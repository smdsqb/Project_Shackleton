// Talking to the crew. Press V to open the mic (it stops when you stop talking, or press V again to send, Esc cancels);
// press T to type instead. The nearest awake crew member (or whoever you name) turns to you, answers in their own voice, and
// then does what you asked or goes back to their task.
//   mic -> /api/stt (Groq Whisper, ElevenLabs Scribe as backup) -> /api/crew (Groq writes the reply and picks an action)
//   -> /api/tts (ElevenLabs, a distinct voice per person) -> played from the speaker's position in 3D, mouth driven by the audio.
// Every reply is also shown as a caption, and voice replies can be switched off in the text panel.
import * as THREE from 'three';
import type { Crew, Bot, CrewAction } from './crew';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
type Turn = { role: 'me' | 'you'; text: string };
type Reply = { say: string; do: CrewAction };

const CSS = `#chint{position:fixed;bottom:12px;right:16px;font-size:10px;letter-spacing:.18em;color:#7d8a99;pointer-events:none;z-index:5}#chint b{color:#4fd8ff;font-weight:600}
#cstat{position:fixed;left:50%;bottom:11%;transform:translateX(-50%);display:none;padding:6px 16px;font-size:11px;letter-spacing:.2em;color:#4fd8ff;background:rgba(5,7,10,.78);border:1px solid rgba(79,216,255,.45);border-radius:3px;z-index:6;pointer-events:none;white-space:nowrap}
#cstat.rec{color:#ff6b6b;border-color:#ff6b6b}#cstat.rec i{display:inline-block;width:8px;height:8px;border-radius:50%;background:#ff4d4d;margin-right:8px;animation:cpulse 1s infinite}@keyframes cpulse{50%{opacity:.25}}
#csub{position:fixed;left:50%;bottom:29%;transform:translateX(-50%);width:min(640px,90vw);display:flex;flex-direction:column;gap:5px;align-items:center;z-index:6;pointer-events:none}
#csub div{max-width:100%;padding:5px 12px;font-size:13px;line-height:1.4;background:rgba(5,7,10,.72);border-radius:3px;color:#e9edf1;animation:cfade .25s}#csub .me{color:#7fd6ff}#csub .nm{color:#ffb000;letter-spacing:.14em;font-size:10px;margin-right:8px}@keyframes cfade{from{opacity:0}}
#cbox{position:fixed;right:16px;bottom:16px;width:min(380px,92vw);display:none;flex-direction:column;background:rgba(4,12,18,.9);border:1px solid rgba(79,216,255,.45);border-radius:6px;z-index:7;backdrop-filter:blur(3px)}#cbox.on{display:flex}
#cbox .hd{display:flex;justify-content:space-between;align-items:center;padding:7px 12px;font-size:11px;letter-spacing:.18em;color:#ffb000;border-bottom:1px solid rgba(79,216,255,.2)}
#cbox label{font-size:10px;letter-spacing:.12em;color:#7d8a99;cursor:pointer;user-select:none}#cbox label input{margin-right:5px;vertical-align:-2px}
#cbox form{display:flex;gap:8px;padding:9px 12px;align-items:center}#cbox form span{color:#4fd8ff}#cbox input[type=text]{flex:1;background:transparent;border:0;outline:0;color:#e9edf1;font:inherit;font-size:13px}
#cbox button{background:transparent;border:1px solid rgba(79,216,255,.45);color:#4fd8ff;font:inherit;font-size:11px;padding:3px 9px;cursor:pointer;border-radius:3px}#cbox .tip{padding:0 12px 8px;font-size:10px;letter-spacing:.1em;color:#566}`;

const localReply = (text: string, bot: Bot): Reply => {
  const t = text.toLowerCase(), f = bot.spec.first, o = (say: string, d: CrewAction): Reply => ({ say, do: d });
  if (/\b(come|over here|get over|come here)\b/.test(t)) return o('On my way, Commander.', { type: 'come' });
  if (/\bfollow\b/.test(t)) return o('Right behind you.', { type: 'follow' });
  if (/\b(stop|wait|stay|hold on|hold up)\b/.test(t)) return o('Holding right here.', { type: 'stop' });
  if (/\bdance\b/.test(t)) return o('Oh, you asked for it.', { type: 'emote', emote: 'dance' });
  if (/\bjump\b/.test(t)) return o('Lunar gravity, baby!', { type: 'emote', emote: 'jump' });
  if (/\bsalute\b/.test(t)) return o('Yes, sir. Commander, sir.', { type: 'emote', emote: 'salute' });
  if (/\b(thumbs|good job|nice)\b/.test(t)) return o('Thanks, Commander.', { type: 'emote', emote: 'thumbsup' });
  if (/\b(window|porthole|stars?)\b/.test(t)) return o('Sure, a bit of sky never hurt.', { type: 'goto', place: 'window' });
  if (/\b(console|comms|radio)\b/.test(t)) return o('Heading to the console.', { type: 'goto', place: 'console' });
  if (/\b(galley|kitchen|coffee|snack|eat)\b/.test(t)) return o('Coffee. Yes. Going.', { type: 'goto', place: 'galley' });
  if (/\blab\b/.test(t)) return o('To the lab, then.', { type: 'goto', place: 'lab' });
  if (/\b(outside|moonwalk|eva|surface)\b/.test(t)) return o('Suiting up, give me a minute.', { type: 'task', task: 'moonwalk' });
  if (/\b(sleep|bed|bunk|nap)\b/.test(t)) return o('Now that I can do.', { type: 'goto', place: 'bunk' });
  if (/\b(hi|hello|hey|morning|evening|afternoon|wave)\b/.test(t)) return o(`Hey Commander, ${f} here.`, { type: 'emote', emote: 'wave' });
  return o(['Copy that, Commander.', 'Yep, got you.', 'Sure thing.'][Math.floor(Math.random() * 3)], { type: 'none' });
};
const localGreeting = (hour: number, bot: Bot): Reply => {
  const part = hour >= 5 && hour < 12 ? 'Morning' : hour >= 12 && hour < 17 ? 'Afternoon' : hour >= 17 && hour < 21 ? 'Evening' : 'Late night';
  return { say: part === 'Late night' ? `Burning the midnight oil, Commander? Same here.` : `${part}, Commander. ${bot.spec.first} reporting in.`, do: { type: 'emote', emote: 'wave' } };
};

export class CrewTalk {
  voiceReplies = true; recording = false; busy = false; greeted = false;
  private ctx: AudioContext | null = null; private stop: ((send: boolean) => void) | null = null;
  private cur: { an: AnalyserNode; data: Uint8Array<ArrayBuffer>; bot: Bot; pan: PannerNode | null } | null = null;
  private hist = new Map<string, Turn[]>(); private statusEl: HTMLElement; private subEl: HTMLElement; private box: HTMLElement; private inp: HTMLInputElement; private vchk: HTMLInputElement;
  private statusT = 0; private fwd = new THREE.Vector3(); private tmp = new THREE.Vector3();

  constructor(private crew: Crew, private camera: THREE.PerspectiveCamera) {
    const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
    const mk = (tag: string, id: string, html = '') => { const e = document.createElement(tag); e.id = id; e.innerHTML = html; document.body.append(e); return e; };
    mk('div', 'chint', '<b>V</b> TALK TO CREW &nbsp;·&nbsp; <b>T</b> TYPE');
    this.statusEl = mk('div', 'cstat'); this.subEl = mk('div', 'csub');
    this.box = mk('div', 'cbox', `<div class="hd"><span>CREW CHANNEL</span><label><input type="checkbox" id="cvoice" checked>VOICE REPLIES</label></div>
      <form autocomplete="off"><span>&gt;</span><input type="text" id="cin" maxlength="240" placeholder="say something to the crew…"><button type="button" id="cmic">MIC</button></form>
      <div class="tip">NEAREST CREW MEMBER ANSWERS · SAY A NAME TO PICK ONE · ENTER SENDS · ESC CLOSES</div>`);
    this.inp = this.box.querySelector('#cin')!; this.vchk = this.box.querySelector('#cvoice')!;
    this.vchk.addEventListener('change', () => { this.voiceReplies = this.vchk.checked; });
    this.box.querySelector('#cmic')!.addEventListener('click', () => { this.closeText(); void this.toggleMic(); });
    this.box.querySelector('form')!.addEventListener('submit', (e) => { e.preventDefault(); const v = this.inp.value.trim(); this.inp.value = ''; this.closeText(); if (v) void this.converse(v); });
    this.inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); this.closeText(); } });
    this.inp.addEventListener('keyup', (e) => e.stopPropagation());
  }

  // ------------------------------------------------------------ UI helpers
  private status(text: string, ms = 0, rec = false) {
    clearTimeout(this.statusT); this.statusEl.className = rec ? 'rec' : ''; this.statusEl.innerHTML = (rec ? '<i></i>' : '') + text.replace(/[<>&]/g, ''); this.statusEl.style.display = text ? 'block' : 'none';
    if (ms) this.statusT = window.setTimeout(() => { this.statusEl.style.display = 'none'; }, ms);
  }
  private line(name: string, text: string, me = false) {
    const d = document.createElement('div'); if (me) d.className = 'me'; d.innerHTML = `<span class="nm">${name.replace(/[<>&]/g, '')}</span>`; d.append(document.createTextNode(text));
    this.subEl.append(d); while (this.subEl.children.length > 3) this.subEl.firstChild?.remove(); setTimeout(() => d.remove(), 3500 + text.length * 70);
  }
  get textOpen() { return this.box.classList.contains('on'); }
  openText() { document.getElementById('chint')!.style.display = 'none'; this.box.classList.add('on'); this.vchk.checked = this.voiceReplies; this.inp.focus(); }
  closeText() { document.getElementById('chint')!.style.display = ''; this.box.classList.remove('on'); this.inp.blur(); }

  // ------------------------------------------------------------ audio plumbing
  private ac(): AudioContext {
    if (!this.ctx) { const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext; this.ctx = new AC(); }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }
  private blip(freq: number) {
    const c = this.ac(), o = c.createOscillator(), g = c.createGain(), t = c.currentTime; o.frequency.value = freq; g.gain.value = 0.0001; o.connect(g); g.connect(c.destination);
    g.gain.exponentialRampToValueAtTime(0.03, t + 0.01); g.gain.setValueAtTime(0.03, t + 0.18); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22); o.start(t); o.stop(t + 0.23);
  }
  /** call every frame: keeps the 3D listener on the camera, the voice on the speaker's head, and the speaker's mouth moving with the audio */
  update() {
    const c = this.ctx; if (!c) return; const L = c.listener, p = this.camera.position; this.camera.getWorldDirection(this.fwd);
    if (L.positionX) { L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z; L.forwardX.value = this.fwd.x; L.forwardY.value = this.fwd.y; L.forwardZ.value = this.fwd.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
    else L.setPosition(p.x, p.y, p.z);
    if (this.cur) {
      const { an, data, bot, pan } = this.cur; an.getByteTimeDomainData(data); let s = 0; for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; s += v * v; }
      bot.lip += (clamp(Math.sqrt(s / data.length) * 7, 0, 1) - bot.lip) * 0.5;
      if (pan) { bot.rig.root.getWorldPosition(this.tmp); pan.positionX.value = this.tmp.x; pan.positionY.value = this.tmp.y + 0.38 * bot.spec.h; pan.positionZ.value = this.tmp.z; }
    }
  }

  private async tts(text: string, bot: Bot): Promise<AudioBuffer> {
    const r = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000), body: JSON.stringify({ text, voice: bot.spec.female ? 'female' : 'male', person: bot.spec.name.toLowerCase(), fast: true }) });
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('audio')) throw new Error('tts ' + r.status);
    return this.ac().decodeAudioData(await r.arrayBuffer());
  }
  private play(buf: AudioBuffer, bot: Bot, radio: boolean): Promise<void> {
    return new Promise((res) => {
      const c = this.ac(), src = c.createBufferSource(), an = c.createAnalyser(), g = c.createGain(); src.buffer = buf; an.fftSize = 512; g.gain.value = radio ? 0.9 : 1.15;
      src.connect(an); let node: AudioNode = src, pan: PannerNode | null = null;
      if (radio) { const hp = c.createBiquadFilter(), lp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 320; lp.type = 'lowpass'; lp.frequency.value = 3300; node.connect(hp); hp.connect(lp); node = lp; this.blip(2525); }
      else { pan = c.createPanner(); pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse'; pan.refDistance = 1.6; pan.rolloffFactor = 1.1; pan.maxDistance = 80; node.connect(pan); node = pan; }
      node.connect(g); g.connect(c.destination);
      this.cur = { an, data: new Uint8Array(an.fftSize), bot, pan };
      src.onended = () => { this.cur = null; bot.lip = 0; if (radio) this.blip(2475); res(); }; src.start();
    });
  }
  private browserSpeak(text: string, bot: Bot): Promise<void> {
    return new Promise((res) => {
      if (!('speechSynthesis' in window)) return res();
      const vs = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang)), fem = /female|zira|samantha|karen|susan|hazel|victoria|tessa|aria|jenny|sonia|google us english/i;
      const v = vs.find((x) => (bot.spec.female ? fem.test(x.name) : !fem.test(x.name))) ?? vs[0], u = new SpeechSynthesisUtterance(text);
      if (v) u.voice = v; u.pitch = { OKAFOR: 1.05, WHITAKER: 0.78, ZHAO: 1.22, MENDOZA: 0.95 }[bot.spec.name] ?? 1; u.rate = 1.05;
      const iv = window.setInterval(() => { bot.lip = 0.15 + Math.random() * 0.6; }, 110); const done = () => { clearInterval(iv); bot.lip = 0; res(); };
      u.onend = done; u.onerror = done; speechSynthesis.speak(u);
    });
  }

  // ------------------------------------------------------------ conversation
  private target(text: string) {
    const p = this.camera.position, named = this.crew.byName(text);
    if (named) return { bot: named, d: Math.hypot(p.x - named.x, p.z - named.z) };
    return this.crew.nearest(p, true);
  }
  private async ask(body: Record<string, unknown>, fallback: Reply): Promise<Reply> {
    try {
      const r = await fetch('/api/crew', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(14000), body: JSON.stringify(body) });
      if (!r.ok) throw new Error('crew ' + r.status);
      const j = (await r.json()) as { say?: string; do?: CrewAction };
      if (!j.say) throw new Error('empty'); return { say: j.say, do: j.do ?? { type: 'none' } };
    } catch { return fallback; }
  }
  private async speak(bot: Bot, text: string, radio: boolean) {
    this.line(`${bot.spec.first} ${bot.spec.name}`.toUpperCase(), text);
    let buf: AudioBuffer | null = null;
    if (this.voiceReplies) { try { buf = await this.tts(text, bot); } catch { buf = null; } }
    bot.convo = 'speak';
    if (buf) await this.play(buf, bot, radio); else if (this.voiceReplies) await this.browserSpeak(text, bot); else await sleep(Math.min(5000, 900 + text.length * 55));
    bot.lip = 0;
  }
  private clock() { const d = new Date(); return { hour: d.getHours(), clock: `${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}, ${d.toLocaleDateString([], { weekday: 'long' })}` }; }

  async converse(text: string) {
    if (this.busy) return; this.busy = true;
    try {
      const t = this.target(text); if (!t) { this.status('NOBODY IS AROUND TO HEAR YOU', 2500); return; }
      const bot = t.bot, p = this.camera.position, radio = t.d > 15 || this.crew.playerOutside(p) !== bot.eva;
      this.line('YOU', text, true);
      if (bot.sleepStage < 2) bot.convo = 'think';
      this.status(`${bot.spec.first.toUpperCase()} IS THINKING…`);
      const h = this.hist.get(bot.spec.name) ?? []; const ck = this.clock();
      const res = await this.ask({ who: bot.spec.name, kind: 'chat', text, ctx: bot.ctx(), history: h.map((x) => ({ role: x.role === 'me' ? 'me' : 'you', text: x.text })), radio, ...ck }, localReply(text, bot));
      h.push({ role: 'me', text }, { role: 'you', text: res.say }); this.hist.set(bot.spec.name, h.slice(-12));
      this.status('');
      if (res.do.type === 'emote') bot.perform(res.do, p);
      await this.speak(bot, res.say, radio);
      bot.convo = null; if (res.do.type !== 'emote' && res.do.type !== 'none') bot.perform(res.do, p);
    } finally { this.busy = false; for (const b of this.crew.bots) if (b.convo) b.convo = null; this.status(''); }
  }

  /** the nearest crew member says a one-line hello that fits the time of day where the player is */
  async greet() {
    if (this.greeted) return;
    for (let i = 0; i < 24; i++) { const t = this.crew.nearest(this.camera.position); if (t && t.d < 12) break; await sleep(1500); }
    const t = this.crew.nearest(this.camera.position); if (!t || this.busy || this.greeted) return;
    this.greeted = true; this.busy = true; const bot = t.bot, p = this.camera.position, ck = this.clock();
    try {
      bot.convo = 'think';
      const res = await this.ask({ who: bot.spec.name, kind: 'greet', ctx: bot.ctx(), ...ck }, localGreeting(ck.hour, bot));
      bot.perform({ type: 'emote', emote: 'wave' }, p); await this.speak(bot, res.say, false);
    } finally { bot.convo = null; this.busy = false; }
  }

  // ------------------------------------------------------------ microphone (push to open, auto-stops on silence)
  async toggleMic() {
    if (this.recording) { this.stop?.(true); return; }
    if (this.busy) return;
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
    catch { this.status('MIC BLOCKED OR MISSING, TYPE INSTEAD', 3500); this.openText(); return; }
    const c = this.ac(), node = c.createMediaStreamSource(stream), an = c.createAnalyser(); an.fftSize = 1024; node.connect(an);
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? '';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined), chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    this.recording = true; const t0 = performance.now(); let noise = 0, nn = 0, spoke = false, last = t0, done = false; const buf = new Float32Array(an.fftSize);
    const who = this.crew.nearest(this.camera.position, true), tag = who ? who.bot.spec.first.toUpperCase() : 'CREW';
    this.status(`LISTENING · ${tag} · V TO SEND · ESC CANCELS`, 0, true);
    const finish = (send: boolean) => {
      if (done) return; done = true; this.recording = false; this.stop = null; if (rec.state !== 'inactive') rec.stop();
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop()); node.disconnect();
        if (!send || !spoke) { this.status(send ? 'DIDN’T CATCH ANYTHING' : '', send ? 1800 : 0); return; }
        void this.transcribe(new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' }));
      };
    };
    this.stop = finish; rec.start(250);
    const tick = () => {
      if (done) return; an.getFloatTimeDomainData(buf); let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]; const rms = Math.sqrt(s / buf.length), now = performance.now();
      if (now - t0 < 350) { noise += rms; nn++; } else if (rms > Math.max(0.018, (noise / Math.max(1, nn)) * 2.8)) { spoke = true; last = now; }
      if (spoke && now - last > 1150) return finish(true); if (now - t0 > 14000) return finish(true); if (!spoke && now - t0 > 7000) return finish(false);
      setTimeout(tick, 50);
    };
    tick();
  }
  cancel() { if (this.recording) this.stop?.(false); }

  private async transcribe(blob: Blob) {
    this.status('TRANSCRIBING…'); this.busy = true; let text = '';
    try {
      const r = await fetch('/api/stt', { method: 'POST', headers: { 'Content-Type': blob.type || 'audio/webm' }, body: blob, signal: AbortSignal.timeout(16000) });
      if (!r.ok) throw new Error('stt ' + r.status); text = String(((await r.json()) as { text?: string }).text ?? '').trim();
    } catch { this.busy = false; this.status('VOICE RECOGNITION UNAVAILABLE, TYPE INSTEAD (T)', 3500); this.openText(); return; }
    this.busy = false;
    if (!text) { this.status('DIDN’T CATCH THAT', 1800); return; }
    await this.converse(text);
  }
}
