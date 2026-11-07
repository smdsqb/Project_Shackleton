// Vercel function: real Sun and Earth positions as seen from the Shackleton crater rim, from NASA JPL Horizons.
const SITE = '129.78,-89.9,0'; // east longitude, latitude, altitude km (Shackleton crater)

async function track(body: string, start: Date, stop: Date) {
  const f = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ');
  const q = new URLSearchParams({
    format: 'json', COMMAND: `'${body}'`, OBJ_DATA: "'NO'", MAKE_EPHEM: "'YES'", EPHEM_TYPE: "'OBSERVER'",
    CENTER: "'coord@301'", COORD_TYPE: "'GEODETIC'", SITE_COORD: `'${SITE}'`,
    START_TIME: `'${f(start)}'`, STOP_TIME: `'${f(stop)}'`, STEP_SIZE: "'1h'", QUANTITIES: "'4'", ANG_FORMAT: "'DEG'", CSV_FORMAT: "'YES'",
  });
  const r = await fetch(`https://ssd.jpl.nasa.gov/api/horizons.api?${q}`);
  if (!r.ok) throw new Error(`Horizons ${r.status}`);
  const text: string = (await r.json()).result ?? '';
  const body_ = text.split('$$SOE')[1]?.split('$$EOE')[0];
  if (!body_) throw new Error('Horizons: no ephemeris block');
  const az: number[] = [], el: number[] = [];
  for (const line of body_.trim().split('\n')) {
    const cols = line.split(',').map((s) => s.trim());
    const nums = cols.slice(1).filter((s) => s !== '' && !isNaN(Number(s))).map(Number);
    if (nums.length >= 2) { az.push(nums[0]); el.push(nums[1]); }
  }
  if (az.length < 10) throw new Error('Horizons: too few rows');
  return { t0: start.getTime(), step: 3600000, az, el };
}

export async function GET() {
  const start = new Date(Math.floor(Date.now() / 3600000) * 3600000);
  const stop = new Date(start.getTime() + 30 * 86400000);
  try {
    const [sun, earth] = await Promise.all([track('10', start, stop), track('399', start, stop)]);
    return Response.json({ source: 'NASA JPL Horizons', sun, earth }, { headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=86400' } });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 502 });
  }
}
