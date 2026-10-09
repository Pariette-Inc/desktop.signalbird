const { contextBridge, ipcRenderer } = require('electron');

/**
 * Menü çubuğunu besleyen köprü.
 *
 * ── Neden burada, ana süreçte değil ─────────────────────────────────────
 * Panelin oturum jetonu `localStorage['token']`'da. Ana süreç oraya
 * erişemez ve erişebilseydi bile ikinci bir kimlik yolu açmış olurduk.
 * Burada, sayfanın KENDİ kaynağında ve kendi jetonuyla okuyoruz: masaüstü
 * uygulaması panelden fazla hiçbir şey göremez.
 *
 * ── Sayfaya hiçbir şey EKLENMEZ ─────────────────────────────────────────
 * `contextBridge` yalnız tek yönlü bir dinleyici açar (ana süreç → sayfa).
 * Sayfaya global bir nesne koymak, signalbird.io'yu masaüstünde farklı
 * davranmaya iten bir kapı olurdu; panel kodu bu uygulamadan habersiz kalmalı.
 * Tek istisna oturum yenilemedir: yenilenen jeton panelin deposuna yazılır
 * (bkz. `refreshSession`).
 */

const POLL_MS = 60_000;

/** Oturum yenileme aralığı. Sunucu 24 saatten genç jetonu zaten aynen döner. */
const REFRESH_MS = 6 * 60 * 60 * 1000;

let apiUrl = null;

/**
 * API kökü ana süreçten gelir (`SIGNALBIRD_API_URL`, varsayılan
 * live.signalbird.io/api). Sayfanın kökeninden TÜRETİLMEZ: `signalbird.io/api`
 * yalnız geliştirmedeki vekildir, canlıda 501 döner.
 */
async function apiBase() {
  if (!apiUrl) apiUrl = (await ipcRenderer.invoke('sb:config')).apiUrl;

  return apiUrl;
}

function token() {
  try {
    // Gömülü panel `sessionStorage` kullanıyor (bkz. signalbird.web
    // lib/session.ts); masaüstünde gömme yok ama sıra korunuyor ki
    // ileride biri gömme kabuğunu burada açarsa yanlış jeton okunmasın.
    return window.sessionStorage.getItem('token') || window.localStorage.getItem('token');
  } catch {
    return null;
  }
}

function teamId() {
  try {
    return window.sessionStorage.getItem('current_team_id') || window.localStorage.getItem('current_team_id');
  } catch {
    return null;
  }
}

async function request(path, method = 'GET') {
  const auth = token();

  if (!auth) throw new Error('oturum yok');

  const headers = { Accept: 'application/json', Authorization: `Bearer ${auth}` };
  const team = teamId();

  if (team) headers['X-Team-Id'] = team;

  const response = await fetch(`${await apiBase()}${path}`, { method, headers });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  return response.json();
}

/**
 * Bildirimin açılacağı ekran - web'deki `useAlertFeed.screenHref` ile aynı
 * kural. Bilinmeyen bildirim bildirimler sayfasına düşer.
 */
function notificationHref(data) {
  if (data?.screen === 'WatcherDetail' && data.watcher_id) return `/watchers/${data.watcher_id}`;
  if (data?.screen === 'RadioEvent' && data.radio_event_id) return `/radio?event=${data.radio_event_id}`;
  if (typeof data?.url === 'string' && data.url.startsWith('/')) return data.url;

  return '/alerts';
}

async function poll() {
  try {
    /*
     * Üç uç, tek tur. Ayrı ayrı beklemek menü çubuğunu bir uç yavaşken
     * hepsinden mahrum bırakırdı; `allSettled` biri düşse de diğerlerini
     * gösterir.
     */
    const [events, unread, notifications] = await Promise.allSettled([
      request('/v1/panel/radio/events?per_page=8'),
      request('/notifications/unread-count'),
      request('/notifications'),
    ]);

    /*
     * Menüde yalnız OKUNMAMIŞ bildirimler, en yeni 5'i. Metin sunucunun düz
     * `title`/`body` alanıdır; panel bazılarını çeviri anahtarından üretir,
     * menü çubuğu sözlüğü taşımaz.
     */
    const list = notifications.status === 'fulfilled' && Array.isArray(notifications.value) ? notifications.value : [];

    ipcRenderer.send('sb:poll', {
      events: events.status === 'fulfilled' ? (events.value?.data ?? events.value ?? []) : [],
      unread: unread.status === 'fulfilled' ? Number(unread.value?.count ?? 0) : 0,
      notifications: list
        .filter((n) => !n.read_at)
        .slice(0, 5)
        .map((n) => ({
          id: n.id,
          title: n.title || 'Bildirim',
          body: n.body || '',
          created_at: n.created_at,
          href: notificationHref(n.data),
        })),
      error: events.status === 'rejected' ? String(events.reason?.message ?? events.reason) : null,
    });
  } catch (error) {
    ipcRenderer.send('sb:poll', { events: [], unread: 0, notifications: [], error: String(error?.message ?? error) });
  }
}

/**
 * Menüden açılan bildirim okundu sayılır - paneldeki zille aynı davranış.
 * Yönlendirme istekten SONRA: sayfa değişince bekleyen istek kesilir.
 */
ipcRenderer.on('sb:read', async (_event, { id, path }) => {
  try {
    await request(`/notifications/${encodeURIComponent(id)}/read`, 'POST');
  } catch {
    // Okundu yazılamasa da bildirim açılır.
  }

  navigate(path);
});

/*
 * İlk tur biraz gecikmeli: sayfa açılır açılmaz jeton henüz yazılmamış
 * olabilir (giriş akışı) ve menü çubuğu boşuna "oturum yok" derdi.
 */
setTimeout(poll, 4000);
setInterval(poll, POLL_MS);

/**
 * Oturumu kullanıldıkça uzatır (`POST /auth/refresh`).
 *
 * Sunucu jetonu girişten 30 gün sonra düşürür; masaüstünde bu, ayda bir
 * zorunlu giriş demekti. Uygulama açıkken yenileme yapılır: sunucu taze bir
 * jeton verir, burada panelin okuduğu yere (`localStorage['token']`) yazılır.
 * Panel jetonu her istekte depodan okuduğu için (signalbird.web lib/axios.ts)
 * bir sonraki istek yenisiyle gider; eskisi sunucuda birkaç dakika daha
 * geçerli kalır ki o an uçuştaki istekler 401 yemesin.
 *
 * Sayfaya global bir şey eklenmez ama panelin deposuna YAZILIR; bu dosyanın
 * panelin kendi oturumuna dokunduğu tek yer burasıdır. Gömülü oturuma
 * (`sessionStorage`) dokunulmaz, sunucu gömme jetonunu zaten yenilemez.
 *
 * Hata sessizdir: uç yoksa (eski sunucu) ya da ağ yoksa bir sonraki turda
 * yeniden denenir, menü çubuğu etkilenmez.
 */
async function refreshSession() {
  try {
    if (window.sessionStorage.getItem('sb_embed') === '1') return;
    if (!window.localStorage.getItem('token')) return;

    const result = await request('/auth/refresh', 'POST');

    // Yanıt beklenirken çıkış yapıldıysa ya da hesap değiştiyse yazma.
    if (result?.rotated && result.token && window.localStorage.getItem('token')) {
      window.localStorage.setItem('token', result.token);
    }
  } catch {
    // Sessiz: bkz. yukarı.
  }
}

setTimeout(refreshSession, 10_000);
setInterval(refreshSession, REFRESH_MS);

ipcRenderer.on('sb:refresh', poll);

/*
 * Ana süreçten gelen yönlendirme. `location.assign` kullanılıyor, Next
 * router'ına dokunulmuyor: panel kendi yönlendiricisiyle çalışsın, biz
 * yalnız adresi söyleyelim.
 */
function navigate(path) {
  try {
    // Yol dil önekiyle geliyor olabilir; gelmiyorsa mevcut önek korunur.
    const prefix = location.pathname.match(/^\/(tr|en)(?=\/|$)/)?.[0] ?? '';

    location.assign(path.startsWith('/tr') || path.startsWith('/en') ? path : prefix + path);
  } catch {
    location.assign(path);
  }
}

ipcRenderer.on('sb:navigate', (_event, path) => navigate(path));

contextBridge.exposeInMainWorld('signalbirdDesktop', { version: 1 });
