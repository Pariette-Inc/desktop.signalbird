#!/bin/sh
# Simgeleri SVG kaynaklarından üretir. Gerekli: rsvg-convert (brew install librsvg).
set -e
cd "$(dirname "$0")"
rsvg-convert -w 1024 -h 1024 icon.svg -o icon.png
# Menü çubuğu: macOS şablon görüntüsü (yalnız alfa kullanılır), 18 pt yükseklik.
for name in tray tray-unread; do
  rsvg-convert -h 18 "$name.svg" -o "${name}Template.png"
  rsvg-convert -h 36 "$name.svg" -o "${name}Template@2x.png"
done
