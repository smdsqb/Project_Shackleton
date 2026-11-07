// Draft 1 APPROXIMATION. The Moon's spin axis is tilted ~1.54 deg to the ecliptic, so near the south pole
// the Sun stays within about +/-1.54 deg of the horizon and circles once per synodic month (~29.53 d).
// The seasonal phase below is a placeholder; the next branch swaps in a real ephemeris.
const SYNODIC_DAYS = 29.530588;
const NEW_MOON_REF = Date.UTC(2000, 0, 6, 18, 14);
const TILT = 1.54 * Math.PI / 180;

export function sunDirection(date: Date) {
  const days = (date.getTime() - NEW_MOON_REF) / 86400000;
  const az = ((days / SYNODIC_DAYS) % 1) * Math.PI * 2;
  const yearFrac = (days / 365.2422) % 1;
  const el = TILT * Math.sin(yearFrac * Math.PI * 2);
  const c = Math.cos(el);
  return { x: c * Math.sin(az), y: Math.sin(el), z: -c * Math.cos(az), az, el };
}
