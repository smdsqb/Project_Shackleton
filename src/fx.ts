// Visible evidence for every crisis: meteor tracers and impact flashes, explosions, fire and smoke, steam and water jets,
// hull-breach vapour, arcing sparks, quake shaking. The sim stays pure; this layer reads its state (and its one-shot fxq events).
// Lunar physics where it matters: no air, so debris flies in long ballistic arcs at 1.62 m/s^2 with no drag.
import * as THREE from 'three';
import type { Sim, FxEvt } from './sim';
import { HAB_R } from './hab';

export type FxHooks = { boom(vol: number): void; hiss(): void };
const G = -1.62, rnd = (a: number, b: number) => a + Math.random() * (b - a);

const VERT = `attribute float aSize; attribute float aAlpha; attribute vec3 aColor; uniform float uScale; varying float vA; varying vec3 vC;
void main(){ vA = aAlpha; vC = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = max(0.0, aSize * uScale / max(0.1, -mv.z)); }`;
const FRAG = `varying float vA; varying vec3 vC; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(vC, vA * smoothstep(0.5, 0.05, d)); }`;

class Particles {
  private pos: Float32Array; private vel: Float32Array; private col: Float32Array; private sz: Float32Array; private al: Float32Array;
  private life: Float32Array; private max: Float32Array; private s0: Float32Array; private a0: Float32Array; private head = 0; readonly pts: THREE.Points;
  constructor(scene: THREE.Scene, private n: number, additive: boolean, private grav: number, private drag: number, private growK: number, private ground?: (x: number, z: number) => number) {
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3); this.col = new Float32Array(n * 3); this.sz = new Float32Array(n); this.al = new Float32Array(n);
    this.life = new Float32Array(n); this.max = new Float32Array(n); this.s0 = new Float32Array(n); this.a0 = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.sz, 1).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('aAlpha', new THREE.BufferAttribute(this.al, 1).setUsage(THREE.DynamicDrawUsage));
    this.pts = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, uniforms: { uScale: { value: 900 } } }));
    this.pts.frustumCulled = false; scene.add(this.pts);
  }
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, r: number, g: number, b: number, size: number, a = 1) {
    const i = this.head, j = i * 3; this.head = (i + 1) % this.n;
    this.pos[j] = x; this.pos[j + 1] = y; this.pos[j + 2] = z; this.vel[j] = vx; this.vel[j + 1] = vy; this.vel[j + 2] = vz;
    this.col[j] = r; this.col[j + 1] = g; this.col[j + 2] = b; this.life[i] = this.max[i] = life; this.s0[i] = size; this.a0[i] = a; this.sz[i] = size; this.al[i] = a;
  }
  update(dt: number) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue; this.life[i] -= dt; const j = i * 3;
      if (this.life[i] <= 0) { this.sz[i] = 0; this.al[i] = 0; continue; }
      const u = this.life[i] / this.max[i], k = 1 - this.drag * dt;
      this.vel[j + 1] += this.grav * dt; this.vel[j] *= k; this.vel[j + 1] *= k; this.vel[j + 2] *= k;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      if (this.ground && this.vel[j + 1] < 0 && this.pos[j + 1] < this.ground(this.pos[j], this.pos[j + 2])) { this.life[i] = 0; this.sz[i] = 0; this.al[i] = 0; continue; }
      this.sz[i] = this.s0[i] * (1 + this.growK * (1 - u)); this.al[i] = this.a0[i] * u;
    }
    for (const a of ['position', 'aSize', 'aAlpha', 'aColor']) (this.pts.geometry.attributes[a] as THREE.BufferAttribute).needsUpdate = true;
  }
}

type Meteor = { p: THREE.Vector3; v: THREE.Vector3; target: THREE.Vector3 | null; power: number; hull: boolean; array: boolean };

export class Fx {
  shake = 0;   // 0..1, decays; main turns it into camera jitter
  private smoke: Particles; private spark: Particles; private dust: Particles; private glow: Particles;
  private flashes: { l: THREE.PointLight; t: number; peak: number }[] = []; private hazard: THREE.PointLight;
  private sched: { at: number; fn: () => void }[] = []; private meteors: Meteor[] = []; private clock = 0; private acc: Record<string, number> = {};
  private leakAng = Math.random() * Math.PI * 2; private lastLeak = false; private hissT = 0; private arcT = 0;
  private gy: number; private batt: THREE.Vector3; private rad: THREE.Vector3; private lab: THREE.Vector3; private water: THREE.Vector3;

  constructor(private scene: THREE.Scene, private heightAt: (x: number, z: number) => number, private arrayPos: THREE.Vector3, private hooks: FxHooks) {
    const gnd = (x: number, z: number) => heightAt(x, z) + 0.02;
    this.smoke = new Particles(scene, 1400, false, 0.25, 0.6, 2.6); this.spark = new Particles(scene, 1800, true, G, 0, -0.2, gnd);
    this.dust = new Particles(scene, 1800, false, G, 0.15, 1.2, gnd); this.glow = new Particles(scene, 300, true, 0, 2.2, 1.6);
    // lights are created now (at zero) so adding an effect never changes the light count and forces a shader recompile
    for (let i = 0; i < 2; i++) { const l = new THREE.PointLight(0xffd9a0, 0, 70, 1.6); scene.add(l); this.flashes.push({ l, t: 9, peak: 0 }); }
    this.hazard = new THREE.PointLight(0xff7a2a, 0, 16, 2); scene.add(this.hazard);
    this.gy = heightAt(0, 0); this.batt = new THREE.Vector3(9.75, heightAt(9.75, -9) + 1.0, -9); this.rad = new THREE.Vector3(-7, heightAt(-7, -11) + 1.4, -11);
    this.lab = new THREE.Vector3(0, this.gy + 1.15, -1.7); this.water = new THREE.Vector3(-HAB_R + 1.2, this.gy + 1.3, 2.6);
  }

  // ---------- one-shot effects ----------
  private flash(p: THREE.Vector3, peak: number, color = 0xffd9a0) {
    const f = this.flashes.reduce((a, b) => (a.t > b.t ? a : b)); f.l.position.copy(p); f.l.color.setHex(color); f.peak = peak; f.t = 0;
  }
  private sparks(p: THREE.Vector3, n: number, speed: number) { for (let i = 0; i < n; i++) { const a = rnd(0, 6.283), e = rnd(0.2, 1.4), s = rnd(0.3, 1) * speed; this.spark.emit(p.x, p.y, p.z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s, Math.sin(a) * Math.cos(e) * s, rnd(1, 3.2), 1, rnd(0.6, 0.9), rnd(0.2, 0.5), rnd(0.12, 0.3)); } }
  private ejecta(p: THREE.Vector3, n: number, speed: number) { for (let i = 0; i < n; i++) { const a = rnd(0, 6.283), e = rnd(0.35, 1.3), s = rnd(0.2, 1) * speed; this.dust.emit(p.x, p.y, p.z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s, Math.sin(a) * Math.cos(e) * s, rnd(2.5, 6), 0.62, 0.58, 0.52, rnd(0.25, 0.8), 0.9); } }
  private distFall(p: THREE.Vector3, cam: THREE.Vector3, near = 12, far = 160) { const d = p.distanceTo(cam); return Math.max(0, Math.min(1, 1 - (d - near) / (far - near))); }

  private impact(p: THREE.Vector3, power: number, cam: THREE.Vector3) {
    this.flash(p.clone().add(new THREE.Vector3(0, 1.2, 0)), 220 * power); this.ejecta(p, Math.floor(70 * power), 11 * power); this.sparks(p, Math.floor(60 * power), 14);
    for (let i = 0; i < 14; i++) this.smoke.emit(p.x + rnd(-0.8, 0.8), p.y + 0.2, p.z + rnd(-0.8, 0.8), rnd(-1, 1), rnd(0.5, 2), rnd(-1, 1), rnd(2, 4.5), 0.55, 0.52, 0.48, rnd(0.8, 1.8), 0.55);
    const f = this.distFall(p, cam); this.shake = Math.max(this.shake, 0.55 * f * power); this.hooks.boom(0.25 + 0.75 * f);
  }
  private explosion(p: THREE.Vector3, cam: THREE.Vector3, big = 1) {
    this.flash(p.clone().add(new THREE.Vector3(0, 1.5, 0)), 520 * big, 0xffb060);
    for (let i = 0; i < 46; i++) { const a = rnd(0, 6.283), s = rnd(1, 7) * big; this.glow.emit(p.x, p.y + 0.8, p.z, Math.cos(a) * s, rnd(0.5, 5), Math.sin(a) * s, rnd(0.5, 1.4), 1, rnd(0.5, 0.8), rnd(0.15, 0.3), rnd(1.8, 4.5) * big, 0.9); }
    this.sparks(p.clone().add(new THREE.Vector3(0, 0.8, 0)), 220, 22 * big); this.ejecta(p, 60, 12 * big);
    for (let i = 0; i < 90; i++) this.smoke.emit(p.x + rnd(-1, 1), p.y + 0.5, p.z + rnd(-1, 1), rnd(-2, 2), rnd(1.5, 5), rnd(-2, 2), rnd(5, 11), 0.1, 0.1, 0.11, rnd(1.5, 3.5) * big, 0.7);
    const f = Math.max(0.35, this.distFall(p, cam, 20, 200)); this.shake = Math.max(this.shake, 0.9 * f); this.hooks.boom(Math.min(1, 0.4 + f));
  }
  private spawnMeteor(target: THREE.Vector3 | null, power: number, hull: boolean, array: boolean, cam: THREE.Vector3) {
    const t = target ?? new THREE.Vector3(cam.x + rnd(-120, 120), 0, cam.z + rnd(-120, 120)); if (!target) t.y = this.heightAt(t.x, t.z);
    const az = rnd(0, 6.283), el = rnd(0.45, 0.8), dir = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    this.meteors.push({ p: t.clone().addScaledVector(dir, 150), v: dir.clone().multiplyScalar(-100), target: target ?? t, power, hull, array });
  }

  /** the one-shot events the sim queued */
  private handle(e: FxEvt, cam: THREE.Vector3) {
    if (e.type === 'streaks') { for (let i = 0; i < e.n; i++) this.sched.push({ at: this.clock + rnd(0.3, 7), fn: () => { const az = rnd(0, 6.283), el = rnd(0.5, 1.0), d = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)); this.meteors.push({ p: new THREE.Vector3(cam.x, 0, cam.z).addScaledVector(d, 260), v: d.clone().multiplyScalar(-90).add(new THREE.Vector3(rnd(-30, 30), rnd(-10, 0), rnd(-30, 30))), target: null, power: 0, hull: false, array: false }); } }); }
    else if (e.type === 'meteors') for (let i = 0; i < Math.max(e.n, 3); i++) {
      const real = i < e.n, last = i === e.n - 1; const tgt = real && last && e.hitArray ? this.arrayPos.clone().add(new THREE.Vector3(0, -2, rnd(-3, 3))) : real && last && e.hitHull ? new THREE.Vector3(Math.cos(this.leakAng) * (HAB_R + 0.3), this.gy + 2.2, Math.sin(this.leakAng) * (HAB_R + 0.3)) : null;
      this.sched.push({ at: this.clock + 0.6 + i * rnd(1.2, 3), fn: () => this.spawnMeteor(tgt, real ? rnd(0.8, 1.5) : rnd(0.5, 0.8), !!(real && last && e.hitHull), !!(real && last && e.hitArray), cam) });
    }
    else if (e.type === 'explosion') this.explosion(e.where === 'battery' ? this.batt : e.where === 'array' ? this.arrayPos : this.lab, cam, e.where === 'lab' ? 0.45 : 1);
    else if (e.type === 'sparks') { const p = e.where === 'array' ? this.arrayPos.clone().add(new THREE.Vector3(-0.2, -3, rnd(-3, 3))) : this.lab; this.sparks(p, 40, 8); this.flash(p, 90, 0xbfd8ff); }
  }

  // ---------- continuous emitters ----------
  private emitRate(key: string, rate: number, dt: number, f: () => void) { this.acc[key] = (this.acc[key] ?? 0) + rate * dt; while (this.acc[key] >= 1) { this.acc[key]--; f(); } }

  update(dt: number, cam: THREE.Vector3, sim: Sim) {
    this.clock += dt; this.shake = Math.max(0, this.shake - dt * 0.9);
    while (sim.fxq.length) this.handle(sim.fxq.shift()!, cam);
    for (let i = this.sched.length - 1; i >= 0; i--) if (this.clock >= this.sched[i].at) { const s = this.sched.splice(i, 1)[0]; s.fn(); }
    // meteors in flight: a fast tracer with a spark trail, then an impact (or a silent fly-by for the warning streaks)
    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const m = this.meteors[i]; m.p.addScaledVector(m.v, dt);
      this.spark.emit(m.p.x, m.p.y, m.p.z, rnd(-1, 1), rnd(-1, 1), rnd(-1, 1), 0.55, 1, 0.95, 0.8, 0.7, 1); this.glow.emit(m.p.x, m.p.y, m.p.z, 0, 0, 0, 0.25, 1, 0.9, 0.7, 1.4, 1);
      const gh = this.heightAt(m.p.x, m.p.z);
      if (m.power > 0 && m.p.y <= (m.target && (m.array || m.hull) ? m.target.y : gh)) { this.impact(m.p.clone().setY(Math.max(m.p.y, gh)), m.power, cam); if (m.array) { this.sparks(m.p, 80, 12); } this.meteors.splice(i, 1); }
      else if (m.p.y < gh - 1 || m.p.distanceTo(cam) > 420) this.meteors.splice(i, 1);
    }
    // quake: the ground shakes, dust hops up, the room rattles
    if (sim.quakeS > 0) { const q = Math.min(1, sim.quakeS / 3); this.shake = Math.max(this.shake, 0.85 * q); this.emitRate('qd', 60 * q, dt, () => { const x = cam.x + rnd(-14, 14), z = cam.z + rnd(-14, 14); this.dust.emit(x, this.heightAt(x, z) + 0.05, z, rnd(-0.6, 0.6), rnd(0.6, 2.4), rnd(-0.6, 0.6), rnd(1, 2.4), 0.6, 0.56, 0.5, rnd(0.2, 0.6), 0.7); }); }
    // fire in the lab
    const fire = sim.fire; let hz = 0;
    if (fire > 0) { this.emitRate('fire', 40 * fire, dt, () => { this.glow.emit(this.lab.x + rnd(-0.5, 0.5), this.lab.y - 0.4, this.lab.z + rnd(-0.5, 0.5), rnd(-0.2, 0.2), rnd(0.8, 2.2), rnd(-0.2, 0.2), rnd(0.4, 0.9), 1, rnd(0.45, 0.7), 0.12, rnd(0.5, 1.1) * (0.6 + fire), 0.85); }); this.emitRate('fsm', 22 * fire, dt, () => this.smoke.emit(this.lab.x + rnd(-0.5, 0.5), this.lab.y, this.lab.z + rnd(-0.5, 0.5), rnd(-0.3, 0.3), rnd(0.5, 1.2), rnd(-0.3, 0.3), rnd(3, 6), 0.12, 0.12, 0.13, rnd(0.6, 1.2), 0.6)); hz = Math.max(hz, 40 * fire * (0.7 + 0.3 * Math.sin(this.clock * 17) * Math.sin(this.clock * 7.3))); this.hazard.position.copy(this.lab); this.hazard.color.setHex(0xff7a2a); }
    // battery overheating: venting gas and a growing orange glow, sparks as it climbs
    if (sim.batteryHazard > 0) { const h = sim.batteryHazard; this.emitRate('bs', 30 * h, dt, () => this.smoke.emit(this.batt.x + rnd(-3, 1), this.batt.y + 0.6, this.batt.z + rnd(-0.4, 0.4), rnd(-0.4, 0.4), rnd(1, 2.8), rnd(-0.4, 0.4), rnd(2.5, 5), 0.7, 0.68, 0.64, rnd(0.5, 1.1), 0.5)); this.emitRate('bk', 6 * h, dt, () => this.sparks(this.batt.clone().add(new THREE.Vector3(rnd(-2, 0), 0.7, 0)), 6, 6)); if (fire <= 0) { hz = Math.max(hz, 44 * h * (0.65 + 0.35 * Math.sin(this.clock * 9))); this.hazard.position.copy(this.batt); this.hazard.color.setHex(0xff5a1a); } }
    // coolant pump failure: steam venting from the radiator
    if (sim.coolantK < 1) this.emitRate('cs', 38, dt, () => this.smoke.emit(this.rad.x + rnd(-0.3, 0.3), this.rad.y + 1.1, this.rad.z + rnd(-1.8, 1.8), rnd(-0.3, 0.3), rnd(2.2, 4.4), rnd(-0.3, 0.3), rnd(1.4, 3), 0.95, 0.96, 0.98, rnd(0.5, 1.0), 0.65));
    // water line rupture: a spray fountain inside the hab, falling in low gravity
    if (sim.waterLeakKgH > 0) this.emitRate('ws', 90, dt, () => this.dust.emit(this.water.x, this.water.y, this.water.z + rnd(-0.1, 0.1), rnd(2.2, 3.8), rnd(1.6, 3.4), rnd(-0.9, 0.9), rnd(1, 2.2), 0.6, 0.82, 1, rnd(0.08, 0.16), 0.9));
    // hull breach: air streams out as a white vapour jet and the cabin hisses
    const leak = sim.leakKpaH > 0; if (leak && !this.lastLeak) this.leakAng = rnd(0, 6.283); this.lastLeak = leak;
    if (leak) { const r = HAB_R + 0.1, c = Math.cos(this.leakAng), s = Math.sin(this.leakAng); this.emitRate('ls', 55, dt, () => this.smoke.emit(c * r, this.gy + 2.2, s * r, c * rnd(5, 9), rnd(-0.4, 1.2), s * rnd(5, 9), rnd(0.8, 1.8), 0.96, 0.97, 1, rnd(0.25, 0.6), 0.55)); this.hissT -= dt; if (this.hissT <= 0) { this.hooks.hiss(); this.hissT = 7; } }
    // array string fault: it arcs and spits sparks now and then
    if (sim.arrayHealth < sim.arrayCap - 0.05) { this.arcT -= dt; if (this.arcT <= 0) { this.arcT = rnd(1.2, 3.2); this.handle({ type: 'sparks', where: 'array' }, cam); } }
    // light flashes fade
    for (const f of this.flashes) { f.t += dt; f.l.intensity = f.t > 0.7 ? 0 : f.peak * Math.exp(-f.t * 7); }
    this.hazard.intensity = hz;
    this.smoke.update(dt); this.spark.update(dt); this.dust.update(dt); this.glow.update(dt);
  }
}
