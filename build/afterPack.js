const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

/**
 * YEREL derlemeler için ad-hoc imza.
 *
 * ── Neden gerekli ───────────────────────────────────────────────────────
 * `npm run dist` yapılandırmayı `mac.identity=null` ile eziyor; electron-builder
 * o durumda imzalamayı tamamen atlıyor ve Apple Silicon'da İMZASIZ BİR PAKET
 * HİÇ AÇILMIYOR - çift tıklayınca macOS "zarar görmüş" der. `codesign -s -`
 * ad-hoc mühürler: sertifika gerekmez, uygulama bu makinede açılır.
 *
 * ── Neden koşullu ───────────────────────────────────────────────────────
 * `npm run dist:release` gerçek Developer ID sertifikasıyla imzalıyor ve
 * sonrasında notarize ediyor. Orada ad-hoc mühür vurmak en iyi ihtimalle
 * gereksiz, en kötüsünde sertleştirilmiş çalışma zamanı izinlerini taşıyan
 * imzayı bozar. Kimlik null DEĞİLSE burada hiçbir şey yapılmaz.
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  // `identity: null` yalnız yerel derlemede olur (bkz. package.json `dist`).
  if (context.packager.platformSpecificBuildOptions.identity !== null) return;

  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);

  // --deep: çerçeveler ve yardımcı süreçler de mühürlensin. Apple bunu dağıtım
  // imzası için önermiyor ama ad-hoc mühürde tek pratik yol bu - dağıtım
  // imzasını zaten electron-builder kendi atıyor.
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
};
