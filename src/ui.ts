// Player-facing layer: tablet (power / life support / radiation / crew work), the decision card, alarms and the end-of-mission debrief.
import { Sim, SIM, LOADS, JOBS, type LoadId, type JobId } from './sim';
import { Director, type ActiveEvent } from './events';

const CSS = `
#ops{position:fixed;inset:3vh 3vw;display:none;flex-direction:column;z-index:6;background:rgba(4,10,16,.95);border:1px solid rgba(255,176,0,.45);border-radius:6px;font:12px/1.6 ui-monospace,Menlo,Consolas,monospace;color:#d7dde5;box-shadow:0 0 60px #000}
#ops.on{display:flex}#ops header{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:9px 14px;border-bottom:1px solid rgba(255,176,0,.3);letter-spacing:.18em;font-size:11px;color:#ffb000}
#ops .grid{flex:1;overflow:auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:1px;background:rgba(255,255,255,.08)}
#ops section{background:#060d14;padding:12px 14px}#ops h3{margin:0 0 2px;font-weight:400;letter-spacing:.2em;font-size:11px;color:#4fd8ff}#ops .sub{color:#7d8a99;font-size:10px;margin-bottom:8px;line-height:1.4}
#ops .r{display:flex;justify-content:space-between;gap:8px}#ops .r span{color:#9aa6b4}#ops b{font-weight:400}.ok{color:#7ee787}.warn{color:#ffb000}.bad{color:#ff5a5a}
#ops .bar{height:5px;background:rgba(255,255,255,.12);margin:2px 0 7px}#ops .bar i{display:block;height:100%;background:#4fd8ff;width:0}
#ops button,#ops .btn{font:inherit;font-size:10px;letter-spacing:.1em;color:#4fd8ff;background:transparent;border:1px solid rgba(79,216,255,.45);padding:3px 8px;margin:2px 3px 2px 0;cursor:pointer}#ops button:hover:not(:disabled){background:#4fd8ff;color:#05070a}#ops button:disabled{opacity:.35;cursor:not-allowed}#ops button.sel{background:rgba(79,216,255,.25)}
#ops label{display:flex;align-items:center;gap:6px;cursor:pointer;margin:2px 0}#ops label em{margin-left:auto;font-style:normal;color:#9aa6b4}#ops label s{text-decoration:none;color:#ff5a5a;font-size:10px}
#ops input[type=range]{width:100%;accent-color:#4fd8ff}#ops .log{max-height:130px;overflow:auto;color:#aab5c2;font-size:11px;margin-top:4px}#ops .log div{margin-bottom:3px}
#decision{position:fixed;top:11vh;left:50%;transform:translateX(-50%);width:min(620px,92vw);display:none;z-index:5;background:rgba(10,6,4,.94);border:1px solid #ff5a5a;border-radius:4px;padding:14px 18px;font:13px/1.55 ui-monospace,Menlo,Consolas,monospace;color:#e8edf3;box-shadow:0 0 50px rgba(255,60,60,.25)}
#decision .tag{font-size:10px;letter-spacing:.22em;color:#ffb000}#decision h2{margin:2px 0 8px;font-size:17px;font-weight:400;letter-spacing:.14em;color:#ff7a6a}#decision p{margin:0 0 10px;color:#cfd6de;font-size:12px}
#decision .opt{display:flex;gap:10px;padding:6px 8px;margin:4px 0;border:1px solid rgba(255,255,255,.18);cursor:pointer}#decision .opt:hover{border-color:#4fd8ff;background:rgba(79,216,255,.08)}#decision .opt b{color:#4fd8ff;font-weight:400}#decision .opt small{display:block;color:#8d98a6;font-size:11px}
#decision .t{height:4px;background:rgba(255,255,255,.14);margin:8px 0}#decision .t i{display:block;height:100%;background:#ff5a5a;width:100%}#decision .ask{font-size:11px;color:#9aa6b4;min-height:18px}#decision .ask.rx{color:#7ee787}
#result{position:fixed;top:11vh;left:50%;transform:translateX(-50%);width:min(560px,90vw);display:none;z-index:5;background:rgba(4,10,16,.92);border-left:3px solid #ffb000;padding:10px 14px;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;color:#e8edf3}
#banner{position:fixed;top:4vh;left:50%;transform:translateX(-50%);display:none;z-index:4;padding:8px 22px;font:13px/1.4 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.2em;color:#fff;background:rgba(160,20,20,.88);border:1px solid #ff8a7a;pointer-events:none}#banner.bad{animation:bn .8s steps(2) infinite}#banner.calm{background:rgba(30,60,90,.88);border-color:#4fd8ff;animation:none}@keyframes bn{50%{background:rgba(90,10,10,.88)}}
#alerts{position:fixed;top:14px;right:16px;z-index:2;text-align:right;font:11px/1.7 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.1em;pointer-events:none}#alerts .warning{color:#ff5a5a}#alerts .caution{color:#ffb000}#alerts .info{color:#9aa6b4}
#endscr{position:fixed;inset:0;display:none;z-index:9;background:rgba(2,5,9,.96);align-items:center;justify-content:center;font:13px/1.6 ui-monospace,Menlo,Consolas,monospace;color:#d7dde5}#endscr .box{width:min(720px,92vw);max-height:90vh;overflow:auto;padding:24px}#endscr h1{font-weight:400;letter-spacing:.2em;font-size:22px;margin:0 0 4px}#endscr .big{font-size:64px;line-height:1}#endscr .row{display:flex;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,.1);padding:3px 0}#endscr button{margin-top:16px;font:inherit;letter-spacing:.16em;color:#05070a;background:#ffb000;border:0;padding:10px 22px;cursor:pointer}`;

const f = (n: number, d = 1) => n.toFixed(d), pct = (n: number) => `${Math.round(n)}%`;
const cls = (bad: boolean, warn: boolean) => (bad ? 'bad' : warn ? 'warn' : 'ok');

export type UiHost = { sim: Sim; dir: Director; openComms(): void; onTabletClose(): void; clockText(): string; flare(): string };

let ac: AudioContext | null = null;
export function ensureAudio() { try { ac ??= new AudioContext(); void ac.resume(); } catch { /* no audio */ } }
export function rumble(sec: number) { // low rumble for a moonquake
  if (!ac) return; const n = Math.floor(ac.sampleRate * sec), b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0); let last = 0;
  for (let i = 0; i < n; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5 * Math.min(1, i / 4000) * Math.min(1, (n - i) / 8000); }
  const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(); s.buffer = b; f.type = 'lowpass'; f.frequency.value = 110; g.gain.value = 1.6; s.connect(f).connect(g).connect(ac.destination); s.start();
}
export function beep(kind: 'warn' | 'event' | 'ok' | 'recall') {
  if (!ac) return; const seq = kind === 'recall' ? [[1040, 0], [760, 0.14], [1040, 0.28], [760, 0.42]] : kind === 'warn' ? [[880, 0], [660, 0.18]] : kind === 'event' ? [[740, 0], [740, 0.22], [988, 0.44]] : [[523, 0], [784, 0.12]];
  for (const [fr, t] of seq) { const o = ac.createOscillator(), g = ac.createGain(); o.type = 'square'; o.frequency.value = fr; g.gain.setValueAtTime(0.0001, ac.currentTime + t); g.gain.exponentialRampToValueAtTime(kind === 'recall' ? 0.14 : 0.07, ac.currentTime + t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t + 0.16); o.connect(g).connect(ac.destination); o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.2); }
}

export class UI {
  isTabletOpen = false;
  private ops: HTMLElement; private k = new Map<string, HTMLElement>(); private bars = new Map<string, HTMLElement>(); private loadBoxes = new Map<LoadId, HTMLInputElement>(); private shedTags = new Map<LoadId, HTMLElement>();
  private card: HTMLElement; private res: HTMLElement; private alertsEl: HTMLElement; private end: HTMLElement; private timer = 0; private resT = 0; private seen = new Set<string>(); private iv = 0; private lastEvent: ActiveEvent | null = null; private ended = false;

  constructor(private h: UiHost) {
    const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
    const row = (key: string, label: string) => `<div class="r"><span>${label}</span><b data-k="${key}"></b></div>`;
    const bar = (key: string) => `<div class="bar"><i data-b="${key}"></i></div>`;
    this.ops = document.createElement('div'); this.ops.id = 'ops';
    this.ops.innerHTML = `<header><span>CREW TABLET · MISSION OPS · <span data-k="clock"></span></span><span><button data-act="comms">EARTH COMMS</button><button data-act="close">CLOSE [M]</button></span></header>
    <div class="grid">
     <section><h3>POWER BUDGET</h3><div class="sub">The array makes power only when the Sun hits it. Everything you switch on is a trade-off against the battery.</div>
      ${row('gen', 'Array output')}${row('load', 'Base load')}${row('batt', 'Battery')}${bar('batt')}${row('arr', 'Array')}${row('dust', 'Dust on cells')}
      <div><button data-act="array:deployed">DEPLOY</button><button data-act="array:tilted">TILT</button><button data-act="array:retracted">RETRACT</button></div>
      <div class="sub" style="margin-top:8px">LOADS. If power runs short the bus drops the lowest-priority load first.</div>
      ${(Object.keys(LOADS) as LoadId[]).map((id) => `<label title="${LOADS[id].why}"><input type="checkbox" data-load="${id}"> ${LOADS[id].name} <s data-shed="${id}"></s><em>${LOADS[id].kw} kW</em></label>`).join('')}</section>
     <section><h3>LIFE SUPPORT</h3><div class="sub">Air, water and heat. You breathe out CO2, so the scrubber and the oxygenator both have to keep up.</div>
      ${row('ppo2', 'Oxygen (cabin)')}${row('o2', 'Oxygen tank')}${row('co2', 'CO2')}${row('scr', 'Scrubber health')}${row('press', 'Cabin pressure')}${row('gas', 'Gas reserve')}${row('water', 'Water')}${row('temp', 'Cabin temperature')}${row('oxy', 'Oxygenator output')}
      <div class="sub" style="margin-top:6px">Oxygenator throttle (more oxygen, more power, more water)</div><input type="range" min="0" max="100" data-oxy>
      <label><input type="checkbox" data-lioh> Burn LiOH canisters <em data-k="lioh"></em></label></section>
     <section><h3>RADIATION</h3><div class="sub">Space has no air or magnetic field. Dose limits: 250 mSv in 30 days, 600 mSv in a career. Soil on the roof and the storm shelter cut the dose.</div>
      ${row('rate', 'Dose rate (crew)')}${row('dose', 'Crew dose')}${bar('dose')}${row('cdose', 'Your dose')}${row('shield', 'Soil cover on hab')}${row('spe', 'Solar storm')}${row('flare', 'Real flare (NASA DONKI)')}
      <div><button data-act="shelter">CREW: STORM SHELTER</button></div></section>
     <section><h3>CREW WORK AND MISSION</h3><div class="sub">The crew can do one job at a time. Their hours are a resource too.</div>
      ${row('lock', 'Lockdown')}${row('crewout', 'Crew outside')}${row('day', 'Mission day')}${bar('day')}${row('health', 'Crew health')}${bar('health')}${row('morale', 'Morale')}${row('sci', 'Science done')}${row('job', 'Current job')}${bar('job')}<div><button data-act="stopjob">STOP CURRENT TASK</button></div>
      ${(Object.keys(JOBS) as JobId[]).map((id) => `<button data-job="${id}" title="${JOBS[id].why}">${JOBS[id].name.toUpperCase()} · ${JOBS[id].hours} H${JOBS[id].kw ? ' · ' + JOBS[id].kw + ' KW' : ''}</button>`).join('')}
      <div class="sub" style="margin-top:8px">LOG</div><div class="log" data-k="log"></div></section></div>`;
    document.body.append(this.ops);
    this.ops.querySelectorAll<HTMLElement>('[data-k]').forEach((e) => this.k.set(e.dataset.k!, e)); this.ops.querySelectorAll<HTMLElement>('[data-b]').forEach((e) => this.bars.set(e.dataset.b!, e));
    this.ops.querySelectorAll<HTMLInputElement>('[data-load]').forEach((e) => this.loadBoxes.set(e.dataset.load as LoadId, e)); this.ops.querySelectorAll<HTMLElement>('[data-shed]').forEach((e) => this.shedTags.set(e.dataset.shed as LoadId, e));
    this.ops.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('button') as HTMLElement | null; if (!t) return; const s = h.sim;
      if (t.dataset.job) { const r = s.startJob(t.dataset.job as JobId); if (r) this.flash(r); }
      else if (t.dataset.act === 'stopjob') s.cancelJob();
      else if (t.dataset.act === 'close') this.close(); else if (t.dataset.act === 'comms') { this.close(true); h.openComms(); }
      else if (t.dataset.act?.startsWith('array:')) s.setArray(t.dataset.act.slice(6) as never);
      else if (t.dataset.act === 'shelter') { s.shelter = !s.shelter; s.shelterAt = Infinity; s.say(s.shelter ? 'Crew ordered into the storm shelter.' : 'Crew ordered out of the storm shelter.'); }
      this.refresh();
    });
    this.ops.addEventListener('change', (e) => { const t = e.target as HTMLInputElement, s = h.sim; if (t.dataset.load) s.on[t.dataset.load as LoadId] = t.checked; if (t.hasAttribute('data-lioh')) s.liohOn = t.checked; });
    this.ops.addEventListener('input', (e) => { const t = e.target as HTMLInputElement; if (t.hasAttribute('data-oxy')) h.sim.oxyThrottle = +t.value / 100; });
    this.ops.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape' || e.key.toLowerCase() === 'm') this.close(); });

    this.card = document.createElement('div'); this.card.id = 'decision'; document.body.append(this.card);
    this.card.addEventListener('click', (e) => { const o = (e.target as HTMLElement).closest('[data-i]') as HTMLElement | null; if (o) h.dir.resolve(+o.dataset.i!); else if ((e.target as HTMLElement).closest('[data-ask]')) this.ask(); });
    this.res = document.createElement('div'); this.res.id = 'result'; document.body.append(this.res);
    this.alertsEl = document.createElement('div'); this.alertsEl.id = 'alerts'; document.body.append(this.alertsEl);
    this.end = document.createElement('div'); this.end.id = 'endscr'; document.body.append(this.end);
    h.dir.onEvent = (ev) => { this.showCard(ev); beep('event'); };
    h.dir.onResolve = (m) => { this.card.style.display = 'none'; this.lastEvent = null; this.res.textContent = m; this.res.style.display = 'block'; this.resT = 9; beep('ok'); };
  }

  private bannerEl: HTMLElement | null = null; private bannerText = '';
  /** Big banner for lockdown / recall. null hides it. */
  banner(text: string | null, tone: 'bad' | 'calm' = 'bad') {
    if (!this.bannerEl) { this.bannerEl = document.createElement('div'); this.bannerEl.id = 'banner'; document.body.append(this.bannerEl); }
    const key = text ? tone + text : ''; if (key === this.bannerText) return; this.bannerText = key;
    this.bannerEl.style.display = text ? 'block' : 'none'; this.bannerEl.className = tone; this.bannerEl.textContent = text ?? '';
  }
  flash(m: string) { this.res.textContent = m; this.res.style.display = 'block'; this.resT = 4; }
  open() { if (this.isTabletOpen) return; this.isTabletOpen = true; this.ops.classList.add('on'); this.refresh(true); this.iv = window.setInterval(() => this.refresh(), 400); setTimeout(() => this.ops.focus(), 0); }
  close(silent = false) { if (!this.isTabletOpen) return; this.isTabletOpen = false; this.ops.classList.remove('on'); clearInterval(this.iv); if (!silent) this.h.onTabletClose(); }
  ask() { const r = this.h.dir.ask(); if (r) this.flash(r); }

  private showCard(ev: ActiveEvent) {
    this.lastEvent = ev; this.card.style.display = 'block'; this.res.style.display = 'none';
    this.card.innerHTML = `<div class="tag">${ev.def.tag} · DECIDE NOW</div><h2>${ev.def.title}</h2><p>${ev.brief}</p>
      ${ev.choices.map((c, i) => `<div class="opt" data-i="${i}"><b>${i + 1}</b><div>${c.label}<small>${c.detail}</small></div></div>`).join('')}
      <div class="t"><i></i></div><div class="ask" data-ask>[H] ASK HOUSTON · answer in about ${f(SIM.commsDelayS * 2 + SIM.houstonPollS, 0)} s (light time + flight director poll)</div>
      <div class="ask" style="color:#6c7785">Do nothing and "${ev.choices[ev.def.defaultIdx].label}" happens.</div>`;
  }
  /** Per frame: countdown, Houston reply, alerts, mission-end screen. */
  frame(realDt: number, force = false) {
    const ev = this.h.dir.active;
    if (ev && ev === this.lastEvent) {
      (this.card.querySelector('.t i') as HTMLElement).style.width = `${Math.max(0, (ev.left / ev.def.windowS) * 100)}%`;
      const a = this.card.querySelector('[data-ask]') as HTMLElement;
      if (ev.reply) { a.className = 'ask rx'; a.textContent = ev.reply; } else if (ev.asked !== null) a.textContent = `TX to Houston... awaiting reply (${f(Math.max(0, SIM.commsDelayS * 2 + SIM.houstonPollS - (ev.asked - ev.left)), 0)} s)`;
    }
    if (this.resT > 0) { this.resT -= realDt; if (this.resT <= 0) this.res.style.display = 'none'; }
    this.timer -= realDt; if (this.timer > 0 && !force) return; this.timer = 0.4;
    const al = this.h.sim.alerts(); this.alertsEl.innerHTML = al.map((a) => `<div class="${a.level}">${a.level === 'warning' ? '▲ ' : ''}${a.text}</div>`).join('');
    for (const a of al) if (a.level === 'warning' && !this.seen.has(a.text.replace(/[\d.]+/g, ''))) { this.seen.add(a.text.replace(/[\d.]+/g, '')); beep('warn'); }
    if (!al.some((a) => a.level === 'warning')) this.seen.clear();
    if (this.h.sim.status !== 'RUN' && !this.ended) this.showEnd();
  }

  private refresh(first = false) {
    const s = this.h.sim, set = (k: string, t: string, c = '') => { const e = this.k.get(k); if (e) { e.textContent = t; e.className = c; } }, bar = (k: string, v: number, c = '') => { const e = this.bars.get(k); if (e) { e.style.width = `${Math.max(0, Math.min(100, v))}%`; if (c) e.style.background = c; } };
    const b = (s.batteryKwh / s.batteryCap) * 100, mm = (n: number) => `${Math.floor(n / 24)}d ${Math.floor(n % 24)}h`;
    set('clock', this.h.clockText());
    set('gen', `${f(s.genKw)} kW`, s.genKw > 0 ? 'ok' : 'warn'); set('load', `${f(s.loadKw)} kW`, cls(s.loadKw > s.genKw + 25, s.loadKw > s.genKw));
    set('batt', `${pct(b)} · ${s.batteryHours > 900 ? 'charging' : f(s.batteryHours, 0) + ' h left'}`, cls(b < 10, b < 25)); bar('batt', b, b < 25 ? '#ff5a5a' : '#4fd8ff');
    set('arr', s.arrayMode.toUpperCase() + (Math.abs(s.arrayK - (s.arrayMode === 'deployed' ? 1 : s.arrayMode === 'tilted' ? 0.3 : 0)) > 0.02 ? ' (moving)' : ''), s.arrayMode === 'deployed' ? 'ok' : 'warn'); set('dust', pct(s.dust * 100) + (s.arrayHealth < 1 ? ` · cells ${pct(s.arrayHealth * 100)}` : ''), cls(s.dust > 0.25, s.dust > 0.05));
    ops: for (const [id, box] of this.loadBoxes) { if (document.activeElement !== box) box.checked = s.on[id]; const t = this.shedTags.get(id)!; t.textContent = s.on[id] && !s.served[id] ? 'SHED' : ''; }
    set('ppo2', `${f(s.ppO2)} kPa`, cls(s.ppO2 < 17, s.ppO2 < 19.5)); set('o2', `${f(s.o2Kg, 0)} kg · ${s.o2Days > 900 ? 'steady' : f(s.o2Days, 0) + ' d'}`, cls(s.o2Days < 15, s.o2Days < 40));
    set('co2', `${f(s.co2)} mmHg`, cls(s.co2 > 6, s.co2 > 4)); set('scr', pct(s.scrubberHealth * 100) + (s.served.scrubber ? '' : ' · OFF'), cls(s.scrubberHealth < 0.5, s.scrubberHealth < 1));
    set('press', `${f(s.pressureKpa)} kPa` + (s.leakKpaH > 0 ? ` · leaking ${f(s.leakKpaH, 2)}/h` : ''), cls(s.pressureKpa < 85, s.leakKpaH > 0)); set('gas', `${f(s.gasKg, 0)} kg`, cls(s.gasKg < 30, s.gasKg < 100));
    set('water', `${f(s.waterKg, 0)} kg · ${s.waterDays > 900 ? 'steady' : f(s.waterDays, 0) + ' d'}`, cls(s.waterDays < 15, s.waterDays < 40)); set('temp', `${f(s.tempC)} C`, cls(s.tempC > 30 || s.tempC < 12, s.tempC > 27 || s.tempC < 17));
    set('oxy', `${f(s.oxyKgH * 24)} kg/day (need ${f(SIM.crew * SIM.o2KgPerCrewDay)})`, s.oxyKgH * 24 < SIM.crew * SIM.o2KgPerCrewDay ? 'warn' : 'ok');
    const lioh = this.ops.querySelector<HTMLInputElement>('[data-lioh]')!, ox = this.ops.querySelector<HTMLInputElement>('[data-oxy]')!; if (document.activeElement !== lioh) lioh.checked = s.liohOn; if (document.activeElement !== ox) ox.value = String(Math.round(s.oxyThrottle * 100)); set('lioh', `${f(s.lioh, 1)} left`);
    set('rate', `${f(s.doseRateMsvH * 24, 2)} mSv/day`, cls(s.doseRateMsvH * 24 > 20, s.doseRateMsvH * 24 > 3)); set('dose', `${f(s.doseMsv, 1)} / 250 mSv`, cls(s.doseMsv > 250, s.doseMsv > 125)); bar('dose', (s.doseMsv / 250) * 100, s.doseMsv > 125 ? '#ff5a5a' : '#4fd8ff');
    set('cdose', `${f(s.cmdDoseMsv, 1)} mSv${s.cmdExposed ? ' · OUTSIDE' : s.shelter ? ' · sheltered' : ''}`); set('shield', `${f(s.shieldM, 1)} m`, s.shieldM > 0 ? 'ok' : 'warn');
    set('spe', s.spe ? (s.t < s.spe.arrive ? `S${s.spe.cls} arriving in ${f(s.speEtaH * 60, 0)} min` : `S${s.spe.cls} active · ${f(s.speRateUnshielded(), 1)} mSv/h outside`) : 'none', s.spe ? 'bad' : 'ok'); set('flare', this.h.flare(), s.radMult > 1 ? 'warn' : '');
    set('lock', s.lockdown ? `${s.lockdown.reason} · ${f(s.lockdown.left, 0)} h` : 'none', s.lockdown ? 'bad' : 'ok'); set('crewout', `${s.crewOutside} of 4`, s.crewOutside > 0 && (s.shelter || s.lockdown) ? 'bad' : '');
    set('day', `${SIM.startDay + Math.floor(s.t / 24)} (${f(s.t / 24, 1)} of ${SIM.missionDays})`); bar('day', (s.t / (SIM.missionDays * 24)) * 100); set('health', pct(s.health), cls(s.health < 40, s.health < 75)); bar('health', s.health, s.health < 50 ? '#ff5a5a' : '#7ee787'); set('morale', pct(s.morale), cls(s.morale < 30, s.morale < 60)); set('sci', pct(s.score().sci));
    set('job', s.job ? `${JOBS[s.job.id].name} · ${f(s.job.left, 1)} h${s.shelter ? ' (paused)' : !s.jobServed ? ' (no power)' : ''}` : 'idle'); bar('job', s.job ? (1 - s.job.left / JOBS[s.job.id].hours) * 100 : 0);
    this.ops.querySelectorAll<HTMLButtonElement>('[data-job]').forEach((x) => { const why = s.canStart(x.dataset.job as JobId); x.disabled = !!why; if (why) x.dataset.why = why; });
    (this.ops.querySelector('[data-act=shelter]') as HTMLElement).textContent = s.shelter ? 'CREW: LEAVE STORM SHELTER' : 'CREW: ENTER STORM SHELTER';
    const lg = this.k.get('log')!; lg.innerHTML = [...s.log].reverse().slice(0, 12).map((l) => `<div>D${SIM.startDay + Math.floor(l.t / 24)} ${String(Math.floor(l.t % 24)).padStart(2, '0')}:${String(Math.floor((l.t % 1) * 60)).padStart(2, '0')} ${l.text}</div>`).join('');
    void first; void mm;
  }

  private showEnd() {
    this.ended = true; const s = this.h.sim, sc = s.score(), won = s.status === 'WON'; this.card.style.display = 'none'; document.exitPointerLock?.(); this.close(true);
    const lessons = ['Every watt, litre and gram is a trade-off. Spending power on science meant less margin for the battery.', 'Soil and the storm shelter cut radiation far more than the hull alone.', 'Houston is about 2.6 seconds away, but a flight director needs time to answer. At Mars you would be on your own for 20+ minutes.', 'Dust, leaks and failed parts are normal. Spares and crew time are what keep a base alive.'];
    this.end.style.display = 'flex'; this.end.innerHTML = `<div class="box"><h1 style="color:${won ? '#7ee787' : '#ff5a5a'}">${won ? 'MISSION COMPLETE' : 'CREW LOST'}</h1><div style="color:#9aa6b4">${won ? `All ${SIM.crew} crew survived ${SIM.missionDays} days at Shackleton.` : `Cause: ${s.lostReason}, on day ${f(s.t / 24, 1)}.`}</div>
      <div class="big" style="color:${won ? '#ffb000' : '#ff5a5a'};margin:14px 0">${sc.grade}</div>
      ${[['Crew health', pct(s.health)], ['Science', pct(sc.sci)], ['Crew dose', `${f(s.doseMsv, 1)} mSv of the 250 mSv limit`], ['Your dose', `${f(s.cmdDoseMsv, 1)} mSv`], ['Decisions made', `${this.h.dir.history.length} (${this.h.dir.history.filter((x) => x.auto).length} ran out the clock)`]].map(([a, b]) => `<div class="row"><span>${a}</span><b>${b}</b></div>`).join('')}
      <h3 style="letter-spacing:.2em;font-weight:400;color:#4fd8ff;margin:16px 0 4px">YOUR DECISIONS</h3>${this.h.dir.history.map((d) => `<div class="row"><span>D${d.day} ${d.title}</span><b>${d.auto ? 'no decision: ' : ''}${d.choice}</b></div>`).join('') || '<div>None</div>'}
      <h3 style="letter-spacing:.2em;font-weight:400;color:#4fd8ff;margin:16px 0 4px">WHAT REAL MISSION PLANNERS LEARN</h3>${lessons.map((l) => `<div style="margin-bottom:4px">· ${l}</div>`).join('')}<button onclick="location.reload()">FLY AGAIN</button></div>`;
  }
}
