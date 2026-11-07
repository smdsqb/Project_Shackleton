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
function demAt(x: number, z: number): number | null {
  if (!dem) return null;
  const { n, res, half, data, scale } = dem;
  // beyond the tile the edge value is extended, so the far field stays continuous with the real relief
  const fx = Math.min(n - 1.001, Math.max(0, (x + half) / res)), fz = Math.min(n - 1.001, Math.max(0, (z + half) / res));
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const a = data[j * n + i], b = data[j * n + i + 1], c = data[(j + 1) * n + i], d = data[(j + 1) * n + i + 1];
  return (a + u * (b - a) + v * (c - a + u * (a - b - c + d))) * scale;
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
  const far = dem ? 5000 : 1500;
  for (let t = 4; t < far; t += t < 200 ? 2 : t < 1000 ? 8 : 25) {
    if (heightAt(p.x + sun.x * t, p.z + sun.z * t) > p.y + sun.y * t) return false;
  }
  return true;
}
export const rand = rnd;

export type Site = { lat: number; lon: number; elevM: number; craterDir: { x: number; z: number } | null; litFraction: number | null };
let site: Site | null = null;
export const getSite = () => site;

/** Load the baked LOLA tile if one is deployed. Returns a short status for the boot screen. */
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
    return `LOLA DEM \u00b7 ${meta.res} M/PX`;
  } catch { return 'PROCEDURAL'; }
}
/** n x n grid, res metres per cell, centred on the site, heights in `scale` metre units relative to the site. */
export function setDem(data: Int16Array, n: number, res: number, scale: number) {
  dem = { n, res, half: (n * res) / 2, data, scale }; H0 = rawHeight(0, 0);
}
