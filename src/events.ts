// The event director: schedules emergencies, runs the decision window, and applies the consequences.
// Every option costs something. Houston can advise, but only after the round-trip light time plus the flight director's poll,
// and not at all during an antenna fault: that is the communication-delay lesson.
import { Sim, SIM } from './sim';

export type Choice = { label: string; detail: string; run: (s: Sim) => string };
export type EventDef = {
  id: string; title: string; tag: string; windowS: number; defaultIdx: number; weight: (s: Sim) => number;
  make: (s: Sim) => { brief: string; choices: Choice[]; advice: { idx: number; why: string } };
};
export type ActiveEvent = { def: EventDef; brief: string; choices: Choice[]; advice: { idx: number; why: string }; left: number; asked: number | null; reply: string | null };

const r1 = (n: number) => Math.round(n * 10) / 10;
const pick = <T,>(s: Sim, a: T[]) => a[Math.floor(s.rnd() * a.length)];

export const EVENTS: EventDef[] = [
  {
    id: 'dust', title: 'DUST CLOUD INBOUND', tag: 'POWER', windowS: 25, defaultIdx: 2, weight: (s) => (s.dustHoursLeft > 0 ? 0 : 0.25),
    make: (s) => {
      const hrs = 8, hoursOnBattery = r1(s.batteryKwh / Math.max(0.5, s.loadKw));
      const start = (rate: number) => { s.dustRateH = rate; s.dustHoursLeft = hrs; };
      return {
        brief: `A cloud of electrostatically charged lunar dust is drifting toward the solar array and will last about ${hrs} hours. Lunar dust is sharp as glass and sticks to everything. Battery alone would run the base for about ${hoursOnBattery} h at the current load.`,
        advice: { idx: s.batteryKwh / 240 > 0.45 ? 0 : 1, why: s.batteryKwh / 240 > 0.45 ? 'Battery has the margin. Fold the array and wait it out; cleaning dust costs an EVA.' : 'Battery is low. Tilt edge-on to keep a trickle of power and little dust.' },
        choices: [
          { label: 'RETRACT ARRAY', detail: 'No dust, no power. The battery carries the base.', run: () => { start(0); s.setArray('retracted'); return 'Array folded. Remember to redeploy it when the dust clears (key P).'; } },
          { label: 'TILT EDGE-ON', detail: 'About 30% power, a quarter of the dust.', run: () => { start(0.012); s.setArray('tilted'); return 'Array tilted edge-on. Redeploy after the dust clears (key P).'; } },
          { label: 'LEAVE EXPOSED', detail: 'Full power, dust sticks, arcing can damage cells.', run: () => { start(0.012); let m = 'Array stays exposed.'; if (s.rnd() < 0.3) { s.arrayHealth *= 0.9; m += ' An electrostatic arc burned out 10% of the cells for good.'; } return m; } },
        ],
      };
    },
  },
  {
    id: 'spe', title: 'SOLAR STORM WARNING', tag: 'RADIATION', windowS: 25, defaultIdx: 1, weight: (s) => 0.3 * s.radMult * (s.spe ? 0 : 1),
    make: (s) => {
      const cls = pick(s, [1, 1, 2, 2, 3, 3, 4]), total = [0, 15, 45, 150, 400][cls], tau = 6 + s.rnd() * 6;
      s.spe = { cls, total, arrive: s.t + 0.75, tau };
      const inHab = total * s.speFactor();
      const shelterIdx = inHab > 12 ? 0 : 1;
      return {
        brief: `NOAA S${cls} solar radiation storm. Protons reach the Moon in about 45 minutes and stay dangerous for roughly ${Math.round(tau * 3)} hours. The Moon has no magnetic field or air to protect you. Staying in the hab would give the crew about ${inHab.toFixed(0)} mSv; the storm shelter about ${(inHab * 0.15).toFixed(0)} mSv. The 30-day limit is ${SIM.limit30} mSv. (Walk to the glowing ring and press E to take cover yourself.)`,
        advice: { idx: shelterIdx, why: shelterIdx === 0 ? `That is ${inHab.toFixed(0)} mSv in the hab. Shelter now.` : 'Dose is small enough that carrying on is acceptable, but keep EVAs off the schedule.' },
        choices: [
          { label: 'SHELTER NOW', detail: 'Crew in the water-lined shelter. Work stops. Morale drops.', run: () => { s.shelter = true; return 'Crew in the storm shelter. All tasks paused until the storm passes.'; } },
          { label: 'CARRY ON IN THE HAB', detail: 'Full work. Full dose through the hull.', run: () => 'Crew keeps working. Dose is accumulating through the hull.' },
          { label: 'SHELTER IN 1 HOUR', detail: 'Finish the job first. Storm arrives in 45 min.', run: () => { s.shelterAt = s.t + 1; return 'Crew will shelter in one hour.'; } },
        ],
      };
    },
  },
  {
    id: 'leak', title: 'HULL BREACH', tag: 'LIFE SUPPORT', windowS: 30, defaultIdx: 2, weight: (s) => (s.leakKpaH > 0 ? 0 : 0.15),
    make: (s) => {
      const d = pick(s, [1.5, 2, 2.5, 3]), rate = 0.19 * d * d;
      const apply = () => { s.leakKpaH = rate; };
      return {
        brief: `A micrometeoroid has punched a ~${d} mm hole in the hull. Cabin pressure is falling ${rate.toFixed(2)} kPa every hour. The regulator is making up the loss from the gas reserve (${s.gasKg.toFixed(0)} kg left, about ${(s.gasKg / SIM.kgGasPerKpa / rate).toFixed(0)} h at this rate).`,
        advice: { idx: 0, why: 'A patch from outside is the reliable fix. The dose cost is small next to losing the reserve.' },
        choices: [
          { label: 'EVA PATCH', detail: '4 h outside. About 85% to work. Crew exposed to radiation.', run: () => { apply(); return s.startJob('patch') || 'EVA team heading out to patch the hull.'; } },
          { label: 'SEAL FROM INSIDE', detail: '2 h. Only about 55% to find the hole.', run: () => { apply(); return s.startJob('sealant') || 'Crew hunting the leak with sealant.'; } },
          { label: 'MONITOR AND TOP UP', detail: 'Burn gas from the reserve and fix it later.', run: () => { apply(); return 'Leak is open. The reserve is paying for it. Start a patch from the tablet (M) when ready.'; } },
        ],
      };
    },
  },
  {
    id: 'scrubber', title: 'CO2 SCRUBBER FAULT', tag: 'LIFE SUPPORT', windowS: 30, defaultIdx: 2, weight: (s) => (s.scrubberHealth < 1 || s.spares.bed < 1 ? 0 : 0.15),
    make: (s) => {
      s.scrubberHealth = 0.3;
      return {
        brief: 'The scrubber bed is saturated and now removes only 30% of the CO2. Five people exhale about 5 kg of CO2 a day. Above 5 mmHg crews get headaches; above 10 it becomes dangerous. You have one spare bed and 20 LiOH canisters (each lasts about 5 hours).',
        advice: { idx: 0, why: 'Swap in the spare bed. Burn LiOH only if CO2 passes 5 mmHg while the swap runs.' },
        choices: [
          { label: 'SWAP THE BED', detail: '6 h, uses the only spare, 0.5 kW.', run: () => s.startJob('bed') || 'Crew swapping the scrubber bed.' },
          { label: 'BURN LiOH CANISTERS', detail: 'Works at once. 20 canisters is about 4 days.', run: () => { s.liohOn = true; return 'LiOH canisters running. They are a bridge, not a fix.'; } },
          { label: 'DO NOTHING YET', detail: 'CO2 will settle near 6 mmHg and keep stressing the crew.', run: () => 'Crew breathing a little harder.' },
        ],
      };
    },
  },
  {
    id: 'oxy', title: 'OXYGENATOR DEGRADED', tag: 'LIFE SUPPORT', windowS: 30, defaultIdx: 2, weight: (s) => (s.oxyHealth < 1 || s.spares.stack < 1 ? 0 : 0.1),
    make: (s) => {
      s.oxyHealth = 0.4;
      return {
        brief: `The electrolysis stack is corroding and now makes only 40% of its oxygen. The crew needs ${(SIM.crew * SIM.o2KgPerCrewDay).toFixed(1)} kg a day. The tank holds ${s.o2Kg.toFixed(0)} kg, about ${s.o2Days.toFixed(0)} days at the new output. There is one spare stack.`,
        advice: { idx: 0, why: 'Swap the stack while the tank is full. It only gets harder later.' },
        choices: [
          { label: 'SWAP THE STACK', detail: '8 h, uses the only spare, 1 kW.', run: () => s.startJob('stack') || 'Crew swapping the oxygenator stack.' },
          { label: 'RUN FLAT OUT', detail: 'Oxygenator to 100% throttle. More power, more water.', run: () => { s.oxyThrottle = 1; return 'Oxygenator at full throttle. Watch the power bus and the water tank.'; } },
          { label: 'LIVE OFF THE TANK', detail: 'Do nothing now. The tank slowly drains.', run: () => 'Tank is covering the shortfall.' },
        ],
      };
    },
  },
  {
    id: 'antenna', title: 'ANTENNA GIMBAL STUCK', tag: 'COMMS', windowS: 25, defaultIdx: 2, weight: (s) => (s.antennaOk ? 0.1 : 0),
    make: (s) => {
      s.antennaOk = false;
      return {
        brief: 'The high-gain antenna gimbal has jammed. The Earth link is down. Until it is fixed Houston cannot hear you and you cannot ask for advice: every decision is yours. (At Mars, with a 4 to 24 minute one-way delay, this is how every emergency would feel.)',
        advice: { idx: 0, why: 'No link: Houston cannot advise.' },
        choices: [
          { label: 'EVA TO FREE IT', detail: '1.5 h outside. Restores the link.', run: () => s.startJob('antenna') || 'EVA team out to free the gimbal.' },
          { label: 'WAIT FOR EARTH', detail: 'Houston will try the backup. Could be a long time.', run: () => { if (s.rnd() < 0.5) { s.antennaOk = true; return 'Houston switched to the backup transponder. Link restored.'; } return 'No luck yet. Still no link.'; } },
          { label: 'IGNORE IT', detail: 'You are on your own.', run: () => 'You are on your own.' },
        ],
      };
    },
  },
];

export class Director {
  active: ActiveEvent | null = null; cooldownH = 1; ready = true;
  history: { title: string; choice: string; outcome: string; auto: boolean; day: number }[] = [];
  onEvent: (e: ActiveEvent) => void = () => {}; onResolve: (msg: string) => void = () => {};
  constructor(private s: Sim) {}
  linkUp = () => SIM.commsAlwaysOn ? this.s.antennaOk : this.s.antennaOk;

  /** Called every frame with sim hours elapsed and real seconds elapsed. */
  frame(simH: number, realS: number) {
    const s = this.s; if (s.status !== 'RUN') return;
    if (this.active) {
      const a = this.active; a.left -= realS;
      if (a.asked !== null && a.reply === null && SIM.commsDelayS * 2 + SIM.houstonPollS - (a.asked - a.left) <= 0) a.reply = `HOUSTON: ${a.choices[a.advice.idx].label}. ${a.advice.why}`;
      if (a.left <= 0) this.resolve(a.def.defaultIdx, true);
      return;
    }
    this.cooldownH -= simH; if (this.cooldownH > 0) return;
    const total = EVENTS.reduce((t, e) => t + e.weight(s), 0); if (total <= 0) return;
    if (s.rnd() < (total * simH * 1.0) / 24 * 1.6 || (s.t < 3 && s.t > 1.0 && this.history.length === 0)) {
      let x = s.rnd() * total, def = EVENTS[0];
      if (this.history.length === 0) def = EVENTS[0]; // sol-214 opener: the dust cloud
      else for (const e of EVENTS) { x -= e.weight(s); if (x <= 0) { def = e; break; } }
      const m = def.make(s); this.active = { def, brief: m.brief, choices: m.choices, advice: m.advice, left: def.windowS, asked: null, reply: null };
      this.onEvent(this.active);
    }
  }
  ask() {
    const a = this.active; if (!a || a.asked !== null) return 'ALREADY ASKED';
    if (!this.linkUp()) return 'NO LINK: HOUSTON CANNOT HEAR YOU';
    a.asked = a.left; return '';
  }
  resolve(idx: number, auto = false) {
    const a = this.active; if (!a) return; this.active = null; this.cooldownH = 2.5;
    const out = a.choices[idx].run(this.s);
    this.history.push({ title: a.def.title, choice: a.choices[idx].label, outcome: out, auto, day: SIM.startDay + Math.floor(this.s.t / 24) });
    this.s.say(`${a.def.title}: ${auto ? 'NO DECISION, default applied: ' : ''}${a.choices[idx].label}. ${out}`);
    this.onResolve(`${auto ? 'TIME UP. ' : ''}${a.choices[idx].label}: ${out}`);
  }
}
