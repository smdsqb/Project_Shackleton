// Procedural lunar terrain: seeded crater populations at several scales (bowl + raised rim), smooth gradient noise
// for undulation, and true lunar curvature so the horizon sits where it would for a 1.7 m eye height.
// Not yet real LRO/LOLA data (that source is not reachable from the build environment).
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
function craters(x: number, z: number) {
  let h = 0;
  for (let L = 0; L < LAYERS.length; L++) {
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

function rawHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const pad = Math.min(1, Math.max(0, (r - 25) / 45));
  const main = Math.hypot(x + 300, z), MR = 240;
  const rim = (main < MR ? -35 * (1 - (main / MR) ** 2) : 0) + 16 * Math.exp(-(((main - MR) / 40) ** 2));
  const land = fbm(x * 0.006, z * 0.006, 4) * 9 + fbm(x * 0.05, z * 0.05, 3) * 0.5;
  return (rim + (land + craters(x, z)) * pad) - (x * x + z * z) / (2 * R_MOON);
}

const H0 = rawHeight(0, 0);
/** Terrain with a level pad under the Hab (radius ~18 m, blending out to ~48 m). */
export function heightAt(x: number, z: number): number {
  const t = Math.min(1, Math.max(0, (Math.hypot(x, z) - 18) / 30));
  return H0 + (rawHeight(x, z) - H0) * t * t * (3 - 2 * t);
}

type V3 = { x: number; y: number; z: number };
export function isSunlit(p: V3, sun: V3): boolean {
  for (let t = 4; t < 1500; t += t < 200 ? 2 : 6) {
    if (heightAt(p.x + sun.x * t, p.z + sun.z * t) > p.y + sun.y * t) return false;
  }
  return true;
}
export const rand = rnd;
