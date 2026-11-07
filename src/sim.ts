// Draft 1 simulation core. Pure state + fixed maths, no rendering. Constants are rough engineering
// placeholders, to be tightened against NASA reference values in later branches.
export const SIM = {
  crew: 4, arrayAreaM2: 100, arrayEff: 0.27, solarConstW: 1361,
  loadKw: 12, batteryCapKwh: 600, o2StartKg: 400, o2KgPerCrewDay: 0.84,
  co2BaseMmHg: 2.5, co2RiseMmHgPerH: 0.35, co2ScrubMmHgPerH: 1.5,
  timeRate: 60, surfaceDoseMsvPerDay: 1.3, habShield: 0.5, commsDelayS: 1.28,
};

export class Sim {
  batteryKwh = SIM.batteryCapKwh * 0.8;
  o2Kg = SIM.o2StartKg;
  co2 = SIM.co2BaseMmHg;
  doseMsv = 0;
  genKw = 0;
  radMult = 1;
  scrubberOn = true;
  sunlit = true;

  step(dtSeconds: number) {
    const h = dtSeconds / 3600;
    this.genKw = this.sunlit ? (SIM.arrayAreaM2 * SIM.arrayEff * SIM.solarConstW) / 1000 : 0;
    this.batteryKwh = Math.min(SIM.batteryCapKwh, Math.max(0, this.batteryKwh + (this.genKw - SIM.loadKw) * h));
    this.scrubberOn = this.batteryKwh > 0 || this.genKw >= SIM.loadKw;
    this.o2Kg = Math.max(0, this.o2Kg - (SIM.crew * SIM.o2KgPerCrewDay * h) / 24);
    this.co2 += SIM.co2RiseMmHgPerH * h;
    if (this.scrubberOn) this.co2 = Math.max(SIM.co2BaseMmHg, this.co2 - SIM.co2ScrubMmHgPerH * h);
    this.doseMsv += (SIM.surfaceDoseMsvPerDay / 24) * h * SIM.habShield * this.radMult;
  }

  spend(o2Kg: number, kWh: number) {
    this.o2Kg = Math.max(0, this.o2Kg - o2Kg);
    this.batteryKwh = Math.max(0, this.batteryKwh - kWh);
  }

  /** Placeholder mapping from the strongest recent flare class to a dose multiplier. */
  setFlareClass(c: string | null) {
    const k = c?.[0]?.toUpperCase();
    this.radMult = k === 'X' ? 6 : k === 'M' ? 3 : k === 'C' ? 1.3 : 1;
  }
}
