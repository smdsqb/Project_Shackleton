#!/usr/bin/env node
// Bake a crop of a LOLA polar DEM (raw .IMG/.bin raster) into public/terrain/shackleton.{bin,json} for the simulator.
//
//   node scripts/bake-terrain.mjs --in LDEM_xxx.IMG --width 30336 --height 30336 --type int16 --endian le \
//        --unit 0.5 --res 20 --cx 15200 --cy 14900 --size 1024
//
// --in      raw raster file (no header): int16 or float32
// --width/--height  raster size in pixels (from the .LBL: LINE_SAMPLES / LINES)
// --type    int16 | float32        --endian le | be (LOLA IMG files are little-endian)
// --unit    metres per raw unit (int16 LOLA: 0.5; float32 already in metres: 1)
// --res     metres per pixel (from the .LBL: MAP_RESOLUTION / MAP_SCALE)
// --cx --cy pixel of the Hab site in the raster (column, row). The crop is centred here and the site becomes height 0.
// --size    output grid size in pixels (default 1024). Output = size*size int16 at 0.25 m per step (2 bytes/px).
import fs from 'node:fs';
import path from 'node:path';

const a = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, arr) => (v.startsWith('--') ? [...acc, [v.slice(2), arr[i + 1]]] : acc), []));
const need = ['in', 'width', 'height', 'res', 'cx', 'cy'];
for (const k of need) if (a[k] === undefined) { console.error(`missing --${k}\n`); console.error(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 17).join('\n')); process.exit(1); }
const W = +a.width, H = +a.height, res = +a.res, cx = Math.round(+a.cx), cy = Math.round(+a.cy), size = +(a.size ?? 1024);
const type = a.type ?? 'int16', le = (a.endian ?? 'le') === 'le', unit = +(a.unit ?? (type === 'int16' ? 0.5 : 1));
const buf = fs.readFileSync(a.in), bpp = type === 'int16' ? 2 : 4;
if (buf.length < W * H * bpp) { console.error(`file is ${buf.length} bytes, expected at least ${W * H * bpp}`); process.exit(1); }
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const raw = (x, y) => { const o = (y * W + x) * bpp; return type === 'int16' ? dv.getInt16(o, le) * unit : dv.getFloat32(o, le) * unit; };
const bad = (v) => !Number.isFinite(v) || v <= -30000 * unit || v < -20000 || v > 20000;
const x0 = cx - size / 2, y0 = cy - size / 2;
if (x0 < 0 || y0 < 0 || x0 + size > W || y0 + size > H) { console.error('crop falls outside the raster; reduce --size or move --cx/--cy'); process.exit(1); }
const site = raw(cx, cy);
if (bad(site)) { console.error('site pixel is a no-data value; pick a different --cx/--cy'); process.exit(1); }
const STEP = 0.25, out = new Int16Array(size * size);
let last = 0, lo = Infinity, hi = -Infinity, voids = 0;
for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
  let v = raw(x0 + i, y0 + j);
  if (bad(v)) { v = last; voids++; } else { v -= site; last = v; }
  const q = Math.max(-32768, Math.min(32767, Math.round(v / STEP)));
  out[j * size + i] = q; lo = Math.min(lo, v); hi = Math.max(hi, v);
}
const dir = path.resolve('public/terrain'); fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'shackleton.bin'), Buffer.from(out.buffer));
fs.writeFileSync(path.join(dir, 'shackleton.json'), JSON.stringify({ n: size, res, scale: STEP, source: path.basename(a.in), siteElevationM: site, reliefM: [lo, hi] }, null, 2));
console.log(`baked ${size}x${size} @ ${res} m/px (${((size * res) / 1000).toFixed(1)} km square), relief ${lo.toFixed(0)}..${hi.toFixed(0)} m, ${voids} void px filled`);
