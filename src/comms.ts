import { Radio } from './radio';

export type Link = { up: boolean; reason: string };
export type CommsHost = {
  telemetry(): Record<string, unknown>; link(): Link; now(): Date; delayS(): number;
  onClose(): void; onPad(open: boolean, lines: string[], live: boolean): void;
  /** Present when the outpost has a rover: its telemetry, its UHF link to the Hab, and whether anybody is aboard. */
  rover?: { telemetry(): unknown; link(): { up: boolean; dist: number; reason: string }; occupied(): boolean };
};
type Turn = { from: 'crew' | 'houston'; text: string };
type Reply = { role?: string; reply?: string; emergency?: boolean } | null;
type Channel = 'houston' | 'hab' | 'rover';
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const NO_REPLY = 'Shackleton, Houston. You are breaking up on us, say again in a minute. Houston out.';
const HAILS = [
  'Shackleton, Houston. Loud and clear down here. Go ahead whenever you are ready.',
  'Shackleton, Houston, we have you five by five. What can we do for you?',
  'Hey Shackleton, Houston. Good to hear you. The coffee is cold on our side, so you are not missing much. Go ahead.',
  'Shackleton, Houston. We read you loud and clear. Standing by.',
];

const CSS = `
#term,#pad{position:fixed;display:none;z-index:6;font-family:ui-monospace,Menlo,Consolas,monospace;color:#d7dde5}
#term{inset:0;background:rgba(3,5,8,.92);align-items:center;justify-content:center}#term.on{display:flex}
#term .box{width:min(760px,94vw);height:min(560px,86vh);display:flex;flex-direction:column;border:1px solid rgba(79,216,255,.35);background:#05080c}
.hd{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid rgba(79,216,255,.25);font-size:11px;letter-spacing:.2em;color:#4fd8ff}
.chip{padding:2px 10px;border:1px solid currentColor;font-size:10px;letter-spacing:.16em}.chip.bad{color:#ff4d4d}.chip.warn{color:#ffb000}
.lg{flex:1;overflow-y:auto;padding:12px 14px;font-size:13px;line-height:1.55}.lg div{margin-bottom:6px;white-space:pre-wrap}
.tx{color:#7fd6ff}.rx{color:#e9edf1}.sys{color:#7d8a99}.hint{padding:6px 14px;font-size:10px;letter-spacing:.16em;color:#566}
.fm{display:flex;gap:8px;padding:10px 14px;border-top:1px solid rgba(79,216,255,.2)}.fm span{color:#4fd8ff}
.fm input{flex:1;background:transparent;border:0;outline:0;color:#e9edf1;font:inherit;font-size:13px}
#pad{left:16px;bottom:16px;width:min(390px,92vw);background:rgba(4,12,18,.86);border:1px solid rgba(79,216,255,.45);border-radius:6px;flex-direction:column;backdrop-filter:blur(3px)}
#pad.on{display:flex}#pad.emerg{border-color:#ff4d4d}#pad .lg{max-height:190px;min-height:96px;font-size:12px;padding:8px 12px}`;

export class Comms {
  isOpen = false; padOpen = false;
  private radio = new Radio(); private turns: Turn[] = []; private busy = false; private ready = false; private session = 0;
  private term: HTMLElement; private log: HTMLElement; private inp: HTMLInputElement; private chip: HTMLElement;
  private pad: HTMLElement; private plog: HTMLElement; private pin: HTMLInputElement; private pchip: HTMLElement;
  private recall: string[] = []; private ri = 0; private lastRx = '';
  private mode: 'hab' | 'rover' = 'hab'; private head!: HTMLElement; private roverIntro = false;

  constructor(private host: CommsHost) {
    const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
    this.term = document.createElement('div'); this.term.id = 'term';
    this.term.innerHTML = `<div class="box"><div class="hd"><span id="thead">HAB COMMS DESK · HOUSTON</span><span class="chip" id="tchip">STANDBY</span></div><div class="lg" id="tlog"></div><div class="hint">TEXT ONLY · ENTER SEND · TAB CLOSE</div><form class="fm" autocomplete="off"><span>&gt;</span><input id="tin" maxlength="200" spellcheck="false" placeholder="message to Houston"/></form></div>`;
    this.pad = document.createElement('div'); this.pad.id = 'pad';
    this.pad.innerHTML = `<div class="hd"><span>SUIT COMMS PAD</span><span class="chip" id="pchip">STANDBY</span></div><div class="lg" id="plog"></div><form class="fm" autocomplete="off"><span>&gt;</span><input id="pin" maxlength="200" spellcheck="false" placeholder="talk to Houston" disabled/></form><div class="hint">ENTER SEND · TAB CLOSE</div>`;
    document.body.append(this.term, this.pad);
    this.log = this.term.querySelector('#tlog')!; this.inp = this.term.querySelector('#tin')!; this.chip = this.term.querySelector('#tchip')!; this.head = this.term.querySelector('#thead')!;
    this.plog = this.pad.querySelector('#plog')!; this.pin = this.pad.querySelector('#pin')!; this.pchip = this.pad.querySelector('#pchip')!;
    this.term.querySelector('form')!.addEventListener('submit', (e) => { e.preventDefault(); const v = this.inp.value; this.inp.value = ''; void this.deskSend(v); });
    this.pad.querySelector('form')!.addEventListener('submit', (e) => { e.preventDefault(); const v = this.pin.value; this.pin.value = ''; void this.padSend(v); });
    this.inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Tab') { e.preventDefault(); this.close(); }
      else if (e.key === 'ArrowUp' && this.recall.length) { this.ri = Math.max(0, this.ri - 1); this.inp.value = this.recall[this.ri] ?? ''; e.preventDefault(); }
    });
    this.pin.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Tab') { e.preventDefault(); this.closePad(); } });
    this.pin.addEventListener('keyup', (e) => e.stopPropagation());
  }

  private async ask(text: string, channel: Channel = 'houston'): Promise<Reply> {
    try {
      const r = await fetch('/api/comms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(25000),
        body: JSON.stringify({ text, channel, history: channel === 'houston' ? this.turns.slice(-8) : [], telemetry: { ...this.host.telemetry(), rover: this.host.rover?.telemetry() } }) });
      return (await r.json()) as Reply;
    } catch { return null; }
  }
  private stamp() { const d = this.host.now(); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}Z`; }
  private line(box: HTMLElement, cls: string, text: string) { const d = document.createElement('div'); d.className = cls; d.textContent = text; box.append(d); box.scrollTop = box.scrollHeight; return d; }

  // ---------- desk terminal: text only ----------
  private setMode(m: 'hab' | 'rover') {
    this.mode = m;
    this.head.textContent = m === 'rover' ? 'ROVER RADIO · UHF TO HAB · RELAY TO HOUSTON' : 'HAB COMMS DESK · HOUSTON';
    this.inp.placeholder = m === 'rover' ? 'message to Houston (relayed), or HAB <message> for the Hab crew' : 'message to Houston, or ROVER <message> to call the rover';
  }
  open(mode: 'hab' | 'rover' = 'hab') {
    this.closePad(); this.setMode(mode); this.isOpen = true; this.term.classList.add('on'); this.refresh();
    if (!this.log.childElementCount) this.line(this.log, 'sys', 'HAB COMMS DESK. Type to Houston. Replies come back as text. ROVER <message> calls the rover over UHF.');
    if (mode === 'rover' && !this.roverIntro) { this.roverIntro = true; this.line(this.log, 'sys', 'ROVER RADIO. UHF to the Hab; Houston traffic is relayed through the Hab dish. HAB <message> talks to the Hab crew.'); }
    setTimeout(() => this.inp.focus(), 30);
  }
  close() { this.isOpen = false; this.term.classList.remove('on'); this.inp.blur(); this.host.onClose(); }
  private refresh() {
    const l = this.host.link(), r = this.host.rover?.link();
    if (this.mode === 'rover' && r) { const up = r.up && l.up; this.chip.textContent = !r.up ? 'NO UHF LINK TO HAB' : l.up ? `UHF ${(r.dist / 1000).toFixed(1)} KM · EARTH ${this.host.delayS().toFixed(2)} S` : 'UHF UP · EARTH LINK DOWN'; this.chip.className = 'chip' + (up ? '' : ' bad'); return; }
    this.chip.textContent = l.up ? `LINK UP · ${this.host.delayS().toFixed(2)} S` : 'NO LINK'; this.chip.className = 'chip' + (l.up ? '' : ' bad');
  }
  private async deskSend(raw: string) {
    const text = raw.trim(); if (!text || this.busy) return;
    this.recall.push(text); this.ri = this.recall.length; this.line(this.log, 'tx', `${this.stamp()}  YOU  ${text}`);
    this.refresh();
    const rv = this.host.rover, r = rv?.link(); let channel: Channel = 'houston', msg = text, rt = this.host.delayS() * 2000;
    const m = /^(hab|base|rover)\b[:,]?\s*(.*)$/i.exec(text);
    if (m && rv && r) {
      channel = m[1].toLowerCase() === 'rover' ? 'rover' : 'hab'; msg = m[2] || 'radio check';
      if (channel === 'hab' && this.mode !== 'rover') { this.line(this.log, 'sys', 'YOU ARE AT THE HAB. USE ROVER <message> TO CALL THE ROVER.'); return; }
      if (channel === 'rover' && this.mode !== 'hab') { this.line(this.log, 'sys', 'YOU ARE IN THE ROVER. USE HAB <message> TO CALL THE HAB.'); return; }
      if (!r.up) { this.line(this.log, 'sys', `NO UHF LINK. ${r.reason}`); return; }
      if (channel === 'rover' && !rv.occupied()) { this.line(this.log, 'sys', 'NO ANSWER FROM THE ROVER. NOBODY IS ABOARD.'); return; }
      rt = 700 + (r.dist / 299792458) * 2000;
    } else {
      if (this.mode === 'rover') {
        if (!r) { this.line(this.log, 'sys', 'NO RADIO.'); return; }
        if (!r.up) { this.line(this.log, 'sys', `NO UHF LINK TO THE HAB, SO NOTHING CAN BE RELAYED TO HOUSTON. ${r.reason}`); return; }
        rt += 500;
      }
      const l = this.host.link(); if (!l.up) { this.line(this.log, 'sys', `NO LINK. ${l.reason}`); return; }
    }
    this.busy = true; const t0 = performance.now();
    const wait = this.line(this.log, 'sys', `UPLINK ... round trip ${(rt / 1000).toFixed(1)} s${channel === 'houston' ? '' : ' (UHF)'}`);
    const data = await this.ask(msg, channel); const left = rt - (performance.now() - t0); if (left > 0) await sleep(left);
    const reply = data?.reply ?? (channel === 'houston' ? NO_REPLY : 'Say again, you are breaking up. Over.'); wait.remove(); if (channel === 'houston') this.turns.push({ from: 'crew', text: msg }, { from: 'houston', text: reply });
    const el = this.line(this.log, 'rx', ''); const head = `${this.stamp()}  ${data?.role ?? (channel === 'hab' ? 'HAB OPS' : channel === 'rover' ? 'ROVER 1' : 'CAPCOM')}  `;
    for (let i = 0; i <= reply.length; i += 3) { el.textContent = head + reply.slice(0, i); this.log.scrollTop = this.log.scrollHeight; await sleep(14); }
    el.textContent = head + reply; this.busy = false;
  }

  // ---------- suit pad: key press, static, female link manager, then voice chat with Houston ----------
  async togglePad() { if (this.isOpen) return; if (this.padOpen) this.closePad(); else this.openPad(); }
  private openPad() {
    this.padOpen = true; const s = ++this.session; this.ready = false; this.busy = false; this.plog.textContent = ''; this.pad.classList.add('on'); this.pad.classList.remove('emerg'); this.pin.disabled = true;
    this.setChip('CONNECTING'); this.screen(); void this.connect(s);
  }
  closePad() {
    if (!this.padOpen) return; this.padOpen = false; this.session++; this.ready = false; this.pad.classList.remove('on'); this.pin.blur();
    this.radio.stop(); this.radio.staticOff(); this.host.onPad(false, ['SUIT COMMS', 'STANDBY', 'PRESS C'], false);
  }
  private setChip(t: string, bad = false) { this.pchip.textContent = t; this.pchip.className = 'chip' + (bad ? ' bad' : ''); this.screen(); }
  private screen() { this.host.onPad(this.padOpen, ['SUIT COMMS', this.pchip.textContent ?? '', this.lastRx.slice(0, 17), this.lastRx.slice(17, 34), this.lastRx.slice(34, 51)], this.ready); }
  private async connect(s: number) {
    this.radio.staticOn(0.22);
    const l = this.host.link();
    const script = l.up ? 'Shackleton link manager. Comms module powered and running. Slewing the high gain antenna to Earth. Carrier acquired. Link is up. Stand by for Houston.'
      : `Shackleton link manager. I cannot hold Earth right now. ${l.reason}`;
    this.line(this.plog, 'sys', 'LINK MANAGER  ' + script);
    await this.radio.speak(script, 'female'); if (s !== this.session) return;
    if (!l.up) { await sleep(400); if (s === this.session) this.closePad(); return; }
    this.radio.staticSet(0.06);
    const hail = pick(HAILS); this.line(this.plog, 'rx', 'HOUSTON  ' + hail); this.lastRx = hail;
    await this.radio.quindar('in'); if (s !== this.session) return;
    await this.radio.speak(hail, 'male'); if (s !== this.session) return;
    await this.radio.quindar('out'); if (s !== this.session) return;
    this.ready = true; this.setChip(`LINK UP · ${this.host.delayS().toFixed(2)} S`); this.pin.disabled = false; this.pin.focus();
  }
  private async padSend(raw: string) {
    const text = raw.trim(); if (!text || this.busy || !this.ready) return;
    this.line(this.plog, 'tx', 'YOU  ' + text);
    const l = this.host.link(); if (!l.up) { this.line(this.plog, 'sys', `NO LINK. ${l.reason}`); return; }
    const s = this.session; this.busy = true; this.pin.disabled = true; this.setChip('UPLINK');
    this.radio.staticSet(0.14); await this.radio.quindar('out');
    const t0 = performance.now(), rt = this.host.delayS() * 2000, data = await this.ask(text), left = rt - (performance.now() - t0);
    if (left > 0) await sleep(left); if (s !== this.session) return;
    const reply = data?.reply ?? NO_REPLY, emerg = !!data?.emergency; this.turns.push({ from: 'crew', text }, { from: 'houston', text: reply });
    this.pad.classList.toggle('emerg', emerg); this.setChip(emerg ? 'EMERGENCY' : 'DOWNLINK', emerg);
    this.radio.staticSet(emerg ? 0.05 : 0.1); await this.radio.quindar('in'); if (s !== this.session) return;
    await this.radio.speak(reply, 'male', () => { this.line(this.plog, 'rx', 'HOUSTON  ' + reply); this.lastRx = reply; this.screen(); }, emerg);
    if (s !== this.session) return;
    await this.radio.quindar('out'); if (s !== this.session) return;
    this.radio.staticSet(0.05); this.busy = false; this.pin.disabled = false; this.setChip(`LINK UP · ${this.host.delayS().toFixed(2)} S`, false); this.pin.focus();
  }
}
