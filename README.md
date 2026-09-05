# Signalbird Masaüstü

Panel + **menü çubuğunda telsiz ve bildirimler**. macOS için Electron.

> 5 Eyl 2026, Ahmet: "Signalbird için masaüstü uygulama yapılması güzel olur.
> Bir de Mac sağ üstteki saat falan olan alanın yanına son radio ve bildirimleri
> okuma zımbırtısı yaptık mı üf süper."

## Ne yapar

1. `signalbird.io` panelini kendi penceresinde açar.
2. Menü çubuğuna yerleşir: **son 8 telsiz olayı** başlıklarıyla listelenir,
   okunmamış bildirim sayısı simgenin yanında durur. Bir olaya tıklamak
   pencereyi açıp doğrudan o olayın künyesine gider.
3. `error`/`critical` olaylarda macOS bildirimi gösterir — **yalnız onlarda**.
   Her olay için bildirim, menü çubuğunun varlık sebebini yok ederdi.

## Kurulum (geliştirme)

```bash
npm install
npm start
```

Başka bir kuruluma bağlanmak için: `SIGNALBIRD_URL=https://… npm start`

## Paketleme

```bash
npm run dist            # .dmg + .zip (bu makinenin mimarisi)
npm run dist:universal  # Intel + Apple Silicon tek pakette
```

İmzalama ve noter onayı (notarization) YAPILANDIRILMADI — imzasız uygulama ilk
açılışta "geliştirici doğrulanamadı" uyarısı verir (sağ tık → Aç ile geçilir).
Dağıtılacaksa Apple Developer hesabı ve `electron-builder` `mac.notarize`
ayarları gerekir.

## Kararlar

- **Panel KOPYALANMAZ.** Uygulama web panelini yükler. Ekranları yeniden
  yazmak, ilk web güncellemesinde iki farklı Signalbird demekti. Masaüstünün
  kattığı şey ekran değil YERLEŞİM: pencere, menü çubuğu, sistem bildirimi.
- **Menü çubuğu verisi sayfanın kendi jetonuyla okunur** (`src/preload.js`).
  Ana süreç `localStorage`'a erişemez ve erişebilseydi bile ikinci bir kimlik
  yolu açmış olurduk. Masaüstü uygulamasının panelden fazla yetkisi yok.
- **Oturum: son kullanım + 30 gün** (`src/session.js`). Electron oturumu
  kendiliğinden sonsuz yaşar; çalınan bir dizüstü sahibinin panelini de
  götürürdü. Süre GİRİŞTEN değil KULLANIMDAN sayılır: her gün açan hiç giriş
  yapmaz, bir ay dokunmayan yeniden girer. Süre dolduğunda sessizce çıkarmak
  yerine bildirim gösterilir.
- **Dış bağlantılar tarayıcıda açılır.** Müşterinin sitesine uygulama
  penceresinden gitmek, o sayfayı Signalbird oturumunun içinde çalıştırmak
  olurdu.
- **Menü çubuğunda sayı değil OLAY yazar.** "3 yeni olay" satırı için
  uygulamayı açmak gerekiyordu; menü çubuğunun tek işi açmadan okutmak.
