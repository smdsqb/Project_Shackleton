// Draft 1: procedural, stylised terrain (one crater rim to the west of the outpost pad).
// Next branch: replace with real LRO LOLA elevation data for Shackleton.
const hash = (x: number, z: number) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };
const vnoise = (x: number, z: number) => {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  return hash(xi, zi) * (1 - u) * (1 - v) + hash(xi + 1, zi) * u * (1 - v) + hash(xi, zi + 1) * (1 - u) * v + hash(xi + 1, zi + 1) * u * v;
};
const fbm = (x: number, z: number) => { let a = 1, f = 1, s = 0; for (let i = 0; i < 5; i++) { s += a * (vnoise(x * f, z * f) - 0.5); a *= 0.5; f *= 2; } return s; };

export function heightAt(x: number, z: number): number {
  const d = Math.hypot(x + 300, z), R = 240;
  const bowl = d < R ? -35 * (1 - (d / R) ** 2) : 0;
  const rim = 16 * Math.exp(-(((d - R) / 40) ** 2));
  const pad = Math.min(1, Math.hypot(x, z) / 30);
  return bowl + rim + fbm(x * 0.012, z * 0.012) * 14 * pad + fbm(x * 0.08, z * 0.08) * 1.2 * pad;
}

type V3 = { x: number; y: number; z: number };
/** Marches a ray toward the Sun across the heightfield; true if nothing blocks it. */
export function isSunlit(p: V3, sun: V3): boolean {
  for (let t = 4; t < 850; t += 4) {
    if (heightAt(p.x + sun.x * t, p.z + sun.z * t) > p.y + sun.y * t) return false;
  }
  return true;
}
