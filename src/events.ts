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
        brief: `NOAA S${cls} solar radiation storm. Protons reach the Moon in about 45 minutes and stay dangerous for roughly ${Math.round(tau * 3)} hours. The Moon has no magnetic field or air to protect you. Staying in the hab would give the crew about ${inHab.toFixed(0)} mSv; the storm shelter about ${(inHab * 0.15).toFixed(0)} mSv. The 30-day limit is ${SIM.limit30} mSv. Anyone still outside on an EVA when it arrives takes the full dose, so get everyone indoors.`,
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
          { label: 'EVA PATCH', detail: '4 h outside. About 85% to work. Crew exposed to radiation.', run: () => { apply(); return s.startJob('patch', true) || 'EVA team heading out to patch the hull.'; } },
          { label: 'SEAL FROM INSIDE', detail: '2 h. Only about 55% to find the hole.', run: () => { apply(); return s.startJob('sealant', true) || 'Crew hunting the leak with sealant.'; } },
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
          { label: 'SWAP THE BED', detail: '6 h, uses the only spare, 0.5 kW.', run: () => s.startJob('bed', true) || 'Crew swapping the scrubber bed.' },
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
          { label: 'SWAP THE STACK', detail: '8 h, uses the only spare, 1 kW.', run: () => s.startJob('stack', true) || 'Crew swapping the oxygenator stack.' },
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
          { label: 'EVA TO FREE IT', detail: '1.5 h outside. Restores the link.', run: () => s.startJob('antenna', true) || 'EVA team out to free the gimbal.' },
          { label: 'WAIT FOR EARTH', detail: 'Houston will try the backup. Could be a long time.', run: () => { if (s.rnd() < 0.5) { s.antennaOk = true; return 'Houston switched to the backup transponder. Link restored.'; } return 'No luck yet. Still no link.'; } },
          { label: 'IGNORE IT', detail: 'You are on your own.', run: () => 'You are on your own.' },
        ],
      };
    },
  },

  // ---------------------------------------------------------------- crises that force action
  {
    id: 'duststorm', title: 'DUST STORM: LOCKDOWN', tag: 'POWER / SAFETY', windowS: 25, defaultIdx: 2, weight: (s) => (s.lockdown || s.dustHoursLeft > 0 ? 0 : 0.12),
    make: (s) => {
      s.stormWarn = true;   // the dust is already rolling in while the crew decides
      const hrs = 12 + Math.round(s.rnd() * 8), pct = s.batteryKwh / s.batteryCap;
      const lock = () => { s.lockdown = { reason: 'ELECTROSTATIC DUST STORM', left: hrs, storm: 1 }; s.dustRateH = 0.02; s.dustHoursLeft = hrs; };
      return {
        brief: `Charged lunar dust is lifting off the ground and rolling over the site. Visibility will drop to almost zero for about ${hrs} hours. (The Moon has no wind: this is electrostatic dust, the glow Surveyor saw on the horizon.) Hatches seal, nobody goes outside, and anyone already out must come in now. Dust will foul the array and clog the cabin air filters unless you close the vents.`,
        advice: { idx: pct > 0.5 ? 0 : 1, why: pct > 0.5 ? 'Battery can carry the base. Fold the array and close the vents.' : 'Battery is thin. Tilt the array edge-on for a trickle and accept some filter loading.' },
        choices: [
          { label: 'SEAL UP, RETRACT ARRAY', detail: 'No dust gets in, no solar power. Battery carries the base.', run: () => { lock(); s.setArray('retracted'); return `Hatches sealed, array folded, vents shut. Battery covers about ${(s.batteryKwh / Math.max(0.5, s.loadKw)).toFixed(0)} h at this load. Redeploy (P) when it clears.`; } },
          { label: 'TILT ARRAY, KEEP A TRICKLE', detail: '30% power, a quarter of the dust, filters load up.', run: () => { lock(); s.setArray('tilted'); s.scrubberHealth = Math.min(s.scrubberHealth, 0.8); return 'Array edge-on. Dust is getting into the air filters: scrubber at 80%.'; } },
          { label: 'KEEP THE ARRAY OUT', detail: 'Full power, but the cells will be coated and may arc.', run: () => { lock(); s.scrubberHealth = Math.min(s.scrubberHealth, 0.8); let m = 'Array stays out and is taking the dust. Filters loading.'; if (s.rnd() < 0.4) { s.arrayHealth = Math.max(0.1, s.arrayHealth * 0.88); s.arrayCap = Math.min(s.arrayCap, s.arrayHealth + 0.1); m += ' An arc burned out 12% of the cells.'; } return m; } },
        ],
      };
    },
  },
  {
    id: 'swarm', title: 'METEOROID SWARM', tag: 'SAFETY', windowS: 20, defaultIdx: 2, weight: (s) => (s.lockdown ? 0 : 0.1),
    make: (s) => {
      const hits = 1 + Math.floor(s.rnd() * 3), land = (protectArray: boolean, protectCrew: boolean) => {
        const out: string[] = [];
        for (let i = 0; i < hits; i++) { const r = s.rnd(); if (r < 0.5) { if (!protectArray) { s.arrayHealth = Math.max(0.1, s.arrayHealth - 0.04); s.arrayCap = Math.min(s.arrayCap, s.arrayHealth + 0.1); out.push('a cell panel took a hit'); } } else if (r < 0.75) { if (s.leakKpaH <= 0) { s.leakKpaH = 0.19 * 1.2 * 1.2; out.push('the hull is punctured'); } } else if (r < 0.9 && !protectCrew && !s.injured) { s.injured = true; out.push('spall hit a crew member'); } }
        s.fxq.push({ type: 'meteors', n: hits, hitArray: out.some((o) => o.includes('cell panel')), hitHull: out.some((o) => o.includes('punctured')) });
        return out.length ? `${hits} impacts: ${out.join(', ')}.` : `${hits} impacts, all clear misses.`;
      };
      s.lockdown = { reason: 'METEOROID SWARM', left: 3 + s.rnd() * 2, storm: 0 }; s.fxq.push({ type: 'streaks', n: 6 });
      return {
        brief: `Tracking shows a swarm of micrometeoroids crossing the site in about 10 minutes: ${hits} impacts expected, each as fast as a rifle bullet ten times over. Nobody goes outside until it passes. Crew in the shielded core are safe from spalling inside the hull; the array is the most exposed thing you own.`,
        advice: { idx: 0, why: 'Shelter the crew and fold the array. Power can be rebuilt; people cannot.' },
        choices: [
          { label: 'SHELTER AND FOLD ARRAY', detail: 'Crew in the core, array edge-on. Work stops.', run: () => { s.shelter = true; s.setArray('retracted'); return land(true, true) + ' Crew sheltered. Redeploy the array when the lockdown lifts.'; } },
          { label: 'FOLD ARRAY ONLY', detail: 'Protects the cells; crew stay at their posts.', run: () => { s.setArray('retracted'); return land(true, false); } },
          { label: 'STAY AT STATIONS', detail: 'No cost now. Everything is exposed.', run: () => land(false, false) },
        ],
      };
    },
  },
  {
    id: 'quake', title: 'MOONQUAKE', tag: 'STRUCTURE', windowS: 20, defaultIdx: 2, weight: () => 0.12,
    make: (s) => {
      const mag = 3 + s.rnd() * 2; s.quakeS = 14;
      const roll = (k: number) => { let m = ''; if (s.rnd() < 0.45 * k) { s.hidden = { leak: 0.3 + s.rnd() * 0.5, at: s.t + 3 }; } if (s.rnd() < 0.3 * k) { s.arrayHealth = Math.max(0.1, s.arrayHealth * 0.92); s.arrayCap = Math.min(s.arrayCap, s.arrayHealth + 0.1); m = ' The array shifted on its mounts: 8% output lost.'; } return m; };
      return {
        brief: `A shallow moonquake of about magnitude ${mag.toFixed(1)} is shaking the site. Apollo seismometers recorded quakes that rang for over ten minutes because the Moon is dry and rigid. Equipment shifts, seals can crack, and damage may not show up for hours.`,
        advice: { idx: 1, why: 'Brace now, and walk the hull afterwards. A hairline crack you find is a patch; one you miss is a leak at 3 a.m.' },
        choices: [
          { label: 'BRACE AND HOLD', detail: 'Crew drops and holds. Halves the chance of damage.', run: () => 'Crew braced.' + roll(0.5) + (s.hidden ? '' : ' Nothing seems to have broken.') },
          { label: 'BRACE, THEN INSPECT', detail: 'A 1 h walk-round finds any crack before it leaks.', run: () => { const m = roll(0.5); if (!s.hidden) return 'Crew braced. Walk-round not needed: nothing broke.' + m; return (s.startJob('inspect', true) || 'Crew inspecting the hull.') + m; } },
          { label: 'KEEP WORKING', detail: 'Full chance of hidden damage.', run: () => 'Crew carried on.' + roll(1) },
        ],
      };
    },
  },
  {
    id: 'battery', title: 'BATTERY OVERHEATING', tag: 'POWER', windowS: 25, defaultIdx: 2, weight: (s) => (s.batteryHazard > 0 ? 0 : 0.08),
    make: (s) => {
      s.batteryHazard = 0.15;
      return {
        brief: 'A cell in battery pack 3 is overheating. Thermal runaway spreads from cell to cell and cannot be stopped once it starts: the pack burns itself. The hotter you run the bus, the faster it climbs.',
        advice: { idx: 0, why: 'Isolate the pack now. Losing 20% of the battery beats losing 40% and starting a fire.' },
        choices: [
          { label: 'ISOLATE THE PACK', detail: '1 h job. Permanently loses 20% of the battery.', run: () => s.startJob('isolate', true) || 'Crew isolating pack 3.' },
          { label: 'SHED LOADS TO COOL IT', detail: 'Lab and water reclaimer off. Slows it; does not stop it.', run: () => { s.on.lab = false; s.on.water = false; return 'Lab and reclaimer off. Pack still climbing, more slowly. Isolate it soon.'; } },
          { label: 'IGNORE IT', detail: 'It will reach runaway in a few hours.', run: () => 'Pack 3 is still heating.' },
        ],
      };
    },
  },
  {
    id: 'fire', title: 'FIRE IN THE LAB', tag: 'LIFE SUPPORT', windowS: 20, defaultIdx: 2, weight: (s) => (s.fire > 0 ? 0 : 0.08),
    make: (s) => {
      s.fire = 0.2;
      return {
        brief: 'Smoke is pouring from the science lab rack. In a sealed hab a fire eats the oxygen and fills the air with toxic smoke, and there is nowhere to go. An electrical fire dies if you cut its power.',
        advice: { idx: 1, why: 'Kill the lab power first: it starves an electrical fire. Keep the extinguishers for when that is not enough.' },
        choices: [
          { label: 'EXTINGUISHER', detail: '30 min, uses one of the extinguishers, about 85% to work.', run: () => s.startJob('extinguish', true) || 'Crew attacking the fire.' },
          { label: 'CUT LAB POWER', detail: 'Starves the fire. You lose the science for now.', run: () => { s.on.lab = false; return 'Lab power cut. The fire is starving. Watch the air.'; } },
          { label: 'LET THE FILTERS COPE', detail: 'Keep the lab running and hope.', run: () => 'The fire is feeding on the live rack.' },
        ],
      };
    },
  },
  {
    id: 'water', title: 'WATER LINE RUPTURE', tag: 'LIFE SUPPORT', windowS: 25, defaultIdx: 2, weight: (s) => (s.waterLeakKgH > 0 ? 0 : 0.1),
    make: (s) => {
      s.waterLeakKgH = 12;
      return {
        brief: `A line in the water loop has split and is spraying 12 kg an hour into the floor. The tank holds ${s.waterKg.toFixed(0)} kg and water is also your oxygen: the oxygenator splits it.`,
        advice: { idx: 0, why: 'Repair it. Isolating the loop costs you the recycler.' },
        choices: [
          { label: 'REPAIR THE LINE', detail: '2 h job. Stops the leak.', run: () => s.startJob('waterline', true) || 'Crew repairing the water line.' },
          { label: 'ISOLATE THE LOOP', detail: 'Leak drops to a quarter, but the reclaimer goes off.', run: () => { s.waterLeakKgH *= 0.25; s.on.water = false; return 'Loop isolated. Leak slowed, reclaimer off: you are no longer recycling water.'; } },
          { label: 'IGNORE IT', detail: 'The tank drains in about 4 days.', run: () => 'Water is still draining.' },
        ],
      };
    },
  },
  {
    id: 'coolant', title: 'COOLANT PUMP FAILURE', tag: 'LIFE SUPPORT', windowS: 25, defaultIdx: 2, weight: (s) => (s.coolantK < 1 || s.spares.pump < 1 ? 0 : 0.08),
    make: (s) => {
      s.coolantK = 0.3;
      return {
        brief: 'The main coolant pump has stopped; the backup can move only 30% of the heat. Every watt you use becomes heat in the cabin, and the radiators cannot take it away. The cabin is already warming.',
        advice: { idx: 0, why: 'Swap the pump. Shedding loads only buys time.' },
        choices: [
          { label: 'SWAP THE PUMP', detail: '3 h, uses the spare pump.', run: () => s.startJob('coolant', true) || 'Crew swapping the pump.' },
          { label: 'SHED LOADS', detail: 'Lab off, oxygenator halved: about 5 kW less heat.', run: () => { s.on.lab = false; s.oxyThrottle = Math.min(s.oxyThrottle, 0.5); return 'Lab off, oxygenator halved. Heat input is back near what the backup can handle.'; } },
          { label: 'RUN HOT', detail: 'The cabin will pass 30 C in about 12 hours.', run: () => 'Cabin warming.' },
        ],
      };
    },
  },
  {
    id: 'blackout', title: 'SOLAR RADIO BLACKOUT', tag: 'COMMS', windowS: 20, defaultIdx: 2, weight: (s) => (s.blackoutLeft > 0 ? 0 : 0.1 * s.radMult),
    make: (s) => {
      s.blackoutLeft = 3 + s.rnd() * 3;
      return {
        brief: `A solar radio burst is swamping the Earth link for about ${s.blackoutLeft.toFixed(0)} hours. Houston cannot hear you and you cannot hear Houston. Any decision in that window is yours alone.`,
        advice: { idx: 1, why: 'No link: Houston cannot advise.' },
        choices: [
          { label: 'WAIT IT OUT', detail: 'No cost. Blind for the whole burst.', run: () => 'Standing by.' },
          { label: 'SWITCH TO UHF BACKUP', detail: 'Shortens it to 40% of the time. 0.5 kWh.', run: () => { s.blackoutLeft *= 0.4; s.spend(0, 0.5); return 'Backup transponder up. Blackout shortened.'; } },
          { label: 'KEEP TRANSMITTING', detail: 'Wastes power and gets nowhere.', run: () => { s.spend(0, 0.4); return 'Noise on every channel.'; } },
        ],
      };
    },
  },
  {
    id: 'injury', title: 'CREW MEMBER HURT', tag: 'CREW', windowS: 25, defaultIdx: 2, weight: (s) => (s.injured ? 0 : 0.1),
    make: (s) => {
      s.injured = true;
      return {
        brief: 'A crew member took a bad fall in the low gravity and is clutching a shoulder; another has a streaming reaction to the dust. (Apollo crews called it lunar hay fever.) Untreated, an injury wears the whole crew down.',
        advice: { idx: s.linkOk ? 1 : 0, why: s.linkOk ? "Have the flight surgeon talk the crew through it: it halves the treatment time." : 'No link: use the med kit.' },
        choices: [
          { label: 'TREAT WITH THE MED KIT', detail: '2 h job.', run: () => s.startJob('medic', true) || 'Crew treating the casualty.' },
          { label: 'TELE-MEDICINE WITH HOUSTON', detail: 'The surgeon coaches the crew. Half the time, needs the link.', run: () => { if (!s.linkOk) return (s.startJob('medic', true) || 'Crew treating the casualty.') + ' (No link: Houston could not help.)'; const r = s.startJob('medic', true); if (!r && s.job) s.job.left = 1; return r || 'Flight surgeon coaching the crew by radio. About 1 hour.'; } },
          { label: 'TOUGH IT OUT', detail: 'No cost now. Health keeps draining.', run: () => 'Crew member pressing on, in pain.' },
        ],
      };
    },
  },
  {
    id: 'busfault', title: 'ARRAY STRING FAULT', tag: 'POWER', windowS: 25, defaultIdx: 2, weight: (s) => (s.arrayHealth < 0.8 ? 0 : 0.08),
    make: (s) => {
      s.arrayHealth = Math.max(0.1, s.arrayHealth - 0.25);
      return {
        brief: 'One string of solar cells has gone open-circuit and a quarter of your array output has dropped out. A bad connector at the array junction box is the likely cause.',
        advice: { idx: 0, why: 'An EVA to fix the connector gets all of it back.' },
        choices: [
          { label: 'EVA REPAIR', detail: '4 h outside. Restores the full 25%.', run: () => s.startJob('busfix', true) || 'EVA team heading for the array.' },
          { label: 'SWITCH TO BACKUP STRING', detail: 'Gets 15% back now, but you can never get above 90%.', run: () => { s.arrayCap = Math.min(s.arrayCap, 0.9); s.arrayHealth = Math.min(s.arrayCap, s.arrayHealth + 0.15); return 'Backup string in. Array limited to 90% from now on.'; } },
          { label: 'LIVE WITH IT', detail: '25% less power for good.', run: () => 'Array running on three strings.' },
        ],
      };
    },
  },
  {
    id: 'sensor', title: 'PRESSURE SENSOR ALARM', tag: 'LIFE SUPPORT', windowS: 25, defaultIdx: 2, weight: (s) => (s.suspect || s.leakKpaH > 0 ? 0 : 0.1),
    make: (s) => {
      const real = s.rnd() < 0.5; s.suspect = { real };
      return {
        brief: 'Cabin pressure sensor B shows a falling reading. Sensor A reads steady. It could be a real hairline leak, or a failing sensor. Chasing a false alarm outside costs an EVA; ignoring a real leak costs air.',
        advice: { idx: 0, why: 'Cross-check with the hand gauge before anyone suits up. Verify first.' },
        choices: [
          { label: 'CHECK WITH THE HAND GAUGE', detail: '1 h inside the hab. Tells you the truth.', run: () => s.startJob('inspect', true) || 'Crew cross-checking with the hand gauge.' },
          { label: 'SUIT UP AND PATCH NOW', detail: '4 h EVA. Wasted if it was a bad sensor.', run: () => { if (real) { s.leakKpaH = 0.5; s.suspect = null; return s.startJob('patch', true) || 'EVA team out to patch.'; } s.suspect = null; s.job = { id: 'patch', left: 4 }; return 'EVA team out to search for a hole that may not exist.'; } },
          { label: 'IGNORE IT', detail: 'If it is real, it leaks until you notice.', run: () => { if (real) { s.leakKpaH = 0.5; s.suspect = null; return 'It WAS real: a leak is now open.'; } s.suspect = null; return 'It was a bad sensor. You got lucky.'; } },
        ],
      };
    },
  },
];

/** Pacing: a crisis roughly every day and a quarter, never closer than 12 sim hours. Real flare activity nudges the odds up a little. */
export const RATE_PER_DAY = 1.05, MIN_GAP_H = 12;
/** The first three crises are always these, so a new crew sees a dust storm, a moonquake and a meteoroid swarm early. Random after that. */
export const SCRIPT = ['duststorm', 'quake', 'swarm'];

export class Director {
  active: ActiveEvent | null = null; cooldownH = 8; ready = true;   // first crisis after about 50 real seconds, not 12
  history: { title: string; choice: string; outcome: string; auto: boolean; day: number }[] = [];
  onEvent: (e: ActiveEvent) => void = () => {}; onResolve: (msg: string) => void = () => {};
  constructor(private s: Sim) {}
  linkUp = () => this.s.linkOk;

  private start(def: EventDef) {
    const m = def.make(this.s); this.active = { def, brief: m.brief, choices: m.choices, advice: m.advice, left: def.windowS, asked: null, reply: null };
    this.onEvent(this.active);
  }
  /** Instructor: inject a fault right now (training / testing) */
  inject(id: string): string {
    if (this.active) return 'FINISH THE CURRENT DECISION FIRST'; const def = EVENTS.find((e) => e.id === id); if (!def) return 'UNKNOWN FAULT';
    this.start(def); return '';
  }

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
    if (this.history.length >= SCRIPT.length && s.openHazards >= 3) return;   // fairness: never pile a fourth crisis onto three open ones
    // scripted opening: the next one in the script, as soon as the gap is over
    if (this.history.length < SCRIPT.length) { const def = EVENTS.find((e) => e.id === SCRIPT[this.history.length])!; this.start(def); return; }
    const total = EVENTS.reduce((t, e) => t + e.weight(s), 0); if (total <= 0) return;
    if (s.rnd() < (RATE_PER_DAY / 24) * Math.min(1.8, total / 2) * simH) {
      let x = s.rnd() * total, def = EVENTS[0];
      for (const e of EVENTS) { x -= e.weight(s); if (x <= 0) { def = e; break; } }
      this.start(def);
    }
  }
  ask() {
    const a = this.active; if (!a || a.asked !== null) return 'ALREADY ASKED';
    if (!this.linkUp()) return 'NO LINK: HOUSTON CANNOT HEAR YOU';
    a.asked = a.left; return '';
  }
  resolve(idx: number, auto = false) {
    const a = this.active; if (!a) return; this.active = null; this.cooldownH = this.history.length < SCRIPT.length ? 24 : MIN_GAP_H; this.s.stormWarn = false;   // the three scripted ones are a day apart
    const out = a.choices[idx].run(this.s);
    this.history.push({ title: a.def.title, choice: a.choices[idx].label, outcome: out, auto, day: SIM.startDay + Math.floor(this.s.t / 24) });
    this.s.say(`${a.def.title}: ${auto ? 'NO DECISION, default applied: ' : ''}${a.choices[idx].label}. ${out}`);
    this.onResolve(`${auto ? 'TIME UP. ' : ''}${a.choices[idx].label}: ${out}`);
  }
}
