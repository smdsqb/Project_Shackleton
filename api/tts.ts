// Vercel function: speech for the radio. Uses Groq's Orpheus text-to-speech with the same GROQ_API_KEY as the chat.
// If this fails the browser quietly falls back to its own built-in voices.
const hits = new Map<string, number[]>();
const throttled = (ip: string) => { const now = Date.now(), a = (hits.get(ip) ?? []).filter((t) => now - t < 60000); a.push(now); hits.set(ip, a); return a.length > 40; };
const VOICES = { female: process.env.GROQ_TTS_FEMALE ?? 'hannah', male: process.env.GROQ_TTS_MALE ?? 'troy' };

export async function POST(request: Request) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return Response.json({ error: 'GROQ_API_KEY not set' }, { status: 503 });
  const ip = (request.headers.get('x-forwarded-for') ?? 'local').split(',')[0].trim();
  if (throttled(ip)) return Response.json({ error: 'rate limited' }, { status: 429 });
  let body: { text?: string; voice?: string };
  try { body = await request.json(); } catch { return Response.json({ error: 'bad request' }, { status: 400 }); }
  const input = String(body.text ?? '').replace(/[<>\u0000-\u001f]/g, ' ').trim().slice(0, 200);
  if (!input) return Response.json({ error: 'no text' }, { status: 400 });
  const voice = body.voice === 'female' ? VOICES.female : VOICES.male;
  try {
    const r = await fetch('https://api.groq.com/openai/v1/audio/speech', {
      method: 'POST', signal: AbortSignal.timeout(12000),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.GROQ_TTS_MODEL ?? 'canopylabs/orpheus-v1-english', voice, input, response_format: 'wav' }),
    });
    if (!r.ok) return Response.json({ error: 'tts failed', status: r.status, detail: (await r.text()).slice(0, 200) }, { status: 502 });
    return new Response(await r.arrayBuffer(), { headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' } });
  } catch (e) { return Response.json({ error: String(e) }, { status: 502 }); }
}
