import { hsl, mix, inRR, inRing, inDisc, render, writePng } from './icongen.mjs';

// Signalbird: Han moru squircle + yayılan telsiz dalgaları.
// Renk panelin `--primary`sinden (hsl 251 78% 48%) türetildi; masaüstü
// simgesi web ile aynı mürekkebi kullansın diye.
const S = 1024, C = S / 2;
const TOP = hsl(251, 88, 64), BOT = hsl(251, 82, 36), INK = [255, 255, 255];
const OX = 322, OY = 706; // dalgaların çıktığı nokta

const px = render(S, (x, y) => {
  if (!inRR(x, y, C, C, 824, 824, 190)) return null;
  const t = (x + y) / (2 * S);
  const bg = mix(TOP, BOT, t);
  const wave =
    inDisc(x, y, OX, OY, 54) ||
    inRing(x, y, OX, OY, 152, 196, -Math.PI / 2, 0) ||
    inRing(x, y, OX, OY, 272, 316, -Math.PI / 2, 0) ||
    inRing(x, y, OX, OY, 392, 436, -Math.PI / 2, 0);
  return wave ? [...INK, 1] : [...bg, 1];
});

writePng(new URL('./icon.png', import.meta.url).pathname, S, px);
