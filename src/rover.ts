import * as THREE from 'three';
import { buildRoverModel, WHEEL_R, TRACK, AXLES, FLOOR_Y, AISLE, HATCH, RADIO, SEAT_EYE, type RoverModel } from './roverModel';
import { heightAt, lineOfSight } from './terrain';
import { rockTop, bigRocksNear } from './rocks';
import { beep } from './ui';
import type { Sim } from './sim';

// The pressurised rover. Walk to the port steps (face the door), cycle in, walk the cabin, take the seat and drive.
// Lunar physics: 1.62 m/s2 gravity means traction (and therefore braking and cornering) is weak, so everything is slow and
// needs planning. Each wheel is on a spring and damper, boulders and drops are felt, and harsh driving damages parts that
// then have to be repaired outside with kits from the rover.
const CAP_KWH = 90, HOTEL_KW = 1.1, LAMP_KW = 0.4, MASS = 6500, MAX_V = 6.5, MAX_REV = 2.2, G = 1.62, MU = 0.62, WHEELBASE = 5.4;
const CHARGE_KW = 6, CHARGE_R = 13, UHF_RANGE = 20000, KITS_MAX = 3;
const K_SPR = 11, C_DAMP = 0.95, DROOP = 0.3, TMAX = 0.3, RHO_P = 2.6, RHO_R = 1.6, XC = (AXLES[0] + AXLES[2]) / 2;
const D = THREE.MathUtils, lerp = D.lerp, clamp = D.clamp, smooth = (k: number) => k * k * (3 - 2 * k);
export type RoverMode = 'out' | 'cabin' | 'driving';
type Cand = { a: THREE.Vector3; reach: number; cone: number; text: string; run: () => string };
export type RoverTele = { present: true; mode: RoverMode; batteryPct: number; speedKph: number; distM: number; headingDeg: number; linkUp: boolean; damagePct: number };
type Warn = { text: string; level: 'warn' | 'bad' };

export class Rover {
  mode: RoverMode = 'out';
  x = 3; z = 11.8; heading = 0; speed = 0; steer = 0; batteryKwh = CAP_KWH * 0.9; lights = false; parkBrake = true;
  prompt = ''; toast = ''; busy = false; taskLabel = ''; taskProgress = 0; drawKw = 0; charging = false; shake = 0; kits = KITS_MAX;
  warnings: Warn[] = []; speedLimit = MAX_V; brakeTemp = 20; overspeed = false; skidding = false;
  wheelHp = [100, 100, 100, 100, 100, 100]; brakeHp = 100; bodyHp = 100; glassHp = 100; dishHp = 100; lampHp = [100, 100];
  onRadio: (() => void) | null = null; pendingExit: THREE.Vector2 | null = null; tiltQ = new THREE.Quaternion();
  private m: RoverModel; private cabin = new THREE.Vector2(2.35, -1.0); private best: Cand | null = null;
  // body state: origin height, pitch/roll as plane slopes, with rates
  private B = 0; private vB = 0; private sx = 0; private sz = 0; private vsx = 0; private vsz = 0;
  private hcs: number[] = []; private hcPrev: number[] = []; private cl: number[] = []; private hubY: number[] = [];
  private thr = 0; private brk = 0; private roll = 0; private pitch = 0; private lastA = 0;
  private cycle: { t: number; total: number; kind: 'enter' | 'exit' | 'repair' | 'restock'; stage: number; part?: number } | null = null;
  private hatchK = 0; private hatchTarget = 0; private toastT = 0; private scrT = 0; private warnT = 0; private beepT = 0; private time = 0; private firstAlert = new Set<string>();
  private spot: THREE.SpotLight; private fx: Pool;
  private link = { up: false, dist: 0, los: false, reason: 'NOT CHECKED' }; private linkT = 0; private ant = new THREE.Vector3(); private tmp = new THREE.Vector3(); lastPlayer = new THREE.Vector3(); private suitOk = false;
  private frontDmg = 0; private dentUsed = new Set<number>(); private strikeCool = 0; private stuck = 0; private lookAhead = { upG: 0, downG: 0, drop: 0, rockDist: 99, field: false };

  constructor(scene: THREE.Scene, private solid: (x: number, z: number, r: number) => boolean, private habAnt: () => THREE.Vector3) {
    this.m = buildRoverModel(); scene.add(this.m.root);
    this.spot = new THREE.SpotLight(0xfff4e0, 0, 80, 0.55, 0.6, 1.4); this.spot.position.set(5.0, 2.2, 0); this.spot.target.position.set(40, 0.5, 0); this.m.root.add(this.spot, this.spot.target);
    this.fx = makePool(scene, 160, { size: 0.1, opacity: 1, colors: true });
    const ws = this.m.wheels, hs = this.contacts(); this.hcs = hs.slice(); this.hcPrev = hs.slice(); this.cl = hs.map(() => 0); this.hubY = ws.map(() => WHEEL_R);
    this.fitPlane(hs, true); this.animate(0);
  }

  // ---------- frames ----------
  private toWorld(l: THREE.Vector3, out = new THREE.Vector3()) { return out.copy(l).applyMatrix4(this.m.root.matrixWorld); }
  private worldXZ(lx: number, lz: number) { const c = Math.cos(this.heading), s = Math.sin(this.heading); return [this.x + lx * c + lz * s, this.z - lx * s + lz * c] as const; }
  get inside() { return this.mode !== 'out'; }
  get hasPrompt() { return !!this.prompt; }
  /** Rectangle the player cannot walk through while outside. */
  blocks(x: number, z: number) {
    if (this.mode !== 'out') return false;
    const c = Math.cos(this.heading), s = Math.sin(this.heading), dx = x - this.x, dz = z - this.z, lx = dx * c - dz * s, lz = dx * s + dz * c;
    return lx > -5.5 && lx < 5.4 && Math.abs(lz) < 2.45;
  }
  cameraPos(out: THREE.Vector3) {
    if (this.mode === 'driving') return this.toWorld(SEAT_EYE, out);
    return this.toWorld(this.tmp.set(this.cabin.x, FLOOR_Y + 0.06 + 1.62, this.cabin.y), out);
  }
  walk(dx: number, dz: number) { const c = Math.cos(this.heading), s = Math.sin(this.heading); this.cabin.x = clamp(this.cabin.x + dx * c - dz * s, AISLE.x0, AISLE.x1); this.cabin.y = clamp(this.cabin.y + dx * s + dz * c, AISLE.z0, AISLE.z1); }
  press() { if (this.best) { const t = this.best.run(); if (t) this.say(t); } }
  say(t: string, secs = 3) { this.toast = t; this.toastT = secs; }
  toggleLights() { this.lights = !this.lights; this.say(this.lights ? 'HEADLAMPS ON' : 'HEADLAMPS OFF', 1.5); }
  toggleParkBrake() { if (this.mode !== 'driving') return; this.parkBrake = !this.parkBrake; this.say(this.parkBrake ? 'PARKING BRAKE ON' : 'PARKING BRAKE RELEASED', 1.6); }

  // ---------- damage ----------
  get worst(): { name: string; hp: number } {
    const parts = [...this.wheelHp.map((h, i) => ({ name: this.m.wheels[i].name, hp: h })), { name: 'BRAKES', hp: this.brakeHp }, { name: 'WINDSCREEN', hp: this.glassHp }, { name: 'COMMS DISH', hp: this.dishHp }, { name: 'LEFT HEADLAMPS', hp: this.lampHp[0] }, { name: 'RIGHT HEADLAMPS', hp: this.lampHp[1] }, { name: 'BODY PANELS', hp: this.bodyHp }];
    return parts.reduce((a, b) => (b.hp < a.hp ? b : a));
  }
  get damagePct() { return 100 - (this.wheelHp.reduce((a, b) => a + b, 0) / 6 * 0.4 + this.brakeHp * 0.2 + this.bodyHp * 0.15 + this.glassHp * 0.1 + this.dishHp * 0.1 + (this.lampHp[0] + this.lampHp[1]) / 2 * 0.05); }
  private hurt(kind: 'wheel' | 'brakes' | 'body' | 'glass' | 'dish' | 'lamp', amt: number, i = 0) {
    if (amt <= 0) return;
    const before = this.worst;
    if (kind === 'wheel') this.wheelHp[i] = Math.max(0, this.wheelHp[i] - amt); else if (kind === 'brakes') this.brakeHp = Math.max(0, this.brakeHp - amt);
    else if (kind === 'body') this.bodyHp = Math.max(0, this.bodyHp - amt); else if (kind === 'glass') this.glassHp = Math.max(0, this.glassHp - amt);
    else if (kind === 'dish') this.dishHp = Math.max(0, this.dishHp - amt); else this.lampHp[i] = Math.max(0, this.lampHp[i] - amt);
    const w = this.worst; void before;
    if (w.hp < 60 && !this.firstAlert.has(w.name)) { this.firstAlert.add(w.name); this.say(`REPAIR REQUIRED: ${w.name} (${w.hp.toFixed(0)}%)`, 5); beep('warn'); }
  }
  private dent(zone: string, severity: number) {
    const slots = this.m.dents.map((d, i) => ({ d, i })).filter((o) => o.d.zone === zone && !this.dentUsed.has(o.i)); if (!slots.length) return;
    const pick = slots[(Math.random() * slots.length) | 0]; this.dentUsed.add(pick.i); pick.d.m.visible = true; pick.d.m.scale.setScalar(0.7 + Math.min(1, severity) * 0.7); pick.d.m.rotateZ(Math.random() * 6);
  }
  private crash(v: number, where: 'front' | 'rear' | 'side') {
    if (v < 1.0 || this.strikeCool > 0) return; this.strikeCool = 0.8;
    const sev = v - 1.0; this.hurt('body', sev * 13); this.dent(where === 'side' ? (Math.random() < 0.5 ? 'port' : 'starboard') : where, sev / 3);
    if (where === 'front') { this.frontDmg = Math.min(1, this.frontDmg + sev * 0.18); if (v > 3.4) { this.hurt('glass', (v - 3.4) * 26); } if (v > 2.4) this.hurt('lamp', (v - 2.4) * 30, Math.random() < 0.5 ? 0 : 1); for (const i of [0, 1]) this.hurt('wheel', Math.max(0, (v - 1.6) * 4), i); }
    if (v > 3.8) this.hurt('dish', (v - 3.8) * 22);
    this.vsx += where === 'front' ? -v * 0.22 : v * 0.18; this.shake = Math.min(1, 0.4 + v * 0.15); this.say(`COLLISION AT ${(v * 3.6).toFixed(0)} km/h · CHECK DAMAGE`, 3.5); beep('warn');
  }

  // ---------- hatch, repair and restock cycles ----------
  private startCycle(kind: 'enter' | 'exit' | 'repair' | 'restock', part = 0): string {
    if (this.busy) return 'WORK IN PROGRESS';
    if (kind === 'exit' && !this.suitOk) return 'EXIT REFUSED: EVA SUIT NOT SEALED. DON ONE AT THE HAB RACK';
    if (kind === 'repair' && this.kits <= 0) return 'NO REPAIR KITS LEFT. RESTOCK FROM HAB SPARES';
    const total = kind === 'enter' ? 7 : kind === 'exit' ? 8 : kind === 'restock' ? 5 : 8 + (100 - this.partHp(part)) * 0.18;
    this.cycle = { t: 0, total, kind, stage: -1, part }; this.busy = true; return '';
  }
  private partHp(i: number) { return i < 6 ? this.wheelHp[i] : i === 6 ? this.brakeHp : i === 7 ? this.glassHp : i === 8 ? this.dishHp : i === 9 ? Math.min(...this.lampHp) : this.bodyHp; }
  private setPartHp(i: number, v: number) { if (i < 6) this.wheelHp[i] = v; else if (i === 6) this.brakeHp = v; else if (i === 7) this.glassHp = v; else if (i === 8) this.dishHp = v; else if (i === 9) this.lampHp = [v, v]; else { this.bodyHp = v; this.frontDmg = 0; } }
  private partName(i: number) { return i < 6 ? this.m.wheels[i].name : ['BRAKE ASSEMBLIES', 'WINDSCREEN', 'COMMS DISH', 'HEADLAMPS', 'BODY PANELS'][i - 6]; }
  private stepCycle(dt: number, sim: Sim) {
    const c = this.cycle!; c.t += dt; const f = Math.min(1, c.t / c.total);
    const names = { enter: ['OPENING OUTER HATCH', 'STEPPING INTO THE VESTIBULE', 'CLOSING HATCH', 'REPRESSURISING TO 101 kPA', 'EQUALISING, CHECKING SEALS'], exit: ['CLOSING CABIN DOOR, SEALING SUIT', 'PUMPING CABIN AIR TO STORAGE', 'VESTIBULE AT VACUUM', 'OPENING OUTER HATCH'], repair: ['ISOLATING THE DAMAGED UNIT', 'REMOVING WORN PARTS', 'FITTING NEW PARTS', 'TORQUING FASTENERS', 'TESTING'], restock: ['OPENING SPARES LOCKER', 'RESTOCKING KITS FROM HAB SPARES', 'LOGGING INVENTORY'] }[c.kind];
    const st = Math.min(names.length - 1, Math.floor(f * names.length)); this.taskProgress = f; this.taskLabel = c.kind === 'repair' ? `REPAIR · ${this.partName(c.part!)} · ${names[st]}` : c.kind === 'restock' ? `ROVER LOCKER · ${names[st]}` : `ROVER HATCH · ${names[st]}`;
    if (st !== c.stage) {
      c.stage = st;
      if (c.kind === 'enter') { if (st === 0) this.hatchTarget = 1; if (st === 2) { this.mode = 'cabin'; this.cabin.set(2.35, -1.0); this.hatchTarget = 0; } if (st === 3) sim.spend(0.2, 0.2); }
      else if (c.kind === 'exit') { if (st === 1) sim.spend(0.05, 0.1); if (st === 3) this.hatchTarget = 1; }
    }
    if (f >= 1) {
      if (c.kind === 'exit') { this.mode = 'out'; this.hatchTarget = 1; const [wx, wz] = this.worldXZ(HATCH.x, HATCH.z - 1.7); this.pendingExit = new THREE.Vector2(wx, wz); this.say('OUTSIDE · HATCH LEFT OPEN FOR NOW'); }
      else if (c.kind === 'enter') this.say('ROVER CABIN PRESSURISED · 101 kPa');
      else if (c.kind === 'repair') { this.setPartHp(c.part!, 100); this.kits--; this.say(`${this.partName(c.part!)} REPAIRED · ${this.kits} KIT${this.kits === 1 ? '' : 'S'} LEFT`); beep('ok'); this.firstAlert.delete(this.partName(c.part!)); if (c.part === 7) this.m.cracks.forEach((m) => (m.visible = false)); }
      else { this.kits = KITS_MAX; this.say('REPAIR KITS RESTOCKED'); beep('ok'); }
      this.cycle = null; this.busy = false; this.taskLabel = ''; this.taskProgress = 0;
    }
  }

  // ---------- radio link to the Hab ----------
  habLink() { return this.link; }
  private updateLink() {
    this.toWorld(this.tmp.set(2.0, FLOOR_Y + 2.9, -0.7), this.ant); const hab = this.habAnt(), dist = Math.hypot(this.ant.x - hab.x, this.ant.z - hab.z);
    const rng = UHF_RANGE * Math.pow(this.dishHp / 100, 1.5), los = dist < 40 || lineOfSight(this.ant, hab), inRange = dist < rng;
    this.link = { dist, los, up: los && inRange && this.batteryKwh > 0 && this.dishHp > 20, reason: this.dishHp <= 20 ? 'THE COMMS DISH IS DAMAGED. REPAIR IT OUTSIDE' : !inRange ? `OUT OF UHF RANGE OF THE HAB (${(rng / 1000).toFixed(0)} KM MAX)` : !los ? 'THE HAB IS BELOW THE LOCAL HORIZON OR MASKED BY TERRAIN' : this.batteryKwh <= 0 ? 'ROVER BATTERY IS DEAD' : '' };
  }
  telemetry(): RoverTele { return { present: true, mode: this.mode, batteryPct: (this.batteryKwh / CAP_KWH) * 100, speedKph: Math.abs(this.speed) * 3.6, distM: this.link.dist, headingDeg: (((90 - D.radToDeg(this.heading)) % 360) + 360) % 360, linkUp: this.link.up, damagePct: this.damagePct }; }
  status(): [string, string, string][] {
    const pct = (this.batteryKwh / CAP_KWH) * 100, w = this.worst, rows: [string, string, string][] = [
      ['ROVER', this.mode === 'out' ? 'PARKED' : this.mode === 'cabin' ? 'CABIN' : `DRIVING · ${(Math.abs(this.speed) * 3.6).toFixed(1)} km/h`, this.overspeed ? 'bad' : this.mode === 'driving' ? 'warn' : 'ok'],
      ['ROVER BATTERY', `${pct.toFixed(0)} %${this.charging ? ' · CHARGING' : ''}`, pct < 10 ? 'bad' : pct < 25 ? 'warn' : 'ok'],
      ['ROVER UHF', this.link.up ? `HAB ${(this.link.dist / 1000).toFixed(2)} km` : 'NO LINK', this.link.up ? 'ok' : 'bad'],
      ['ROVER DAMAGE', w.hp > 90 ? 'NONE' : `${w.name} ${w.hp.toFixed(0)}%`, w.hp < 40 ? 'bad' : w.hp < 90 ? 'warn' : 'ok'],
    ];
    if (this.mode === 'driving') {
      rows.splice(1, 0, ['SPEED LIMIT', `${(this.speedLimit * 3.6).toFixed(0)} km/h`, this.overspeed ? 'bad' : 'ok'], ['BRAKES', `${this.brakeTemp.toFixed(0)} °C${this.parkBrake ? ' · PARK ON' : ''}`, this.brakeTemp > 600 ? 'bad' : this.brakeTemp > 400 ? 'warn' : 'ok']);
      for (const wn of this.warnings.slice(0, 2)) rows.push(['ALERT', wn.text, wn.level === 'bad' ? 'bad' : 'warn']);
      rows.push(['DRIVE', 'W/S · A/D · SPACE BRAKE · X PARK · L LAMPS · R RADIO', 'ok']);
    }
    return rows;
  }

  // ---------- per-frame ----------
  update(dt0: number, dtSim: number, ctx: { player: THREE.Vector3; suitOn: boolean; keys: Set<string>; sim: Sim; hab: THREE.Vector3; look: THREE.Vector3 }): { dHeading: number } {
    const dt = Math.min(dt0, 0.05); this.time += dt; this.suitOk = ctx.suitOn; this.lastPlayer.copy(ctx.player); this.strikeCool -= dt; let dHeading = 0;
    if (this.cycle) this.stepCycle(dt, ctx.sim);
    const driving = this.mode === 'driving';
    dHeading = driving ? this.drive(dt, ctx.keys) : this.parked(dt);

    // suspension and body motion (after the move, so wheels see the new ground)
    this.suspension(dt);
    // battery: hotel + lamps + traction (including climbing) ; regen on braking ; charging at the Hab
    const dh = dtSim / 3600, habD = Math.hypot(this.x - ctx.hab.x, this.z - ctx.hab.z), v = Math.abs(this.speed);
    const tractionKw = driving ? Math.max(0, (Math.max(0, this.lastA) + G * Math.max(0, this.sx) + 0.07) * MASS * v) / 850 : 0;
    this.drawKw = HOTEL_KW + (this.lights ? LAMP_KW : 0) + tractionKw;
    this.charging = !driving && this.speed === 0 && habD < CHARGE_R && this.batteryKwh < CAP_KWH - 0.05 && ctx.sim.batteryKwh > 2;
    let dE = -this.drawKw * dh + this.regenKw * dh;
    if (this.charging) { const g = Math.min(CHARGE_KW * dh, CAP_KWH - this.batteryKwh - dE); dE += g; ctx.sim.spend(0, g); }
    this.batteryKwh = clamp(this.batteryKwh + dE, 0, CAP_KWH);

    this.animate(dt);
    this.linkT -= dt; if (this.linkT <= 0) { this.linkT = 0.5; this.updateLink(); }
    this.scrT -= dt; if (this.scrT <= 0) { this.scrT = 0.2; this.drawScreens(); }
    this.warnT -= dt; if (this.warnT <= 0) { this.warnT = 0.25; this.scanTerrain(); }
    this.alarms(dt);
    this.pickPrompt(ctx, habD);
    this.toastT -= dt; if (this.toastT <= 0) this.toast = '';
    this.shake = Math.max(0, this.shake - dt * 1.4);
    return { dHeading };
  }

  private parked(dt: number): number {
    // parking brake holds; without it the rover creeps down any real slope
    const slope = Math.sin(Math.atan(this.sx));
    if (this.parkBrake || this.cycle) this.speed *= Math.max(0, 1 - 6 * dt); else this.speed += -G * slope * 0.8 * dt;
    if (Math.abs(this.speed) < 0.03) this.speed = 0; this.thr += (0 - this.thr) * Math.min(1, dt * 4); this.brk += (0 - this.brk) * Math.min(1, dt * 4); this.steer += (0 - this.steer) * Math.min(1, dt * 1.5);
    this.regenKw = 0; this.lastA = 0; this.overspeed = false; this.skidding = false; this.brakeTemp += (20 - this.brakeTemp) * Math.min(1, dt * 0.02);
    if (this.speed !== 0) return this.advance(dt, 0); return 0;
  }
  regenKw = 0;

  /** Speed limit from the current grade, side slope, boulders and damage. */
  private limitNow(): number {
    const g = this.sx, side = Math.abs(this.sz);
    const up = g > 0.2 ? lerp(MAX_V, 2.6, clamp((g - 0.2) / 0.32, 0, 1)) : MAX_V, down = -g > 0.17 ? lerp(MAX_V, 1.8, clamp((-g - 0.17) / 0.33, 0, 1)) : MAX_V, sl = side > 0.2 ? lerp(MAX_V, 2.2, clamp((side - 0.2) / 0.35, 0, 1)) : MAX_V;
    let lim = Math.min(up, down, sl); const la = this.lookAhead;
    if (la.downG > 0.17) lim = Math.min(lim, lerp(MAX_V, 2.2, clamp((la.downG - 0.17) / 0.33, 0, 1)) + 0.7); if (la.upG > 0.2) lim = Math.min(lim, lerp(MAX_V, 3, clamp((la.upG - 0.2) / 0.32, 0, 1)) + 0.7);
    if (la.field) lim = Math.min(lim, 3.4); if (la.rockDist < 25) lim = Math.min(lim, 2.4); if (la.drop > 1.2) lim = Math.min(lim, 2.0);
    const mw = Math.min(...this.wheelHp); lim *= mw > 70 ? 1 : mw > 40 ? 0.75 : mw > 15 ? 0.45 : 0.2;
    return Math.max(0.6, lim);
  }

  private drive(dt: number, keys: Set<string>): number {
    // pedals with realistic ramps
    const w = keys.has('KeyW'), s = keys.has('KeyS'), sp = keys.has('Space'), v0 = this.speed;
    let thrT = w ? 1 : 0, brkT = sp ? 1 : 0; if (s) { if (v0 > 0.25) brkT = Math.max(brkT, 0.6); else thrT = -1; }
    if (this.parkBrake && (thrT !== 0)) { this.parkBrake = false; this.say('PARKING BRAKE RELEASED', 1.4); }
    this.thr += (thrT - this.thr) * Math.min(1, dt * (Math.abs(thrT) > Math.abs(this.thr) ? 1.1 : 3)); this.brk += (brkT - this.brk) * Math.min(1, dt * (brkT > this.brk ? 3.2 : 4));
    const dead = Math.min(...this.wheelHp) <= 0, flat = this.batteryKwh <= 0, vmax = dead || flat ? 0.25 : MAX_V;
    this.speedLimit = this.limitNow(); const lim = Math.min(this.speedLimit, vmax);
    const sinG = this.sx / Math.sqrt(1 + this.sx * this.sx), cosG = 1 / Math.sqrt(1 + this.sx * this.sx), contact = this.cl.filter((c) => c < DROOP).length / 6;
    const trac = MU * G * cosG * clamp(contact * 1.2, 0, 1) * (1 - 0.35 * Math.min(1, Math.abs(this.sz) * 2));
    // drive torque is weak at standstill and fades with speed (slow, heavy start)
    const sgn = Math.sign(this.thr) || 1, vf = Math.max(0, v0 * sgn), aMax = 0.62 * Math.pow(Math.max(0, 1 - vf / (thrT < 0 ? MAX_REV : MAX_V)), 0.8) + 0.05;
    let a = clamp(this.thr * aMax, -trac, trac) - G * sinG - 0.07 * Math.sign(v0) * Math.min(1, Math.abs(v0) * 3);
    if (this.speed > lim && this.thr > 0) a = Math.min(a, 0);                     // governor cuts the throttle at the limit
    // brakes: ABS-limited to traction, weaker when hot or damaged, assisted by regen
    const fade = 1 - 0.55 * smooth(clamp((this.brakeTemp - 420) / 330, 0, 1)), hpF = Math.max(0.25, Math.pow(this.brakeHp / 100, 0.8));
    const aBrakeMax = Math.min(trac * 0.92, 1.4) * fade * hpF; let aFric = this.brk * aBrakeMax, regen = 0;
    const hdc = v0 > lim + 0.05 ? Math.min(aBrakeMax, (v0 - lim) * 1.1 + 0.18) : 0;     // hill-descent control holds the limit
    aFric = Math.max(aFric, hdc);
    if (this.batteryKwh < CAP_KWH * 0.98) regen = (this.thr === 0 || this.brk > 0 ? Math.min(0.35, 0.18 + this.brk * 0.2) : 0) * Math.min(1, Math.abs(v0));
    const decel = aFric + regen; this.regenKw = Math.min(25, (regen * MASS * Math.abs(v0) * 0.7) / 1000);
    this.skidding = false; this.overspeed = v0 > lim + 0.4;
    let nv = v0 + a * dt; const dir = Math.sign(nv) || Math.sign(v0);
    if (decel > 0 && Math.abs(v0) > 0) { const dv = decel * dt; if (Math.abs(nv) <= dv) nv = 0; else nv -= Math.sign(nv) * dv; }
    if (this.parkBrake && this.thr === 0) nv *= Math.max(0, 1 - 5 * dt);
    nv = clamp(nv, -Math.min(MAX_REV, vmax), vmax + 3.5); // downhill can exceed the cap, which is what overspeed is
    this.lastA = (nv - v0) / dt; void dir;
    this.brakeTemp += (aFric * Math.abs(v0) * 16 - (this.brakeTemp - 20) * 0.022) * dt;
    if (this.brakeTemp > 650) this.hurt('brakes', (this.brakeTemp - 650) * 0.012 * dt * 10);
    this.speed = nv;
    // steering: rate limited, authority falls with speed, cornering limited by (weak) traction
    const want = ((keys.has('KeyA') ? 1 : 0) - (keys.has('KeyD') ? 1 : 0)) * 0.56 / Math.sqrt(1 + (Math.abs(this.speed) / 3.2) ** 2);
    const rate = want === 0 ? 1.2 : 0.8; this.steer += clamp(want - this.steer, -rate * dt, rate * dt);
    let yaw = (this.speed * Math.tan(this.steer)) / WHEELBASE; const aLatMax = MU * G * cosG * 0.85 * clamp(contact * 1.2, 0, 1), aLat = Math.abs(yaw * this.speed);
    if (aLat > aLatMax && Math.abs(this.speed) > 0.5) { yaw = Math.sign(yaw) * aLatMax / Math.abs(this.speed); this.skidding = true; if (Math.abs(this.speed) > 2.6) { const out = yaw > 0 ? 1 : 0; for (const i of [2 + out, 4 + out, 0 + out]) this.hurt('wheel', (aLat - aLatMax) * 3.2 * dt, i); } }
    const pull = this.wheelHp.reduce((acc, h, i) => acc + (i % 2 === 0 ? -1 : 1) * (100 - h) / 100, 0) * 0.012 * this.speed; yaw += pull;
    return this.advance(dt, yaw);
  }

  /** Move and collide; returns the heading change. */
  private advance(dt: number, yaw: number): number {
    const nh = this.heading + yaw * dt, c = Math.cos(nh), s = Math.sin(nh), nx = this.x + c * this.speed * dt, nz = this.z - s * this.speed * dt;
    let hit: 'front' | 'rear' | 'side' | null = null; const sign = this.speed >= 0 ? 1 : -1;
    if (Math.abs(nx) > 270 || Math.abs(nz) > 270) hit = sign > 0 ? 'front' : 'rear';
    if (!hit) for (const lx of [4.6, 2.4, 0.2, -2.0, -4.6]) { if (this.solid(nx + lx * c, nz - lx * s, 2.15)) { hit = lx > 2 ? 'front' : lx < -1.5 ? 'rear' : 'side'; break; } }
    if (!hit) for (const w of this.m.wheels) { const wx = nx + w.x * c + w.side * TRACK * s, wz = nz - w.x * s + w.side * TRACK * c; if (rockTop(wx + c * 0.5 * sign, wz - s * 0.5 * sign) > 0.74) { hit = sign > 0 ? 'front' : 'rear'; break; } }
    if (!hit) for (const lx of [4.4, 2.2, 0, -2.2, -4.4]) for (const lat of [-1.0, 0, 1.0]) { // rocks that would strike the belly (ground clearance about 0.65 m)
      if (rockTop(nx + c * lx * 1 + s * lat, nz - s * lx + c * lat) > 0.62) { hit = sign > 0 ? 'front' : 'rear'; break; }
    }
    if (!hit && Math.abs(this.sx) > 0.58 && Math.sign(this.sx) === Math.sign(this.speed)) hit = null, this.speed = 0, this.say('TOO STEEP · CANNOT CLIMB THIS SLOPE', 1.5);
    if (!hit && Math.abs(this.roll) > 0.8) { this.speed = 0; this.say('ROLLOVER LIMIT · BACK AWAY', 1.5); return 0; }
    if (hit) { const v = Math.abs(this.speed); this.crash(v, hit); this.speed = 0; this.stuck = 0.3; return 0; }
    this.x = nx; this.z = nz; this.heading = nh; return yaw * dt;
  }

  // ---------- wheel contact, suspension and body dynamics ----------
  private contacts(): number[] {
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    return this.m.wheels.map((w) => { const wx = this.x + w.x * c + w.side * TRACK * s, wz = this.z - w.x * s + w.side * TRACK * c, f = this.speed >= 0 ? 1 : -1; return heightAt(wx, wz) + Math.max(rockTop(wx, wz), 0.8 * rockTop(wx + c * 0.45 * f, wz - s * 0.45 * f), 0.8 * rockTop(wx - c * 0.45 * f, wz + s * 0.45 * f)); });
  }
  private fitPlane(hs: number[], snap: boolean) {
    const ws = this.m.wheels, avg = (f: (i: number) => boolean) => { let t = 0, n = 0; hs.forEach((h, i) => { if (f(i)) { t += h; n++; } }); return t / Math.max(1, n); };
    const hF = avg((i) => ws[i].x === AXLES[0]), hR = avg((i) => ws[i].x === AXLES[2]), hP = avg((i) => ws[i].side < 0), hS = avg((i) => ws[i].side > 0);
    if (snap) { this.sx = (hF - hR) / (AXLES[0] - AXLES[2]); this.sz = (hS - hP) / (2 * TRACK); this.B = avg(() => true) + 0.0245; this.vB = 0; this.vsx = 0; this.vsz = 0; }
  }
  private suspension(dt: number) {
    const ws = this.m.wheels, hs = this.contacts(), v = Math.abs(this.speed), up = 1.4 + 1.0 * v, down = 1.6;
    // wheels cannot jump onto a step instantly: ground height follows with a limited rate
    const hcdot: number[] = [];
    hs.forEach((h, i) => { const prev = this.hcs[i]; this.hcs[i] = prev + clamp(h - prev, -down * dt, up * dt); hcdot.push(clamp((this.hcs[i] - prev) / Math.max(dt, 1e-4), -3, 3)); });
    const e0 = G / (6 * K_SPR), n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n, dampF = (i: number) => C_DAMP * (0.5 + this.wheelHp[i] / 200);
    let peak = 0, maxBump = 0;
    for (let k = 0; k < n; k++) {
      let sumA = 0, aP = 0, aR = 0;
      ws.forEach((w, i) => {
        const P = this.B + this.sx * (w.x - XC) + this.sz * w.side * TRACK, c = P - this.hcs[i], cdot = this.vB + this.vsx * (w.x - XC) + this.vsz * w.side * TRACK - hcdot[i], e = -c;
        this.cl[i] = c; let a = 0;
        if (c < DROOP) {
          a = K_SPR * (e + e0) + dampF(i) * -cdot;
          if (e > TMAX) { a += 420 * (e - TMAX) + 8 * Math.max(0, -cdot); maxBump = Math.max(maxBump, Math.max(0, -cdot)); this.impactV[i] = Math.max(this.impactV[i] ?? 0, Math.max(0, -cdot)); }
          a = Math.max(0, a); peak = Math.max(peak, Math.abs(a - G / 6));
        }
        sumA += a; aP += a * (w.x - XC); aR += a * w.side * TRACK;
      });
      this.vB = clamp(this.vB + (-G + sumA) * h, -8, 5); this.B += this.vB * h;
      this.vsx = clamp(this.vsx + (aP / (RHO_P * RHO_P)) * h, -3, 3); this.vsz = clamp(this.vsz + (aR / (RHO_R * RHO_R)) * h, -3, 3); this.vsx *= 1 - 0.9 * h; this.vsz *= 1 - 0.9 * h;
      this.sx += this.vsx * h; this.sz += this.vsz * h;
    }
    this.sx = clamp(this.sx, -0.9, 0.9); this.sz = clamp(this.sz, -0.9, 0.9);
    this.pitch = Math.atan(this.sx); this.roll = -Math.atan(this.sz);
    this.shake = Math.max(this.shake, clamp(peak * 0.06 * Math.min(1, v / 2 + 0.2), 0, 0.9));
    // impacts that hit the bump stops hurt the suspension and tyres
    ws.forEach((_, i) => { const iv = this.impactV[i] ?? 0; if (iv > 1.55) { this.hurt('wheel', (iv - 1.55) * 16, i); this.shake = Math.min(1, 0.35 + iv * 0.15); if (iv > 2.4) { this.say(`HARD IMPACT · ${this.m.wheels[i].name}`, 2); beep('warn'); } } this.impactV[i] = 0; });
    if (maxBump > 1.55 && this.bodyHp > 0) this.hurt('body', (maxBump - 1.55) * 2.5);
    ws.forEach((_, i) => { this.hubY[i] = clamp(WHEEL_R - this.cl[i], WHEEL_R - DROOP, WHEEL_R + TMAX); });
  }
  private impactV: number[] = [];

  // ---------- look-ahead terrain warnings ----------
  private scanTerrain() {
    this.warnings = []; const ws: Warn[] = this.warnings;
    if (this.mode !== 'driving') { this.lookAhead = { upG: 0, downG: 0, drop: 0, rockDist: 99, field: false }; return; }
    const c = Math.cos(this.heading), s = Math.sin(this.heading), f = this.speed >= -0.1 ? 1 : -1, hAt = (d: number, lat = 0) => { const x = this.x + c * d * f - s * lat * 0, z = this.z - s * d * f + c * lat * 0; return heightAt(x, z); };
    let upG = 0, downG = 0, drop = 0, prev = hAt(0); const pts: number[] = [prev];
    for (let d = 4; d <= 32; d += 4) { const h = hAt(d), g = (h - prev) / 4; if (g > upG) upG = g; if (-g > downG) downG = -g; drop = Math.max(drop, prev - h); prev = h; pts.push(h); }
    let rockDist = 99; for (let d = 3; d <= 26; d += 2) { for (const lat of [-1.6, 0, 1.6]) { const x = this.x + c * d * f - s * lat, z = this.z - s * d * f + c * lat; if (rockTop(x, z) > 0.72) { rockDist = Math.min(rockDist, d); } } }
    const fx = this.x + c * 14 * f, fz = this.z - s * 14 * f, field = bigRocksNear(fx, fz, 10, 0.5) >= 2;
    this.lookAhead = { upG, downG, drop, rockDist, field };
    const deg = (g: number) => D.radToDeg(Math.atan(g)).toFixed(0), curG = this.sx * (this.speed >= 0 ? 1 : -1);
    if (this.overspeed) ws.push({ text: `OVERSPEED · LIMIT ${(this.speedLimit * 3.6).toFixed(0)} km/h`, level: 'bad' });
    if (drop > 1.2) ws.push({ text: `DROP-OFF AHEAD ${drop.toFixed(1)} m`, level: 'bad' });
    if (rockDist < 99) ws.push({ text: `IMPASSABLE BOULDER ${rockDist.toFixed(0)} m AHEAD`, level: 'bad' });
    if (downG > 0.17) ws.push({ text: `STEEP DESCENT AHEAD ${deg(downG)}°`, level: downG > 0.36 ? 'bad' : 'warn' });
    if (upG > 0.2) ws.push({ text: `STEEP INCLINE AHEAD ${deg(upG)}°`, level: upG > 0.4 ? 'bad' : 'warn' });
    if (Math.abs(this.sz) > 0.2) ws.push({ text: `SIDE SLOPE ${deg(Math.abs(this.sz))}° · ROLLOVER RISK`, level: Math.abs(this.sz) > 0.4 ? 'bad' : 'warn' });
    if (field) ws.push({ text: 'BOULDER FIELD AHEAD', level: 'warn' });
    if (curG > 0.2) ws.push({ text: `CLIMBING ${deg(curG)}°`, level: 'warn' }); else if (curG < -0.17) ws.push({ text: `DESCENDING ${deg(-curG)}° · HILL DESCENT CONTROL`, level: 'warn' });
    if (this.skidding) ws.push({ text: 'WHEELS SLIDING · EASE THE STEERING', level: 'bad' });
    if (this.brakeTemp > 420) ws.push({ text: `BRAKES HOT ${this.brakeTemp.toFixed(0)}°C · FADE`, level: this.brakeTemp > 600 ? 'bad' : 'warn' });
    if (Math.min(...this.wheelHp) < 60) ws.push({ text: `${this.worst.name} DAMAGED · REDUCED SPEED`, level: 'bad' });
    ws.sort((a, b) => (a.level === b.level ? 0 : a.level === 'bad' ? -1 : 1));
  }
  private lastWarnKey = '';
  private alarms(dt: number) {
    this.beepT -= dt; const top = this.warnings[0]; if (!top || this.mode !== 'driving') { this.lastWarnKey = ''; return; }
    if (top.text !== this.lastWarnKey && this.beepT <= 0) { beep('warn'); this.beepT = 1.4; } this.lastWarnKey = top.text;
    if (this.overspeed && this.beepT <= 0) { beep('warn'); this.beepT = 1.2; }
  }

  // ---------- gaze-based prompts ----------
  private pickPrompt(ctx: { player: THREE.Vector3; look: THREE.Vector3 }, habD: number) {
    const cands: Cand[] = [], W = (l: THREE.Vector3) => this.toWorld(l, new THREE.Vector3()), an = this.m.anchors;
    if (!this.busy) {
      if (this.mode === 'out') {
        cands.push({ a: W(an.hatchOut), reach: 3.6, cone: 0.84, text: '[E] OPEN HATCH AND ENTER THE ROVER', run: () => this.startCycle('enter') });
        const targets: { i: number; a: THREE.Vector3 }[] = [...this.m.wheels.map((w, i) => ({ i, a: w.anchor })), { i: 6, a: an.bumper }, { i: 7, a: an.windscreen }, { i: 8, a: an.dish }, { i: 10, a: an.bumper }];
        for (const t of targets) { const hp = this.partHp(t.i); if (hp < 90) cands.push({ a: W(t.a), reach: 3.6, cone: 0.88, text: `[E] REPAIR ${this.partName(t.i)} (${hp.toFixed(0)}%) · ${this.kits} KIT${this.kits === 1 ? '' : 'S'}`, run: () => this.startCycle('repair', t.i) }); }
        const lh = Math.min(...this.lampHp); if (lh < 90) cands.push({ a: W(an.bumper), reach: 3.6, cone: 0.88, text: `[E] REPAIR HEADLAMPS (${lh.toFixed(0)}%) · ${this.kits} KITS`, run: () => this.startCycle('repair', 9) });
      } else if (this.mode === 'cabin') {
        cands.push({ a: W(an.hatchIn), reach: 2.6, cone: 0.86, text: '[E] EXIT THE ROVER (NEEDS A SEALED EVA SUIT)', run: () => this.startCycle('exit') });
        cands.push({ a: W(an.seat), reach: 2.8, cone: 0.9, text: "[E] TAKE THE DRIVER'S SEAT", run: () => { this.mode = 'driving'; this.say('WASD DRIVE · SPACE BRAKE · X PARKING BRAKE · L LAMPS · R RADIO', 5); return ''; } });
        cands.push({ a: W(an.radio), reach: 2.4, cone: 0.92, text: '[E] ROVER RADIO (HAB + EARTH RELAY)', run: () => { this.onRadio?.(); return ''; } });
        cands.push({ a: W(an.locker), reach: 2.4, cone: 0.92, text: habD < CHARGE_R ? `[E] RESTOCK REPAIR KITS (${this.kits}/${KITS_MAX}) FROM HAB SPARES` : `REPAIR KITS ${this.kits}/${KITS_MAX} · RESTOCK AT THE HAB`, run: () => (habD < CHARGE_R ? (this.kits >= KITS_MAX ? 'LOCKER IS FULL' : this.startCycle('restock')) : 'PARK WITHIN 13 m OF THE HAB TO RESTOCK') });
      } else if (this.mode === 'driving' && Math.abs(this.speed) < 0.3) {
        cands.push({ a: W(an.seat), reach: 9, cone: -1, text: '[E] LEAVE THE SEAT', run: () => { this.mode = 'cabin'; this.parkBrake = true; this.cabin.set(2.75, -0.2); this.say('PARKING BRAKE ON'); return ''; } });
      }
    }
    let best: Cand | null = null, bd = -2; const dir = new THREE.Vector3();
    for (const c of cands) { dir.subVectors(c.a, ctx.player); const d = dir.length(); if (d > c.reach) continue; const dot = dir.normalize().dot(ctx.look); if (dot > c.cone && dot > bd) { best = c; bd = dot; } }
    this.best = best; this.prompt = best ? best.text : '';
  }

  // ---------- visuals ----------
  private animate(dt: number) {
    const r = this.m.root; r.position.set(this.x, this.B - 0.0245, this.z); r.rotation.set(this.roll, this.heading, this.pitch, 'YZX'); r.updateMatrixWorld(true);
    // view tilt for the driver: the rover's pitch and roll about horizontal axes fixed to its heading
    const yq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.heading), tq = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.roll, 0, this.pitch, 'ZXY'));
    this.tiltQ.copy(yq).multiply(tq).multiply(yq.clone().invert());
    const km = this.speed, d = (i: number) => clamp((100 - this.wheelHp[i]) / 100, 0, 1), hot = clamp((this.brakeTemp - 250) / 450, 0, 1);
    this.m.wheels.forEach((w, i) => {
      w.hub.position.y = this.hubY[i]; w.links(this.hubY[i]); w.spin.rotation.z -= (km * dt) / WHEEL_R;
      w.steer.rotation.y = w.front ? this.steer : w.x === AXLES[2] ? -this.steer * 0.4 : 0;
      const dm = d(i); w.spin.scale.y = 1 - 0.2 * dm; w.hub.rotation.x = w.side * 0.16 * dm; w.spin.rotation.x = Math.sin(this.time * Math.abs(km) * 2.2) * 0.05 * dm * Math.min(1, Math.abs(km));
      w.rotor.emissiveIntensity = hot * (w.front ? 1.7 : 1.2);
    });
    // door: fixed-rate swing so it ends exactly open or exactly shut
    this.hatchK = clamp(this.hatchK + Math.sign(this.hatchTarget - this.hatchK) * dt * 0.6, Math.min(this.hatchTarget, this.hatchK), Math.max(this.hatchTarget, this.hatchK));
    this.m.hatch.rotation.y = -1.55 * smooth(this.hatchK); if (this.mode === 'out' && !this.cycle && this.hatchTarget === 1 && !this.nearPlayer) this.hatchTarget = 0;
    // controls follow the inputs
    const A = (a: number, b: number, k = 10) => a + (b - a) * Math.min(1, dt * k);
    this.m.stick.rotation.z = A(this.m.stick.rotation.z, -(this.thr - this.brk * 0.8) * 0.3); this.m.stick.rotation.x = A(this.m.stick.rotation.x, -this.steer * 0.9);
    this.m.thrLever.rotation.z = A(this.m.thrLever.rotation.z, -Math.max(0, this.thr) * 0.5, 8); this.m.pedalT.rotation.z = A(this.m.pedalT.rotation.z, -0.35 * Math.max(0, this.thr), 12); this.m.pedalB.rotation.z = A(this.m.pedalB.rotation.z, -0.4 * this.brk, 12);
    this.m.parkLever.rotation.z = A(this.m.parkLever.rotation.z, this.parkBrake ? 0.5 : -0.2, 6);
    const blink = Math.sin(this.time * 9) > 0 ? 1 : 0.15, I = this.m.ind, inRover = this.inside;
    I.park.emissiveIntensity = inRover && this.parkBrake ? 1.8 : 0; I.abs.emissiveIntensity = this.brk > 0.5 && Math.abs(this.speed) > 0.6 ? 1.8 : 0; I.over.emissiveIntensity = this.overspeed ? 2 * blink : 0;
    I.dmg.emissiveIntensity = this.worst.hp < 90 && inRover ? 1.8 * (this.worst.hp < 40 ? blink : 1) : 0; I.lamps.emissiveIntensity = this.lights ? 1.6 : 0; I.link.emissiveIntensity = inRover && this.link.up ? 1.4 : 0;
    // lamps, cracks, dents, bumper, dish
    this.m.lamps.mat.forEach((mt, i) => { const hp = this.lampHp[i]; mt.emissiveIntensity = (this.lights ? 2.6 : 0.12) * (hp > 60 ? 1 : hp > 25 ? (Math.sin(this.time * 17 + i) > -0.2 ? 0.6 : 0.05) : 0); });
    this.spot.intensity = this.lights ? 520 * ((this.lampHp[0] + this.lampHp[1]) / 200) : 0;
    this.m.cracks.forEach((m, i) => { m.visible = this.glassHp < [80, 55, 30][i] || (this.glassHp < 80 && i === 1 && this.glassHp < 80); });
    this.m.bumper.position.x = -0.2 * this.frontDmg; this.m.bumper.rotation.z = 0.12 * this.frontDmg; this.m.bumper.rotation.y = 0.1 * this.frontDmg;
    this.m.dishG.rotation.z = 0.28 * (1 - this.dishHp / 100); this.m.dishG.rotation.x = -0.2 * (1 - this.dishHp / 100);
    this.m.cabLight.intensity = inRover ? 7 : 0;
    this.particles(dt);
  }
  private get nearPlayer() { return Math.hypot(this.lastPlayer.x - this.x, this.lastPlayer.z - this.z) < 8; }

  private particles(dt: number) {
    const c = Math.cos(this.heading), s = Math.sin(this.heading), sp = Math.abs(this.speed), moving = sp > 0.8;
    // sparks from broken wheels, coolant jets from failed brakes or wheel units (ballistic, since there is no air)
    this.m.wheels.forEach((w, i) => {
      const wx = this.x + w.x * c + w.side * TRACK * s, wz = this.z - w.x * s + w.side * TRACK * c, base = heightAt(wx, wz);
      if (this.wheelHp[i] < 45 && moving && Math.random() < 0.5) emit(this.fx, wx, base + 0.15, wz, (Math.random() - 0.5) * 2, 1 + Math.random() * 2, (Math.random() - 0.5) * 2, 0.8 + Math.random() * 0.6, 1, 0.55, 0.12);
      if ((this.wheelHp[i] < 20 || this.brakeHp < 30) && Math.random() < 0.25) emit(this.fx, wx, base + 0.5, wz, w.side * (1 + Math.random() * 1.5), 1.5 + Math.random() * 2, (Math.random() - 0.5), 1.4 + Math.random(), 0.88, 0.94, 1);
    });
    stepPool(this.fx, dt);
  }

  private drawScreens() {
    const [s0, s1, s2] = this.m.screens, pct = (this.batteryKwh / CAP_KWH) * 100, kmh = Math.abs(this.speed * 3.6), lim = this.speedLimit * 3.6;
    const frame = (g: CanvasRenderingContext2D, title: string, col = '#ffb000') => { g.fillStyle = '#04141c'; g.fillRect(0, 0, 256, 160); g.strokeStyle = 'rgba(79,216,255,.45)'; g.lineWidth = 1; g.strokeRect(1.5, 1.5, 253, 157); g.fillStyle = col; g.font = '600 11px monospace'; g.textAlign = 'left'; g.fillText(title, 8, 15); };
    const bar = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, f: number, col: string) => { g.fillStyle = 'rgba(255,255,255,.1)'; g.fillRect(x, y, w, h); g.fillStyle = col; g.fillRect(x, y, w * clamp(f, 0, 1), h); };
    // DRIVE: speed arc with limit tick, heading, attitude, pedals
    { const g = s0.g; frame(g, 'DRIVE'); const cx = 78, cy = 96, R = 56; g.lineWidth = 7; g.strokeStyle = 'rgba(255,255,255,.12)'; g.beginPath(); g.arc(cx, cy, R, Math.PI * 0.8, Math.PI * 2.2); g.stroke();
      g.strokeStyle = this.overspeed ? '#ff5a5a' : '#4fd8ff'; g.beginPath(); g.arc(cx, cy, R, Math.PI * 0.8, Math.PI * (0.8 + 1.4 * clamp(kmh / 28, 0, 1))); g.stroke();
      const la = Math.PI * (0.8 + 1.4 * clamp(lim / 28, 0, 1)); g.strokeStyle = '#ffb000'; g.lineWidth = 3; g.beginPath(); g.moveTo(cx + Math.cos(la) * (R - 8), cy + Math.sin(la) * (R - 8)); g.lineTo(cx + Math.cos(la) * (R + 7), cy + Math.sin(la) * (R + 7)); g.stroke();
      g.fillStyle = this.overspeed ? '#ff5a5a' : '#4fd8ff'; g.font = 'bold 34px monospace'; g.textAlign = 'center'; g.fillText(kmh.toFixed(1), cx, cy + 6); g.font = '11px monospace'; g.fillText('KM/H', cx, cy + 22); g.fillStyle = '#ffb000'; g.fillText(`LIMIT ${lim.toFixed(0)}`, cx, cy + 40);
      g.textAlign = 'left'; g.fillStyle = '#4fd8ff'; g.font = '12px monospace'; g.fillText(`HDG ${String(Math.round((((90 - D.radToDeg(this.heading)) % 360) + 360) % 360)).padStart(3, '0')}`, 150, 40);
      const ax = 200, ay = 80, ar = 30; g.save(); g.beginPath(); g.arc(ax, ay, ar, 0, 7); g.clip(); g.translate(ax, ay); g.rotate(this.roll); g.fillStyle = '#12395a'; g.fillRect(-ar, -ar * 2 + this.pitch * 90, ar * 2, ar * 2); g.fillStyle = '#5a4630'; g.fillRect(-ar, this.pitch * 90, ar * 2, ar * 2); g.restore();
      g.strokeStyle = '#ffb000'; g.lineWidth = 2; g.beginPath(); g.moveTo(ax - 14, ay); g.lineTo(ax + 14, ay); g.stroke(); g.strokeStyle = 'rgba(79,216,255,.6)'; g.lineWidth = 1.5; g.beginPath(); g.arc(ax, ay, ar, 0, 7); g.stroke();
      g.fillStyle = '#9fb3c4'; g.font = '10px monospace'; g.fillText(`P ${D.radToDeg(this.pitch).toFixed(0)}° R ${D.radToDeg(this.roll).toFixed(0)}°`, 168, 122); g.fillText('THR', 150, 142); bar(g, 172, 134, 70, 6, Math.max(0, this.thr), '#4fd8ff'); g.fillText('BRK', 150, 154); bar(g, 172, 146, 70, 6, this.brk, '#ff7a5a'); }
    s0.t.needsUpdate = true;
    // POWER / BRAKES
    { const g = s1.g; frame(g, 'POWER / BRAKES'); g.textAlign = 'left'; g.fillStyle = pct < 15 ? '#ff5a5a' : '#4fd8ff'; g.font = 'bold 34px monospace'; g.fillText(`${pct.toFixed(0)}%`, 12, 54); bar(g, 12, 62, 110, 7, pct / 100, pct < 15 ? '#ff5a5a' : '#4fd8ff');
      g.font = '11px monospace'; g.fillStyle = '#9fb3c4'; g.fillText(`LOAD ${this.drawKw.toFixed(1)} kW`, 12, 86); g.fillStyle = this.regenKw > 0.3 ? '#7ee787' : '#9fb3c4'; g.fillText(`REGEN ${this.regenKw.toFixed(1)} kW`, 12, 100); g.fillStyle = '#9fb3c4'; g.fillText(this.charging ? 'CHARGING FROM HAB' : this.lights ? 'LAMPS ON' : 'LAMPS OFF', 12, 114);
      g.fillText('BRAKE TEMP', 138, 40); g.font = 'bold 20px monospace'; g.fillStyle = this.brakeTemp > 600 ? '#ff5a5a' : this.brakeTemp > 400 ? '#ffb000' : '#4fd8ff'; g.fillText(`${this.brakeTemp.toFixed(0)}°C`, 138, 62); bar(g, 138, 68, 106, 7, (this.brakeTemp - 20) / 700, this.brakeTemp > 600 ? '#ff5a5a' : this.brakeTemp > 400 ? '#ffb000' : '#4fd8ff');
      g.font = '11px monospace'; g.fillStyle = this.parkBrake ? '#ff7a5a' : '#9fb3c4'; g.fillText(this.parkBrake ? 'PARK BRAKE ON' : 'PARK BRAKE OFF', 138, 92); g.fillStyle = '#9fb3c4'; g.fillText(`BRAKES ${this.brakeHp.toFixed(0)}%`, 138, 106); g.fillText(`KITS ${this.kits}/${KITS_MAX}`, 138, 120); g.fillText(`RANGE ${kmh > 0.5 ? ((this.batteryKwh / Math.max(1, this.drawKw)) * kmh).toFixed(0) : '--'} km`, 12, 134); }
    s1.t.needsUpdate = true;
    // WARNINGS / NAV
    { const g = s2.g, w = this.worst; frame(g, 'ALERTS / NAV'); g.textAlign = 'left'; g.font = '11px monospace';
      const list = this.warnings.slice(0, 4); if (!list.length) { g.fillStyle = '#7ee787'; g.fillText('NO ACTIVE ALERTS', 10, 36); } list.forEach((a, i) => { g.fillStyle = a.level === 'bad' ? '#ff5a5a' : '#ffb000'; g.fillText(`▲ ${a.text}`.slice(0, 34), 10, 36 + i * 15); });
      g.fillStyle = '#4fd8ff'; g.fillText(`HAB ${(this.link.dist / 1000).toFixed(2)} km`, 10, 108); g.fillStyle = this.link.up ? '#4fd8ff' : '#ff5a5a'; g.fillText(this.link.up ? 'UHF UP · EARTH VIA HAB' : 'NO UHF LINK', 10, 122);
      g.fillStyle = w.hp < 90 ? (w.hp < 40 ? '#ff5a5a' : '#ffb000') : '#7ee787'; g.fillText(w.hp < 90 ? `REPAIR: ${w.name} ${w.hp.toFixed(0)}%`.slice(0, 36) : 'ALL SYSTEMS NOMINAL', 10, 140); }
    s2.t.needsUpdate = true;
    const g3 = this.m.radioScr.g; g3.fillStyle = '#04141c'; g3.fillRect(0, 0, 256, 160); g3.strokeStyle = 'rgba(79,216,255,.45)'; g3.lineWidth = 1; g3.strokeRect(1.5, 1.5, 253, 157);
    g3.textAlign = 'left'; g3.fillStyle = '#ffb000'; g3.font = '600 11px monospace'; g3.fillText('ROVER RADIO', 8, 15); g3.font = '14px monospace'; g3.fillStyle = this.link.up ? '#4fd8ff' : '#ff5a5a'; g3.fillText(this.link.up ? 'UHF  HAB  LINKED' : 'UHF  NO LINK', 10, 48);
    g3.fillStyle = '#4fd8ff'; g3.fillText('EARTH  VIA HAB RELAY', 10, 74); g3.fillText(`DIST ${(this.link.dist / 1000).toFixed(2)} KM`, 10, 100); g3.fillStyle = '#9fb3c4'; g3.font = '11px monospace'; g3.fillText('FACE THIS PANEL + E', 10, 140); this.m.radioScr.t.needsUpdate = true;
  }
}

// ---------- small particle pools ----------
type Pool = { p: THREE.Points; pos: Float32Array; col: Float32Array; vel: Float32Array; life: Float32Array; n: number; head: number };
function makePool(scene: THREE.Scene, n: number, o: { color?: number; size: number; opacity: number; colors?: boolean }): Pool {
  const pos = new Float32Array(n * 3).fill(-1e5), col = new Float32Array(n * 3).fill(1), g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ color: o.color ?? 0xffffff, size: o.size, transparent: true, opacity: o.opacity, depthWrite: false, vertexColors: !!o.colors })); p.frustumCulled = false; scene.add(p);
  return { p, pos, col, vel: new Float32Array(n * 3), life: new Float32Array(n), n, head: 0 };
}
function emit(pl: Pool, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, r: number, g: number, b: number) {
  const i = pl.head; pl.head = (pl.head + 1) % pl.n; pl.pos.set([x, y, z], i * 3); pl.vel.set([vx, vy, vz], i * 3); pl.life[i] = life; pl.col.set([r, g, b], i * 3);
}
function stepPool(pl: Pool, dt: number) {
  for (let i = 0; i < pl.n; i++) {
    if (pl.life[i] <= 0) { pl.pos[i * 3 + 1] = -1e5; continue; }
    pl.life[i] -= dt; pl.vel[i * 3 + 1] -= 1.62 * dt; pl.pos[i * 3] += pl.vel[i * 3] * dt; pl.pos[i * 3 + 1] += pl.vel[i * 3 + 1] * dt; pl.pos[i * 3 + 2] += pl.vel[i * 3 + 2] * dt;
    if (pl.pos[i * 3 + 1] < heightAt(pl.pos[i * 3], pl.pos[i * 3 + 2])) pl.life[i] = 0;
  }
  (pl.p.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true; (pl.p.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
}
