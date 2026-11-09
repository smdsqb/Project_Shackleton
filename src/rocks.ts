import { heightAt, rand } from './terrain';

// One shared boulder layout, used for the instanced meshes in main.ts and for wheel contact in the rover, so what you
// see is what the suspension feels. 1500 scattered rocks plus 14 boulder fields.
export type Rock = { x: number; z: number; s: number; sy: number; sz: number; rx: number; ry: number; y: number; a: number };
export const ROCKS: Rock[] = [];
const grid = new Map<number, Rock[]>(), CELL = 8;
const key = (i: number, j: number) => (i + 4096) * 8192 + (j + 4096);
export const ROCK_CAP = 2600;

export function buildRocks(): Rock[] {
  ROCKS.length = 0; grid.clear();
  const add = (x: number, z: number, s: number, ra: number, rb: number, rc: number) => {
    if (Math.hypot(x, z) < 22 || Math.abs(x) > 290 || Math.abs(z) > 290 || ROCKS.length >= ROCK_CAP) return;
    const sz = s * (0.7 + rc * 0.6), r: Rock = { x, z, s, sy: s * 0.7, sz, rx: ra * 6, ry: rb * 6, y: heightAt(x, z) + s * 0.25, a: ((s + sz) / 2) * 0.95 };
    ROCKS.push(r); const k = key(Math.floor(x / CELL), Math.floor(z / CELL)); const g = grid.get(k); if (g) g.push(r); else grid.set(k, [r]);
  };
  for (let i = 0; i < 1500; i++) add((rand(i, 1, 99) - 0.5) * 600, (rand(i, 2, 99) - 0.5) * 600, 0.12 + rand(i, 3, 99) ** 3 * 1.7, rand(i, 4, 99), rand(i, 5, 99), rand(i, 6, 99));
  for (let f = 0; f < 14; f++) {
    const cx = (rand(f, 11, 77) - 0.5) * 520, cz = (rand(f, 12, 77) - 0.5) * 520;
    for (let k = 0; k < 60; k++) {
      const a = rand(f * 100 + k, 13, 77) * 6.283, d = Math.sqrt(rand(f * 100 + k, 14, 77)) * 26;
      add(cx + Math.cos(a) * d, cz + Math.sin(a) * d, 0.15 + rand(f * 100 + k, 15, 77) ** 2.4 * 1.4, rand(f * 100 + k, 16, 77), rand(f * 100 + k, 17, 77), rand(f * 100 + k, 18, 77));
    }
  }
  return ROCKS;
}

/** Height (m) a rock adds above the terrain at (x,z); 0 when there is none. Smooth over the last few percent of the rim. */
export function rockTop(x: number, z: number): number {
  const i0 = Math.floor(x / CELL), j0 = Math.floor(z / CELL); let top = 0;
  for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) {
    const g = grid.get(key(i, j)); if (!g) continue;
    for (const r of g) {
      const d = Math.hypot(x - r.x, z - r.z); if (d > r.a) continue;
      const u = d / r.a, edge = Math.min(1, Math.max(0, (0.97 - u) / 0.09)), h = edge * (0.25 * r.s + r.sy * Math.sqrt(Math.max(0, 1 - u * u)));
      if (h > top) top = h;
    }
  }
  return top;
}
/** Rocks taller than minTop (m) within a circle: used for boulder-field warnings. */
export function bigRocksNear(x: number, z: number, rad: number, minTop = 0.45): number {
  let n = 0; const i0 = Math.floor((x - rad) / CELL), i1 = Math.floor((x + rad) / CELL), j0 = Math.floor((z - rad) / CELL), j1 = Math.floor((z + rad) / CELL);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const g = grid.get(key(i, j)); if (!g) continue; for (const r of g) if (r.s * 0.95 > minTop && Math.hypot(x - r.x, z - r.z) < rad) n++; }
  return n;
}
