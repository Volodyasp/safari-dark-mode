// Writes the extension icon (dark rounded square + crescent moon) as PNGs into
// extension/icons/. 16/32/48/128 are referenced by the manifest; the larger
// sizes feed the Safari app icon set (scripts/safari-convert.sh).
// Dependency-free: pixels are rasterised here (4x4 supersampling for
// anti-aliasing) and encoded with a minimal PNG writer on top of node:zlib.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const SIZES = [16, 32, 48, 64, 128, 256, 512, 1024];
const BG = [0x18, 0x1a, 0x1b]; // #181a1b, the dark-theme fallback background
const MOON = [0xf3, 0xd6, 0x7a]; // warm moon on the dark tile
const SS = 4; // supersampling factor per axis
const destDir = path.join(__dirname, '..', 'extension', 'icons');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

// Geometry in unit coordinates (0..1). Rounded square tile, then a crescent =
// big circle minus a smaller circle shifted to the upper right.
function insideTile(x, y) {
  const r = 0.22;
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function insideMoon(x, y) {
  const inOuter = (x - 0.46) ** 2 + (y - 0.52) ** 2 <= 0.30 ** 2;
  const inCut = (x - 0.60) ** 2 + (y - 0.40) ** 2 <= 0.27 ** 2;
  return inOuter && !inCut;
}

// Returns RGBA for one pixel by averaging SS*SS sub-samples.
function shade(px, py, size) {
  let tile = 0;
  let moon = 0;
  for (let sy = 0; sy < SS; sy++) {
    for (let sx = 0; sx < SS; sx++) {
      const x = (px + (sx + 0.5) / SS) / size;
      const y = (py + (sy + 0.5) / SS) / size;
      if (insideTile(x, y)) {
        tile++;
        if (insideMoon(x, y)) moon++;
      }
    }
  }
  const total = SS * SS;
  if (tile === 0) return [0, 0, 0, 0];
  const m = moon / tile; // moon share of the covered area
  return [
    Math.round(BG[0] + (MOON[0] - BG[0]) * m),
    Math.round(BG[1] + (MOON[1] - BG[1]) * m),
    Math.round(BG[2] + (MOON[2] - BG[2]) * m),
    Math.round((255 * tile) / total),
  ];
}

function encodePng(size) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0); // width
  ihdrData.writeUInt32BE(size, 4); // height
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type: RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = chunk('IHDR', ihdrData);

  const rowLength = 1 + size * 4; // filter byte + RGBA pixels
  const raw = Buffer.alloc(rowLength * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * rowLength;
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = shade(x, y, size);
      const px = rowStart + 1 + x * 4;
      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
      raw[px + 3] = a;
    }
  }
  const idat = chunk('IDAT', zlib.deflateSync(raw));

  const iend = chunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

fs.mkdirSync(destDir, { recursive: true });

for (const size of SIZES) {
  const png = encodePng(size);
  fs.writeFileSync(path.join(destDir, `${size}.png`), png);
}

console.log(`wrote icons ${SIZES.join('/')} into ${path.relative(process.cwd(), destDir)}`);
