// Vercel function: proxies NASA DONKI solar flare data so the API key stays server-side.
// Set NASA_API_KEY in the Vercel project's environment variables (falls back to DEMO_KEY).
export async function GET() {
  const key = process.env.NASA_API_KEY ?? 'DEMO_KEY';
  const end = new Date();
  const start = new Date(end.getTime() - 3 * 86400000);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const url = `https://api.nasa.gov/DONKI/FLR?startDate=${day(start)}&endDate=${day(end)}&api_key=${key}`;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`DONKI ${r.status}`);
    const text = await r.text();
    const raw: { classType?: string; beginTime?: string }[] = text ? JSON.parse(text) : [];
    const flares = raw.map((f) => ({ classType: f.classType ?? '', beginTime: f.beginTime ?? '' }));
    const rank = (c: string) => 'ABCMX'.indexOf(c[0]?.toUpperCase() ?? '') * 100 + (parseFloat(c.slice(1)) || 0);
    const strongest = flares.map((f) => f.classType).sort((a, b) => rank(b) - rank(a))[0] ?? null;
    return Response.json({ source: 'NASA DONKI', windowDays: 3, strongest, flares }, {
      headers: { 'Cache-Control': 's-maxage=900, stale-while-revalidate=3600' },
    });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 502 });
  }
}
