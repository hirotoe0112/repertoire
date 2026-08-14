// PWA 用のアイコン (鍵盤のモチーフ) を依存ライブラリ無しで生成する。
// node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const BG = [28, 25, 23]; // #1c1917
const WHITE = [245, 245, 244];
const BLACK = [24, 24, 27];
const ACCENT = [217, 119, 6]; // 琥珀色のライン

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(width, height, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  const raw = Buffer.alloc(height * (width * 3 + 1));
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixels(x, y);
      raw[p++] = r;
      raw[p++] = g;
      raw[p++] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function keyboardIcon(size) {
  const pad = Math.round(size * 0.18);
  const top = Math.round(size * 0.3);
  const bottom = size - pad;
  const left = pad;
  const right = size - pad;
  const whiteCount = 7;
  const keyWidth = (right - left) / whiteCount;
  // 黒鍵は 2 本 + 3 本の並び (白鍵 0-1, 1-2, 3-4, 4-5, 5-6 の境目)
  const blackAt = [1, 2, 4, 5, 6];
  const blackWidth = keyWidth * 0.58;
  const blackBottom = top + (bottom - top) * 0.6;
  const accentTop = Math.round(size * 0.2);
  const accentBottom = accentTop + Math.max(2, Math.round(size * 0.028));

  return (x, y) => {
    if (y >= accentTop && y < accentBottom && x >= left && x < right) return ACCENT;
    if (y < top || y >= bottom || x < left || x >= right) return BG;
    for (const i of blackAt) {
      const center = left + i * keyWidth;
      if (y < blackBottom && Math.abs(x - center) < blackWidth / 2) return BLACK;
    }
    // 白鍵の境目に細い線を入れる
    const offset = (x - left) % keyWidth;
    if (offset < Math.max(1, size * 0.008)) return BG;
    return WHITE;
  };
}

for (const size of [192, 512]) {
  writeFileSync(`public/icon-${size}.png`, png(size, size, keyboardIcon(size)));
  console.log(`public/icon-${size}.png`);
}
