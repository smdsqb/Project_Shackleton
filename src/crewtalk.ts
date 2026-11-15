// Talking to the crew (and Houston). Press V to open the mic (it stops when you stop talking, or press V again to send,
// Esc cancels); press B to radio Houston by voice; press T to type. The nearest awake crew member (or whoever you name, or
// everybody) turns to you, answers in their own voice, and does what you asked, including the game's real repair jobs.
// The crew also talk to each other, crack jokes, start conversations with you, and after a question your mic opens by itself.
//   mic -> /api/stt (Groq Whisper, ElevenLabs Scribe as backup) -> /api/crew (Groq: line + action, with live base status)
//   -> /api/tts (ElevenLabs, a distinct voice per person) -> played from the speaker's position in 3D, mouth driven by the audio.
//   Houston: the same mic -> /api/stt, then the comms pad sends it and Houston answers over the radio voice as before.
import * as THREE from 'three';
import { isBroadcast } from './crew';
import type { Crew, Bot, CrewAction } from './crew';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
type Turn = { role: 'me' | 'you'; text: string };
type Reply = { say: string; do: CrewAction; ask?: boolean };
type Job = { id: string; ok: boolean; why?: string };
/** what the game gives the crew voice layer: live base state, the repair-job interface and idle checks */
export type CrewHost = {
  houston?: (text: string) => Promise<void>;
  world: () => string;
  jobs: () => Job[];
  startJob: (id: string) => string;     // '' when started, else the reason it can't be
  lastLog: () => string;
  canChat: () => boolean;               // false while a menu/terminal is open or the sim is paused
  /** mirror every captioned line into the comms console log (while the CREW target is selected) */
  panelLine?: (name: string, text: string, me: boolean) => void;
  /** open the comms console on a target/mode (used when speech fails and typing is the fallback) */
  openPanel?: (target: 'houston' | 'crew', mode: 'voice' | 'text') => void;
};

const CSS = `#chint{position:fixed;bottom:12px;right:16px;font-size:10px;letter-spacing:.18em;color:#7d8a99;pointer-events:none;z-index:5}#chint b{color:#4fd8ff;font-weight:600}
#cstat{position:fixed;left:50%;bottom:11%;transform:translateX(-50%);display:none;padding:6px 16px;font-size:11px;letter-spacing:.2em;color:#4fd8ff;background:rgba(5,7,10,.78);border:1px solid rgba(79,216,255,.45);border-radius:3px;z-index:6;pointer-events:none;white-space:nowrap}
#cstat.rec{color:#ff6b6b;border-color:#ff6b6b}#cstat.rec i{display:inline-block;width:8px;height:8px;border-radius:50%;background:#ff4d4d;margin-right:8px;animation:cpulse 1s infinite}@keyframes cpulse{50%{opacity:.25}}
#csub{position:fixed;left:50%;bottom:29%;transform:translateX(-50%);width:min(640px,90vw);display:flex;flex-direction:column;gap:5px;align-items:center;z-index:6;pointer-events:none}
#csub div{max-width:100%;padding:5px 12px;font-size:13px;line-height:1.4;background:rgba(5,7,10,.72);border-radius:3px;color:#e9edf1;animation:cfade .25s}#csub .me{color:#7fd6ff}#csub .nm{color:#ffb000;letter-spacing:.14em;font-size:10px;margin-right:8px}@keyframes cfade{from{opacity:0}}`;

const JOB_NAMES: Record<string, string> = { patch: 'patching the hull leak', sealant: 'sealing the leak from inside', clean: 'brushing the dust off the array', busfix: 'repairing the array power string', antenna: 're-pointing the antenna', bed: 'swapping the scrubber bed', stack: 'swapping the oxygenator stack', coolant: 'swapping the coolant pump', waterline: 'repairing the water line', extinguish: 'fighting the fire', isolate: 'isolating the battery pack', medic: 'treating the injured crew member', inspect: 'inspecting the hull and equipment', berm: 'piling regolith over the hab' };
const ATTENTION = /\b(listen|attention|gather|huddle|assemble|hear me|over here|come (here|over|to me)|get (over )?here|to me)\b/i;
const HOUSTON = /^\s*(?:(?:hey|hi|hello|ok|okay|yo)[ ,]+)?(?:houston|mission control|capcom|ground control|flight director)\b|\b(?:radio|call|contact|tell|ask|message|hail|get me|patch me (?:in )?to|connect me to)\s+(?:houston|mission control|capcom|ground control|the flight director)\b|\bthis is shackleton\b/i;
/** does it sound like an instruction rather than chat? (imperative verb, "can you...", "please...", "I need you to...") */
export const isOrder = (text: string) => /^(?:(?:ok|okay|hey|hi|yo|please|alright|right|now|so)[ ,]+)*(?:\w+,?\s+)?(?:go|come|get|take|do|fix|patch|plug|seal|clean|check|grab|bring|put|swap|repair|start|stop|wait|follow|help|inspect|treat|dust|brush|handle|deal|make|run|hurry|move|head|walk|suit|extinguish|isolate|re-?point|pile|sweep|tend|look|find|call|tell|ask|show|stay|hold|freeze|jump|dance|wave|salute|let'?s)\b|\b(?:can|could|would|will) you\b|\bplease\b|\bneed you to\b|\bi want you to\b|\bgo ahead\b|\bhave to\b|\bgotta\b|\bneed (?:someone|somebody|everyone|you)\b/i.test(text.trim());
/** a plain-language reading of what the Commander asked for; backs up the language model so an order is never dropped */
export function parseIntent(text: string): CrewAction | null {
  const t = text.toLowerCase(), T = (re: RegExp) => re.test(t), J = (job: string): CrewAction => ({ type: 'job', job });
  if (T(/\b(patch|plug|seal|fix|repair|close|stop|cover|stem)\b.*\b(breach|leak|hole|crack|hull|puncture)\b|\b(breach|leak|hole|crack|puncture)\b.*\b(patch|plug|seal|fix|repair)\b/)) return J(T(/\b(inside|from inside|sealant|foam)\b/) ? 'sealant' : 'patch');
  if (T(/\b(clean|brush|sweep|wipe|dust off)\b.*\b(array|panels?|solar)\b|\b(array|panels?|solar)\b.*\b(dust|clean|brush)\b/)) return J('clean');
  if (T(/\b(fix|repair|restore|sort out)\b.*\b(solar|array|panels?|power string|string)\b|\b(solar|array|panels?)\b.*\b(fix|repair|broken|damaged)\b/)) return J('busfix');
  if (T(/\b(put out|extinguish|fight|deal with|handle|stop)\b.*\b(fire|flames?|blaze)\b|\bfire\b/)) return J('extinguish');
  if (T(/\bbatter(y|ies)\b/) && T(/\b(overheat|hot|runaway|isolate|disconnect|swap out|smoking)\b/)) return J('isolate');
  if (T(/\bcoolant\b|\bcooling pump\b|\bcoolant pump\b/)) return J('coolant');
  if (T(/\bwater\b/) && T(/\b(leak|line|pipe)\b/)) return J('waterline');
  if (T(/\b(treat|heal|bandage|patch up|check on|help)\b.*\b(injured|hurt|wound|casualty)\b|\bmedic\b|\bfirst aid\b|\binjured\b/)) return J('medic');
  if (T(/\b(scrubber|co2|lioh)\b/) && T(/\b(swap|change|replace|bed|fix)\b/)) return J('bed');
  if (T(/\b(oxygenator|o2 generator|oxygen stack)\b/) && T(/\b(swap|change|replace|stack|fix)\b/)) return J('stack');
  if (T(/\b(antenna|gimbal|dish)\b/) && T(/\b(point|aim|fix|free|repair|stuck|unstick|align)\b/)) return J('antenna');
  if (T(/\binspect (the )?(hull|equipment|base|habitat|everything)\b|\bcheck (the )?hull\b|\bhull (check|inspection)\b/)) return J('inspect');
  if (T(/\b(pile|cover|bury|berm|heap|shovel)\b.*\b(regolith|soil|hab|habitat)\b|\bberm\b/)) return J('berm');
  if (T(/\b(follow me|come with me|come along|tag along|stick with me|walk with me)\b/)) return { type: 'follow' };
  if (T(/\b(dance|boogie)\b/)) return { type: 'emote', emote: 'dance' };
  if (T(/\b(jump|hop|bounce)\b/)) return { type: 'emote', emote: 'jump' };
  if (T(/\bsalute\b/)) return { type: 'emote', emote: 'salute' };
  if (T(/\b(thumbs|thumbs up)\b/)) return { type: 'emote', emote: 'thumbsup' };
  if (T(/\bshrug\b/)) return { type: 'emote', emote: 'shrug' };
  if (T(/\bfacepalm\b/)) return { type: 'emote', emote: 'facepalm' };
  if (T(/\b(wave|say hi|say hello|give me a wave)\b/)) return { type: 'emote', emote: 'wave' };
  if (T(/\b(samples?|rocks?|regolith|collect|geology)\b/)) return { type: 'task', task: 'sample' };
  if (T(/\binspect|\bcheck (the )?(batter(y|ies)|tanks?|radiator|equipment|gear|outside)/)) return { type: 'task', task: 'inspect' };
  if (T(/\b(moonwalk|walk outside|go outside|go out|step outside|suit up|eva|surface)\b/)) return { type: 'task', task: 'moonwalk' };
  if (T(/\bstar ?gaz|\b(look|watch|see|check) (at )?the (stars|sky|earth)\b/)) return { type: 'task', task: 'stargaze' };
  if (T(/\b(photo|photos|picture|pictures|selfie)\b/)) return { type: 'task', task: 'photo' };
  if (T(/\b(journal|diary|write in)\b/)) return { type: 'task', task: 'journal' };
  if (T(/\b(stretch|exercise|workout|work out)\b/)) return { type: 'task', task: 'stretch' };
  if (T(/\b(coffee|snack|tea|drink|food|eat|hungry)\b/)) return { type: 'task', task: 'coffee' };
  if (T(/\bradio check\b/)) return { type: 'task', task: 'radio' };
  if (T(/\b(software|update|upgrade)\b/)) return { type: 'task', task: 'update' };
  if (T(/\b(racks?|life support|oxygen|scrubber|water reclaimer|regulator)\b/)) return { type: 'task', task: 'rack' };
  if (T(/\b(lab|experiment|microscope)\b/)) return { type: 'task', task: 'lab' };
  if (T(/\b(window|porthole)\b/)) return { type: 'goto', place: 'window' };
  if (T(/\b(console|comms|communications)\b/)) return { type: 'goto', place: 'console' };
  if (T(/\b(galley|kitchen)\b/)) return { type: 'goto', place: 'galley' };
  if (T(/\b(bunk|bed|sleep|nap|rest|turn in)\b/)) return { type: 'goto', place: 'bunk' };
  if (T(/\bairlock\b/)) return { type: 'goto', place: 'airlock' };
  if (T(/\b(middle|centre|center)\b/)) return { type: 'goto', place: 'center' };
  if (T(/\b(stop|wait|hold (on|up|it)|stay|freeze|stand by|don'?t move)\b/)) return { type: 'stop' };
  if (ATTENTION.test(t)) return { type: 'come' };
  return null;
}
const ACK: Record<string, string[]> = {
  come: ['On my way, Commander.', 'Coming right now.', 'Be right there.'], follow: ['Right behind you.', 'Lead the way, Commander.'], stop: ['Holding right here.', 'Not moving a muscle.'],
  goto: ['Heading there now.', 'On it, moving.', 'Going, Commander.'], task: ['On it, doing it now.', 'Consider it started.', 'Yes, Commander, starting now.'], emote: ['Ha, you got it.', 'Sure thing!'],
  job: ['On it, starting the repair now.', 'Suiting up, consider it handled.', 'Already moving, Commander.'],
};
const localReply = (text: string, bot: Bot): Reply => {
  const a = parseIntent(text), f = bot.spec.first;
  if (a && (isOrder(text) || a.type === 'emote' || a.type === 'job')) return { say: pick(ACK[a.type] ?? ACK.goto), do: a };
  if (/\b(hi|hello|hey|morning|evening|afternoon|yo)\b/i.test(text)) return { say: `Hey Commander, ${f} here.`, do: { type: 'emote', emote: 'wave' } };
  return { say: pick(['Copy that, Commander.', 'Yep, got you.', 'Sure thing.']), do: { type: 'none' } };
};
const localGreeting = (hour: number, bot: Bot): Reply => {
  const part = hour >= 5 && hour < 12 ? 'Morning' : hour >= 12 && hour < 17 ? 'Afternoon' : hour >= 17 && hour < 21 ? 'Evening' : 'Late night';
  return { say: part === 'Late night' ? `Burning the midnight oil, Commander? Same here.` : `${part}, Commander. ${bot.spec.first} reporting in.`, do: { type: 'emote', emote: 'wave' } };
};
const BUMP_LINES = ['Whoa, easy there, Commander!', 'Ow! Watch the shoulder, boss.', 'Heh, personal space, Commander.', 'Careful, I bruise like a peach.', 'Hey! Eyes up, Commander.', 'Oof. Did we just collide?'];

export class CrewTalk {
  lastBump = 0; voiceReplies = true; ambient = true; handsFree = true; recording = false; busy = false; greeted = false;
  private ctx: AudioContext | null = null; private stop: ((send: boolean) => void) | null = null;
  private cur: { an: AnalyserNode; data: Uint8Array<ArrayBuffer>; bot: Bot; pan: PannerNode | null; src: AudioBufferSourceNode } | null = null;
  private hist = new Map<string, Turn[]>(); private statusEl: HTMLElement; private subEl: HTMLElement;
  private statusT = 0; private fwd = new THREE.Vector3(); private tmp = new THREE.Vector3();
  private sceneT = 1e9; private sceneBusy = false; private sceneAbort = false; private recent: string[] = []; private lastInitiate = 0; private lastPair = ''; private jobAnn = new Map<string, number>();
  private micMode: { target: 'crew' | 'houston'; auto: boolean; force?: Bot } = { target: 'crew', auto: false };

  constructor(private crew: Crew, private camera: THREE.PerspectiveCamera, private host: CrewHost) {
    const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
    const mk = (tag: string, id: string, html = '') => { const e = document.createElement(tag); e.id = id; e.innerHTML = html; document.body.append(e); return e; };
    mk('div', 'chint', '<b>V</b> CREW VOICE &nbsp;·&nbsp; <b>B</b> HOUSTON VOICE &nbsp;·&nbsp; <b>T</b> COMMS CONSOLE');
    this.statusEl = mk('div', 'cstat'); this.subEl = mk('div', 'csub');
    this.crew.onBump = (b, k) => this.onBump(b, k);
    this.crew.onJobDone = (b, id) => this.jobDone(b, id);
  }

  // ------------------------------------------------------------ UI helpers
  private status(text: string, ms = 0, rec = false) {
    clearTimeout(this.statusT); this.statusEl.className = rec ? 'rec' : ''; this.statusEl.innerHTML = (rec ? '<i></i>' : '') + text.replace(/[<>&]/g, ''); this.statusEl.style.display = text ? 'block' : 'none';
    if (ms) this.statusT = window.setTimeout(() => { this.statusEl.style.display = 'none'; }, ms);
  }
  /** on-screen caption; every captioned line also mirrors into the comms console log when the CREW target is open */
  caption(name: string, text: string, me = false) {
    const d = document.createElement('div'); if (me) d.className = 'me'; d.innerHTML = `<span class="nm">${name.replace(/[<>&]/g, '')}</span>`; d.append(document.createTextNode(text));
    this.subEl.append(d); while (this.subEl.children.length > 3) this.subEl.firstChild?.remove(); setTimeout(() => d.remove(), 3500 + text.length * 70);
    this.host.panelLine?.(name, text, me);
  }

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
  update(dt = 1 / 60) {
    this.tickScene(dt);
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
      this.cur = { an, data: new Uint8Array(an.fftSize), bot, pan, src };
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
  private async ask(body: Record<string, unknown>, fallback: Reply, ms = 14000): Promise<Reply> {
    try {
      const r = await fetch('/api/crew', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(ms), body: JSON.stringify({ world: this.host.world(), jobs: this.host.jobs(), alert: this.crew.alert, ...this.clock(), ...body }) });
      if (!r.ok) throw new Error('crew ' + r.status);
      const j = (await r.json()) as { say?: string; do?: CrewAction; ask?: boolean };
      if (!j.say) throw new Error('empty'); return { say: j.say, do: j.do ?? { type: 'none' }, ask: j.ask };
    } catch { return fallback; }
  }
  private radioTo(bot: Bot) { const p = this.camera.position; return Math.hypot(p.x - bot.x, p.z - bot.z) > 15 || this.crew.playerOutside(p) !== bot.eva; }
  private turns(bot: Bot) { return this.hist.get(bot.spec.name) ?? []; }
  private remember(bot: Bot, ...t: Turn[]) { this.hist.set(bot.spec.name, [...this.turns(bot), ...t].slice(-14)); }
  private clock() { const d = new Date(); return { hour: d.getHours(), clock: `${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}, ${d.toLocaleDateString([], { weekday: 'long' })}` }; }
  /** caption + voice. stand=true makes the speaker stop and face the Commander while talking; with an order they keep moving and talk on the go. */
  private async speak(bot: Bot, text: string, radio: boolean, stand = true, pre?: Promise<AudioBuffer | null>, quiet = false) {
    this.caption(`${bot.spec.first} ${bot.spec.name}`.toUpperCase(), text);
    let buf: AudioBuffer | null = null;
    if (this.voiceReplies && !(quiet && this.cur)) { try { buf = pre ? await pre : await this.tts(text, bot); } catch { buf = null; } }
    if (stand && bot.sleepStage < 2) bot.convo = 'speak';
    if (buf) await this.play(buf, bot, radio); else if (this.voiceReplies && !quiet) await this.browserSpeak(text, bot); else await sleep(Math.min(5000, 900 + text.length * 55));
    bot.lip = 0; if (stand && bot.convo === 'speak') bot.convo = null;
  }
  private endScene() { if (this.sceneBusy) { this.sceneAbort = true; try { this.cur?.src.stop(); } catch { /* already stopped */ } } }

  /** carry the order out in the game: crew movement and, for repair work, the real sim job */
  private execute(bot: Bot, act: CrewAction): { act: CrewAction; note?: string } {
    const p = this.camera.position;
    if (act.type === 'job' && act.job) {
      let id = act.job; const jobs = this.host.jobs(), ok = (i: string) => !!jobs.find((j) => j.id === i)?.ok;
      if (!ok(id)) { const alt = id === 'busfix' && ok('clean') ? 'clean' : id === 'clean' && ok('busfix') ? 'busfix' : id === 'patch' && ok('sealant') ? 'sealant' : id === 'sealant' && ok('patch') ? 'patch' : ''; if (alt) id = alt; }
      if (!this.crew.canObey({ type: 'job', job: id })) { bot.perform({ type: 'emote', emote: 'shrug' }, p); return { act: { type: 'none' }, note: 'ALERT ACTIVE: NOBODY GOES OUTSIDE UNTIL IT CLEARS' }; }
      const why = this.host.startJob(id);
      if (why) { bot.perform({ type: 'emote', emote: 'shrug' }, p); return { act: { type: 'none' }, note: why }; }
      this.crew.assignJob(bot, id, p); return { act: { type: 'job', job: id } };
    }
    if (act.type !== 'none') {
      if (!this.crew.canObey(act)) { bot.perform({ type: 'emote', emote: 'shrug' }, p); return { act: { type: 'none' }, note: 'ALERT ACTIVE: NOBODY GOES OUTSIDE UNTIL IT CLEARS' }; }
      if (act.type !== 'emote') bot.convo = null; bot.perform(act, p);
    }
    return { act };
  }

  async converse(text: string, force?: Bot) {
    if (this.busy) return; this.endScene(); this.busy = true; let followUp: Bot | null = null;
    try {
      if (!force && HOUSTON.test(text) && this.host.houston) { await this.host.houston(text); return; }   // the comms console displays the Houston side itself
      if (isBroadcast(text)) { await this.broadcast(text); return; }
      const t = force && force.sleepStage < 2 ? { bot: force, d: 0 } : this.target(text); if (!t) { this.status('NOBODY IS AROUND TO HEAR YOU', 2500); return; }
      const bot = t.bot, radio = this.radioTo(bot);
      this.caption('YOU', text, true);
      if (bot.sleepStage < 2) bot.convo = 'think';
      this.status(`${bot.spec.first.toUpperCase()} IS THINKING…`);
      const res = await this.ask({ who: bot.spec.name, kind: 'chat', text, ctx: bot.ctx(), history: this.turns(bot), radio }, localReply(text, bot));
      let act = res.do;
      if (act.type === 'none' && isOrder(text)) { const i = parseIntent(text); if (i) act = i; }   // an order is never dropped
      this.remember(bot, { role: 'me', text }, { role: 'you', text: res.say });
      this.status('');
      // do it NOW and talk while doing it: movement orders start this instant, the voice line plays as they go
      const { act: done, note } = this.execute(bot, act); if (note) this.caption('BASE', note);
      const moves = done.type !== 'none' && done.type !== 'emote';
      await this.speak(bot, res.say, radio, !moves);
      // keep it going like real people: a question gets a hands-free answer window; otherwise another crew member may chime in
      if (!moves) { if (res.ask || /\?\s*["”]?$/.test(res.say)) followUp = bot; else this.maybeChime(bot, text, res.say); }
    } finally { this.busy = false; for (const b of this.crew.bots) if (b.convo === 'think' || b.convo === 'listen') b.convo = null; this.status(''); }
    if (followUp) void this.autoListen(followUp);
  }

  /** "everyone, listen up": the whole crew hears it, turns, obeys at once and answers in turn (nearest first) */
  private async broadcast(text: string) {
    const p = this.camera.position;
    const near = [...this.crew.bots].sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
    this.caption('YOU', text, true); this.status('EVERYONE IS LISTENING…');
    for (const b of near) if (b.sleepStage < 2) b.convo = 'think';
    const intent = (isOrder(text) || ATTENTION.test(text)) ? (parseIntent(text) ?? (ATTENTION.test(text) ? ({ type: 'come' } as CrewAction) : null)) : null;
    let replies: { who: string; say: string; do: CrewAction }[] = [];
    try {
      const r = await fetch('/api/crew', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(14000), body: JSON.stringify({ who: 'ALL', text, crew: near.map((b) => { const c = b.ctx(); return { name: c.name, state: c.state, doing: c.doing }; }), world: this.host.world(), jobs: this.host.jobs(), alert: this.crew.alert, ...this.clock() }) });
      if (r.ok) replies = ((await r.json()) as { replies?: typeof replies }).replies ?? [];
    } catch { replies = []; }
    this.status('');
    const lines = ['Right here, Commander.', 'Listening.', 'Yep, all ears.', 'Go ahead, Commander.'];
    let jobTaken = false;
    const items = near.map((b, i) => {
      const r = replies.find((x) => x.who === b.spec.name); let act: CrewAction = r?.do ?? { type: 'none' }; if (act.type === 'none' && intent) act = intent;
      if (act.type === 'job') { if (jobTaken) act = { type: 'none' }; else jobTaken = true; }   // one repair crew per job; the rest just acknowledge
      return { bot: b, say: r?.say || lines[i % 4], act, radio: this.radioTo(b) };
    });
    // everyone obeys at once...
    for (const it of items) { const { act, note } = this.execute(it.bot, it.act); it.act = act; if (note) this.caption('BASE', note); if (act.type === 'none' && it.bot.sleepStage < 2) it.bot.convo = 'listen'; }
    // ...then they answer one after another (audio is fetched in parallel so there is no dead air between voices)
    const pre = items.map((it) => (this.voiceReplies ? this.tts(it.say, it.bot).catch(() => null) : Promise.resolve(null)));
    for (let i = 0; i < items.length; i++) { const it = items[i], moves = it.act.type !== 'none' && it.act.type !== 'emote'; await this.speak(it.bot, it.say, it.radio, !moves, pre[i]); }
  }

  /** the player walked into someone: they stumble (crew.ts), look round and say something about it */
  private onBump(bot: Bot, strength: number) {
    const now = performance.now(); if (now - this.lastBump < 3500 || bot.sleepStage > 0) return; this.lastBump = now;
    void (async () => {
      const canned = pick(BUMP_LINES), loud = this.busy || !!this.cur;
      const res = loud ? { say: canned, do: { type: 'none' } as CrewAction } : await this.ask({ who: bot.spec.name, kind: 'bump', strength, ctx: bot.ctx() }, { say: canned, do: { type: 'none' } }, 5000);
      await this.speak(bot, res.say, false, true, undefined, loud);
    })();
  }

  /** a repair finished (the sim says so): the lead reports back in their own voice */
  private jobDone(bot: Bot, id: string) {
    const now = performance.now(); if (now - (this.jobAnn.get(id) ?? 0) < 4000) return; this.jobAnn.set(id, now);
    void (async () => {
      const name = JOB_NAMES[id] ?? id, res = await this.ask({ who: bot.spec.name, kind: 'jobdone', job: name, outcome: this.host.lastLog(), ctx: bot.ctx() }, { say: `${name[0].toUpperCase() + name.slice(1)} is done, Commander.`, do: { type: 'none' } }, 7000);
      for (let i = 0; i < 40 && (this.cur || this.recording); i++) await sleep(250);   // wait for a quiet moment
      await this.speak(bot, res.say, this.radioTo(bot), false);
    })();
  }

  /** after a one-liner another crew member may toss in a quip */
  private maybeChime(bot: Bot, me: string, you: string) {
    if (Math.random() > 0.25 || this.sceneBusy) return;
    const others = this.crew.bots.filter((b) => b !== bot && b.sleepStage === 0 && !b.convo && b.lk === null && Math.hypot(b.x - bot.x, b.z - bot.z) < 14); if (!others.length) return;
    const c = pick(others);
    void (async () => {
      const res = await this.ask({ who: c.spec.name, kind: 'chime', exchange: { me, you, by: bot.spec.first }, ctx: c.ctx() }, { say: pick(['I heard that. Carry on.', 'Ha! Note to self.']), do: { type: 'none' } }, 6000);
      await sleep(500); if (this.busy || this.recording || this.cur) return;
      c.chat = bot; await this.speak(c, res.say, this.radioTo(c), false); c.chat = null;
    })();
  }

  /** the nearest crew member says a one-line hello that fits the time of day where the player is */
  async greet() {
    if (this.greeted) return;
    try {
      for (let i = 0; i < 24; i++) { const t = this.crew.nearest(this.camera.position); if (t && t.d < 12) break; await sleep(1500); }
      const t = this.crew.nearest(this.camera.position); if (!t || this.busy || this.greeted) return;
      this.greeted = true; this.busy = true; const bot = t.bot, p = this.camera.position, ck = this.clock();
      try {
        bot.convo = 'think';
        const res = await this.ask({ who: bot.spec.name, kind: 'greet', ctx: bot.ctx() }, localGreeting(ck.hour, bot));
        this.remember(bot, { role: 'you', text: res.say });
        bot.perform({ type: 'emote', emote: 'wave' }, p); await this.speak(bot, res.say, false);
      } finally { bot.convo = null; this.busy = false; }
    } finally { this.greeted = true; this.sceneT = rnd(14, 24); }   // the first crew-to-crew scene comes quickly after the greeting
  }

  // ------------------------------------------------------------ ambient life: the crew chat with each other and with you
  private tickScene(dt: number) {
    this.sceneT -= dt; if (this.sceneT > 0) return;
    this.sceneT = rnd(22, 45);   // crew-to-crew comms used to fire every 45-90 s, which read as "almost never": every 22-45 s now
    if (!this.ambient || !this.greeted || this.busy || this.recording || this.sceneBusy || this.cur || document.hidden || this.crew.alert || !this.host.canChat()) { this.sceneT = 8; return; }
    void this.runScene();
  }
  private async runScene() {
    const p = this.camera.position, free = this.crew.bots.filter((b) => b.sleepStage === 0 && !b.convo && b.lk === null && !b.emote);
    const near = this.crew.nearest(p, true), nearOk = !!near && near.d < 8 && !near.bot.convo && near.bot.sleepStage === 0, now = performance.now();
    this.sceneBusy = true; this.sceneAbort = false;
    try {
      if (nearOk && now - this.lastInitiate > 45000 && (free.length < 2 || Math.random() < 0.3)) { this.lastInitiate = now; await this.initiate(near!.bot); }   // a crew member starts talking to YOU at most every 45 s, so most scenes are crew-to-crew banter
      else if (free.length >= 2) await this.crewBanter(free, nearOk);
    } finally { this.sceneBusy = false; for (const b of this.crew.bots) b.chat = null; }
  }
  /** a crew member walks up on their own and starts talking to you */
  private async initiate(bot: Bot) {
    const res = await this.ask({ who: bot.spec.name, kind: 'initiate', ctx: bot.ctx(), history: this.turns(bot) }, { say: 'Hey Commander, got a sec? Somebody has to hear my terrible jokes.', do: { type: 'none' }, ask: true });
    if (this.sceneAbort || this.busy || this.recording) return;
    this.remember(bot, { role: 'you', text: res.say });
    await this.speak(bot, res.say, this.radioTo(bot), true);
    if (res.ask || /\?\s*["”]?$/.test(res.say)) void this.autoListen(bot);
  }
  /** two crew members banter while they work: they face each other, trade jokes, sometimes finish by asking you something */
  private async crewBanter(free: Bot[], nearPlayer: boolean) {
    const p = this.camera.position, pool = [...free].sort(() => Math.random() - 0.5);
    let a = pool[0], o = pool[1]; if (`${a.spec.name}${o.spec.name}` === this.lastPair || `${o.spec.name}${a.spec.name}` === this.lastPair) { const alt = pool.find((b, i) => i > 1); if (alt) o = alt; }
    this.lastPair = `${a.spec.name}${o.spec.name}`;
    const toPlayer = nearPlayer && Math.random() < 0.4 && Math.hypot(p.x - o.x, p.z - o.z) < 9;
    let lines: { who: string; say: string; emote?: string }[] = [], ask = false;
    try {
      const r = await fetch('/api/crew', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(18000), body: JSON.stringify({ kind: 'banter', who: a.spec.name, other: o.spec.name, ctxA: a.ctx(), ctxB: o.ctx(), world: this.host.world(), jobs: this.host.jobs(), recent: this.recent.slice(-8), toPlayer, ...this.clock() }) });
      if (r.ok) { const j = (await r.json()) as { lines?: typeof lines; ask?: boolean }; lines = j.lines ?? []; ask = j.ask === true; }
    } catch { lines = []; }
    if (lines.length < 2 || this.sceneAbort || this.busy || this.recording) return;
    a.chat = o; o.chat = a;
    const bots = [a, o], pre = lines.map((l) => { const sp = bots.find((b) => b.spec.name === l.who) ?? a; return this.voiceReplies ? this.tts(l.say, sp).catch(() => null) : Promise.resolve(null); });
    let last = a;
    for (let i = 0; i < lines.length; i++) {
      if (this.sceneAbort) break;
      const l = lines[i], sp = bots.find((b) => b.spec.name === l.who) ?? a; last = sp;
      if (l.emote) sp.perform({ type: 'emote', emote: l.emote }, p);
      this.recent.push(`${sp.spec.first}: ${l.say}`); this.recent = this.recent.slice(-10);
      await this.speak(sp, l.say, this.radioTo(sp), false, pre[i]);
      await sleep(rnd(150, 450));
    }
    if (ask && !this.sceneAbort) { this.remember(last, { role: 'you', text: lines[lines.length - 1].say }); void this.autoListen(last); }
  }

  // ------------------------------------------------------------ microphone (push to open, auto-stops on silence)
  private async micStream(): Promise<MediaStream> {
    if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('mediaDevices unavailable (needs https or localhost)'), { name: 'NoMediaDevices' });
    try { return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
    catch (e) { const n = (e as { name?: string }).name; if (n === 'NotAllowedError' || n === 'SecurityError') throw e; return navigator.mediaDevices.getUserMedia({ audio: true }); }   // odd devices reject the processing hints
  }
  private micMessage(e: unknown) {
    const n = (e as { name?: string })?.name ?? '', d = document as unknown as { permissionsPolicy?: { allowsFeature(f: string): boolean }; featurePolicy?: { allowsFeature(f: string): boolean } };
    const blockedByHeader = (d.permissionsPolicy ?? d.featurePolicy)?.allowsFeature('microphone') === false;
    if (blockedByHeader) return 'MIC DISABLED BY THIS SITE’S PERMISSIONS-POLICY HEADER, REDEPLOY WITH THE UPDATED vercel.json';
    if (n === 'NotAllowedError' || n === 'SecurityError') return 'MIC PERMISSION DENIED, CLICK THE LOCK ICON BY THE ADDRESS AND ALLOW MICROPHONE';
    if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'NO MICROPHONE FOUND, CHECK THE BROWSER’S INPUT DEVICE';
    if (n === 'NotReadableError' || n === 'AbortError') return 'MIC IS BUSY IN ANOTHER APP OR TAB';
    if (n === 'NoMediaDevices') return 'MIC NEEDS HTTPS OR LOCALHOST';
    return `MIC ERROR (${n || 'unknown'}), TYPE INSTEAD`;
  }
  private async micGranted() { try { return (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state === 'granted'; } catch { return false; } }
  /** after a crew question the mic opens by itself for a few seconds so you can just answer (only once the browser has already granted the mic) */
  private async autoListen(bot: Bot) {
    if (!this.handsFree || this.recording || this.busy || bot.sleepStage >= 2) return;
    if (!(await this.micGranted())) return;
    await sleep(300); if (this.recording || this.busy || this.cur) return;
    await this.toggleMic('crew', { auto: true, force: bot });
  }
  /** target 'crew' = whoever is nearest/named/everyone; 'houston' = the radio (the comms pad sends it and Houston answers by voice) */
  async toggleMic(target: 'crew' | 'houston' = 'crew', opt: { auto?: boolean; force?: Bot } = {}) {
    if (this.recording) { this.stop?.(true); return; }
    if (this.busy) return;
    this.endScene(); const auto = !!opt.auto; this.micMode = { target, auto, force: opt.force };
    let stream: MediaStream;
    try { stream = await this.micStream(); }
    catch (e) { console.warn('[crew mic]', e); if (!auto) { this.status(this.micMessage(e), 7000); this.host.openPanel?.(target, 'text'); } return; }
    const c = this.ac(), node = c.createMediaStreamSource(stream), an = c.createAnalyser(); an.fftSize = 1024; node.connect(an);
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? '';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined), chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    this.recording = true; const t0 = performance.now(); let noise = 0, nn = 0, spoke = false, last = t0, done = false; const buf = new Float32Array(an.fftSize);
    const who = opt.force ?? this.crew.nearest(this.camera.position, true)?.bot, tag = who ? who.spec.first.toUpperCase() : 'CREW';
    this.status(target === 'houston' ? 'TRANSMITTING TO HOUSTON · B TO SEND · ESC CANCELS' : auto ? `${tag} IS LISTENING FOR YOUR REPLY…` : `LISTENING · ${tag} · V TO SEND · ESC CANCELS`, 0, true);
    const finish = (send: boolean) => {
      if (done) return; done = true; this.recording = false; this.stop = null; if (rec.state !== 'inactive') rec.stop();
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop()); node.disconnect();
        if (!send || !spoke) { this.status(send && !auto ? 'DIDN’T CATCH ANYTHING' : '', send && !auto ? 1800 : 0); return; }
        void this.transcribe(new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' }));
      };
    };
    this.stop = finish; rec.start(250);
    const tick = () => {
      if (done) return; an.getFloatTimeDomainData(buf); let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]; const rms = Math.sqrt(s / buf.length), now = performance.now();
      if (now - t0 < 350) { noise += rms; nn++; } else if (rms > Math.max(0.018, (noise / Math.max(1, nn)) * 2.8)) { spoke = true; last = now; }
      if (spoke && now - last > 1400) return finish(true); if (now - t0 > 18000) return finish(true); if (!spoke && now - t0 > (auto ? 6500 : 7000)) return finish(false);   // a 1.4 s mid-sentence pause no longer cuts you off; the hard cap is 18 s
      setTimeout(tick, 50);
    };
    tick();
  }
  cancel() { if (this.recording) this.stop?.(false); }

  private async transcribe(blob: Blob) {
    const m = this.micMode; this.status('TRANSCRIBING…'); this.busy = true; let text = '';
    // one automatic retry: a single dropped request used to read as "voice recognition is broken"
    const once = async () => {
      try {
        const r = await fetch('/api/stt', { method: 'POST', headers: { 'Content-Type': blob.type || 'audio/webm' }, body: blob, signal: AbortSignal.timeout(24000) });
        if (!r.ok) throw new Error('stt ' + r.status);
        return String(((await r.json()) as { text?: string }).text ?? '').trim();
      } catch { return ''; }
    };
    text = await once();
    if (!text) { await sleep(400); text = await once(); }   // brief pause, then the second attempt
    if (!text) {
      this.busy = false;
      if (!m.auto) {
        this.status('VOICE RECOGNITION UNAVAILABLE — SAY AGAIN, OR TYPE', 3500);
        this.host.openPanel?.(m.target, 'text');   // the comms console opens on the SAME target, ready to type
      }
      return;
    }
    this.busy = false;
    if (m.target === 'houston') { this.status('UPLINK TO HOUSTON…'); this.busy = true; try { await this.host.houston?.(text); } finally { this.busy = false; this.status(''); } return; }
    await this.converse(text, m.force);
  }
}
