const { app, BrowserWindow, Menu, Notification, Tray, ipcMain, nativeImage, session, shell } = require('electron');
const { join } = require('node:path');

const { WINDOW_DAYS, expireIfStale, startHeartbeat } = require('./session');

/**
 * Signalbird masaüstü uygulaması.
 *
 * İki iş yapar ve ikincisi asıl sebebidir:
 *
 *   1. Paneli kendi penceresinde açar (tarayıcı sekmesi aramaya son).
 *   2. MENÜ ÇUBUĞUNA yerleşir: son telsiz olayları ve okunmamış bildirimler
 *      saatin yanında durur, tıklanınca ilgili ekran açılır.
 *      (5 Eyl 2026, Ahmet: "Mac'te saatin yanına son radio ve bildirimleri
 *      okuma zımbırtısı yaptık mı üf süper.")
 *
 * ── Panel KOPYALANMAZ ───────────────────────────────────────────────────
 * Uygulama signalbird.io'yu yükler. Ekranları yeniden yazmak, ilk web
 * güncellemesinde iki farklı Signalbird demekti. Masaüstünün kattığı şey
 * ekran değil YERLEŞİM: pencere, menü çubuğu, sistem bildirimi.
 *
 * ── Menü çubuğu veriyi NEREDEN alıyor ───────────────────────────────────
 * Panelin oturum jetonu `localStorage`'ta. Ana süreç oraya erişemez; bu
 * yüzden veriyi pencerenin KENDİSİ çeker (preload → `sb:poll`) ve IPC ile
 * ana sürece verir. Ayrı bir kimlik ya da ikinci bir jeton üretmiyoruz -
 * masaüstü uygulamasının panelden fazla yetkisi yok.
 */

/*
 * Uygulama PANELDE açılır, tanıtım sitesinde değil.
 *
 * (6 Eyl 2026, Ahmet: "programı açtığım anda login olucam, normal web
 * sitesini görmeye ihtiyacım yok.")
 *
 * Önceki sürüm `signalbird.io/tr` yüklüyordu; orası `(marketing)` grubunun
 * ana sayfası. Oturum açıkken bile karşılama sayfası açılıyor, panele
 * gitmek için ayrıca tıklamak gerekiyordu. Masaüstü uygulamasının pazarlama
 * sayfasını göstermesi için hiçbir sebep yok: buraya gelen kişi zaten
 * müşteri.
 */
const ORIGIN = process.env.SIGNALBIRD_URL || 'https://signalbird.io';
const HOME = '/tr/dashboard';
const APP_URL = ORIGIN + HOME;
const PARTITION = 'persist:signalbird';

let mainWindow = null;
let tray = null;
/** Menü çubuğunun gösterdiği son veri. Pencere kapalıyken de elde kalır. */
let latest = { events: [], unread: 0, error: null, at: null };
/** Bildirim gösterilen olaylar - aynı olay iki kez masaüstü bildirimi vermesin. */
const notified = new Set();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    title: 'Signalbird',
    // macOS'ta başlık çubuğu gizli ama trafik ışıkları duruyor: pencere
    // uygulamaya değil web sayfasına ait hissettirmesin.
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0b0d12',
    webPreferences: {
      partition: PARTITION,
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(APP_URL);

  mainWindow.webContents.on('did-navigate', (_event, url) => bounceHome(url));

  /*
   * Dış bağlantılar TARAYICIDA açılır.
   *
   * Uygulama penceresi oturumlu bir yüzeydir; müşterinin sitesine ya da bir
   * e-posta bağlantısına oradan gitmek, o sayfayı Signalbird oturumunun
   * içinde çalıştırmak olurdu.
   */
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);

    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isInternal(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // macOS'ta kapatmak ÇIKMAK değildir: menü çubuğu simgesi çalışmaya devam
  // etsin diye pencere yalnız gizlenir.
  mainWindow.on('close', (event) => {
    if (!app.isQuitting && process.platform === 'darwin') {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function isInternal(url) {
  try {
    const host = new URL(url).host;

    return host === new URL(APP_URL).host || host.endsWith('.signalbird.io');
  } catch {
    return false;
  }
}

/**
 * Tanıtım sitesinin KÖKÜ panele çevrilir.
 *
 * Yalnız kök: `/`, `/tr`, `/en`. Çıkış yapınca ya da panel bir sebeple ana
 * sayfaya atınca, masaüstünde karşımıza tanıtım sayfası çıkmasın. Daha
 * geniş bir kural (bütün `(marketing)` yolları) riskli olurdu - sözleşme
 * ya da fatura sayfaları da oradan geçiyor.
 *
 * Giriş yapılmamışsa panel kendisi `/login`'e atar; burada döngü olmaz,
 * çünkü `/login` kök değil.
 */
function bounceHome(url) {
  try {
    const parsed = new URL(url);

    if (!isInternal(url)) return;
    if (!/^\/(tr|en)?\/?$/.test(parsed.pathname)) return;

    const locale = parsed.pathname.match(/^\/(tr|en)/)?.[0] ?? '/tr';

    mainWindow?.loadURL(`${parsed.origin}${locale}/dashboard`);
  } catch {
    // Adres çözülemiyorsa dokunma: yanlış bir yönlendirme, yanlış yerde
    // kalmaktan daha kötü.
  }
}

/** Pencereyi gösterir ve istenen yola götürür. */
function openAt(path) {
  if (!mainWindow) createWindow();

  mainWindow.show();
  mainWindow.focus();

  if (path) {
    mainWindow.webContents.send('sb:navigate', path);
  }
}

// ── Menü çubuğu ────────────────────────────────────────────────────────────

function trayIcon(unread) {
  /*
   * Şablon görüntü (`setTemplateImage`): macOS koyu/açık menü çubuğunda
   * simgeyi kendisi boyar. Renkli bir PNG koysaydık açık temada okunmuyordu.
   *
   * Simge dosya olarak değil, kodda çizilerek üretiliyor - 16 piksellik bir
   * kuş silueti için repoya ikili dosya koymaya değmez ve okunmamış varken
   * noktalı hâli aynı yerden çıkıyor.
   */
  const svg = unread > 0
    ? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><path d="M2 9c3-5 7-6 11-6-1 4-3 7-7 8l-2 3H2z" fill="black"/><circle cx="13" cy="4" r="3" fill="black"/></svg>'
    : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><path d="M2 9c3-5 7-6 11-6-1 4-3 7-7 8l-2 3H2z" fill="black"/></svg>';

  const image = nativeImage.createFromDataURL(
    'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')
  );

  image.setTemplateImage(true);

  return image;
}

function relative(iso) {
  if (!iso) return '';

  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);

  if (minutes < 1) return 'şimdi';
  if (minutes < 60) return `${minutes} dk`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} sa`;

  return `${Math.round(minutes / 1440)} gün`;
}

function buildTrayMenu() {
  const items = [];

  if (latest.error) {
    items.push({ label: `Okunamadı: ${latest.error}`, enabled: false });
  } else if (latest.events.length === 0) {
    items.push({ label: 'Yeni telsiz olayı yok', enabled: false });
  } else {
    /*
     * Menüde OLAYIN KENDİSİ yazar, sayı değil. "3 yeni olay" satırı için
     * uygulamayı açmak gerekiyordu; oysa menü çubuğunun tek işi, açmadan
     * okutmak. Mesajın ilk satırı başlıktır (SDK sözleşmesi).
     */
    for (const event of latest.events.slice(0, 8)) {
      const line = String(event.message || '').split('\n')[0].slice(0, 60);
      const dot = event.level === 'error' || event.level === 'critical' ? '● ' : '';

      items.push({
        label: `${dot}${line}`,
        sublabel: `${event.module_title || event.key || ''} · ${relative(event.occurred_at)}`,
        click: () => openAt(`/radio/events?event=${event.id}`),
      });
    }
  }

  items.push({ type: 'separator' });

  items.push({
    label: latest.unread > 0 ? `Bildirimler (${latest.unread} okunmamış)` : 'Bildirimler',
    click: () => openAt('/notifications'),
  });

  items.push({ label: 'Telsiz akışı', click: () => openAt('/radio/events') });
  items.push({ label: 'Paneli aç', click: () => openAt(null) });
  items.push({ type: 'separator' });
  items.push({ label: 'Şimdi yenile', click: () => mainWindow?.webContents.send('sb:refresh') });
  items.push({ type: 'separator' });
  items.push({ label: 'Çıkış', click: () => { app.isQuitting = true; app.quit(); } });

  tray.setContextMenu(Menu.buildFromTemplate(items));
  tray.setImage(trayIcon(latest.unread));

  // Başlıkta yalnız okunmamış SAYI durur; sıfırken hiçbir şey yazmaz -
  // menü çubuğunda sürekli duran bir "0" gürültüdür.
  tray.setTitle(latest.unread > 0 ? String(latest.unread) : '');
}

/**
 * Yeni ve KRİTİK olaylar için sistem bildirimi.
 *
 * Her olay için bildirim göstermek, menü çubuğunun varlık sebebini yok
 * ederdi: sessiz akış orada durur, kesinti yalnız gerçekten kesinti
 * gerektiren şey içindir.
 */
function notifyCritical(events) {
  for (const event of events) {
    if (!['error', 'critical'].includes(event.level)) continue;
    if (notified.has(event.id)) continue;

    notified.add(event.id);

    const [title, ...rest] = String(event.message || '').split('\n');

    new Notification({
      title: title.slice(0, 80) || 'Signalbird',
      body: rest.join(' ').slice(0, 160) || event.module_title || '',
    })
      .on('click', () => openAt(`/radio/events?event=${event.id}`))
      .show();
  }

  // Küme sınırsız büyümesin: uygulama günlerce açık kalıyor.
  if (notified.size > 500) {
    for (const id of Array.from(notified).slice(0, 250)) notified.delete(id);
  }
}

// ── Açılış ─────────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  const partition = session.fromPartition(PARTITION);

  const expired = await expireIfStale(partition);

  startHeartbeat();

  createWindow();

  tray = new Tray(trayIcon(0));
  tray.setToolTip('Signalbird');
  buildTrayMenu();

  if (expired) {
    // Sessizce giriş ekranına düşürmek "neden çıktım?" sorusunu doğuruyordu.
    new Notification({
      title: 'Signalbird oturumu yenilendi',
      body: `${WINDOW_DAYS} gündür kullanılmadığı için yeniden giriş yapmanız gerekiyor.`,
    }).show();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow?.show();
  });
});

// Pencere kapansa da uygulama menü çubuğunda yaşamaya devam eder.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/** Preload'un getirdiği veri. Hata da bir sonuçtur ve menüde yazılır. */
ipcMain.on('sb:poll', (_event, payload) => {
  latest = {
    events: Array.isArray(payload?.events) ? payload.events : [],
    unread: Number(payload?.unread ?? 0),
    error: payload?.error ?? null,
    at: Date.now(),
  };

  notifyCritical(latest.events);
  buildTrayMenu();
});
