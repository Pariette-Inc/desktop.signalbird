const { app } = require('electron');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');

/**
 * "Son oturum + 30 gün" kuralı.
 *
 * Electron oturumu kendiliğinden SONSUZ yaşar: `localStorage` ve çerezler
 * kalıcı bölümde durur, uygulama kapansa da kalır. Yani hiçbir şey yapmazsak
 * bir kere giriş yapan makine sonsuza kadar açık kalırdı - çalınan ya da
 * ikinci el verilen bir dizüstü, sahibinin panelini de birlikte götürürdü.
 *
 * Kural şudur: her AÇILIŞTA ve düzenli aralıklarla "son görüldü" damgası
 * yazılır. Açılışta damga 30 günden eskiyse oturum verisi TEMİZLENİR ve
 * kullanıcı giriş ekranına düşer.
 *
 * Süre KULLANIMDAN sayılır, girişten değil ("son oturum + 30 gün"): her gün
 * açan biri hiç giriş yapmak zorunda kalmaz, bir ay dokunmayan yeniden girer.
 */

const WINDOW_DAYS = 30;
const HEARTBEAT_MS = 5 * 60 * 1000;

function statePath() {
  return join(app.getPath('userData'), 'session-state.json');
}

function read() {
  try {
    return JSON.parse(readFileSync(statePath(), 'utf8'));
  } catch {
    return {};
  }
}

function write(state) {
  try {
    mkdirSync(dirname(statePath()), { recursive: true });
    writeFileSync(statePath(), JSON.stringify(state, null, 2));
  } catch {
    // Damga yazılamazsa oturum bir sonraki açılışta süresi dolmuş SAYILMAZ
    // (aşağıdaki kontrol damga yokken temizlemiyor): disk hatası yüzünden
    // kullanıcıyı dışarı atmak, yanlış yönde bir hata olurdu.
  }
}

/** Damgayı şimdiye çeker. Açılışta ve periyodik olarak çağrılır. */
function touch() {
  const state = read();

  write({ ...state, lastSeenAt: Date.now() });
}

/**
 * Oturum süresi dolduysa temizler.
 *
 * @returns {Promise<boolean>} true = oturum silindi (yeniden giriş gerekir)
 */
async function expireIfStale(session) {
  const { lastSeenAt } = read();

  // Damga yoksa bu ilk açılıştır (ya da damga yazılamıyor) - temizleme.
  if (!lastSeenAt) {
    touch();

    return false;
  }

  const days = (Date.now() - lastSeenAt) / 86_400_000;

  if (days < WINDOW_DAYS) {
    touch();

    return false;
  }

  // `clearStorageData` çerezleri de localStorage'ı da alır; jeton ikisinden
  // hangisindeyse (panel localStorage kullanıyor) gitmiş olur.
  await session.clearStorageData({
    storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage'],
  });

  touch();

  return true;
}

/** Uygulama açıkken damgayı taze tutar. */
function startHeartbeat() {
  const timer = setInterval(touch, HEARTBEAT_MS);

  // Kapanışta son bir damga: uygulamayı bir ay boyunca AÇIK bırakan kişi,
  // kapattığı gün değil açtığı gün üzerinden sayılmasın.
  app.on('before-quit', () => {
    clearInterval(timer);
    touch();
  });
}

module.exports = { WINDOW_DAYS, expireIfStale, startHeartbeat, touch, statePath };
