import * as THREE from 'three';
import { buildRoverModel, WHEEL_R, TRACK, AXLES, FLOOR_Y, AISLE, HATCH, RADIO, SEAT_EYE, type RoverModel } from './roverModel';
import { heightAt, lineOfSight } from './terrain';
import type { Sim } from './sim';

// The pressurised rover: walk up to the port hatch, cycle in, walk the cabin, take the driver's seat and drive.
// Battery, wheel-by-wheel terrain following, ballistic dust, headlamps and a UHF radio link back to the Hab.
const CAP_KWH = 90, HOTEL_KW = 1.1, LAMP_KW = 0.4, MAX_V = 6, MAX_REV = 2.5, WHEELBASE = 5.4, CHARGE_KW = 6, CHARGE_R = 13, UHF_RANGE = 20000;
const D = THREE.MathUtils;
export type RoverMode = 'out' | 'cabin' | 'driving';
type Item = { x: number; z: number; reach: number; text: () => string; run: () => string };
export type RoverTele = { present: true; mode: RoverMode; batteryPct: number; speedKph: number; distM: number; headingDeg: number; linkUp: boolean };

export class Rover {
  mode: RoverMode = 'out';
  x = 3; z = 11.8; heading = 0; speed = 0; steer = 0; batteryKwh = CAP_KWH * 0.9; lights = false;
  prompt = ''; toast = ''; busy = false; taskLabel = ''; taskProgress = 0; drawKw = 0; charging = false;
  onRadio: (() => void) | null = null;
  private m: RoverModel; private cabin = new THREE.Vector2(2.35, -1.0); private items: Item[] = []; private best: Item | null = null;
  private pitch = 0; private roll = 0; private baseY = 0; private slopeX = 0; private slopeZ = 0; private hubY: number[] = [];
  private cycle: { t: number; total: number; kind: 'enter' | 'exit'; stage: number } | null = null; private hatchK = 0; private hatchTarget = 0; private toastT = 0; private scrT = 0;
  private spot: THREE.SpotLight; private dust: { p: THREE.Points; pos: Float32Array; vel: Float32Array; life: Float32Array; n: number; head: number };
  private link = { up: false, dist: 0, los: false, reason: 'NOT CHECKED' }; private linkT = 0;
  private tmp = new THREE.Vector3(); private ant = new THREE.Vector3();

  constructor(scene: THREE.Scene, private solid: (x: number, z: number, r: number) => boolean, private habAnt: () => THREE.Vector3) {
    this.m = buildRoverModel(); scene.add(this.m.root);
    this.spot = new THREE.SpotLight(0xfff4e0, 0, 80, 0.55, 0.6, 1.4); this.spot.position.set(5.0, 2.2, 0); this.spot.target.position.set(40, 0.5, 0); this.m.root.add(this.spot, this.spot.target);
    const n = 160; this.dust = { n, head: 0, pos: new Float32Array(n * 3).fill(-1e5), vel: new Float32Array(n * 3), life: new Float32Array(n), p: new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0x8a857c, size: 0.14, transparent: true, opacity: 0.85, depthWrite: false })) };
    this.dust.p.geometry.setAttribute('position', new THREE.BufferAttribute(this.dust.pos, 3)); this.dust.p.frustumCulled = false; scene.add(this.dust.p);
    this.hubY = this.m.wheels.map(() => WHEEL_R); this.pose(0, true);

  }

  // ---------- frames ----------
  private toWorld(lx: number, ly: number, lz: number, out = new THREE.Vector3()) { return out.set(lx, ly, lz).applyMatrix4(this.m.root.matrixWorld); }
  private worldXZ(lx: number, lz: number) { const c = Math.cos(this.heading), s = Math.sin(this.heading); return [this.x + lx * c + lz * s, this.z - lx * s + lz * c] as const; }
  get inside() { return this.mode !== 'out'; }
  get hasPrompt() { return !!this.prompt; }

  /** Rectangle the player cannot walk through while outside the rover. */
  blocks(x: number, z: number) {
    if (this.mode !== 'out') return false;
    const c = Math.cos(this.heading), s = Math.sin(this.heading), dx = x - this.x, dz = z - this.z, lx = dx * c - dz * s, lz = dx * s + dz * c;
    return lx > -5.5 && lx < 5.3 && Math.abs(lz) < 2.45;
  }
  /** Camera position for cabin/driving. */
  cameraPos(out: THREE.Vector3) {
    if (this.mode === 'driving') return this.toWorld(SEAT_EYE.x, SEAT_EYE.y, SEAT_EYE.z, out);
    return this.toWorld(this.cabin.x, FLOOR_Y + 0.06 + 1.62, this.cabin.y, out);
  }
  walk(dx: number, dz: number) {
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    this.cabin.x = D.clamp(this.cabin.x + dx * c - dz * s, AISLE.x0, AISLE.x1); this.cabin.y = D.clamp(this.cabin.y + dx * s + dz * c, AISLE.z0, AISLE.z1);
  }
  press() { if (this.best) { const t = this.best.run(); if (t) { this.toast = t; this.toastT = 3; } } }
  toggleLights() { this.lights = !this.lights; this.toast = this.lights ? 'HEADLAMPS ON' : 'HEADLAMPS OFF'; this.toastT = 1.5; }

  // ---------- hatch cycle ----------
  private startCycle(kind: 'enter' | 'exit'): string {
    if (this.busy) return 'HATCH CYCLE IN PROGRESS';
    if (kind === 'exit' && !this.suitOk) return 'EXIT REFUSED: EVA SUIT NOT SEALED. DON ONE AT THE HAB RACK';
    this.cycle = { t: 0, total: kind === 'enter' ? 7 : 8, kind, stage: -1 }; this.busy = true; return '';
  }
  private suitOk = false;
  private stepCycle(dt: number, sim: Sim) {
    const c = this.cycle!; c.t += dt; const f = Math.min(1, c.t / c.total);
    const stages = c.kind === 'enter'
      ? ['OPENING OUTER HATCH', 'STEPPING INTO THE AIRLOCK VESTIBULE', 'CLOSING HATCH', 'REPRESSURISING TO 101 kPA', 'EQUALISING, CHECKING SEALS']
      : ['CLOSING CABIN DOOR, SEALING SUIT', 'PUMPING CABIN AIR TO STORAGE', 'VESTIBULE AT VACUUM', 'OPENING OUTER HATCH'];
    const st = Math.min(stages.length - 1, Math.floor(f * stages.length)); this.taskProgress = f; this.taskLabel = `ROVER HATCH · ${stages[st]}`;
    if (st !== c.stage) {
      c.stage = st;
      if (c.kind === 'enter') { if (st === 0) this.hatchTarget = 1; if (st === 2) { this.mode = 'cabin'; this.cabin.set(2.35, -1.0); } if (st === 2) this.hatchTarget = 0; if (st === 3) sim.spend(0.2, 0.2); }
      else { if (st === 1) sim.spend(0.05, 0.1); if (st === 3) this.hatchTarget = 1; }
    }
    if (f >= 1) {
      if (c.kind === 'exit') {
        this.mode = 'out'; this.hatchTarget = 1;
        const [wx, wz] = this.worldXZ(HATCH.x, HATCH.z - 1.7); this.pendingExit = new THREE.Vector2(wx, wz);
        this.toast = 'OUTSIDE · HATCH LEFT OPEN FOR NOW'; this.toastT = 3;
      } else { this.toast = 'ROVER CABIN PRESSURISED · 101 kPa'; this.toastT = 3; }
      this.cycle = null; this.busy = false; this.taskLabel = ''; this.taskProgress = 0;
    }
  }
  /** World position to put the player after exiting (consumed once by main). */
  pendingExit: THREE.Vector2 | null = null;

  // ---------- radio link to the Hab ----------
  habLink() { return this.link; }
  private updateLink() {
    this.toWorld(2.0, FLOOR_Y + 2.9, -0.7, this.ant); const hab = this.habAnt(), dist = Math.hypot(this.ant.x - hab.x, this.ant.z - hab.z);
    const los = dist < 40 || lineOfSight(this.ant, hab), inRange = dist < UHF_RANGE;
    this.link = { dist, los, up: los && inRange && this.batteryKwh > 0, reason: !inRange ? 'OUT OF UHF RANGE OF THE HAB (' + (UHF_RANGE / 1000).toFixed(0) + ' KM MAX)' : !los ? 'THE HAB IS BELOW THE LOCAL HORIZON OR MASKED BY TERRAIN' : this.batteryKwh <= 0 ? 'ROVER BATTERY IS DEAD' : '' };
  }
  telemetry(): RoverTele {
    return { present: true, mode: this.mode, batteryPct: (this.batteryKwh / CAP_KWH) * 100, speedKph: Math.abs(this.speed) * 3.6, distM: this.link.dist, headingDeg: ((90 - D.radToDeg(this.heading)) % 360 + 360) % 360, linkUp: this.link.up };
  }
  status(): [string, string, string][] {
    const pct = (this.batteryKwh / CAP_KWH) * 100;
    return [
      ['ROVER', this.mode === 'out' ? 'PARKED' : this.mode === 'cabin' ? 'CABIN' : `DRIVING · ${(Math.abs(this.speed) * 3.6).toFixed(1)} km/h`, this.mode === 'driving' ? 'warn' : 'ok'],
      ['ROVER BATTERY', `${pct.toFixed(0)} %${this.charging ? ' · CHARGING' : ''}`, pct < 10 ? 'bad' : pct < 25 ? 'warn' : 'ok'],
      ['ROVER UHF', this.link.up ? `HAB ${(this.link.dist / 1000).toFixed(2)} km` : 'NO LINK', this.link.up ? 'ok' : 'bad'],
    ];
  }

  // ---------- per-frame ----------
  update(dt: number, dtSim: number, ctx: { player: THREE.Vector3; suitOn: boolean; keys: Set<string>; sim: Sim; hab: THREE.Vector3 }): { dHeading: number } {
    this.suitOk = ctx.suitOn; this.lastPlayer.copy(ctx.player); const keys = ctx.keys; let dHeading = 0;
    if (this.cycle) this.stepCycle(dt, ctx.sim);
    if (this.mode === 'driving') dHeading = this.drive(dt, keys);
    else { this.speed *= Math.max(0, 1 - 4 * dt); if (Math.abs(this.speed) < 0.02) this.speed = 0; }

    // battery: hotel load, lamps, traction; charging from the Hab bus when parked on the pad
    const dh = dtSim / 3600, habD = Math.hypot(this.x - ctx.hab.x, this.z - ctx.hab.z);
    this.drawKw = HOTEL_KW + (this.lights ? LAMP_KW : 0) + (this.mode === 'driving' ? 1.6 + 0.9 * Math.abs(this.speed) + 2.2 * Math.max(0, Math.sin(this.pitch)) * Math.abs(this.speed) : 0);
    this.charging = this.mode !== 'driving' && this.speed === 0 && habD < CHARGE_R && this.batteryKwh < CAP_KWH - 0.05 && (ctx.sim.batteryKwh > 2);
    let dE = -this.drawKw * dh;
    if (this.charging) { const g = Math.min(CHARGE_KW * dh, CAP_KWH - this.batteryKwh - dE); dE += g; ctx.sim.spend(0, g); }
    this.batteryKwh = D.clamp(this.batteryKwh + dE, 0, CAP_KWH);

    this.pose(dt, false);
    this.animate(dt);
    this.linkT -= dt; if (this.linkT <= 0) { this.linkT = 0.5; this.updateLink(); }
    this.scrT -= dt; if (this.scrT <= 0) { this.scrT = 0.25; this.drawScreens(); }

    // player-facing prompt
    const p = ctx.player; let best: Item | null = null, bd = 1e9; this.items = this.buildItems();
    if (!this.busy) for (const i of this.items) { const d = Math.hypot(p.x - i.x, p.z - i.z); if (d < i.reach && d < bd) { best = i; bd = d; } }
    this.best = best; this.prompt = best ? best.text() : '';
    this.toastT -= dt; if (this.toastT <= 0) this.toast = '';
    this.m.cabLight.intensity = this.inside ? 7 : 0;
    this.spot.intensity = this.lights ? 520 : 0;
    for (const m of [this.m.headlampMat]) m.emissiveIntensity = this.lights ? 2.4 : 0.15;
    return { dHeading };
  }

  private buildItems(): Item[] {
    if (this.mode === 'driving') return [{ x: this.toWorld(SEAT_EYE.x, 0, SEAT_EYE.z).x, z: this.toWorld(SEAT_EYE.x, 0, SEAT_EYE.z).z, reach: 99, text: () => "[E] LEAVE THE SEAT  ·  [R] RADIO  ·  [L] LAMPS  ·  SPACE BRAKE", run: () => { if (Math.abs(this.speed) > 0.3) return 'STOP THE ROVER FIRST'; this.mode = 'cabin'; this.cabin.set(2.75, -0.2); return ''; } }];
    const at = (lx: number, lz: number) => this.worldXZ(lx, lz);
    if (this.mode === 'cabin') {
      const [hx, hz] = at(HATCH.x, HATCH.z + 0.35), [sx, sz] = at(3.0, -0.62), [rx, rz] = at(RADIO.x + 0.5, RADIO.z);
      return [
        { x: hx, z: hz, reach: 0.95, text: () => '[E] EXIT THE ROVER (NEEDS A SEALED EVA SUIT)', run: () => this.startCycle('exit') },
        { x: sx, z: sz, reach: 1.1, text: () => "[E] TAKE THE DRIVER'S SEAT", run: () => { this.mode = 'driving'; this.toast = 'WASD DRIVE · SPACE BRAKE · L LAMPS · R RADIO'; this.toastT = 5; return ''; } },
        { x: rx, z: rz, reach: 1.15, text: () => '[E] ROVER RADIO (HAB + EARTH RELAY)', run: () => { this.onRadio?.(); return ''; } },
      ];
    }
    const [ox, oz] = at(HATCH.x, HATCH.z - 1.35);
    return [{ x: ox, z: oz, reach: 1.9, text: () => '[E] OPEN HATCH AND ENTER THE ROVER', run: () => this.startCycle('enter') }];
  }

  private drive(dt: number, keys: Set<string>): number {
    const thr = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0), brake = keys.has('Space'), flat = this.batteryKwh <= 0;
    const maxV = flat ? 0.4 : MAX_V;
    let a = thr * (thr > 0 ? 2.1 : 1.6) - 1.62 * Math.sin(this.pitch) * 0.9; // uphill slows, downhill pushes
    if (thr === 0) a -= Math.sign(this.speed) * 0.9; if (brake) a -= Math.sign(this.speed) * 4.2;
    const v0 = this.speed; this.speed += a * dt;
    if (thr === 0 && Math.sign(v0) !== Math.sign(this.speed) && Math.abs(this.speed) < 0.4) this.speed = 0;
    this.speed = D.clamp(this.speed, -MAX_REV, maxV);
    const want = ((keys.has('KeyA') ? 1 : 0) - (keys.has('KeyD') ? 1 : 0)) * 0.5 * (1 - Math.min(0.6, Math.abs(this.speed) / 10));
    this.steer += (want - this.steer) * Math.min(1, dt * 3);
    const dH = (this.speed / WHEELBASE) * Math.tan(this.steer) * dt;
    const nh = this.heading + dH, c = Math.cos(nh), s = Math.sin(nh), nx = this.x + c * this.speed * dt, nz = this.z - s * this.speed * dt;
    let hit = Math.abs(nx) > 270 || Math.abs(nz) > 270;
    if (!hit) for (const lx of [4.6, 2.4, 0.2, -2.0, -4.6]) { if (this.solid(nx + lx * c, nz - lx * s, 2.15)) { hit = true; break; } }
    if (!hit && Math.abs(this.pitch) > 0.52 && Math.sign(this.pitch) === Math.sign(this.speed)) hit = true; // too steep
    if (hit) { if (Math.abs(this.speed) > 0.8) { this.toast = 'OBSTACLE · DRIVE STOPPED'; this.toastT = 1.5; } this.speed = 0; return 0; }
    this.x = nx; this.z = nz; this.heading = nh; return dH;
  }

  private pose(dt: number, snap: boolean) {
    const c = Math.cos(this.heading), s = Math.sin(this.heading), hs = this.m.wheels.map((w) => heightAt(this.x + w.x * c + w.side * TRACK * s, this.z - w.x * s + w.side * TRACK * c));
    const avg = (f: (i: number) => boolean) => { let t = 0, n = 0; hs.forEach((h, i) => { if (f(i)) { t += h; n++; } }); return t / Math.max(1, n); };
    const ws = this.m.wheels, hF = avg((i) => ws[i].x === AXLES[0]), hR = avg((i) => ws[i].x === AXLES[2]), hP = avg((i) => ws[i].side < 0), hS = avg((i) => ws[i].side > 0), base = avg(() => true);
    const k = snap ? 1 : Math.min(1, dt * 7), slopeX = (hF - hR) / (AXLES[0] - AXLES[2]), slopeZ = (hS - hP) / (2 * TRACK);
    this.slopeX += (slopeX - this.slopeX) * k; this.slopeZ += (slopeZ - this.slopeZ) * k; this.baseY += (base - this.baseY) * k;
    this.pitch = Math.atan(this.slopeX); this.roll = -Math.atan(this.slopeZ);
    const xc = (AXLES[0] + AXLES[2]) / 2;
    ws.forEach((w, i) => { const plane = this.baseY + this.slopeX * (w.x - xc) + this.slopeZ * w.side * TRACK; this.hubY[i] += (D.clamp(WHEEL_R + hs[i] - plane, WHEEL_R - 0.4, WHEEL_R + 0.4) - this.hubY[i]) * k; });
  }

  private animate(dt: number) {
    const r = this.m.root; r.position.set(this.x, this.baseY, this.z); r.rotation.set(this.roll, this.heading, this.pitch, 'YZX'); r.updateMatrixWorld(true);
    this.m.wheels.forEach((w, i) => {
      w.hub.position.y = this.hubY[i]; w.links(this.hubY[i]);
      w.spin.rotation.z -= (this.speed * dt) / WHEEL_R;
      w.steer.rotation.y = w.front ? this.steer : w.x === AXLES[2] ? -this.steer * 0.4 : 0;
    });
    this.hatchK += (this.hatchTarget - this.hatchK) * Math.min(1, dt * 2.2); this.m.hatch.rotation.y = -1.55 * this.hatchK;
    // close the hatch once the player has walked away
    if (this.mode === 'out' && !this.cycle && this.hatchTarget === 1 && !this.nearPlayer) this.hatchTarget = 0;
    // ballistic dust kicked up by moving wheels (no air, so it flies in clean arcs and drops)
    const d = this.dust, moving = Math.abs(this.speed) > 0.8;
    if (moving) for (let e = 0; e < 3; e++) {
      const w = this.m.wheels[(Math.random() * 6) | 0]; const i = d.head; d.head = (d.head + 1) % d.n;
      const c = Math.cos(this.heading), s = Math.sin(this.heading), wx = this.x + w.x * c + w.side * TRACK * s, wz = this.z - w.x * s + w.side * TRACK * c;
      d.pos[i * 3] = wx; d.pos[i * 3 + 1] = heightAt(wx, wz) + 0.1; d.pos[i * 3 + 2] = wz;
      const sp = Math.abs(this.speed), dir = Math.sign(this.speed) * -1;
      d.vel[i * 3] = c * dir * sp * 0.5 + (Math.random() - 0.5) * 1.2; d.vel[i * 3 + 1] = 0.8 + Math.random() * 1.6; d.vel[i * 3 + 2] = -s * dir * sp * 0.5 + (Math.random() - 0.5) * 1.2; d.life[i] = 2.2 + Math.random();
    }
    for (let i = 0; i < d.n; i++) {
      if (d.life[i] <= 0) { d.pos[i * 3 + 1] = -1e5; continue; }
      d.life[i] -= dt; d.vel[i * 3 + 1] -= 1.62 * dt; d.pos[i * 3] += d.vel[i * 3] * dt; d.pos[i * 3 + 1] += d.vel[i * 3 + 1] * dt; d.pos[i * 3 + 2] += d.vel[i * 3 + 2] * dt;
      if (d.pos[i * 3 + 1] < heightAt(d.pos[i * 3], d.pos[i * 3 + 2])) d.life[i] = 0;
    }
    (d.p.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
  private get nearPlayer() { return Math.hypot(this.lastPlayer.x - this.x, this.lastPlayer.z - this.z) < 8; }
  lastPlayer = new THREE.Vector3();

  private drawScreens() {
    const [s0, s1, s2] = this.m.screens, g0 = s0.g, g1 = s1.g, g2 = s2.g, pct = (this.batteryKwh / CAP_KWH) * 100;
    const frame = (g: CanvasRenderingContext2D, title: string, c: HTMLCanvasElement) => { g.fillStyle = '#04141c'; g.fillRect(0, 0, c.width, c.height); g.strokeStyle = 'rgba(79,216,255,.5)'; g.strokeRect(2, 2, c.width - 4, c.height - 4); g.fillStyle = '#ffb000'; g.font = '12px monospace'; g.fillText(title, 8, 16); };
    frame(g0, 'DRIVE', s0.c); g0.fillStyle = '#4fd8ff'; g0.font = 'bold 54px monospace'; g0.fillText(Math.abs(this.speed * 3.6).toFixed(1), 16, 82); g0.font = '14px monospace'; g0.fillText('KM/H', 20, 102);
    g0.fillText(`HDG ${String(Math.round(((90 - D.radToDeg(this.heading)) % 360 + 360) % 360)).padStart(3, '0')}`, 16, 128); g0.fillText(`PITCH ${D.radToDeg(this.pitch).toFixed(0)}  ROLL ${D.radToDeg(this.roll).toFixed(0)}`, 16, 148); s0.t.needsUpdate = true;
    frame(g1, 'POWER', s1.c); g1.fillStyle = pct < 15 ? '#ff4d4d' : '#4fd8ff'; g1.font = 'bold 44px monospace'; g1.fillText(pct.toFixed(0) + '%', 16, 72); g1.font = '14px monospace'; g1.fillText(`LOAD ${this.drawKw.toFixed(1)} kW`, 16, 98);
    g1.fillText(this.charging ? 'CHARGING FROM HAB' : this.lights ? 'LAMPS ON' : 'LAMPS OFF', 16, 120); g1.fillText(`RANGE ${(this.speed ? (this.batteryKwh / Math.max(1, this.drawKw)) * Math.abs(this.speed) * 3.6 : 0).toFixed(0)} km`, 16, 142); s1.t.needsUpdate = true;
    frame(g2, 'NAV / COMMS', s2.c); g2.fillStyle = '#4fd8ff'; g2.font = '14px monospace'; g2.fillText(`HAB  ${(this.link.dist / 1000).toFixed(2)} km`, 16, 50); g2.fillStyle = this.link.up ? '#4fd8ff' : '#ff4d4d'; g2.fillText(this.link.up ? 'UHF LINK UP' : 'NO UHF LINK', 16, 74);
    g2.fillStyle = '#4fd8ff'; g2.fillText('RELAY  HAB > EARTH', 16, 98); g2.fillText(`X ${this.x.toFixed(0)}  Z ${this.z.toFixed(0)}`, 16, 122); s2.t.needsUpdate = true;
    const g3 = this.m.radioScr.g, c3 = this.m.radioScr.c; g3.fillStyle = '#04141c'; g3.fillRect(0, 0, c3.width, c3.height); g3.strokeStyle = 'rgba(79,216,255,.5)'; g3.strokeRect(2, 2, c3.width - 4, c3.height - 4);
    g3.fillStyle = '#ffb000'; g3.font = '12px monospace'; g3.fillText('ROVER RADIO', 8, 16); g3.fillStyle = this.link.up ? '#4fd8ff' : '#ff4d4d'; g3.font = '14px monospace';
    g3.fillText(this.link.up ? 'UHF  HAB  LINKED' : 'UHF  NO LINK', 10, 48); g3.fillStyle = '#4fd8ff'; g3.fillText('EARTH  VIA HAB RELAY', 10, 74); g3.fillText(`DIST ${(this.link.dist / 1000).toFixed(2)} KM`, 10, 100); this.m.radioScr.t.needsUpdate = true;
  }
}
