#!/usr/bin/env node
// Bake the LOLA 5 m south-polar DEM (LDEM_875S_5M) into public/terrain/shackleton.{bin,json}.
//
//   node scripts/bake-terrain.mjs --lbl LDEM_875S_5M.LBL --img LDEM_875S_5M.IMG [--size 2048] [--pick 0]
//        [--variant N] [--preview preview.png]
//
// Everything about the raster (size, m/px, scale, projection centre) is read from the .LBL. The script then:
//  1. works out the raster's axis orientation from the data itself (Shackleton is a ~21 km bowl centred on
//     89.9 S, 129.78 E; the correct orientation is the one where a concentric rim ring fits),
//  2. scans Shackleton's rim crest for the best-lit spot (horizon-based illumination estimate, 12 m mast),
//  3. resamples a size x size tile centred on that spot into the simulator's frame (+x east, +z south, site = height 0),
//     so the Horizons sun / Earth azimuths line up with the terrain shadows.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const argv = process.argv.slice(2), a = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? 'true' : argv[++i];
if (!a.lbl || !a.img) { console.error('usage: node scripts/bake-terrain.mjs --lbl X.LBL --img X.IMG [--size 2048] [--pick 0] [--variant N] [--preview out.png]'); process.exit(1); }

// ---------- label ----------
const lbl = fs.readFileSync(a.lbl, 'utf8');
const num = (k) => { const m = lbl.match(new RegExp(`^\\s*${k}\\s*=\\s*([-+0-9.eE]+)`, 'm')); if (!m) throw new Error(`label has no ${k}`); return parseFloat(m[1]); };
const W = num('LINE_SAMPLES'), H = num('LINES'), DNSCALE = num('SCALING_FACTOR'), RES = num('MAP_SCALE');
const C0 = num('SAMPLE_PROJECTION_OFFSET'), R0 = num('LINE_PROJECTION_OFFSET'), RM = num('A_AXIS_RADIUS') * 1000;
if (num('SAMPLE_BITS') !== 16 || !/LSB_INTEGER/.test(lbl)) throw new Error('expected 16-bit little-endian integers');
const fd = fs.openSync(a.img, 'r');
if (fs.fstatSync(fd).size < W * H * 2) throw new Error(`IMG is ${fs.fstatSync(fd).size} bytes, label says ${W * H * 2}`);
console.log(`label: ${W}x${H} px, ${RES} m/px, DN scale ${DNSCALE}, sphere ${RM / 1000} km, centre (${C0}, ${R0})`);

const D2R = Math.PI / 180, b2 = Buffer.alloc(2);
const bad = (v) => !Number.isFinite(v) || v < -20000 || v > 20000;
function h(c, r) { // metres, NaN when outside / no-data
  if (c < 0 || r < 0 || c >= W || r >= H) return NaN;
  fs.readSync(fd, b2, 0, 2, (r * W + c) * 2);
  const v = b2.readInt16LE(0) * DNSCALE; return bad(v) ? NaN : v;
}

// ---------- projection: polar stereographic, true at the pole; 8 candidate axis orientations ----------
const rhoOf = (lat) => 2 * RM * Math.tan(((90 + lat) * D2R) / 2);
const variants = [];
for (const swap of [0, 1]) for (const sx of [1, -1]) for (const sy of [1, -1]) {
  variants.push({
    swap, sx, sy,
    fwd(lat, lon) { const p = rhoOf(lat), l = lon * D2R; let X = p * Math.sin(l), Y = p * Math.cos(l); if (swap) [X, Y] = [Y, X]; return [C0 + (sx * X) / RES, R0 + (sy * Y) / RES]; },
    inv(c, r) { let X = sx * (c - C0) * RES, Y = sy * (r - R0) * RES; if (swap) [X, Y] = [Y, X]; const rho = Math.hypot(X, Y); return [-90 + (2 * Math.atan(rho / (2 * RM))) / D2R, (((Math.atan2(X, Y) / D2R) % 360) + 360) % 360]; },
  });
}

// crater fit: depth of the rim crest above the floor, divided by how far the crest radius wanders
function craterFit(cx, cy) {
  const crest = [], rad = [];
  for (let k = 0; k < 72; k++) {
    const t = (k / 72) * 2 * Math.PI; let best = -1e9, br = 0;
    for (let r = 8000; r <= 13000; r += 100) { const v = h(Math.round(cx + (Math.cos(t) * r) / RES), Math.round(cy + (Math.sin(t) * r) / RES)); if (v > best) { best = v; br = r; } }
    if (best > -1e8) { crest.push({ t, h: best, r: br }); rad.push(br); }
  }
  let fs_ = 0, nf = 0;
  for (let r = 0; r <= 3000; r += 150) for (let k = 0; k < 8; k++) { const t = (k / 8) * 2 * Math.PI, v = h(Math.round(cx + (Math.cos(t) * r) / RES), Math.round(cy + (Math.sin(t) * r) / RES)); if (!Number.isNaN(v)) { fs_ += v; nf++; } }
  const mean = (x) => x.reduce((s, v) => s + v, 0) / x.length, mr = mean(rad), sd = Math.sqrt(mean(rad.map((v) => (v - mr) ** 2)));
  const depth = mean(crest.map((c) => c.h)) - fs_ / nf;
  return { score: depth / (0.5 + sd / 1000), depth, sd, crest };
}
const SH = { lat: -89.9, lon: 129.78 }; // Shackleton centre
let vi;
const fits = variants.map((v, i) => { const [cx, cy] = v.fwd(SH.lat, SH.lon); return { i, cx, cy, ...craterFit(cx, cy) }; });
for (const f of fits) console.log(`  orientation ${f.i}: crater centre px (${f.cx.toFixed(0)}, ${f.cy.toFixed(0)})  rim-above-floor ${f.depth.toFixed(0)} m  radius wander ${f.sd.toFixed(0)} m  score ${f.score.toFixed(2)}`);
if (a.variant !== undefined) vi = +a.variant;
else {
  const s = [...fits].sort((p, q) => q.score - p.score);
  console.log(`best orientation ${s[0].i} (score ${s[0].score.toFixed(2)}), runner-up ${s[1].i} (${s[1].score.toFixed(2)})`);
  if (!(s[0].score > 1.3 * s[1].score && s[0].depth > 1500)) throw new Error('could not tell the raster orientation apart; inspect the table above or pass --variant N');
  vi = s[0].i;
}
const V = variants[vi], fit = fits[vi];

// ---------- illumination estimate for a point (horizon scan on the real DEM) ----------
const SUN_R = 0.27 * D2R, TILT = 1.54 * D2R, MAST = 12;
function litFraction(c, r) {
  const hp = h(Math.round(c), Math.round(r)) + MAST; if (Number.isNaN(hp)) return 0;
  const horizon = [];
  for (let k = 0; k < 72; k++) {
    const t = (k / 72) * 2 * Math.PI, dx = Math.cos(t), dy = Math.sin(t); let best = -Math.PI / 2;
    for (let d = 10; d < 6000; d *= 1.07) { const v = h(Math.round(c + (dx * d) / RES), Math.round(r + (dy * d) / RES)); if (Number.isNaN(v)) continue; best = Math.max(best, Math.atan2(v - hp - (d * d) / (2 * RM), d)); }
    horizon.push(best);
  }
  let lit = 0, n = 0;
  for (let k = 0; k < 72; k++) for (let s = 0; s < 12; s++) { n++; if (TILT * Math.sin((s / 12) * 2 * Math.PI) + SUN_R > horizon[k]) lit++; }
  return lit / n;
}

// ---------- pick a site on the rim crest ----------
const cand = [];
for (const cr of fit.crest) {
  // refine radially +-150 m for the true crest, then score illumination
  let bc = 0, br = 0, bh = -1e9;
  for (let d = cr.r - 150; d <= cr.r + 150; d += RES) { const c = fit.cx + (Math.cos(cr.t) * d) / RES, r = fit.cy + (Math.sin(cr.t) * d) / RES, v = h(Math.round(c), Math.round(r)); if (v > bh) { bh = v; bc = c; br = r; } }
  cand.push({ c: bc, r: br, elev: bh, lit: litFraction(bc, br) });
}
cand.sort((p, q) => q.lit - p.lit);
console.log('rim candidates (illuminated fraction, elevation vs 1737.4 km sphere):');
cand.slice(0, 6).forEach((c, i) => { const [lat, lon] = V.inv(c.c, c.r); console.log(`  #${i}  lit ${(c.lit * 100).toFixed(1)}%  elev ${c.elev.toFixed(0)} m  ${lat.toFixed(3)}, ${lon.toFixed(2)}E`); });
const site = cand[Math.min(cand.length - 1, +(a.pick ?? 0))];
const [slat, slon] = V.inv(site.c, site.r);

// ---------- local frame: east / north unit vectors in raster space, then resample ----------
const nrm = (v) => { const m = Math.hypot(v[0], v[1]); return [v[0] / m, v[1] / m]; };
const p0 = V.fwd(slat, slon), pe = V.fwd(slat, slon + 0.001), pn = V.fwd(slat + 0.0005, slon);
const east = nrm([pe[0] - p0[0], pe[1] - p0[1]]), north = nrm([pn[0] - p0[0], pn[1] - p0[1]]);
const size = +(a.size ?? 2048), half = Math.ceil((size * Math.SQRT1_2) + 4);
const rc = Math.round(site.c), rr = Math.round(site.r), x0 = rc - half, y0 = rr - half, span = 2 * half + 1;
if (x0 < 0 || y0 < 0 || x0 + span > W || y0 + span > H) throw new Error('tile falls outside the raster');
console.log(`reading ${span}x${span} px region...`);
const reg = new Float32Array(span * span), rb = Buffer.alloc(span * 2);
for (let j = 0; j < span; j++) {
  fs.readSync(fd, rb, 0, span * 2, ((y0 + j) * W + x0) * 2);
  for (let i = 0; i < span; i++) { const v = rb.readInt16LE(i * 2) * DNSCALE; reg[j * span + i] = bad(v) ? NaN : v; }
}
const bil = (c, r) => {
  const fx = c - x0, fy = r - y0, i = Math.floor(fx), j = Math.floor(fy);
  if (i < 0 || j < 0 || i >= span - 1 || j >= span - 1) return NaN;
  const u = fx - i, v = fy - j, A = reg[j * span + i], B = reg[j * span + i + 1], C = reg[(j + 1) * span + i], D = reg[(j + 1) * span + i + 1];
  if (Number.isNaN(A + B + C + D)) return Number.isNaN(A) ? (Number.isNaN(B) ? (Number.isNaN(C) ? D : C) : B) : A;
  return A + u * (B - A) + v * (C - A + u * (A - B - C + D));
};
const h0 = bil(site.c, site.r), STEP = 0.5, out = new Int16Array(size * size), grid = new Float32Array(size * size);
let last = 0, lo = Infinity, hi = -Infinity, voids = 0;
for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
  const e = (i + 0.5 - size / 2) * RES, nn = -(j + 0.5 - size / 2) * RES; // world +x east, +z south
  let v = bil(site.c + ((e * east[0] + nn * north[0]) / RES), site.r + ((e * east[1] + nn * north[1]) / RES));
  if (Number.isNaN(v)) { v = last; voids++; } else { v -= h0; last = v; }
  grid[j * size + i] = v; lo = Math.min(lo, v); hi = Math.max(hi, v);
  out[j * size + i] = Math.max(-32768, Math.min(32767, Math.round(v / STEP)));
}
// direction from the site to the crater centre, in world (x east, z south)
const cv = [fit.cx - site.c, fit.cy - site.r], ce = cv[0] * east[0] + cv[1] * east[1], cn = cv[0] * north[0] + cv[1] * north[1], cl = Math.hypot(ce, cn);
const meta = {
  n: size, res: RES, scale: STEP, source: path.basename(a.img), siteElevationM: h0, reliefM: [lo, hi],
  lat: slat, lon: slon, litFraction: site.lit, craterDir: { x: ce / cl, z: -cn / cl }, craterDistM: cl * RES, orientation: vi,
};
const dir = path.resolve('public/terrain'); fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'shackleton.bin'), Buffer.from(out.buffer));
fs.writeFileSync(path.join(dir, 'shackleton.json'), JSON.stringify(meta, null, 2));
console.log(`baked ${size}x${size} @ ${RES} m/px (${((size * RES) / 1000).toFixed(1)} km), site ${slat.toFixed(3)}, ${slon.toFixed(2)}E, lit ${(site.lit * 100).toFixed(0)}%, relief ${lo.toFixed(0)}..${hi.toFixed(0)} m, ${voids} void px`);

// ---------- optional hillshade preview (so a human can eyeball it) ----------
if (a.preview) {
  const px = new Uint8Array(size * size), sd = size > 1024 ? 2 : 1, ow = Math.floor(size / sd);
  const img = new Uint8Array(ow * ow);
  for (let j = 1; j < ow - 1; j++) for (let i = 1; i < ow - 1; i++) {
    const g = (x, y) => grid[y * sd * size + x * sd];
    const dzx = (g(i + 1, j) - g(i - 1, j)) / (2 * RES * sd), dzy = (g(i, j + 1) - g(i, j - 1)) / (2 * RES * sd);
    img[j * ow + i] = Math.max(0, Math.min(255, 150 + 220 * (-dzx * 0.7 + dzy * 0.7) / Math.sqrt(1 + dzx * dzx + dzy * dzy)));
  }
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcT[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]), c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((ow + 1) * ow); for (let y = 0; y < ow; y++) { raw[y * (ow + 1)] = 0; Buffer.from(img.buffer, y * ow, ow).copy(raw, y * (ow + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(ow, 0); ihdr.writeUInt32BE(ow, 4); ihdr[8] = 8; ihdr[9] = 0;
  fs.writeFileSync(a.preview, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
  console.log('preview written to', a.preview);
}
