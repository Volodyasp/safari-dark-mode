// Writes the extension icon (night-sky tile, crescent moon, stars) as PNGs into
// extension/icons/. 16/32/48/128 are referenced by the manifest; the larger
// sizes feed the Safari app icon set (scripts/safari-convert.sh).
// Dependency-free: pixels are rasterised here (4x4 supersampling for
// anti-aliasing) and encoded with a minimal PNG writer on top of node:zlib.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const SIZES = [16, 32, 48, 64, 128, 256, 512, 1024];
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

// Scene in unit coordinates (0..1), y down. Rounded tile with a night-sky
// gradient, a soft glow, a crescent (upright, horns to the right like the
// system moon glyph), four-point sparkles and a few small stars.
const TILE_R = 0.225;
const MOON = { cx: 0.45, cy: 0.5, r: 0.3 };
const CUT = { cx: 0.6, cy: 0.46, r: 0.275 };
const SPARKLES = [
  { cx: 0.74, cy: 0.24, r: 0.055 },
  { cx: 0.81, cy: 0.62, r: 0.038 },
  { cx: 0.24, cy: 0.2, r: 0.03 },
];
const DOTS = [
  { cx: 0.2, cy: 0.74, r: 0.011 },
  { cx: 0.64, cy: 0.79, r: 0.009 },
  { cx: 0.33, cy: 0.12, r: 0.008 },
  { cx: 0.88, cy: 0.42, r: 0.009 },
  { cx: 0.13, cy: 0.5, r: 0.008 },
];

const SKY_TOP = [0x22, 0x28, 0x3c];
const SKY_BOTTOM = [0x0d, 0x0f, 0x16];
const MOON_LIGHT = [0xfd, 0xe6, 0x9a];
const MOON_DEEP = [0xe4, 0xb3, 0x45];
const STAR = [0xff, 0xf6, 0xd6];

function lerp(a, b, t) {
  return a + (b - a) * t;
}
function mix(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}
function dist2(x, y, cx, cy) {
  return (x - cx) ** 2 + (y - cy) ** 2;
}

function insideTile(x, y) {
  const r = TILE_R;
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  return dist2(x, y, cx, cy) <= r * r;
}

function insideMoon(x, y) {
  return dist2(x, y, MOON.cx, MOON.cy) <= MOON.r ** 2 && dist2(x, y, CUT.cx, CUT.cy) > CUT.r ** 2;
}

// Four-point sparkle: an astroid |x|^(2/3) + |y|^(2/3) <= r^(2/3).
function insideSparkle(x, y, sp) {
  const dx = Math.abs(x - sp.cx);
  const dy = Math.abs(y - sp.cy);
  return Math.cbrt(dx * dx) + Math.cbrt(dy * dy) <= Math.cbrt(sp.r * sp.r);
}

function insideStar(x, y) {
  return SPARKLES.some((sp) => insideSparkle(x, y, sp)) || DOTS.some((d) => dist2(x, y, d.cx, d.cy) <= d.r ** 2);
}

// Colour of one sub-sample that is inside the tile.
function sampleColor(x, y) {
  if (insideMoon(x, y)) {
    // Lighter towards the upper-left rim, deeper gold towards the inner edge.
    const t = Math.min(1, Math.max(0, (x - MOON.cx + MOON.r) / (2 * MOON.r) * 0.6 + (y - MOON.cy + MOON.r) / (2 * MOON.r) * 0.6));
    return mix(MOON_LIGHT, MOON_DEEP, t);
  }
  if (insideStar(x, y)) {
    return STAR;
  }
  const sky = mix(SKY_TOP, SKY_BOTTOM, Math.min(1, Math.max(0, (x + y) / 2)));
  // Soft glow around the moon.
  const d = Math.max(0, Math.sqrt(dist2(x, y, MOON.cx, MOON.cy)) - MOON.r);
  const glow = d < 0.2 ? (1 - d / 0.2) ** 2 * 0.22 : 0;
  return mix(sky, MOON_LIGHT, glow);
}

// Returns RGBA for one pixel by averaging SS*SS sub-samples.
function shade(px, py, size) {
  let covered = 0;
  const acc = [0, 0, 0];
  for (let sy = 0; sy < SS; sy++) {
    for (let sx = 0; sx < SS; sx++) {
      const x = (px + (sx + 0.5) / SS) / size;
      const y = (py + (sy + 0.5) / SS) / size;
      if (!insideTile(x, y)) continue;
      covered++;
      const c = sampleColor(x, y);
      acc[0] += c[0];
      acc[1] += c[1];
      acc[2] += c[2];
    }
  }
  if (covered === 0) return [0, 0, 0, 0];
  return [
    Math.round(acc[0] / covered),
    Math.round(acc[1] / covered),
    Math.round(acc[2] / covered),
    Math.round((255 * covered) / (SS * SS)),
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
