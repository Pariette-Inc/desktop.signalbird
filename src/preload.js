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
 */

const POLL_MS = 60_000;

/** Panelin API kökü. Sayfa aynı alan adında, `/api` altında. */
function apiBase() {
  return `${location.origin}/api`;
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

async function get(path) {
  const auth = token();

  if (!auth) throw new Error('oturum yok');

  const headers = { Accept: 'application/json', Authorization: `Bearer ${auth}` };
  const team = teamId();

  if (team) headers['X-Team-Id'] = team;

  const response = await fetch(`${apiBase()}${path}`, { headers });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  return response.json();
}

async function poll() {
  try {
    /*
     * İki uç, tek tur. Ayrı ayrı beklemek menü çubuğunu bir uç yavaşken
     * ikisinden de mahrum bırakırdı; `allSettled` biri düşse de diğerini
     * gösterir.
     */
    const [events, unread] = await Promise.allSettled([
      get('/v1/panel/radio/events?per_page=8'),
      get('/notifications/unread-count'),
    ]);

    ipcRenderer.send('sb:poll', {
      events: events.status === 'fulfilled' ? (events.value?.data ?? events.value ?? []) : [],
      unread: unread.status === 'fulfilled' ? Number(unread.value?.count ?? 0) : 0,
      error: events.status === 'rejected' ? String(events.reason?.message ?? events.reason) : null,
    });
  } catch (error) {
    ipcRenderer.send('sb:poll', { events: [], unread: 0, error: String(error?.message ?? error) });
  }
}

/*
 * İlk tur biraz gecikmeli: sayfa açılır açılmaz jeton henüz yazılmamış
 * olabilir (giriş akışı) ve menü çubuğu boşuna "oturum yok" derdi.
 */
setTimeout(poll, 4000);
setInterval(poll, POLL_MS);

ipcRenderer.on('sb:refresh', poll);

/*
 * Ana süreçten gelen yönlendirme. `location.assign` kullanılıyor, Next
 * router'ına dokunulmuyor: panel kendi yönlendiricisiyle çalışsın, biz
 * yalnız adresi söyleyelim.
 */
ipcRenderer.on('sb:navigate', (_event, path) => {
  try {
    // Yol dil önekiyle geliyor olabilir; gelmiyorsa mevcut önek korunur.
    const prefix = location.pathname.match(/^\/(tr|en)(?=\/|$)/)?.[0] ?? '';

    location.assign(path.startsWith('/tr') || path.startsWith('/en') ? path : prefix + path);
  } catch {
    location.assign(path);
  }
});

contextBridge.exposeInMainWorld('signalbirdDesktop', { version: 1 });
