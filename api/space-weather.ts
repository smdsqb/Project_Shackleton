// Vercel function: recent solar flares from NASA CCMC DONKI. Since 2026-09-30 the public API lives at
// ccmc.gsfc.nasa.gov/DONKI-API (no key); the old api.nasa.gov/DONKI route now redirects to a news page.
type Flare = { classType?: string; class?: string; beginTime?: string };
export async function GET() {
  const end = new Date(), start = new Date(end.getTime() - 3 * 86400000);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const q = `startDate=${day(start)}&endDate=${day(end)}`;
  const sources = [
    ['CCMC', `https://ccmc.gsfc.nasa.gov/DONKI-API/get/FLR?${q}`],
    ['api.nasa.gov', `https://api.nasa.gov/DONKI/FLR?${q}&api_key=${process.env.NASA_API_KEY ?? 'DEMO_KEY'}`],
  ];
  const tried: string[] = [];
  for (const [name, url] of sources) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
      const text = (await r.text()).trim();
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const parsed = text ? JSON.parse(text) : [];
      if (!Array.isArray(parsed)) throw new Error('unexpected response shape');
      const flares = (parsed as Flare[]).map((f) => ({ classType: f.classType ?? f.class ?? '', beginTime: f.beginTime ?? '' }));
      const rank = (c: string) => 'ABCMX'.indexOf(c[0]?.toUpperCase() ?? '') * 100 + (parseFloat(c.slice(1)) || 0);
      const strongest = flares.map((f) => f.classType).filter(Boolean).sort((a, b) => rank(b) - rank(a))[0] ?? null;
      return Response.json({ source: `NASA CCMC DONKI via ${name}`, windowDays: 3, strongest, flares }, {
        headers: { 'Cache-Control': 's-maxage=900, stale-while-revalidate=3600' },
      });
    } catch (e) { tried.push(`${name}: ${String(e)}`); }
  }
  return Response.json({ error: 'DONKI unavailable', tried }, { status: 502 });
}
