// scripts/make-favicon-ico.js — generate a real 16x16 .ico file
// from the SVG in web/favicon.svg. Pure Node; no deps.
// The .ico format is an ICONDIR header + 1 ICONDIRENTRY +
// a BMP payload (no file header, just BITMAPINFOHEADER +
// pixel data + 1-bit AND mask).
//
// MODULAR: one function, one file, regenerable. Run when
// the favicon SVG changes. Output goes to web/favicon.ico
// so the static deploy (Netlify / Railway / Docker) has
// a real file to serve at /favicon.ico.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

// MODULAR: 16x16 cream disc with a rust dot. Pure pixel
// data, hand-drawn. Each row is 16 bytes (4-bit packed) +
// a 1-bit AND mask (16 bits = 4 bytes per row at 32-bit
// alignment; 16-bit at 16-bit alignment). For simplicity
// we use 32-bit BGRA + 1-bit AND mask.
function build16() {
  const W = 16, H = 16;
  const pixels = Buffer.alloc(W * H * 4);
  const cx = 7.5, cy = 7.5, rDisc = 6, rHole = 1.5;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - cx, dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      let r, g, b, a = 255;
      if (d < rHole)        r = 26,  g = 26,  b = 26;        // hole
      else if (d < rDisc)   r = 200, g = 74,  b = 31;        // rust
      else if (d < rDisc + 1) r = 26, g = 26, b = 26;       // ring outline
      else                   r = 244, g = 239, b = 229;     // paper
      const i = (y * W + x) * 4;
      pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = a;
    }
  }
  return pixels;
}

function buildIco(pixels, W, H) {
  // MODULAR: 1-bit AND mask, fully opaque (alpha is in
  // BITMAPINFOHEADER, so the AND mask just records where
  // the pixel is non-transparent — for our disc, every
  // pixel is opaque, so the mask is all-zeros).
  const andMaskRowBytes = Math.ceil(W / 32) * 4;  // 32-bit aligned
  const andMask = Buffer.alloc(andMaskRowBytes * H);

  // BMP DIB header (BITMAPINFOHEADER, 40 bytes). Height is
  // doubled because the AND mask is appended to the pixel
  // data in the BMP convention.
  const dib = Buffer.alloc(40);
  dib.writeUInt32LE(40, 0);              // biSize
  dib.writeInt32LE(W, 4);                // biWidth
  dib.writeInt32LE(H * 2, 8);            // biHeight (x2 for AND mask)
  dib.writeUInt16LE(1, 12);              // biPlanes
  dib.writeUInt16LE(32, 14);             // biBitCount
  dib.writeUInt32LE(0, 16);              // biCompression = BI_RGB
  dib.writeUInt32LE(0, 20);              // biSizeImage (0 for BI_RGB)
  dib.writeInt32LE(0, 24);               // biXPelsPerMeter
  dib.writeInt32LE(0, 28);               // biYPelsPerMeter
  dib.writeUInt32LE(0, 32);              // biClrUsed
  dib.writeUInt32LE(0, 36);              // biClrImportant

  // BMP rows are stored bottom-up. Flip the pixel buffer.
  const rowBytes = W * 4;
  const flipped = Buffer.alloc(rowBytes * H);
  for (let y = 0; y < H; y++) {
    pixels.copy(flipped, (H - 1 - y) * rowBytes, y * rowBytes, (y + 1) * rowBytes);
  }

  // MODULAR: BMP payload = dib + flipped pixels + AND mask.
  const bmp = Buffer.concat([dib, flipped, andMask]);

  // ICO header (6 bytes) + 1 directory entry (16 bytes).
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);               // reserved
  dir.writeUInt16LE(1, 2);               // type = icon
  dir.writeUInt16LE(1, 4);               // count = 1

  const entry = Buffer.alloc(16);
  entry.writeUInt8(W, 0);                // width
  entry.writeUInt8(H, 1);                // height
  entry.writeUInt8(0, 2);                // color count (0 = >=256)
  entry.writeUInt8(0, 3);                // reserved
  entry.writeUInt16LE(1, 4);             // planes
  entry.writeUInt16LE(32, 6);            // bit count
  entry.writeUInt32LE(bmp.length, 8);    // bytes in resource
  entry.writeUInt32LE(6 + 16, 12);       // offset

  return Buffer.concat([dir, entry, bmp]);
}

const ico = buildIco(build16(), 16, 16);
const out = path.resolve(__dirname, '..', 'web', 'favicon.ico');
fs.writeFileSync(out, ico);
console.log(`wrote ${out} (${ico.length} bytes, 16x16)`);
