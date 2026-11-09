// Vercel function: radio voices. Tries the providers you have keys for, best first, and the browser falls back to its own voices
// if none work. Order can be forced with TTS_ORDER, e.g. "elevenlabs,runway,openai,groq".
//   ELEVENLABS_API_KEY  (ELEVENLABS_VOICE_MALE / _FEMALE voice ids, ELEVENLABS_MODEL)
//   RUNWAYML_API_SECRET (RUNWAY_VOICE_MALE / _FEMALE preset names, RUNWAY_TTS_MODEL)
//   OPENAI_API_KEY      (OPENAI_VOICE_MALE / _FEMALE, OPENAI_TTS_MODEL)
//   GROQ_API_KEY        (GROQ_TTS_MALE / _FEMALE, GROQ_TTS_MODEL)
type Voice = 'female' | 'male'; type Style = 'normal' | 'emergency'; type Clip = { buf: ArrayBuffer; type: string };
const E = process.env;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const hits = new Map<string, number[]>();
const throttled = (ip: string) => { const now = Date.now(), a = (hits.get(ip) ?? []).filter((t) => now - t < 60000); a.push(now); hits.set(ip, a); return a.length > 60; };
class Skip extends Error {}

async function elevenlabs(text: string, voice: Voice, style: Style): Promise<Clip> {
  const key = E.ELEVENLABS_API_KEY; if (!key) throw new Skip('no key');
  const id = voice === 'female' ? E.ELEVENLABS_VOICE_FEMALE ?? 'EXAVITQu4vr4xnSDxMaL' : E.ELEVENLABS_VOICE_MALE ?? 'nPczCjzI2devNBz1zQrb';
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${id}?output_format=mp3_44100_128`, {
    method: 'POST', signal: AbortSignal.timeout(9000), headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: E.ELEVENLABS_MODEL ?? 'eleven_multilingual_v2', voice_settings: { stability: style === 'emergency' ? 0.6 : 0.42, similarity_boost: 0.75, style: style === 'emergency' ? 0.05 : 0.2, use_speaker_boost: true } }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 140)}`);
  return { buf: await r.arrayBuffer(), type: 'audio/mpeg' };
}

// Runway's speech models are ElevenLabs underneath, but you submit a task and poll for it, so it is slower than calling ElevenLabs directly.
async function runway(text: string, voice: Voice): Promise<Clip> {
  const key = E.RUNWAYML_API_SECRET ?? E.RUNWAYML_API_KEY; if (!key) throw new Skip('no key');
  const headers = { Authorization: `Bearer ${key}`, 'X-Runway-Version': '2024-11-06', 'Content-Type': 'application/json' };
  const presetId = voice === 'female' ? E.RUNWAY_VOICE_FEMALE ?? 'Maya' : E.RUNWAY_VOICE_MALE ?? 'Mark', model = E.RUNWAY_TTS_MODEL ?? 'eleven_multilingual_v2';
  const start = Date.now(), post = (field: string) => fetch('https://api.dev.runwayml.com/v1/text_to_speech', { method: 'POST', headers, signal: AbortSignal.timeout(8000), body: JSON.stringify({ model, [field]: text, voice: { type: 'runway-preset', presetId } }) });
  let r = await post('promptText'); if (r.status === 400) r = await post('text');
  if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 140)}`);
  const { id } = (await r.json()) as { id: string };
  while (Date.now() - start < 9000) {
    await sleep(600);
    const j = (await (await fetch(`https://api.dev.runwayml.com/v1/tasks/${id}`, { headers })).json()) as { status: string; output?: string[] | string };
    if (j.status === 'SUCCEEDED') { const url = Array.isArray(j.output) ? j.output[0] : j.output; const a = await fetch(String(url)); return { buf: await a.arrayBuffer(), type: a.headers.get('content-type') ?? 'audio/mpeg' }; }
    if (j.status === 'FAILED' || j.status === 'CANCELLED') throw new Error('task ' + j.status.toLowerCase());
  }
  throw new Error('timed out waiting for the task');
}

async function openai(text: string, voice: Voice, style: Style): Promise<Clip> {
  const key = E.OPENAI_API_KEY; if (!key) throw new Skip('no key');
  const instructions = voice === 'female' ? 'Calm, clear, unhurried spacecraft link manager. Professional and slightly warm, natural cadence, never robotic.'
    : style === 'emergency' ? 'A veteran NASA flight controller handling an emergency: calm, controlled, clipped and precise, never panicked.'
    : 'A relaxed, experienced NASA CAPCOM on a radio loop: conversational, understated, a slight smile, natural pauses, never an announcer.';
  const r = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST', signal: AbortSignal.timeout(9000), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: E.OPENAI_TTS_MODEL ?? 'gpt-4o-mini-tts', voice: voice === 'female' ? E.OPENAI_VOICE_FEMALE ?? 'coral' : E.OPENAI_VOICE_MALE ?? 'ash', input: text, instructions, response_format: 'mp3' }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 140)}`);
  return { buf: await r.arrayBuffer(), type: 'audio/mpeg' };
}

async function groq(text: string, voice: Voice): Promise<Clip> {
  const key = E.GROQ_API_KEY; if (!key) throw new Skip('no key');
  const r = await fetch('https://api.groq.com/openai/v1/audio/speech', {
    method: 'POST', signal: AbortSignal.timeout(9000), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: E.GROQ_TTS_MODEL ?? 'canopylabs/orpheus-v1-english', voice: voice === 'female' ? E.GROQ_TTS_FEMALE ?? 'hannah' : E.GROQ_TTS_MALE ?? 'troy', input: text.slice(0, 200), response_format: 'wav' }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 140)}`);
  return { buf: await r.arrayBuffer(), type: 'audio/wav' };
}

export async function POST(request: Request) {
  const ip = (request.headers.get('x-forwarded-for') ?? 'local').split(',')[0].trim();
  if (throttled(ip)) return Response.json({ error: 'rate limited' }, { status: 429 });
  let body: { text?: string; voice?: string; style?: string };
  try { body = await request.json(); } catch { return Response.json({ error: 'bad request' }, { status: 400 }); }
  const text = String(body.text ?? '').replace(/[<>\u0000-\u001f]/g, ' ').trim().slice(0, 400);
  if (!text) return Response.json({ error: 'no text' }, { status: 400 });
  const voice: Voice = body.voice === 'female' ? 'female' : 'male', style: Style = body.style === 'emergency' ? 'emergency' : 'normal';
  const order = (E.TTS_ORDER ?? 'elevenlabs,runway,openai,groq').split(',').map((s) => s.trim().toLowerCase());
  const tried: string[] = [];
  for (const p of order) {
    try {
      const clip = p === 'elevenlabs' ? await elevenlabs(text, voice, style) : p === 'runway' ? await runway(text, voice) : p === 'openai' ? await openai(text, voice, style) : p === 'groq' ? await groq(text, voice) : null;
      if (clip) return new Response(clip.buf, { headers: { 'Content-Type': clip.type, 'Cache-Control': 'no-store', 'x-tts-provider': p } });
    } catch (e) { if (!(e instanceof Skip)) tried.push(`${p}: ${String(e instanceof Error ? e.message : e).slice(0, 180)}`); }
  }
  return Response.json({ error: 'no voice provider available', tried }, { status: 502 });
}
