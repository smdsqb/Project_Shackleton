// Vercel function: speech to text for talking to the crew. POST the raw recorded audio (webm/ogg/mp4/wav) as the body.
// Tries Groq Whisper first (fast), then ElevenLabs Scribe, using the keys you already have. Order: STT_ORDER="groq,elevenlabs".
//   GROQ_API_KEY (GROQ_STT_MODEL, default whisper-large-v3-turbo)   ELEVENLABS_API_KEY (ELEVENLABS_STT_MODEL, default scribe_v1)
const E = process.env;
const hits = new Map<string, number[]>();
const throttled = (ip: string) => { const now = Date.now(), a = (hits.get(ip) ?? []).filter((t) => now - t < 60000); a.push(now); hits.set(ip, a); return a.length > 40; };
class Skip extends Error {}
const ext = (t: string) => (t.includes('webm') ? 'webm' : t.includes('ogg') ? 'ogg' : t.includes('mp4') || t.includes('m4a') ? 'm4a' : t.includes('wav') ? 'wav' : t.includes('mpeg') ? 'mp3' : 'webm');
const HINT = 'Casual chat with astronaut crew mates on a lunar base: Okafor, Amara, Whitaker, Jim, Zhao, Mei, Mendoza, Rafa. Commander. Airlock, comms, galley, porthole.';

async function groqStt(buf: ArrayBuffer, type: string): Promise<string> {
  const key = E.GROQ_API_KEY; if (!key) throw new Skip('no key');
  const fd = new FormData(); fd.append('file', new Blob([buf], { type }), `clip.${ext(type)}`); fd.append('model', E.GROQ_STT_MODEL ?? 'whisper-large-v3-turbo');
  fd.append('response_format', 'json'); fd.append('temperature', '0'); fd.append('language', E.STT_LANG ?? 'en'); fd.append('prompt', HINT);
  const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 140)}`);
  return String(((await r.json()) as { text?: string }).text ?? '');
}
async function elevenStt(buf: ArrayBuffer, type: string): Promise<string> {
  const key = E.ELEVENLABS_API_KEY; if (!key) throw new Skip('no key');
  const fd = new FormData(); fd.append('file', new Blob([buf], { type }), `clip.${ext(type)}`); fd.append('model_id', E.ELEVENLABS_STT_MODEL ?? 'scribe_v1');
  if (E.STT_LANG ?? 'en') fd.append('language_code', E.STT_LANG ?? 'en');
  const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': key }, body: fd, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 140)}`);
  return String(((await r.json()) as { text?: string }).text ?? '');
}

export async function POST(request: Request) {
  const ip = (request.headers.get('x-forwarded-for') ?? 'local').split(',')[0].trim();
  if (throttled(ip)) return Response.json({ error: 'rate limited' }, { status: 429 });
  const type = (request.headers.get('content-type') ?? 'audio/webm').split(';')[0] || 'audio/webm';
  const buf = await request.arrayBuffer();
  if (buf.byteLength < 800) return Response.json({ error: 'no audio' }, { status: 400 });
  if (buf.byteLength > 4_000_000) return Response.json({ error: 'clip too long' }, { status: 413 });
  const tried: string[] = [];
  for (const p of (E.STT_ORDER ?? 'groq,elevenlabs').split(',').map((s) => s.trim().toLowerCase())) {
    try {
      const text = (p === 'groq' ? await groqStt(buf, type) : p === 'elevenlabs' ? await elevenStt(buf, type) : '').replace(/\s+/g, ' ').trim();
      if (text) return Response.json({ text, provider: p });
      if (p === 'groq' || p === 'elevenlabs') return Response.json({ text: '', provider: p });   // heard silence: don't burn a second provider
    } catch (e) { if (!(e instanceof Skip)) tried.push(`${p}: ${String(e instanceof Error ? e.message : e).slice(0, 180)}`); }
  }
  return Response.json({ error: 'no speech-to-text provider available', tried }, { status: 502 });
}
