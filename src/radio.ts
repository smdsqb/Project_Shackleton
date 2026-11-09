// Suit radio audio: carrier static, Apollo-style Quindar tones, and two voices (female link manager, male Houston).
// Voices come from /api/tts (Groq Orpheus) when it works and fall back to the browser's own speech voices otherwise.
export type Who = 'female' | 'male';
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function split(text: string, max = 180): string[] {
  const out: string[] = []; let cur = '';
  for (const s of text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/)) {
    if (s.length > max) { // very long sentence: break on commas, then on spaces
      for (const part of s.split(/(?<=,)\s+/)) { if ((cur + ' ' + part).length > max && cur) { out.push(cur); cur = ''; } cur = (cur + ' ' + part).trim(); while (cur.length > max) { const i = cur.lastIndexOf(' ', max); out.push(cur.slice(0, i > 0 ? i : max)); cur = cur.slice(i > 0 ? i + 1 : max); } }
      continue;
    }
    if ((cur + ' ' + s).length > max && cur) { out.push(cur); cur = s; } else cur = (cur + ' ' + s).trim();
  }
  if (cur) out.push(cur);
  return out.length ? out : [text.slice(0, max)];
}

export class Radio {
  private ctx: AudioContext | null = null; private nSrc: AudioBufferSourceNode | null = null; private nGain: GainNode | null = null;
  private crack = 0; private level = 0; private cur: AudioBufferSourceNode | null = null;
  private ttsOk = true; private ttsRetryAt = 0; private token = 0; private voices: SpeechSynthesisVoice[] = [];

  constructor() {
    if ('speechSynthesis' in window) { const load = () => { this.voices = speechSynthesis.getVoices(); }; load(); speechSynthesis.addEventListener('voiceschanged', load); }
  }
  private ac(): AudioContext {
    if (!this.ctx) { const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext; this.ctx = new AC(); }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  staticOn(level = 0.05) {
    const c = this.ac(); if (this.nSrc) { this.staticSet(level); return; }
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 500;
    const bp = c.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = 2600;
    const g = c.createGain(); g.gain.value = 0; src.connect(hp); hp.connect(bp); bp.connect(g); g.connect(c.destination); src.start();
    this.nSrc = src; this.nGain = g; this.level = level; g.gain.setTargetAtTime(level, c.currentTime, 0.05);
    this.crack = window.setInterval(() => {
      if (!this.nGain || !this.ctx || Math.random() > 0.5) return; const t = this.ctx.currentTime;
      this.nGain.gain.setTargetAtTime(this.level * (1.2 + Math.random() * 0.8), t, 0.004); this.nGain.gain.setTargetAtTime(this.level, t + 0.03, 0.03);
    }, 120);
  }
  staticSet(level: number, tc = 0.15) { this.level = level; if (this.nGain && this.ctx) this.nGain.gain.setTargetAtTime(level, this.ctx.currentTime, tc); }
  staticOff() {
    clearInterval(this.crack); const g = this.nGain, s = this.nSrc, c = this.ctx; this.nGain = null; this.nSrc = null;
    if (g && c) { g.gain.setTargetAtTime(0, c.currentTime, 0.08); setTimeout(() => { try { s?.stop(); } catch { /* already stopped */ } }, 500); }
  }

  /** Quindar tone: 2525 Hz when a transmission opens, 2475 Hz when it closes. */
  async quindar(kind: 'in' | 'out') {
    const c = this.ac(), o = c.createOscillator(), g = c.createGain(), t = c.currentTime;
    o.type = 'sine'; o.frequency.value = kind === 'in' ? 2525 : 2475; g.gain.value = 0.0001; o.connect(g); g.connect(c.destination);
    g.gain.exponentialRampToValueAtTime(0.03, t + 0.01); g.gain.setValueAtTime(0.03, t + 0.22); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    o.start(t); o.stop(t + 0.27); await sleep(270);
  }

  /** Speak text in a voice. onStart fires when audio actually begins. Resolves when finished or interrupted. */
  async speak(text: string, who: Who, onStart?: () => void, fast = false) {
    const my = ++this.token; this.stopVoice();
    const chunks = split(text); let started = false;
    const go = () => { if (!started) { started = true; onStart?.(); } };
    if (this.ttsOk || Date.now() > this.ttsRetryAt) {
      try {
        let next = this.clip(chunks[0], who, fast);
        for (let i = 0; i < chunks.length; i++) {
          const buf = await next; if (my !== this.token) return;
          if (i + 1 < chunks.length) next = this.clip(chunks[i + 1], who, fast);
          go(); await this.play(buf);
          if (my !== this.token) return;
        }
        this.ttsOk = true; return;
      } catch { this.ttsOk = false; this.ttsRetryAt = Date.now() + 90000; if (my !== this.token) return; }
    }
    go(); await this.synth(text, who, my, fast);
  }
  stop() { this.token++; this.stopVoice(); }
  private stopVoice() { try { this.cur?.stop(); } catch { /* idle */ } this.cur = null; if ('speechSynthesis' in window) speechSynthesis.cancel(); }

  private async clip(text: string, who: Who, fast = false): Promise<AudioBuffer> {
    const r = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice: who, style: fast ? 'emergency' : 'normal' }), signal: AbortSignal.timeout(15000) });
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('audio')) throw new Error('tts ' + r.status);
    return this.ac().decodeAudioData(await r.arrayBuffer());
  }
  private play(buf: AudioBuffer): Promise<void> {
    return new Promise((res) => {
      const c = this.ac(), s = c.createBufferSource(); s.buffer = buf;
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 150; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7200;
      const g = c.createGain(); g.gain.value = 1.0; s.connect(hp); hp.connect(lp); lp.connect(g); g.connect(c.destination);
      this.cur = s; s.onended = () => res(); s.start();
    });
  }
  private pick(who: Who) {
    const en = this.voices.filter((v) => /^en/i.test(v.lang));
    const fem = /female|zira|samantha|karen|susan|hazel|victoria|tessa|moira|fiona|aria|jenny|libby|sonia|natasha|google us english/i, mal = /(^|[^a-z])male|david|mark|daniel|alex|fred|george|james|guy|ryan|thomas|oliver/i;
    return en.find((v) => (who === 'female' ? fem : mal).test(v.name)) ?? en[0];
  }
  private synth(text: string, who: Who, my: number, fast: boolean): Promise<void> {
    return new Promise((res) => {
      if (!('speechSynthesis' in window)) return res();
      const parts = split(text, 160); let i = 0;
      const next = () => {
        if (my !== this.token || i >= parts.length) return res();
        const u = new SpeechSynthesisUtterance(parts[i++]), v = this.pick(who); if (v) u.voice = v; u.lang = v?.lang ?? 'en-US';
        u.rate = who === 'male' ? (fast ? 1.12 : 1.0) : 1.02; u.pitch = who === 'male' ? 0.82 : 1.1; u.onend = next; u.onerror = () => res(); speechSynthesis.speak(u);
      };
      next();
    });
  }
}
