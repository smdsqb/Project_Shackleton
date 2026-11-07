import { sunDirection } from './sun';
type Track = { t0: number; step: number; az: number[]; el: number[] };
let eph: { sun: Track; earth: Track } | null = null;

export async function loadEphemeris(): Promise<boolean> {
  try {
    const r = await fetch('/api/ephemeris', { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return false;
    const d = await r.json();
    if (!d?.sun?.az?.length || !d?.earth?.az?.length) return false;
    eph = d; return true;
  } catch { return false; }
}

const D2R = Math.PI / 180;
export function bodyDir(which: 'sun' | 'earth', date: Date) {
  const tr = eph?.[which], ms = date.getTime();
  if (tr && ms >= tr.t0 && ms <= tr.t0 + (tr.az.length - 1) * tr.step) {
    const f = (ms - tr.t0) / tr.step, i = Math.min(tr.az.length - 2, Math.floor(f)), u = f - i;
    const a0 = tr.az[i]; let a1 = tr.az[i + 1];
    if (a1 - a0 > 180) a1 -= 360; else if (a0 - a1 > 180) a1 += 360;
    const az = (((a0 + (a1 - a0) * u) % 360) + 360) % 360 * D2R, el = (tr.el[i] + (tr.el[i + 1] - tr.el[i]) * u) * D2R, c = Math.cos(el);
    return { x: c * Math.sin(az), y: Math.sin(el), z: -c * Math.cos(az), az, el, live: true };
  }
  if (which === 'sun') return { ...sunDirection(date), live: false };
  const az = 0.7, el = 0.07, c = Math.cos(el);
  return { x: c * Math.sin(az), y: Math.sin(el), z: -c * Math.cos(az), az, el, live: false };
}
