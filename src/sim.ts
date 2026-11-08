// Coupled outpost simulation. Pure state and maths, no rendering. Numbers come from NASA / ISS reference values where they exist:
// 0.84 kg O2 and 1.0 kg CO2 per crew-day, ISS-style CO2 limits, electrolysis ~10 kWh per kg O2, 1.3 mSv/day lunar surface dose
// (Chang'e-4 LND), NASA 30-day (250 mSv) and career (600 mSv) limits. Training tempo: events are far more frequent than in reality.
export const SIM = {
  crew: 5, missionDays: 14, startDay: 214,
  arrayAreaM2: 100, arrayEff: 0.25, solarConstW: 1361, batteryCapKwh: 240, dischargeMaxKw: 40,
  o2TankKg: 400, o2TankCapKg: 450, o2KgPerCrewDay: 0.84, co2KgPerCrewDay: 1.0, cabinO2Kg: 84, oxyKgPerDayMax: 5.5,
  waterTankKg: 1200, waterKgPerCrewDay: 3.0, waterRecovery: 0.93, gasReserveKg: 150, kgGasPerKpa: 3.55,
  gcrMsvDay: 1.3, limit30: 250, limitCareer: 600,
  commsDelayS: 1.28, commsAlwaysOn: true, // TEST MODE: Earth link ignores Earth line of sight and power. Set false for the real rules.
  houstonPollS: 7, // time the flight director needs to poll the room, on top of the light time
  timeRate: 600, // fixed clock: 1 real second = 10 sim minutes, so 14 days take about 35 minutes. Drops to 60x on its own during a decision or an EVA (see main.ts).
};
export type LoadId = 'thermal' | 'avionics' | 'scrubber' | 'oxygenator' | 'water' | 'lights' | 'lab';
export const LOADS: Record<LoadId, { name: string; kw: number; prio: number; why: string }> = {
  thermal: { name: 'Thermal loop', kw: 0.9, prio: 1, why: 'Pumps heat from the cabin out to the radiators. Off, and the cabin cooks.' },
  avionics: { name: 'Avionics and comms', kw: 0.9, prio: 2, why: 'Computers, radios and the Earth link.' },
  scrubber: { name: 'CO2 scrubber', kw: 1.0, prio: 3, why: 'Removes the CO2 the crew breathe out. Off, and CO2 climbs about 0.3 mmHg every hour.' },
  oxygenator: { name: 'Oxygenator', kw: 2.1, prio: 4, why: 'Splits water into oxygen and hydrogen. It is the biggest life-support power cost.' },
  water: { name: 'Water reclaimer', kw: 1.2, prio: 5, why: 'Recycles about 93% of used water. Off, and the water tank drains fast.' },
  lights: { name: 'Cabin lights and fans', kw: 1.4, prio: 6, why: 'Comfort and mixing the air. Off, and the cabin goes to dim red emergency light.' },
  lab: { name: 'Science lab', kw: 2.0, prio: 7, why: 'This is what the mission is for, and the first thing to cut when power is short.' },
};
export type ArrayMode = 'deployed' | 'tilted' | 'retracted';
export const JOBS = {
  berm: { name: 'Pile regolith over the hab (+0.5 m)', hours: 12, kw: 4, eva: true, why: 'Soil is a shield. Costs 4 kW and EVA time.' },
  clean: { name: 'Brush dust off the array', hours: 3, kw: 0, eva: true, why: 'An EVA to restore lost solar power.' },
  patch: { name: 'Patch the hull leak from outside', hours: 4, kw: 0, eva: true, why: 'EVA repair. Likely to work, but exposes the crew.' },
  sealant: { name: 'Seal the leak from inside', hours: 2, kw: 0, eva: false, why: 'Safer, but only about half the time.' },
  bed: { name: 'Swap the CO2 scrubber bed', hours: 6, kw: 0.5, eva: false, why: 'Uses the one spare bed.' },
  stack: { name: 'Swap the oxygenator stack', hours: 8, kw: 1, eva: false, why: 'Uses the one spare stack.' },
  antenna: { name: 'Re-point the antenna gimbal', hours: 1.5, kw: 0, eva: true, why: 'EVA to free the stuck gimbal.' },
} as const;
export type JobId = keyof typeof JOBS;
export type Alert = { level: 'info' | 'caution' | 'warning'; text: string };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const KG_PER_MMHG_CO2 = 1 / 1.38; // 1 kg of CO2 raises ppCO2 by 1.38 mmHg in a 300 m3 cabin

export class Sim {
  t = 0; // sim hours since mission start
  status: 'RUN' | 'WON' | 'LOST' = 'RUN'; lostReason = '';
  rnd: () => number = Math.random;
  log: { t: number; text: string }[] = [];
  // power
  batteryKwh = SIM.batteryCapKwh * 0.85; genKw = 0; loadKw = 0; sunlit = true;
  arrayMode: ArrayMode = 'deployed'; arrayK = 1; arrayHealth = 1; dust = 0; dustRateH = 0; dustHoursLeft = 0;
  on: Record<LoadId, boolean> = { thermal: true, avionics: true, scrubber: true, oxygenator: true, water: true, lights: true, lab: true };
  served: Record<LoadId, boolean> = { ...this.on }; jobServed = true; shed: string[] = [];
  // air, water, heat
  o2Kg = SIM.o2TankKg; cabinO2Kg = SIM.cabinO2Kg; co2 = 2.5; pressureKpa = 101.3; gasKg = SIM.gasReserveKg; waterKg = SIM.waterTankKg;
  tempC = 22; leakKpaH = 0; scrubberHealth = 1; oxyHealth = 1; oxyThrottle = 0.8; oxyKgH = 0; liohOn = false; lioh = 20; activityK = 1; activityHoursLeft = 0;
  spares = { bed: 1, stack: 1 }; antennaOk = true; resupplied = false;
  get ppO2() { return (21.3 * this.cabinO2Kg) / SIM.cabinO2Kg; }
  // radiation
  shieldM = 0; shelter = false; cmdExposed = false; shelterAt = Infinity;
  spe: { cls: number; total: number; arrive: number; tau: number } | null = null;
  doseMsv = 0; cmdDoseMsv = 0; doseRateMsvH = 0; flareLetter = 'NONE'; radMult = 1;
  // crew
  health = 100; morale = 85; science = 0;
  job: { id: JobId; left: number } | null = null; lastCause = '';

  say(text: string) { this.log.push({ t: this.t, text }); if (this.log.length > 60) this.log.shift(); }
  setFlareClass(c: string | null) { const k = c?.[0]?.toUpperCase() ?? 'NONE'; this.flareLetter = c ?? 'NONE'; this.radMult = k === 'X' ? 3 : k === 'M' ? 1.8 : k === 'C' ? 1.15 : 1; }
  spend(o2Kg: number, kWh: number) { this.o2Kg = Math.max(0, this.o2Kg - o2Kg); this.batteryKwh = Math.max(0, this.batteryKwh - kWh); }
  setArray(m: ArrayMode) { this.arrayMode = m; }

  // ---------- regolith / shell shielding factors ----------
  gcrFactor() { return 0.92 - 0.32 * (1 - Math.exp(-this.shieldM)); } // shell + regolith vs galactic cosmic rays
  speFactor() { return 0.45 * Math.exp(-this.shieldM / 0.25); } // shell + regolith vs solar protons (they stop in soil)
  speRateUnshielded() { // mSv/h, ramps for an hour then decays
    const e = this.spe; if (!e) return 0; const d = this.t - e.arrive; if (d < 0) return 0;
    const A = e.total / (e.tau + 0.5); return d < 1 ? A * d : A * Math.exp(-(d - 1) / e.tau);
  }

  canStart(id: JobId): string | null {
    if (this.status !== 'RUN') return 'MISSION OVER';
    if (this.job) return 'CREW BUSY WITH ANOTHER TASK';
    if (this.shelter) return 'CREW IS IN THE STORM SHELTER';
    if (id === 'berm' && this.shieldM >= 2) return 'ALREADY 2 M DEEP';
    if (id === 'clean' && this.dust < 0.02) return 'ARRAY IS CLEAN';
    if ((id === 'patch' || id === 'sealant') && this.leakKpaH <= 0) return 'NO LEAK';
    if (id === 'bed' && this.spares.bed < 1) return 'NO SPARE BED';
    if (id === 'stack' && this.spares.stack < 1) return 'NO SPARE STACK';
    if (id === 'antenna' && this.antennaOk) return 'ANTENNA IS FINE';
    return null;
  }
  startJob(id: JobId): string {
    const why = this.canStart(id); if (why) return why;
    this.job = { id, left: JOBS[id].hours }; this.say(`Crew started: ${JOBS[id].name}`); return '';
  }
  private finishJob(id: JobId) {
    const r = this.rnd();
    if (id === 'berm') { this.shieldM = Math.min(2, this.shieldM + 0.5); this.say(`Regolith layer finished. Cover is now ${this.shieldM.toFixed(1)} m.`); }
    else if (id === 'clean') { this.dust *= 0.15; this.spend(1.0, 0); this.say('Array brushed. Dust mostly gone.'); }
    else if (id === 'patch') { if (r < 0.85) { this.leakKpaH = 0; this.say('EVA patch holds. Leak stopped.'); } else { this.leakKpaH *= 0.4; this.say('Patch only partly seated. Leak reduced to 40%.'); } this.spend(1.0, 0); }
    else if (id === 'sealant') { if (r < 0.55) { this.leakKpaH = 0; this.say('Sealant took. Leak stopped.'); } else this.say('Sealant did not find the hole. Leak continues.'); }
    else if (id === 'bed') { this.spares.bed--; this.scrubberHealth = 1; this.say('New scrubber bed online.'); }
    else if (id === 'stack') { this.spares.stack--; this.oxyHealth = 1; this.say('New oxygenator stack online.'); }
    else if (id === 'antenna') { this.antennaOk = true; this.say('Antenna gimbal freed. Earth link restored.'); }
  }

  step(dtSeconds: number) { let left = dtSeconds; while (left > 0 && this.status === 'RUN') { const d = Math.min(left, 120); this.sub(d / 3600); left -= d; } }

  private sub(h: number) {
    this.t += h;
    if (!this.resupplied && this.t >= 168) { this.resupplied = true; this.spares.bed++; this.spares.stack++; this.gasKg += 40; this.say('Resupply lander touched down: spare scrubber bed, oxygenator stack and 40 kg of gas delivered.'); }
    // ---- power: array, demand, load shedding, battery ----
    const target = this.arrayMode === 'deployed' ? 1 : this.arrayMode === 'tilted' ? 0.3 : 0, mv = h / 0.5;
    this.arrayK += clamp(target - this.arrayK, -mv, mv);
    if (this.dustHoursLeft > 0) { this.dustHoursLeft = Math.max(0, this.dustHoursLeft - h); this.dust = Math.min(0.7, this.dust + this.dustRateH * (this.arrayMode === 'deployed' ? 1 : this.arrayMode === 'tilted' ? 0.25 : 0) * h); }
    this.genKw = this.sunlit ? ((SIM.arrayAreaM2 * SIM.arrayEff * SIM.solarConstW) / 1000) * this.arrayK * this.arrayHealth * (1 - this.dust) : 0;
    const crewWorking = !this.shelter;
    const demand: { id: LoadId | 'job'; kw: number; prio: number }[] = [];
    (Object.keys(LOADS) as LoadId[]).forEach((id) => {
      if (!this.on[id]) return;
      let kw = LOADS[id].kw;
      if (id === 'oxygenator') kw *= this.oxyThrottle; if (id === 'lab' && !crewWorking) kw *= 0.15;
      demand.push({ id, kw, prio: LOADS[id].prio });
    });
    if (this.job && JOBS[this.job.id].kw > 0 && crewWorking) demand.push({ id: 'job', kw: JOBS[this.job.id].kw, prio: 8 });
    const avail = this.genKw + Math.min(SIM.dischargeMaxKw, this.batteryKwh / Math.max(h, 1e-6));
    let total = demand.reduce((s, d) => s + d.kw, 0); const order = [...demand].sort((a, b) => b.prio - a.prio), shed = new Set<string>();
    for (const d of order) { if (total <= avail + 1e-9) break; shed.add(d.id); total -= d.kw; }
    (Object.keys(LOADS) as LoadId[]).forEach((id) => (this.served[id] = this.on[id] && !shed.has(id)));
    this.jobServed = !shed.has('job'); this.shed = [...shed].filter((x) => x !== 'job').map((x) => LOADS[x as LoadId].name);
    this.loadKw = total;
    const net = this.genKw - total;
    this.batteryKwh = clamp(this.batteryKwh + (net >= 0 ? net * 0.95 : net) * h, 0, SIM.batteryCapKwh);

    // ---- thermal ----
    const qIn = 0.55 + total, qLeak = 0.012 * (this.tempC + 110);
    const qRej = this.served.thermal ? clamp(qIn - qLeak + 6 * (this.tempC - 22), 0, 16) : 0;
    this.tempC += ((qIn - qLeak - qRej) / 5.5) * h;

    // ---- oxygen: electrolysis, breathing, leaks, regulator ----
    this.oxyKgH = 0;
    if (this.served.oxygenator && this.waterKg > 0) {
      this.oxyKgH = Math.min((SIM.oxyKgPerDayMax / 24) * this.oxyThrottle * this.oxyHealth, Math.max(0, (SIM.o2TankCapKg - this.o2Kg) / h));
      this.o2Kg += this.oxyKgH * h; this.waterKg = Math.max(0, this.waterKg - 1.125 * this.oxyKgH * h);
    }
    if (this.activityHoursLeft > 0) { this.activityHoursLeft -= h; if (this.activityHoursLeft <= 0) this.activityK = 1; }
    const act = this.activityK * (this.shelter ? 0.85 : 1);
    this.cabinO2Kg -= ((SIM.crew * SIM.o2KgPerCrewDay) / 24) * h * act;
    if (this.leakKpaH > 0) {
      const dP = this.leakKpaH * h, fromReserve = Math.min(this.gasKg, dP * SIM.kgGasPerKpa);
      this.gasKg -= fromReserve; this.pressureKpa -= dP - fromReserve / SIM.kgGasPerKpa;
      this.cabinO2Kg -= this.cabinO2Kg * (dP / Math.max(this.pressureKpa, 5));
    }
    const need = Math.max(0, SIM.cabinO2Kg * (this.pressureKpa / 101.3) - this.cabinO2Kg), take = Math.min(need, this.o2Kg);
    this.cabinO2Kg += take; this.o2Kg -= take; this.cabinO2Kg = Math.max(0, this.cabinO2Kg);

    // ---- CO2 ----
    this.co2 += ((SIM.crew * SIM.co2KgPerCrewDay) / 24) * h * act * 1.38;
    if (this.served.scrubber) this.co2 -= 0.144 * this.scrubberHealth * Math.max(0, this.co2 - 0.5) * h;
    if (this.liohOn && this.lioh > 0) { const r = Math.min(0.3 * h, Math.max(0, this.co2 - 0.3)); this.co2 -= r; this.lioh = Math.max(0, this.lioh - r * KG_PER_MMHG_CO2 / 1.1); }
    this.co2 = Math.max(0.3, this.co2);

    // ---- water ----
    this.waterKg = Math.max(0, this.waterKg - ((SIM.crew * SIM.waterKgPerCrewDay) / 24) * h * (this.served.water ? 1 - SIM.waterRecovery : 1));

    // ---- radiation ----
    if (this.spe && this.t > this.spe.arrive + 1 + 4 * this.spe.tau) { this.spe = null; this.say('Solar particle event over. Dose rates back to background.'); if (this.shelter) { this.shelter = false; this.say('All clear. Crew leaves the storm shelter.'); } }
    if (this.t >= this.shelterAt) { this.shelterAt = Infinity; this.shelter = true; this.say('Crew is in the storm shelter.'); }
    const g = this.gcrFactor(), sf = this.speFactor(), sp = this.speRateUnshielded(), gcr = SIM.gcrMsvDay / 24;
    const evaFrac = this.job && JOBS[this.job.id].eva && crewWorking && this.jobServed ? 0.4 : 0, sh = this.shelter ? 0.15 : 1;
    const inRate = gcr * g * (this.shelter ? 0.85 : 1) + sp * sf * sh, outRate = gcr + sp;
    this.doseRateMsvH = (1 - evaFrac) * inRate + evaFrac * outRate; this.doseMsv += this.doseRateMsvH * h;
    const cmdSh = this.shelter && !this.cmdExposed; // the commander shelters with the crew, unless caught outside
    const cmdIn = gcr * g * (cmdSh ? 0.85 : 1) + sp * sf * (cmdSh ? 0.15 : 1);
    this.cmdDoseMsv += (this.cmdExposed ? outRate : cmdIn) * h;

    // ---- jobs and science ----
    if (this.job && crewWorking && this.jobServed) { this.job.left -= h; if (this.job.left <= 0) { const id = this.job.id; this.job = null; this.finishJob(id); } }
    if (this.served.lab && crewWorking) this.science += h * (this.morale / 100);

    // ---- crew health and morale ----
    let dmg = 0, cause = '';
    const hit = (v: number, why: string) => { if (v > dmg) { dmg = v; cause = why; } };
    if (this.co2 > 6) hit((this.co2 - 6) * 0.35 + (this.co2 > 12 ? 2 : 0), 'CO2 poisoning');
    if (this.ppO2 < 17) hit((17 - this.ppO2) * 3, this.leakKpaH > 0 || this.pressureKpa < 92 ? 'loss of cabin pressure' : 'not enough oxygen');
    if (this.pressureKpa < 60) hit((60 - this.pressureKpa) * 0.8, 'loss of cabin pressure');
    if (this.tempC > 30) hit((this.tempC - 30) * 0.9, 'heat stress'); if (this.tempC < 10) hit((10 - this.tempC) * 0.6, 'cold');
    if (this.waterKg <= 0) hit(1.2, 'dehydration');
    const rad = this.doseMsv > SIM.limitCareer ? 1.2 : this.doseMsv > SIM.limit30 ? 0.35 : 0; if (rad) hit(rad, 'radiation sickness');
    this.health = clamp(this.health - dmg * h + (dmg === 0 ? 0.25 * h : 0), 0, 100); if (dmg > 0) this.lastCause = cause;
    const mo = 0.15 - (this.shelter ? 0.65 : 0) - (!this.served.lights ? 0.4 : 0) - (this.co2 > 4 ? 0.3 : 0) - (this.tempC > 27 || this.tempC < 18 ? 0.3 : 0);
    this.morale = clamp(this.morale + mo * h, 0, 100);

    if (this.health <= 0) { this.status = 'LOST'; this.lostReason = this.lastCause || 'crew lost'; this.say(`CREW LOST: ${this.lostReason}.`); }
    else if (this.t >= SIM.missionDays * 24) { this.status = 'WON'; this.say('Mission complete. The crew is safe.'); }
  }

  // ---------- readouts for the HUD, the tablet and Houston ----------
  get lightK() { return this.served.lights ? 1 : 0.12; }
  get o2Days() { const use = (SIM.crew * SIM.o2KgPerCrewDay) / 24 - this.oxyKgH; return use <= 0 ? 999 : this.o2Kg / (use * 24); }
  get waterDays() { const use = ((SIM.crew * SIM.waterKgPerCrewDay) / 24) * (this.served.water ? 1 - SIM.waterRecovery : 1) + 1.125 * this.oxyKgH; return use <= 0 ? 999 : this.waterKg / (use * 24); }
  get batteryHours() { const n = this.loadKw - this.genKw; return n <= 0 ? 999 : this.batteryKwh / n; }
  get speEtaH() { return this.spe ? Math.max(0, this.spe.arrive - this.t) : 0; }
  alerts(): Alert[] {
    const a: Alert[] = [], w = (text: string) => a.push({ level: 'warning', text }), c = (text: string) => a.push({ level: 'caution', text }), i = (text: string) => a.push({ level: 'info', text });
    const b = this.batteryKwh / SIM.batteryCapKwh;
    if (b < 0.1) w(`BATTERY ${(b * 100).toFixed(0)}%`); else if (b < 0.25) c(`BATTERY ${(b * 100).toFixed(0)}%`);
    if (this.shed.length) w(`POWER SHORT: SHED ${this.shed.join(', ').toUpperCase()}`);
    if (this.co2 > 6) w(`CO2 ${this.co2.toFixed(1)} mmHg`); else if (this.co2 > 4) c(`CO2 ${this.co2.toFixed(1)} mmHg`);
    if (this.ppO2 < 17) w(`O2 ${this.ppO2.toFixed(1)} kPa`); else if (this.ppO2 < 19.5) c(`O2 ${this.ppO2.toFixed(1)} kPa`);
    if (this.leakKpaH > 0) (this.pressureKpa < 85 ? w : c)(`HULL LEAK ${this.leakKpaH.toFixed(2)} kPa/h · ${this.pressureKpa.toFixed(0)} kPa`);
    if (this.tempC > 30 || this.tempC < 12) w(`CABIN ${this.tempC.toFixed(0)} C`); else if (this.tempC > 27 || this.tempC < 17) c(`CABIN ${this.tempC.toFixed(0)} C`);
    if (this.o2Days < 15) w(`O2 TANK ${this.o2Days.toFixed(0)} D`); else if (this.o2Days < 40) c(`O2 TANK ${this.o2Days.toFixed(0)} D`);
    if (this.waterDays < 15) w(`WATER ${this.waterDays.toFixed(0)} D`); else if (this.waterDays < 40) c(`WATER ${this.waterDays.toFixed(0)} D`);
    if (this.doseMsv > SIM.limit30) w(`DOSE OVER 30-DAY LIMIT`); else if (this.doseMsv > SIM.limit30 * 0.5) c(`DOSE ${this.doseMsv.toFixed(0)} mSv`);
    if (this.spe) (this.t < this.spe.arrive ? c : w)(this.t < this.spe.arrive ? `SOLAR STORM IN ${(this.speEtaH * 60).toFixed(0)} MIN` : `SOLAR STORM S${this.spe.cls} ${this.speRateUnshielded().toFixed(1)} mSv/h`);
    if (this.shelter) i('CREW IN STORM SHELTER');
    if (this.arrayMode === 'retracted') i('ARRAY RETRACTED');
    if (!this.antennaOk) w('ANTENNA FAULT: NO EARTH LINK');
    if (this.health < 60) w(`CREW HEALTH ${this.health.toFixed(0)}%`);
    return a;
  }
  score() {
    const sci = clamp((this.science / (SIM.missionDays * 24 * 0.75)) * 100, 0, 100), dose = clamp(1 - this.doseMsv / (SIM.limit30 * 0.4), 0, 1) * 20;
    const total = (this.status === 'WON' ? 40 : 0) + this.health * 0.2 + sci * 0.2 + dose;
    return { total, sci, grade: this.status !== 'WON' ? 'F' : total >= 95 ? 'S' : total >= 85 ? 'A' : total >= 70 ? 'B' : 'C' };
  }
}
