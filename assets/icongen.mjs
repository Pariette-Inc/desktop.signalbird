// Küçük bir PNG çizici. Bağımlılık yok: zlib + elle PNG parçaları.
// Neden repoya ikili ikon koymak yerine bu var: 1024x1024 bir simgeyi elde
// tutmak zor, üretmek kolay ve renk değişince yeniden çizilebiliyor.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

export const SS = 3; // kenar yumuşatma için üst örnekleme

export function hsl(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// ── Şekil yardımcıları (hepsi "içinde mi?" döndürür) ──────────────────────
export function inRR(x, y, cx, cy, w, h, r) {
  // Yuvarlatılmış dikdörtgen. Köşe yarıçapı yalnız KÖŞELERDE devreye girer;
  // kenar bantlarında (dx<=0 ya da dy<=0) düz kenar geçerlidir.
  const dx = Math.abs(x - cx) - (w / 2 - r);
  const dy = Math.abs(y - cy) - (h / 2 - r);
  if (dx <= 0 && dy <= 0) return true;
  if (dx <= 0) return dy <= r;
  if (dy <= 0) return dx <= r;
  return Math.hypot(dx, dy) <= r;
}
export function inRect(x, y, cx, cy, w, h) {
  return Math.abs(x - cx) <= w / 2 && Math.abs(y - cy) <= h / 2;
}
export function inRing(x, y, cx, cy, r0, r1, a0, a1) {
  const d = Math.hypot(x - cx, y - cy);
  if (d < r0 || d > r1) return false;
  let a = Math.atan2(y - cy, x - cx);
  if (a < a0) a += Math.PI * 2;
  return a >= a0 && a <= a1;
}
export function inDisc(x, y, cx, cy, r) {
  return Math.hypot(x - cx, y - cy) <= r;
}
export function onPath(x, y, pts, w) {
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const vx = x1 - x0, vy = y1 - y0;
    const t = Math.max(0, Math.min(1, ((x - x0) * vx + (y - y0) * vy) / (vx * vx + vy * vy)));
    if (Math.hypot(x - (x0 + t * vx), y - (y0 + t * vy)) <= w / 2) return true;
  }
  return false;
}

/** paint(x, y) → [r,g,b,a] (a: 0..1) ya da null. Üst örneklemeli. */
export function render(size, paint) {
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = paint(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
          if (c) { r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3]; }
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      px[i] = a ? Math.round(r / a) : 0;
      px[i + 1] = a ? Math.round(g / a) : 0;
      px[i + 2] = a ? Math.round(b / a) : 0;
      px[i + 3] = Math.round((a / n) * 255);
    }
  }
  return px;
}

export function writePng(path, size, px) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

export { mix };
