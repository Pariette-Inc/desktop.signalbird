# Signalbird Masaüstü

Panel + **menü çubuğunda telsiz ve bildirimler**. macOS için Electron.

> 5 Eyl 2026, Ahmet: "Signalbird için masaüstü uygulama yapılması güzel olur.
> Bir de Mac sağ üstteki saat falan olan alanın yanına son radio ve bildirimleri
> okuma zımbırtısı yaptık mı üf süper."
>
> 6 Eyl 2026: "Programı açtığım anda login olucam, normal web sitesini görmeye
> ihtiyacım yok. dmg formatında app olacak, click ile çalışmalı, npm start
> değil."

## Ne yapar

1. Doğrudan **panelde** açılır (`signalbird.io/tr/dashboard`) — tanıtım
   sayfasında değil. Buraya gelen kişi zaten müşteri.
2. Menü çubuğuna yerleşir: **son 8 telsiz olayı** başlıklarıyla listelenir,
   okunmamış bildirim sayısı simgenin yanında durur. Bir olaya tıklamak
   pencereyi açıp doğrudan o olayın künyesine gider.
3. `error`/`critical` olaylarda macOS bildirimi gösterir — **yalnız onlarda**.
   Her olay için bildirim, menü çubuğunun varlık sebebini yok ederdi.

## Kurulum

`npm` gerekmez — `dist/` altındaki **DMG'yi açıp uygulamayı Applications'a
sürükleyin**, sonra çift tıklayın.

Paket **ad-hoc imzalıdır** (`build/afterPack.js`). Apple Silicon'da imzasız bir
paket hiç açılmaz; ad-hoc mühür bunu çözer ve Apple geliştirici sertifikası
gerektirmez. Dağıtım imzası DEĞİLDİR: DMG başka bir Mac'e **indirilerek**
giderse Gatekeeper karantinası devreye girer, ilk açılışta sağ tık → Aç gerekir
(ya da `xattr -dr com.apple.quarantine /Applications/Signalbird.app`).
Gerçek dağıtım için Apple Developer hesabı ve `mac.notarize` gerekir.

## Paketleme

```bash
npm run dist            # .dmg + .zip (bu makinenin mimarisi)
npm run dist:universal  # Intel + Apple Silicon tek pakette
npm run icon            # assets/icon.png'i yeniden çizer
```

Uygulama simgesi repoda elle konmuş bir ikili değil; `assets/make-icon.mjs`
onu bağımlılıksız üretiyor (zlib + elle PNG parçaları). Renk panelin
`--primary`sinden (Han moru) geliyor — masaüstü web ile aynı mürekkebi
kullansın diye.

## Geliştirme

```bash
npm install
npm start
```

Başka bir kuruluma bağlanmak için: `SIGNALBIRD_URL=https://… npm start`

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
