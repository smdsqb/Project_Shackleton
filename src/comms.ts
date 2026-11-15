import { Radio } from './radio';

export type Link = { up: boolean; reason: string };
export type CommsTarget = 'houston' | 'crew';
export type CommsMode = 'voice' | 'text';
export type CommsPlatform = 'hab' | 'rover' | 'suit';
export type CommsHost = {
  telemetry(): Record<string, unknown>; link(): Link; now(): Date; delayS(): number;
  onClose(): void;
  /** the console's MIC button (voice mode): open the mic for the selected target */
  mic(target: CommsTarget): void;
  /** a typed line for the crew channel (console text mode with the CREW target) */
  crewText(text: string): void;
  /** crew-channel options shown on the console footer */
  crewAmbient(): boolean; setCrewAmbient(v: boolean): void; crewHandsFree(): boolean; setCrewHandsFree(v: boolean): void;
  /** on-screen caption used while the console is closed (voice path): the crew captions double as Houston captions */
  caption(name: string, text: string, me?: boolean): void;
  /** Present when the outpost has a rover: its telemetry, its UHF link to the Hab, and whether anybody is aboard. */
  rover?: { telemetry(): unknown; link(): { up: boolean; dist: number; reason: string }; occupied(): boolean };
};
type Turn = { from: 'crew' | 'houston'; text: string };
type Reply = { role?: string; reply?: string; emergency?: boolean } | null;
type Channel = 'houston' | 'hab' | 'rover';
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const THINK_MS = 3000;   // Houston "thinks" for this long before the first character appears
const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const NO_REPLY = 'Shackleton, Houston. You are breaking up on us, say again in a minute. Houston out.';
const HAILS = [
  'Shackleton, Houston. Loud and clear down here. Go ahead whenever you are ready.',
  'Shackleton, Houston, we have you five by five. What can we do for you?',
  'Hey Shackleton, Houston. Good to hear you. The coffee is cold on our side, so you are not missing much. Go ahead.',
  'Shackleton, Houston. We read you loud and clear. Standing by.',
];

const CSS = `
#term{position:fixed;inset:0;display:none;z-index:6;font-family:ui-monospace,Menlo,Consolas,monospace;color:#d7dde5;background:rgba(3,5,8,.92);align-items:center;justify-content:center}
#term.on{display:flex}
#term .box{width:min(760px,94vw);height:min(580px,86vh);display:flex;flex-direction:column;border:1px solid rgba(79,216,255,.35);background:#05080c}
#term .box.emerg{border-color:#ff4d4d}
.hd{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid rgba(79,216,255,.25);font-size:11px;letter-spacing:.2em;color:#4fd8ff}
.chip{padding:2px 10px;border:1px solid currentColor;font-size:10px;letter-spacing:.16em}.chip.bad{color:#ff4d4d}.chip.warn{color:#ffb000}
.pick{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid rgba(79,216,255,.18)}
.pick .cat{font-size:9px;letter-spacing:.22em;color:#566}
.seg{display:flex;gap:6px}
.seg button{background:transparent;border:1px solid rgba(125,138,153,.4);color:#7d8a99;font:inherit;font-size:10px;letter-spacing:.14em;padding:4px 12px;cursor:pointer;border-radius:3px}
.seg button:hover{border-color:rgba(79,216,255,.6)}
.seg button.on{color:#4fd8ff;border-color:rgba(79,216,255,.85);background:rgba(79,216,255,.14)}
.seg[data-crew="1"] button.on{color:#ffb000;border-color:rgba(255,176,0,.8);background:rgba(255,176,0,.12)}
.lg{flex:1;overflow-y:auto;padding:12px 14px;font-size:13px;line-height:1.55}.lg div{margin-bottom:6px;white-space:pre-wrap}
.tx{color:#7fd6ff}.rx{color:#e9edf1}.sys{color:#7d8a99}.crewc{color:#ffd27f}.me{color:#7fd6ff}
.fm{display:flex;gap:8px;padding:10px 14px;border-top:1px solid rgba(79,216,255,.2)}.fm span{color:#4fd8ff}
.fm input{flex:1;background:transparent;border:0;outline:0;color:#e9edf1;font:inherit;font-size:13px}
#copts{display:none;gap:8px;align-items:center;padding:6px 14px;border-top:1px dashed rgba(255,176,0,.25)}
#copts.on{display:flex}#copts .lbl{font-size:9px;letter-spacing:.2em;color:#566}
#copts button{background:transparent;border:1px solid rgba(125,138,153,.4);color:#7d8a99;font:inherit;font-size:9px;letter-spacing:.12em;padding:2px 9px;cursor:pointer;border-radius:3px}
#copts button.on{color:#ffb000;border-color:rgba(255,176,0,.7)}
.voicef{display:none;align-items:center;gap:12px;padding:10px 14px;border-top:1px solid rgba(79,216,255,.2)}
.voicef.on{display:flex}
#tmic{background:rgba(79,216,255,.1);border:1px solid rgba(79,216,255,.7);color:#4fd8ff;font:inherit;font-size:12px;letter-spacing:.16em;padding:9px 18px;cursor:pointer;border-radius:4px}
#tmic.crew{border-color:rgba(255,176,0,.7);color:#ffb000;background:rgba(255,176,0,.1)}
#tmic:hover{background:rgba(79,216,255,.22)}
.vh{font-size:10px;letter-spacing:.14em;color:#566}
.hint{padding:6px 14px;font-size:10px;letter-spacing:.16em;color:#566}`;

/**
 * The one comms console every platform shares (hab desk, rover radio, suit, tablet). Pick who you are talking to —
 * HOUSTON or CREW — then how: VOICE (microphone) or TEXT (keyboard). Houston replies always come back as voice AND text,
 * on every platform. The link sequence is a burst of carrier static and then Houston itself: there is no link manager
 * voice in between any more.
 */
export class Comms {
  isOpen = false;
  target: CommsTarget = 'houston';
  mode: CommsMode = 'voice';
  private radio = new Radio(); private turns: Turn[] = []; private busy = false; private ready = false; private connecting = false; private session = 0;
  private term: HTMLElement; private log: HTMLElement; private inp: HTMLInputElement; private chip: HTMLElement; private head: HTMLElement;
  private segT: HTMLElement; private segM: HTMLElement; private form: HTMLFormElement; private micB: HTMLButtonElement; private vhint: HTMLElement; private thint: HTMLElement;
  private opts: HTMLElement; private camb: HTMLButtonElement; private chf: HTMLButtonElement;
  private recall: string[] = []; private ri = 0;
  private platform: CommsPlatform = 'suit'; private habIntro = false; private roverIntro = false;

  constructor(private host: CommsHost) {
    const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
    this.term = document.createElement('div'); this.term.id = 'term';
    this.term.innerHTML = `<div class="box"><div class="hd"><span id="thead">SUIT COMMS</span><span class="chip" id="tchip">STANDBY</span></div>
      <div class="pick"><span class="cat">TALK TO</span><div class="seg" id="segT"><button type="button" data-t="houston" class="on">HOUSTON</button><button type="button" data-t="crew">CREW</button></div>
      <span class="cat">BY</span><div class="seg" id="segM"><button type="button" data-m="voice" class="on">VOICE</button><button type="button" data-m="text">TEXT</button></div></div>
      <div class="lg" id="tlog"></div>
      <div id="copts"><span class="lbl">CREW CHANNEL</span><button type="button" id="camb"></button><button type="button" id="chf"></button></div>
      <form class="fm" autocomplete="off"><span>&gt;</span><input id="tin" maxlength="200" spellcheck="false" placeholder="message to Houston"/></form>
      <div class="voicef" id="vfoot"><button type="button" id="tmic">TALK TO HOUSTON</button><span class="vh" id="vhint"></span></div>
      <div class="hint" id="thint"></div></div>`;
    document.body.append(this.term);
    this.log = this.term.querySelector('#tlog')!; this.inp = this.term.querySelector('#tin')!; this.chip = this.term.querySelector('#tchip')!;
    this.head = this.term.querySelector('#thead')!; this.segT = this.term.querySelector('#segT')!; this.segM = this.term.querySelector('#segM')!;
    this.form = this.term.querySelector('form')!; this.micB = this.term.querySelector('#tmic')!; this.vhint = this.term.querySelector('#vhint')!;
    this.thint = this.term.querySelector('#thint')!; this.opts = this.term.querySelector('#copts')!;
    this.camb = this.term.querySelector('#camb')!; this.chf = this.term.querySelector('#chf')!;
    this.segT.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('button'); if (b) this.setTarget(b.dataset.t as CommsTarget); });
    this.segM.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('button'); if (b) this.setMode(b.dataset.m as CommsMode); });
    this.camb.addEventListener('click', () => { this.host.setCrewAmbient(!this.host.crewAmbient()); this.syncOpts(); });
    this.chf.addEventListener('click', () => { this.host.setCrewHandsFree(!this.host.crewHandsFree()); this.syncOpts(); });
    this.micB.addEventListener('click', () => { if (!this.busy) this.host.mic(this.target); });
    this.form.addEventListener('submit', (e) => { e.preventDefault(); const v = this.inp.value; this.inp.value = ''; if (v.trim()) { this.recall.push(v.trim()); this.ri = this.recall.length; if (this.target === 'crew') this.host.crewText(v.trim()); else void this.houstonText(v); } });
    this.inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Tab') { e.preventDefault(); this.close(); }
      else if (e.key === 'ArrowUp' && this.recall.length) { this.ri = Math.max(0, this.ri - 1); this.inp.value = this.recall[this.ri] ?? ''; e.preventDefault(); }
    });
    this.inp.addEventListener('keyup', (e) => e.stopPropagation());
  }

  // ------------------------------------------------------------ console UI
  private platformHead() { return this.platform === 'hab' ? 'HAB COMMS DESK' : this.platform === 'rover' ? 'ROVER RADIO · HAB RELAY + EARTH' : 'SUIT COMMS'; }
  open(platform: CommsPlatform = 'suit', target: CommsTarget = 'houston', mode: CommsMode = 'voice') {
    this.platform = platform; this.head.textContent = this.platformHead();
    if (!this.isOpen) {
      this.isOpen = true; this.term.classList.add('on');
      if (!this.log.childElementCount) this.line(this.log, 'sys', 'COMMS CONSOLE. Pick HOUSTON or CREW, then VOICE or TEXT. Houston replies come back as voice and text.');
      if (this.platform === 'hab' && !this.habIntro) { this.habIntro = true; this.line(this.log, 'sys', 'HAB COMMS DESK. Houston traffic goes over the dish; ROVER <message> calls the rover over UHF.'); }
      if (this.platform === 'rover' && !this.roverIntro) { this.roverIntro = true; this.line(this.log, 'sys', 'ROVER RADIO. UHF to the Hab; Houston traffic is relayed through the Hab dish. HAB <message> talks to the Hab crew.'); }
    }
    this.setTarget(target); this.setMode(mode);
    this.refresh(); void this.ensureLink();
  }
  close() {
    if (!this.isOpen) return; this.isOpen = false; this.session++; this.term.classList.remove('on'); this.term.querySelector('.box')!.classList.remove('emerg');
    this.inp.blur(); this.busy = false; this.radio.stop(); this.radio.staticOff(); this.host.onClose();
  }
  toggle() { if (this.isOpen) this.close(); else this.open('suit', this.target, this.mode); }
  private setTarget(t: CommsTarget) {
    const changed = this.target !== t;
    this.target = t;
    this.segT.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    this.segT.dataset.crew = t === 'crew' ? '1' : '0';
    this.micB.classList.toggle('crew', t === 'crew');
    this.micB.textContent = t === 'crew' ? 'TALK TO CREW' : 'TALK TO HOUSTON';
    this.opts.classList.toggle('on', t === 'crew'); this.syncOpts();
    this.inp.placeholder = t === 'crew' ? 'say something to the crew…' : this.platform === 'rover' ? 'message to Houston (relayed), or HAB <message> for the Hab crew' : 'message to Houston, or ROVER <message> to call the rover';
    if (changed) this.line(this.log, 'sys', t === 'crew' ? '— CREW CHANNEL —' : '— HOUSTON —');
    this.setMode(this.mode);
  }
  private setMode(m: CommsMode) {
    this.mode = m;
    this.segM.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
    this.form.style.display = m === 'text' ? 'flex' : 'none';
    (this.term.querySelector('#vfoot') as HTMLElement).classList.toggle('on', m === 'voice');
    this.vhint.textContent = this.target === 'crew'
      ? (m === 'voice' ? 'V OR CLICK TO TALK · SPEAK · IT SENDS WHEN YOU STOP' : 'ENTER SENDS · NEAREST CREW ANSWERS IN THEIR OWN VOICE')
      : (m === 'voice' ? 'B OR CLICK TO TALK · SPEAK · IT SENDS WHEN YOU STOP' : 'ENTER SENDS · HOUSTON REPLIES IN VOICE AND TEXT');
    this.thint.textContent = 'HOUSTON OR CREW · VOICE OR TEXT · TAB OR ESC CLOSES';
    if (m === 'text') setTimeout(() => this.inp.focus(), 30); else this.inp.blur();
  }
  private syncOpts() {
    const a = this.host.crewAmbient(), h = this.host.crewHandsFree();
    this.camb.textContent = a ? 'AMBIENT CHATTER ON' : 'AMBIENT CHATTER OFF'; this.camb.classList.toggle('on', a);
    this.chf.textContent = h ? 'HANDS-FREE ON' : 'HANDS-FREE OFF'; this.chf.classList.toggle('on', h);
  }
  private refresh() {
    const l = this.host.link(), r = this.host.rover?.link();
    if (this.target === 'crew') { this.setChip('CREW CHANNEL · UHF'); return; }
    if (this.platform === 'rover' && r) { const up = r.up && l.up; this.setChipB(!r.up ? 'NO UHF LINK TO HAB' : l.up ? `UHF ${(r.dist / 1000).toFixed(1)} KM · EARTH ${this.host.delayS().toFixed(2)} S` : 'UHF UP · EARTH LINK DOWN', !up); return; }
    this.setChipB(l.up ? (this.ready ? `LINK UP · ${this.host.delayS().toFixed(2)} S` : 'ACQUIRING') : 'NO LINK', !l.up);
  }
  private setChip(t: string) { this.chip.textContent = t; this.chip.className = 'chip'; }
  private setChipB(t: string, bad: boolean) { this.chip.textContent = t; this.chip.className = 'chip' + (bad ? ' bad' : ''); }
  private stamp() { const d = this.host.now(); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}Z`; }
  private line(box: HTMLElement, cls: string, text: string) { const d = document.createElement('div'); d.className = cls; d.textContent = text; box.append(d); box.scrollTop = box.scrollHeight; return d; }
  /** every Houston-side message shows up in the console log when it is open, and as an on-screen caption when it is not */
  private say(cls: 'tx' | 'rx' | 'sys', text: string, name = 'HOUSTON') {
    if (this.isOpen) return this.line(this.log, cls, cls === 'tx' ? `${this.stamp()}  YOU  ${text}` : cls === 'sys' ? text : `${this.stamp()}  ${name}  ${text}`);
    this.host.caption(cls === 'tx' ? 'YOU → HOUSTON' : name, text, cls === 'tx');
    return null;
  }

  // ------------------------------------------------------------ Earth link: static, then Houston straight away
  /** starts the link sequence without opening the console (the B voice path), so the mic can open at once */
  warmLink() { if (!this.ready && !this.connecting && !this.busy) void this.connect(++this.session); }
  /** resolves once the link is up and Houston has finished the hail (starts it if it has not started) */
  private async ensureLink(): Promise<boolean> {
    if (this.ready) return true;
    const l = this.host.link(); if (!l.up) { this.say('sys', `NO EARTH LINK. ${l.reason}`); return false; }
    if (!this.connecting) void this.connect(++this.session);
    for (let i = 0; i < 160 && this.connecting && !this.ready; i++) await sleep(250);
    return this.ready;
  }
  private async connect(s: number) {
    this.connecting = true; this.ready = false;
    this.radio.staticOn(0.05);   // a burst of carrier static while the high-gain antenna slews and locks on
    const l = this.host.link();
    if (!l.up) { this.say('sys', `NO EARTH LINK. ${l.reason}`); this.connecting = false; this.radio.staticOff(); this.refresh(); return; }
    this.setChip('ACQUIRING CARRIER'); this.say('sys', 'SLEWING HIGH-GAIN ANTENNA · CARRIER ACQUIRED · HOUSTON');
    await sleep(900); if (s !== this.session) { this.connecting = false; return; }
    this.radio.staticSet(0.015);
    const hail = pick(HAILS);
    await this.radio.quindar('in'); if (s !== this.session) { this.connecting = false; return; }
    this.say('rx', hail);
    await this.radio.speak(hail, 'male'); if (s !== this.session) { this.connecting = false; return; }
    await this.radio.quindar('out'); if (s !== this.session) { this.connecting = false; return; }
    this.radio.staticOff();
    this.ready = true; this.connecting = false; this.refresh(); if (this.isOpen && this.mode === 'text') this.inp.focus();
  }

  // ------------------------------------------------------------ Houston side
  private async ask(text: string, channel: Channel = 'houston'): Promise<Reply> {
    try {
      const r = await fetch('/api/comms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(25000),
        body: JSON.stringify({ text, channel, history: channel === 'houston' ? this.turns.slice(-8) : [], telemetry: { ...this.host.telemetry(), rover: this.host.rover?.telemetry() } }) });
      return (await r.json()) as Reply;
    } catch { return null; }
  }
  /** a spoken message for Houston (already transcribed): same path as typing it, so the reply is voice and text either way */
  async voiceSend(text: string) {
    const t = text.trim(); if (!t || this.busy) return;
    if (!(await this.ensureLink())) return;
    await this.houstonTurn(t, 'houston');
  }
  private async houstonText(raw: string) {
    const text = raw.trim(); if (!text || this.busy) return;
    const rv = this.host.rover, r = rv?.link(); let channel: Channel = 'houston', msg = text, rt = this.host.delayS() * 2000;
    const m = /^(hab|base|rover)\b[:,]?\s*(.*)$/i.exec(text);
    if (m && rv && r) {
      channel = m[1].toLowerCase() === 'rover' ? 'rover' : 'hab'; msg = m[2] || 'radio check';
      if (channel === 'hab' && this.platform !== 'rover') { this.say('sys', 'YOU ARE AT THE HAB. USE ROVER <message> TO CALL THE ROVER.'); return; }
      if (channel === 'rover' && this.platform !== 'hab') { this.say('sys', 'YOU ARE IN THE ROVER. USE HAB <message> TO CALL THE HAB.'); return; }
      if (!r.up) { this.say('sys', `NO UHF LINK. ${r.reason}`); return; }
      if (channel === 'rover' && !rv.occupied()) { this.say('sys', 'NO ANSWER FROM THE ROVER. NOBODY IS ABOARD.'); return; }
      rt = 700 + (r.dist / 299792458) * 2000;
    } else {
      if (this.platform === 'rover') {
        if (!r) { this.say('sys', 'NO RADIO.'); return; }
        if (!r.up) { this.say('sys', `NO UHF LINK TO THE HAB, SO NOTHING CAN BE RELAYED TO HOUSTON. ${r.reason}`); return; }
        rt += 500;
      }
      if (!(await this.ensureLink())) return;
    }
    await this.houstonTurn(msg, channel, rt);
  }
  /** one full exchange with the far end: uplink, the wait, then the reply as radio voice AND typed text */
  private async houstonTurn(text: string, channel: Channel, rtOverride?: number) {
    const s = this.session; this.busy = true;
    this.say('tx', text);
    this.setChip('UPLINK');
    this.radio.staticOn(0.03); await this.radio.quindar('out'); if (s !== this.session) return;
    const t0 = performance.now(), rt = rtOverride ?? this.host.delayS() * 2000;
    const wait = this.isOpen ? this.line(this.log, 'sys', `UPLINK ... round trip ${(rt / 1000).toFixed(1)} s${channel === 'houston' ? '' : ' (UHF)'}`) : null;
    const data = await this.ask(text, channel); const left = rt - (performance.now() - t0); if (left > 0) await sleep(left);
    if (s !== this.session) return; wait?.remove();
    const reply = data?.reply ?? (channel === 'houston' ? NO_REPLY : 'Say again, you are breaking up. Over.');
    if (channel === 'houston') this.turns.push({ from: 'crew', text }, { from: 'houston', text: reply });
    const who = data?.role ?? (channel === 'hab' ? 'HAB OPS' : channel === 'rover' ? 'ROVER 1' : 'CAPCOM'), emerg = !!data?.emergency;
    this.setChip('HOUSTON THINKING'); await sleep(emerg ? 800 : THINK_MS); if (s !== this.session) return;
    this.term.querySelector('.box')!.classList.toggle('emerg', emerg && this.isOpen);
    this.setChipB(emerg ? 'EMERGENCY' : 'DOWNLINK', emerg);
    this.radio.staticSet(emerg ? 0.01 : 0.02); await this.radio.quindar('in'); if (s !== this.session) return;
    const el = this.isOpen ? this.line(this.log, 'rx', `${this.stamp()}  ${who}  `) : null;
    await this.radio.speak(reply, 'male', () => {
      if (el) void typeLive(el, `${this.stamp()}  ${who}  `, reply, 16, () => { this.log.scrollTop = this.log.scrollHeight; });
      else this.host.caption(who, reply);
    }, emerg);
    if (s !== this.session) return;
    await this.radio.quindar('out'); if (s !== this.session) return;
    this.radio.staticOff();
    this.term.querySelector('.box')!.classList.remove('emerg');
    this.busy = false; this.refresh();
    if (this.isOpen && this.mode === 'text') this.inp.focus();
  }

  /** crew lines mirrored into the console log while the CREW target is selected */
  crewLog(name: string, text: string, me: boolean) {
    if (!this.isOpen || this.target !== 'crew') return;
    this.line(this.log, me ? 'tx' : 'crewc', `${me ? 'YOU' : name}  ${text}`);
  }
}

/** Live transcript at a steady pace, synced to the voice. */
async function typeLive(el: HTMLElement, head: string, text: string, cps: number, tick: () => void) {
  for (let i = 0; i <= text.length; i++) { el.textContent = head + text.slice(0, i); tick(); await sleep(1000 / cps); }
}
