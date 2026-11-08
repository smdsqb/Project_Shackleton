// Earth comms terminal. The player talks to Houston over a delayed link: the reply arrives only after the real
// round-trip light time, and only while Earth is above the horizon and the outpost has power.
export type Link = { up: boolean; reason: string };
export type CommsHost = {
  telemetry(): Record<string, unknown>;
  link(): Link;
  now(): Date;
  delayS(): number;
  onClose(): void;
  /** Present when the outpost has a rover: its telemetry, its UHF link to the Hab, and whether anybody is aboard. */
  rover?: { telemetry(): unknown; link(): { up: boolean; dist: number; reason: string }; occupied(): boolean };
};
type Kind = 'update' | 'weather' | 'health' | 'news' | 'politics' | 'spacewx' | 'status' | 'say' | 'hab' | 'rover';

const CSS = `
#comms{position:fixed;left:50%;bottom:4vh;transform:translateX(-50%);width:min(940px,94vw);height:min(66vh,620px);display:none;flex-direction:column;z-index:6;background:rgba(4,10,16,.93);border:1px solid rgba(79,216,255,.4);border-radius:6px;box-shadow:0 0 60px rgba(0,0,0,.7);font:12px/1.65 ui-monospace,Menlo,Consolas,monospace;color:#d7dde5}
#comms.on{display:flex}
#comms header{display:flex;justify-content:space-between;align-items:center;padding:9px 14px;border-bottom:1px solid rgba(79,216,255,.25);letter-spacing:.2em;font-size:11px;color:#4fd8ff}
#comms header b{font-weight:400;color:#ffb000}
#comms .chip{padding:2px 10px;border:1px solid currentColor;border-radius:10px;letter-spacing:.14em}
#comms .up{color:#4fd8ff}#comms .down{color:#ff4d4d}
#comms #clog{flex:1;overflow-y:auto;padding:12px 16px;white-space:pre-wrap;word-break:break-word}
#comms .tx{color:#4fd8ff}#comms .rx{color:#e8edf3}#comms .sys{color:#ffb000}#comms .role{color:#7d8a99;letter-spacing:.14em}
#comms .quick{display:flex;flex-wrap:wrap;gap:6px;padding:8px 14px;border-top:1px solid rgba(79,216,255,.15)}
#comms .quick button{font:inherit;font-size:11px;letter-spacing:.12em;color:#4fd8ff;background:transparent;border:1px solid rgba(79,216,255,.4);padding:4px 10px;cursor:pointer}
#comms .quick button:hover{background:#4fd8ff;color:#05070a}
#comms form{display:flex;border-top:1px solid rgba(79,216,255,.25)}
#comms form span{padding:10px 0 10px 14px;color:#4fd8ff}
#comms input{flex:1;font:inherit;font-size:13px;color:#fff;background:transparent;border:0;outline:0;padding:10px 12px}
#comms .hint{padding:0 14px 8px;color:#566;font-size:10px;letter-spacing:.14em}`;

const HELP = `COMMAND            WHAT YOU GET
UPDATE             mission status update from CAPCOM
STATUS             downlink your telemetry, Houston reads it back
HEALTH             flight surgeon: crew health and radiation dose
WEATHER [city]     weather on Earth (default: Mission Control, Houston)
SPACEWX            space weather and solar flare outlook
NEWS               world headlines from the wires
POLITICS           political headlines
anything else      talk to CAPCOM
HAB <message>      (rover radio) talk to the crew in the Hab over UHF
ROVER <message>    (Hab console) call the rover over UHF

The link has real light-time delay. Replies take a few seconds. Outside test mode, no Earth in the sky or no power means no link.`;

export class Comms {
  isOpen = false;
  private el: HTMLElement; private log: HTMLElement; private input: HTMLInputElement; private chip: HTMLElement;
  private mode: 'hab' | 'rover' = 'hab'; private head!: HTMLElement; private roverIntro = false;
  private busy = false; private hist: string[] = []; private hi = 0; private tick = 0;

  constructor(private host: CommsHost) {
    const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
    this.el = document.createElement('div'); this.el.id = 'comms';
    this.el.innerHTML = `<header><span id="chead"></span><span class="chip" id="cchip"></span></header>
      <div id="clog"></div>
      <div class="quick">${['UPDATE', 'STATUS', 'HEALTH', 'WEATHER', 'SPACEWX', 'NEWS', 'POLITICS', 'HELP'].map((c) => `<button type="button" data-c="${c}">${c}</button>`).join('')}</div>
      <form autocomplete="off"><span>&gt;</span><input id="cin" maxlength="200" spellcheck="false" placeholder="type a command or just talk to Houston" /></form>
      <div class="hint">ENTER send &nbsp;&middot;&nbsp; UP recall &nbsp;&middot;&nbsp; ESC close terminal</div>`;
    document.body.append(this.el);
    this.log = this.el.querySelector('#clog')!; this.input = this.el.querySelector('#cin')!; this.chip = this.el.querySelector('#cchip')!; this.head = this.el.querySelector('#chead')!; this.setMode('hab');
    this.el.querySelector('form')!.addEventListener('submit', (e) => { e.preventDefault(); const v = this.input.value; this.input.value = ''; void this.send(v); });
    this.el.querySelectorAll('button[data-c]').forEach((b) => b.addEventListener('click', () => void this.send((b as HTMLElement).dataset.c!)));
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); this.hi = Math.max(0, this.hi - 1); this.input.value = this.hist[this.hi] ?? ''; }
      else if (e.key === 'ArrowDown') { e.preventDefault(); this.hi = Math.min(this.hist.length, this.hi + 1); this.input.value = this.hist[this.hi] ?? ''; }
    });
    this.add('sys', 'LINK TERMINAL READY. TYPE HELP FOR COMMANDS.');
  }

  private setMode(m: 'hab' | 'rover') {
    this.mode = m;
    this.head.innerHTML = m === 'rover' ? 'ROVER RADIO <b>&middot; UHF TO HAB &middot; RELAY TO EARTH</b>' : 'EARTH LINK <b>&middot; CAPCOM / HOUSTON</b>';
    this.input.placeholder = m === 'rover' ? 'HAB <message> for the Hab crew, or a command / message to Houston via relay' : 'type a command or just talk to Houston';
  }
  open(mode: 'hab' | 'rover' = 'hab') {
    if (this.isOpen) return; this.setMode(mode);
    if (mode === 'rover' && !this.roverIntro) { this.roverIntro = true; this.add('sys', 'ROVER RADIO READY. UHF TO THE HAB; EARTH TRAFFIC IS RELAYED THROUGH THE HAB DISH. TYPE HELP.'); }
    this.isOpen = true; this.el.classList.add('on'); this.refresh();
    this.tick = window.setInterval(() => this.refresh(), 1000); setTimeout(() => this.input.focus(), 30);
  }
  close() { if (!this.isOpen) return; this.isOpen = false; this.el.classList.remove('on'); clearInterval(this.tick); this.input.blur(); this.host.onClose(); }

  private refresh() {
    const l = this.host.link(), r = this.host.rover?.link();
    if (this.mode === 'rover' && r) { const up = r.up && l.up; this.chip.textContent = !r.up ? 'NO UHF LINK TO HAB' : l.up ? `UHF ${(r.dist / 1000).toFixed(1)} KM · EARTH ${this.host.delayS().toFixed(2)} S` : 'UHF UP · EARTH LINK DOWN'; this.chip.className = 'chip ' + (up ? 'up' : 'down'); return; }
    this.chip.textContent = l.up ? `LINK UP · ${this.host.delayS().toFixed(2)} S ONE-WAY` : 'NO LINK'; this.chip.className = 'chip ' + (l.up ? 'up' : 'down');
  }
  private stamp() { return this.host.now().toISOString().slice(11, 19) + 'Z'; }
  private add(cls: string, text: string) { const d = document.createElement('div'); d.className = cls; d.textContent = text; this.log.append(d); this.log.scrollTop = this.log.scrollHeight; return d; }
  private async typeOut(role: string, text: string) {
    const head = this.add('role', `${this.stamp()}  ${role}`), d = this.add('rx', ''); void head;
    for (let i = 0; i < text.length; i += 3) { d.textContent = text.slice(0, i + 3); this.log.scrollTop = this.log.scrollHeight; await new Promise((r) => setTimeout(r, 14)); }
    d.textContent = text;
  }

  private parse(raw: string): { kind: Kind | 'help'; arg: string } {
    const [w, ...rest] = raw.trim().split(/\s+/), c = w.toLowerCase(), arg = rest.join(' ');
    if (['help', '?'].includes(c)) return { kind: 'help', arg };
    if (['update', 'req', 'request'].includes(c)) return { kind: 'update', arg };
    if (['weather', 'wx', 'forecast'].includes(c)) return { kind: 'weather', arg };
    if (['health', 'med', 'medical', 'surgeon'].includes(c)) return { kind: 'health', arg };
    if (['spacewx', 'swx', 'flare', 'flares', 'radiation'].includes(c)) return { kind: 'spacewx', arg };
    if (['news', 'headlines'].includes(c)) return { kind: 'news', arg };
    if (['politics', 'political'].includes(c)) return { kind: 'politics', arg };
    if (['status', 'tlm', 'telemetry'].includes(c)) return { kind: 'status', arg };
    if (['hab', 'base'].includes(c)) return { kind: 'hab', arg };
    if (c === 'rover') return { kind: 'rover', arg };
    return { kind: 'say', arg: raw.trim() };
  }

  private async send(raw: string) {
    const text = raw.trim(); if (!text) return;
    this.hist.push(text); this.hi = this.hist.length;
    const { kind, arg } = this.parse(text);
    this.add('tx', `${this.stamp()}  TX > ${text.toUpperCase()}`);
    if (kind === 'help') { this.add('sys', HELP); return; }
    if (this.busy) { this.add('sys', 'LINK BUSY. WAITING ON DOWNLINK FROM THE LAST TRANSMISSION.'); return; }
    const l = this.host.link(), rv = this.host.rover, r = rv?.link();
    let rtMs = this.host.delayS() * 2000, note = `light time ${this.host.delayS().toFixed(2)} s each way`;
    if (kind === 'hab' || kind === 'rover') {
      if (!rv || !r) { this.add('sys', 'THERE IS NO ROVER ON THE NETWORK.'); return; }
      if (kind === 'hab' && this.mode !== 'rover') { this.add('sys', 'YOU ARE AT THE HAB CONSOLE ALREADY. USE THE CAPCOM COMMANDS, OR ROVER <message> TO CALL THE ROVER.'); return; }
      if (kind === 'rover' && this.mode !== 'hab') { this.add('sys', 'YOU ARE IN THE ROVER. USE HAB <message> TO CALL THE HAB.'); return; }
      if (!r.up) { this.add('sys', `NO UHF LINK. ${r.reason}`); return; }
      if (kind === 'rover' && !rv.occupied()) { this.add('sys', 'NO ANSWER FROM THE ROVER. NOBODY IS ABOARD.'); return; }
      rtMs = 700 + (r.dist / 299792458) * 2000; note = 'UHF line of sight';
    } else {
      if (this.mode === 'rover') {
        if (!r) { this.add('sys', 'NO RADIO.'); return; }
        if (!r.up) { this.add('sys', `NO UHF LINK TO THE HAB, SO NOTHING CAN BE RELAYED TO EARTH. ${r.reason}`); return; }
        rtMs += 500; note = `UHF to the Hab, then Earth relay, light time ${this.host.delayS().toFixed(2)} s each way`;
      }
      if (!l.up) { this.add('sys', `NO LINK. ${l.reason}`); return; }
    }

    this.busy = true; const t0 = performance.now();
    const wait = this.add('sys', `UPLINK ... ${note}`);
    let data: { role?: string; reply?: string; source?: string } | null = null;
    try {
      const r = await fetch('/api/comms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(25000),
        body: JSON.stringify({ kind, text: kind === 'say' || kind === 'hab' || kind === 'rover' ? arg : text, arg, telemetry: { ...this.host.telemetry(), rover: this.host.rover?.telemetry() } }) });
      data = await r.json();
    } catch { data = null; }
    const left = rtMs - (performance.now() - t0); if (left > 0) await new Promise((r) => setTimeout(r, left));
    wait.textContent = `UPLINK ... ${((performance.now() - t0) / 1000).toFixed(1)} s round trip`;
    if (!data?.reply) await this.typeOut('SIGNAL', 'Shackleton, Houston. Garbled on the ground loop. Say again later. (Comms relay offline: it only runs on the deployed site.)');
    else await this.typeOut(data.role ?? (kind === 'hab' ? 'HAB OPS' : kind === 'rover' ? 'ROVER' : 'CAPCOM'), data.reply);
    this.busy = false;
  }
}
