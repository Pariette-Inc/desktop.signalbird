const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

/**
 * Paketlemeden SONRA ad-hoc imza.
 *
 * `mac.identity: null` yazdığımız için electron-builder imzalamayı tamamen
 * atlıyor. Sonuç, Apple Silicon'da ÇALIŞMAYAN bir uygulama: arm64'te
 * imzasız bir paket başlatılamaz, macOS "zarar görmüş" der ve açmaz.
 * Paketten çıkan `.app`'in imzası yalnız Electron ikilisinin kendi
 * linker imzasıdır; paket kaynakları mühürlenmemiştir (Sealed Resources=none).
 *
 * `codesign -s -` ad-hoc mühürler: Apple geliştirici sertifikası GEREKMEZ,
 * uygulama bu makinede ve kopyalandığı her Mac'te çift tıklamayla açılır.
 * Dağıtım imzası değildir — DMG başka birine e-postayla gönderilirse
 * Gatekeeper karantinası yine devreye girer (bkz. README).
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);

  // --deep: çerçeveler ve yardımcı süreçler de mühürlensin. Apple bunu
  // dağıtım imzası için önermiyor ama ad-hoc mühürde tek pratik yol bu.
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
};
