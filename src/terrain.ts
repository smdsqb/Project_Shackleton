// Lunar terrain. When a baked LRO/LOLA tile is present (public/terrain/shackleton.{json,bin}, produced by
// scripts/bake-terrain.mjs) it supplies the real relief and only metre-scale craters/roughness are added on top;
// otherwise it falls back to procedural craters + gradient noise. Both include true lunar curvature so the horizon
// sits where it would for a 1.7 m eye height.
const R_MOON = 1737400;
const rnd = (i: number, j: number, s: number) => {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(s, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const grad = (i: number, j: number, x: number, z: number) => { const a = rnd(i, j, 77) * 6.2831853; return Math.cos(a) * x + Math.sin(a) * z; };
function perlin(x: number, z: number) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, u = fade(fx), v = fade(fz);
  const a = grad(i, j, fx, fz), b = grad(i + 1, j, fx - 1, fz), c = grad(i, j + 1, fx, fz - 1), d = grad(i + 1, j + 1, fx - 1, fz - 1);
  return (a + u * (b - a) + v * (c - a + u * (a - b - c + d))) * 1.4;
}
const fbm = (x: number, z: number, o: number) => { let a = 1, f = 1, s = 0; for (let k = 0; k < o; k++) { s += a * perlin(x * f, z * f); a *= 0.5; f *= 2.03; } return s; };

// [cell size, max radius, probability]
const LAYERS: [number, number, number][] = [[1400, 600, 0.6], [90, 40, 0.55], [35, 16, 0.7], [12, 5.5, 0.8], [5, 2, 0.8]];
function craters(x: number, z: number, from = 0) {
  let h = 0;
  for (let L = from; L < LAYERS.length; L++) {
    const [cell, rMax, prob] = LAYERS[L];
    const ci = Math.floor(x / cell), cj = Math.floor(z / cell);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const i = ci + di, j = cj + dj;
      if (rnd(i, j, L * 10) > prob) continue;
      const px = (i + 0.2 + 0.6 * rnd(i, j, L * 10 + 1)) * cell, pz = (j + 0.2 + 0.6 * rnd(i, j, L * 10 + 2)) * cell;
      const R = rMax * (0.35 + 0.65 * rnd(i, j, L * 10 + 3) ** 2);
      const d = Math.hypot(x - px, z - pz);
      if (d > R * 2.2) continue;
      const depth = R * (0.08 + 0.12 * rnd(i, j, L * 10 + 4)), t = d / R;
      h += (t < 1 ? -depth * (1 - t * t) : 0) + 0.3 * depth * Math.exp(-(((t - 1) / 0.28) ** 2));
    }
  }
  return h;
}

type Dem = { n: number; res: number; half: number; data: Int16Array; scale: number };
let dem: Dem | null = null;
let demFar: Dem | null = null;

/** Strict bilinear sample of one DEM tile. Returns null when (x,z) is outside the tile's true bounds
 *  (no edge extension). The blend layer in `demAt()` decides what to do in that case. */
function sampleDem(d: Dem, x: number, z: number): number | null {
  const { n, res, half, data, scale } = d;
  const fx = (x + half) / res, fz = (z + half) / res;
  if (fx < 0 || fz < 0 || fx > n - 1 || fz > n - 1) return null;
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const a = data[j * n + i], b = data[j * n + i + 1], c = data[(j + 1) * n + i], dd = data[(j + 1) * n + i + 1];
  return (a + u * (b - a) + v * (c - a + u * (a - b - c + dd))) * scale;
}

/** Legacy edge-extended sample (clamps to the tile border). Used as a fallback when only one DEM is present,
 *  preserving the original single-tile behaviour. */
function sampleDemClamped(d: Dem, x: number, z: number): number {
  const { n, res, half, data, scale } = d;
  const fx = Math.min(n - 1.001, Math.max(0, (x + half) / res)), fz = Math.min(n - 1.001, Math.max(0, (z + half) / res));
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const a = data[j * n + i], b = data[j * n + i + 1], c = data[(j + 1) * n + i], dd = data[(j + 1) * n + i + 1];
  return (a + u * (b - a) + v * (c - a + u * (a - b - c + dd))) * scale;
}

// Blend zone between the near (high-res) tile and the far (wide-coverage) tile.
// Inside BLEND_INNER metres of the hab: pure near tile. Outside BLEND_OUTER: pure far tile.
// Between the two: smoothstep blend, so the handoff from 5 m/px detail to 20 m/px context has no visible seam.
const BLEND_INNER = 4500, BLEND_OUTER = 5500;

function demAt(x: number, z: number): number | null {
  if (!dem && !demFar) return null;
  if (dem && !demFar) return sampleDemClamped(dem, x, z);
  if (!dem && demFar) return sampleDemClamped(demFar, x, z);

  // Both DEMs present. The near tile covers ±5120 m; the far tile covers ±20480 m.
  // Use strict bounds so the near tile does NOT edge-extend past its real data.
  const r = Math.hypot(x, z);
  if (r <= BLEND_INNER) return sampleDem(dem!, x, z);
  if (r >= BLEND_OUTER) return sampleDem(demFar!, x, z);

  const t = (r - BLEND_INNER) / (BLEND_OUTER - BLEND_INNER);
  const ts = t * t * (3 - 2 * t); // smoothstep
  const near = sampleDem(dem!, x, z);
  const far = sampleDem(demFar!, x, z);
  if (near === null) return far;
  if (far === null) return near;
  return near * (1 - ts) + far * ts;
}

function rawHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const pad = Math.min(1, Math.max(0, (r - 25) / 45));
  const dh = demAt(x, z);
  if (dh !== null) return dh + (fbm(x * 0.05, z * 0.05, 3) * 0.5 + craters(x, z, 2)) * pad - (x * x + z * z) / (2 * R_MOON);
  const main = Math.hypot(x + 300, z), MR = 240;
  const rim = (main < MR ? -35 * (1 - (main / MR) ** 2) : 0) + 16 * Math.exp(-(((main - MR) / 40) ** 2));
  const land = fbm(x * 0.006, z * 0.006, 4) * 9 + fbm(x * 0.05, z * 0.05, 3) * 0.5;
  return (rim + (land + craters(x, z)) * pad) - (x * x + z * z) / (2 * R_MOON);
}

let H0 = rawHeight(0, 0);
/** Terrain with a level pad under the Hab (radius ~18 m, blending out to ~48 m). */
export function heightAt(x: number, z: number): number {
  const t = Math.min(1, Math.max(0, (Math.hypot(x, z) - 18) / 30));
  return H0 + (rawHeight(x, z) - H0) * t * t * (3 - 2 * t);
}

type V3 = { x: number; y: number; z: number };
export function isSunlit(p: V3, sun: V3): boolean {
  // With the far DEM in place, the shadow ray can travel across the full Shackleton bowl to the opposite rim,
  // so a hab on the inner wall correctly sees the far wall block the sun at low angles. Without it, the ray
  // only reaches 5 km (the near-tile half-width), which makes the hab look lit when it shouldn't be.
  const far = demFar ? 20000 : dem ? 5000 : 1500;
  for (let t = 4; t < far; t += t < 200 ? 2 : t < 1000 ? 8 : t < 5000 ? 20 : 50) {
    if (heightAt(p.x + sun.x * t, p.z + sun.z * t) > p.y + sun.y * t) return false;
  }
  return true;
}
/** True if terrain does not block the straight line between two points (used for radio links). */
export function lineOfSight(a: V3, b: V3): boolean {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dy, dz), steps = Math.min(4000, Math.ceil(len / 6));
  for (let i = 3; i < steps; i++) { const t = i / steps; if (heightAt(a.x + dx * t, a.z + dz * t) > a.y + dy * t) return false; }
  return true;
}
export const rand = rnd;

export type Site = { lat: number; lon: number; elevM: number; craterDir: { x: number; z: number } | null; litFraction: number | null };
let site: Site | null = null;
export const getSite = () => site;

/** Load the baked LOLA tiles if deployed. The near tile (5 m/px) supplies the immediate relief around the hab;
 *  an optional far tile (e.g. 20 m/px, `shackleton-far.{json,bin}`) supplies the wider regional context so the far
 *  crater wall and floor are real LOLA data instead of edge-extended flatness. Returns a short status for the boot screen. */
export async function loadTerrain(): Promise<string> {
  try {
    const m = await fetch('/terrain/shackleton.json', { signal: AbortSignal.timeout(10000) });
    if (!m.ok) return 'PROCEDURAL';
    const meta = await m.json();
    const b = await fetch('/terrain/shackleton.bin', { signal: AbortSignal.timeout(60000) });
    if (!b.ok) return 'PROCEDURAL';
    const data = new Int16Array(await b.arrayBuffer());
    if (!(meta.n > 2) || !(meta.res > 0) || !(meta.scale > 0) || data.length !== meta.n * meta.n) return 'PROCEDURAL';
    setDem(data, meta.n, meta.res, meta.scale);
    if (Number.isFinite(meta.lat) && Number.isFinite(meta.lon)) {
      site = { lat: meta.lat, lon: meta.lon, elevM: meta.siteElevationM ?? 0, litFraction: meta.litFraction ?? null,
        craterDir: Number.isFinite(meta.craterDir?.x) && Number.isFinite(meta.craterDir?.z) ? meta.craterDir : null };
    }

    // Optional companion far tile. Failure here is non-fatal: the near tile still works on its own,
    // it just edge-extends past its border as before.
    try {
      const mf = await fetch('/terrain/shackleton-far.json', { signal: AbortSignal.timeout(10000) });
      if (mf.ok) {
        const metaF = await mf.json();
        const bf = await fetch('/terrain/shackleton-far.bin', { signal: AbortSignal.timeout(60000) });
        if (bf.ok) {
          const dataF = new Int16Array(await bf.arrayBuffer());
          if (metaF.n > 2 && metaF.res > 0 && metaF.scale > 0 && dataF.length === metaF.n * metaF.n) {
            setDemFar(dataF, metaF.n, metaF.res, metaF.scale);
            // Prefer the near tile's litFraction (the far bake skips the rim scan).
            if (site && (metaF.litFraction === null || metaF.litFraction === undefined) && Number.isFinite(meta.litFraction)) {
              // keep site.litFraction as-is
            }
          }
        }
      }
    } catch { /* far tile optional */ }

    const farRes = demFar ? `+${demFar.res}M` : '';
    return `LOLA DEM \u00b7 ${meta.res} M/PX${farRes ? ' ' + farRes : ''}`;
  } catch { return 'PROCEDURAL'; }
}
/**
 * The baked tile is a rotated square inside a square array, so its corners are "no data" zeros. Left alone they read as
 * sea level next to terrain that is hundreds of metres lower, which makes fake cliff walls. Zero pixels connected to the
 * array border are no-data: replace them with the nearest real height, softened, so the far field slopes on naturally.
 */
export function fillNoData(data: Int16Array, n: number) {
  const bad = new Uint8Array(n * n), q = new Int32Array(n * n); let qh = 0, qt = 0;
  const seed = (i: number) => { if (!bad[i] && data[i] === 0) { bad[i] = 1; q[qt++] = i; } };
  for (let k = 0; k < n; k++) { seed(k); seed((n - 1) * n + k); seed(k * n); seed(k * n + n - 1); }
  while (qh < qt) { const i = q[qh++], x = i % n, y = (i / n) | 0; if (x > 0) seed(i - 1); if (x < n - 1) seed(i + 1); if (y > 0) seed(i - n); if (y < n - 1) seed(i + n); }
  if (qt === 0) return 0;
  const src = new Int32Array(n * n).fill(-1); qh = qt = 0;   // breadth-first spread of the nearest valid pixel into the no-data area
  for (let i = 0; i < n * n; i++) if (!bad[i]) { const x = i % n, y = (i / n) | 0; if ((x > 0 && bad[i - 1]) || (x < n - 1 && bad[i + 1]) || (y > 0 && bad[i - n]) || (y < n - 1 && bad[i + n])) { src[i] = i; q[qt++] = i; } }
  const grow = (i: number, j: number) => { if (bad[j] && src[j] < 0) { src[j] = src[i]; data[j] = data[src[i]]; q[qt++] = j; } };
  while (qh < qt) { const i = q[qh++], x = i % n, y = (i / n) | 0; if (x > 0) grow(i, i - 1); if (x < n - 1) grow(i, i + 1); if (y > 0) grow(i, i - n); if (y < n - 1) grow(i, i + n); }
  for (let pass = 0; pass < 4; pass++) for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) { const i = y * n + x; if (bad[i]) data[i] = (data[i - 1] + data[i + 1] + data[i - n] + data[i + n] + data[i]) / 5; }
  let c = 0; for (let i = 0; i < n * n; i++) c += bad[i]; return c;
}
/** n x n grid, res metres per cell, centred on the site, heights in `scale` metre units relative to the site. */
export function setDem(data: Int16Array, n: number, res: number, scale: number) {
  fillNoData(data, n);
  dem = { n, res, half: (n * res) / 2, data, scale }; H0 = rawHeight(0, 0);
}
/** Companion wide-coverage DEM (coarser resolution, e.g. 20 m/px LOLA covering ~40 km).
 *  Loaded alongside the primary near-field DEM so the far relief (e.g. the opposite Shackleton rim)
 *  is real LOLA data instead of edge-extended flatness. */
export function setDemFar(data: Int16Array, n: number, res: number, scale: number) {
  fillNoData(data, n);
  demFar = { n, res, half: (n * res) / 2, data, scale };
}
