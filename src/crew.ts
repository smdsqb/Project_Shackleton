// Crew: four humanoid astronauts who live in the Hab, built procedurally (no binary assets) and driven by a duty
// scheduler. At any moment one is asleep in a bunk, one stargazes at a porthole (or does other off-duty things),
// one works the comms console / racks / lab, and one is outside on EVA. Roles rotate through a shift cycle
// (sleep -> window -> comms -> eva -> sleep) and tasks rotate inside each role. Bots never interact with each other
// or the player yet; each task owns its own spot. Everything is animated from joint angles, with smoothed poses,
// blinking, eye saccades, breathing, glances at the player, a lunar-gravity lope on EVA, and airlock transits.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { meatball, flagTexture, plateTexture } from './livery';
import { HAB_R } from './hab';

type Pose = Record<string, number>;
type Slot = 'sleep' | 'window' | 'comms' | 'eva';
export type CrewHab = { curtains: THREE.Group[]; setDoor(lock: number, which: 'inner' | 'outer', open: boolean): void };

const { sin, cos, abs, min, max, PI, atan2, hypot, sqrt } = Math;
const TAU = PI * 2, TL = 2.2;
const clamp = (v: number, a: number, b: number) => min(b, max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const wrap = (a: number) => { while (a > PI) a -= TAU; while (a < -PI) a += TAU; return a; };
const sm = (x: number) => clamp(0.5 + 0.5 * x, 0, 1);
const pol = (r: number, a: number) => ({ x: r * cos(a), z: r * sin(a) });
const faceOut = (a: number) => atan2(cos(a), sin(a)); // yaw that faces away from the hab centre at polar angle a
export const CREW_CFG = { rotateMin: 150, rotateMax: 210 }; // seconds between shift changes

// ---------------------------------------------------------------- roster
interface Spec { name: string; role: string; h: number; sw: number; hw: number; bulk: number; skin: number; hair: number; eye: number; style: 'curly' | 'buzz' | 'pony' | 'wavy'; stubble: number; female: boolean; pants: number; stripe: number; tempo: number }
const ROSTER: Spec[] = [
  { name: 'OKAFOR', role: 'FLIGHT SURGEON', h: 1.68, sw: 0.94, hw: 1.06, bulk: 0.96, skin: 0x6e4733, hair: 0x130e0b, eye: 0x3a2414, style: 'curly', stubble: 0, female: true, pants: 0x8a7f63, stripe: 0xfc3d21, tempo: 1.0 },
  { name: 'WHITAKER', role: 'PILOT', h: 1.85, sw: 1.12, hw: 0.98, bulk: 1.16, skin: 0xe0ab88, hair: 0x9a9da1, eye: 0x58788f, style: 'buzz', stubble: 0.5, female: false, pants: 0x27324c, stripe: 0xff7a1a, tempo: 0.92 },
  { name: 'ZHAO', role: 'GEOLOGIST', h: 1.61, sw: 0.88, hw: 0.98, bulk: 0.86, skin: 0xe6c19c, hair: 0x0e0c0c, eye: 0x2a1b12, style: 'pony', stubble: 0, female: true, pants: 0x6f6a5c, stripe: 0x2a7fff, tempo: 1.1 },
  { name: 'MENDOZA', role: 'SYSTEMS ENGINEER', h: 1.76, sw: 1.03, hw: 1.0, bulk: 1.02, skin: 0xb07850, hair: 0x1a120d, eye: 0x3b2a1c, style: 'wavy', stubble: 0.9, female: false, pants: 0x8a7f63, stripe: 0x39b54a, tempo: 1.0 },
];

// ---------------------------------------------------------------- textures
const cv = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
function skinTexture(tone: number, hair: number, stubble: number, female: boolean) {
  const c = cv(512, 256), g = c.getContext('2d')!, col = new THREE.Color(tone), hc = new THREE.Color(hair);
  g.fillStyle = '#' + col.getHexString(); g.fillRect(0, 0, 512, 256);
  const blob = (x: number, y: number, rx: number, ry: number, rgb: string, a: number) => {
    g.save(); g.translate(x, y); g.scale(1, ry / rx);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx); gr.addColorStop(0, `rgba(${rgb},${a})`); gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr; g.fillRect(-rx, -rx, rx * 2, rx * 2); g.restore();
  };
  for (let i = 0; i < 90; i++) blob(Math.random() * 512, Math.random() * 256, 14 + Math.random() * 30, 10 + Math.random() * 20, Math.random() < 0.5 ? '255,205,175' : '110,60,45', 0.035);
  for (const sx of [-1, 1]) { blob(128 + sx * 42, 152, 30, 22, '205,90,80', female ? 0.2 : 0.13); blob(128 + sx * 22, 124, 17, 7, '60,30,40', 0.13); blob(128 + sx * 52, 112, 18, 14, '255,225,200', 0.05); }
  blob(128, 140, 12, 11, '200,100,90', 0.12); blob(128, 82, 56, 28, '255,235,220', 0.07); blob(128, 173, 16, 5, '150,60,60', female ? 0.55 : 0.42);
  g.fillStyle = 'rgba(0,0,0,0.035)'; for (let i = 0; i < 1800; i++) g.fillRect(Math.random() * 512, Math.random() * 256, 1, 1);
  if (stubble > 0) {
    g.globalAlpha = 0.32 * stubble; g.fillStyle = '#' + hc.getHexString();
    for (let i = 0; i < 4200; i++) { const x = 128 + (Math.random() - 0.5) * 150, y = 150 + Math.random() * 75; if (hypot((x - 128) / 75, (y - 190) / 55) > 1) continue; g.fillRect(x, y, 1.2, 1.2); }
    g.globalAlpha = 1;
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function eyeTexture(iris: number) {
  const c = cv(256, 128), g = c.getContext('2d')!, ih = '#' + new THREE.Color(iris).getHexString();
  g.fillStyle = '#efe8e2'; g.fillRect(0, 0, 256, 128);
  g.strokeStyle = 'rgba(190,80,80,.10)'; g.lineWidth = 1;
  for (let i = 0; i < 22; i++) { g.beginPath(); const y = 40 + Math.random() * 48, x = (Math.random() < 0.5 ? 8 : 120) + Math.random() * 40; g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 30, y + (Math.random() - 0.5) * 20); g.stroke(); }
  const gr = g.createRadialGradient(64, 64, 4, 64, 64, 23); gr.addColorStop(0, ih); gr.addColorStop(0.72, ih); gr.addColorStop(1, '#0d0907');
  g.fillStyle = gr; g.beginPath(); g.arc(64, 64, 23, 0, TAU); g.fill();
  for (let i = 0; i < 40; i++) { const a = Math.random() * TAU; g.strokeStyle = Math.random() < 0.5 ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.18)'; g.beginPath(); g.moveTo(64 + cos(a) * 8, 64 + sin(a) * 8); g.lineTo(64 + cos(a) * 21, 64 + sin(a) * 21); g.stroke(); }
  g.fillStyle = '#050403'; g.beginPath(); g.arc(64, 64, 8.5, 0, TAU); g.fill();
  g.fillStyle = 'rgba(255,255,255,.7)'; g.beginPath(); g.arc(57, 57, 2.6, 0, TAU); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// tapered capsule hanging from its proximal joint at y=0 down to y=-len (profile can bulge like a muscle)
const seg = (len: number, rP: number, rD: number, bulge = 0, sx = 1, sz = 1) => {
  const pts: THREE.Vector2[] = [], n = 8;
  for (let i = 0; i <= 4; i++) { const a = -PI / 2 + (i / 4) * (PI / 2); pts.push(new THREE.Vector2(rD * cos(a), rD * sin(a))); }
  for (let i = 1; i < n; i++) { const t = i / n; pts.push(new THREE.Vector2(lerp(rD, rP, t) + bulge * sin(PI * t), len * t)); }
  for (let i = 0; i <= 4; i++) { const a = (i / 4) * (PI / 2); pts.push(new THREE.Vector2(rP * cos(a), len + rP * sin(a))); }
  const g = new THREE.LatheGeometry(pts, 18); g.translate(0, -len, 0); g.scale(sx, 1, sz); return g;
};

// ---------------------------------------------------------------- body rig
interface Rig {
  root: THREE.Group; pv: THREE.Group; sp: THREE.Group; ch: THREE.Group; nk: THREE.Group; hd: THREE.Group;
  sh: THREE.Group[]; el: THREE.Group[]; wr: THREE.Group[]; hip: THREE.Group[]; kn: THREE.Group[]; an: THREE.Group[];
  eye: THREE.Group[]; lid: THREE.Mesh[]; mouth: THREE.Mesh; tail: THREE.Group | null;
  ind: THREE.Object3D[]; eva: THREE.Object3D[]; skinEx: THREE.Object3D[]; items: Record<string, THREE.Object3D>;
  L: { thigh: number; shin: number; ankle: number };
}
function build(s: Spec): Rig {
  const H = s.h, b = s.bulk, T = 0.3 * H;
  const L = { thigh: 0.245 * H, shin: 0.246 * H, ankle: 0.039 * H, ua: 0.186 * H, fa: 0.146 * H };
  const root = new THREE.Group(), pv = new THREE.Group(); root.add(pv);
  const ind: THREE.Object3D[] = [], eva: THREE.Object3D[] = [], skinEx: THREE.Object3D[] = [];
  const std = (color: number, rough = 0.7, metal = 0, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
  const skinM = std(s.skin, 0.62, 0, { emissive: s.skin, emissiveIntensity: 0.05 });
  const headM = new THREE.MeshStandardMaterial({ map: skinTexture(s.skin, s.hair, s.stubble, s.female), roughness: 0.6, emissive: s.skin, emissiveIntensity: 0.03 });
  const poloM = std(0x14357a, 0.92), pantsM = std(s.pants, 0.95), shoeM = std(0x1f2328, 0.7), white = std(0xf1f3f5, 0.5, 0.08), grey = std(0x8e96a1, 0.6, 0.2), stripeM = std(s.stripe, 0.6);
  const hairM = std(s.hair, 0.95), browM = std(new THREE.Color(s.hair).multiplyScalar(0.7).getHex(), 0.9);
  const mk = (geo: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, list?: THREE.Object3D[], x = 0, y = 0, z = 0) => {
    const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; parent.add(o); list?.push(o); return o;
  };
  const ring = (r: number, tube: number, m: THREE.Material, parent: THREE.Object3D, y: number) => mk(new THREE.TorusGeometry(r, tube, 8, 20).rotateX(PI / 2), m, parent, eva, 0, y, 0);
  const BALL = meatball(), FLAG = flagTexture(), TAPE = plateTexture(s.name);
  const patch = (w: number, h: number, map: THREE.Texture, parent: THREE.Object3D, list: THREE.Object3D[], x: number, y: number, z: number, ry = 0) => {
    const o = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map, roughness: 0.85, transparent: true, polygonOffset: true, polygonOffsetFactor: -2 }));
    o.position.set(x, y, z); o.rotation.y = ry; parent.add(o); list.push(o); return o;
  };
  const zc = (x: number, r: number, sx: number) => r * sqrt(max(0.05, 1 - (x / (r * sx)) ** 2));

  // ---- torso ----
  const sp = new THREE.Group(), ch = new THREE.Group(), nk = new THREE.Group(), hd = new THREE.Group();
  pv.add(sp); sp.add(ch); ch.position.y = 0.5 * T; ch.add(nk); nk.position.y = 0.5 * T; nk.add(hd); hd.position.y = 0.055 * H;
  const lowR = 0.07 * H * b, chR = 0.077 * H * b, sxLow = (1.34 * s.hw) / b, sxCh = (1.42 * s.sw) / b;
  mk(seg(0.19 * H, lowR, lowR * 0.9, 0, sxLow, 1), pantsM, pv, ind, 0, 0.13 * H, 0);
  mk(seg(0.17 * H, chR * 0.97, lowR * 0.95, 0.003 * H, sxCh, 1), poloM, ch, ind, 0, 0.5 * T, 0);
  mk(seg(0.2 * H, lowR * 1.32, lowR * 1.22, 0, sxLow, 1), std(0xf1f3f5, 0.5, 0.08), pv, eva, 0, 0.13 * H, 0);
  mk(seg(0.2 * H, chR * 1.38, chR * 1.3, 0.004 * H, sxCh * 0.98, 1), white, ch, eva, 0, 0.5 * T + 0.01 * H, 0);
  patch(0.07 * H, 0.07 * H, BALL, ch, ind, 0.062 * H, 0.105 * H, zc(0.062 * H, chR * 0.97, sxCh) + 0.002 * H);
  patch(0.075 * H, (0.075 * H * 96) / 512, TAPE, ch, ind, -0.062 * H, 0.105 * H, zc(-0.062 * H, chR * 0.97, sxCh) + 0.002 * H);
  const hz = chR * 1.38;
  patch(0.085 * H, 0.085 * H, BALL, ch, eva, 0.058 * H, 0.1 * H, zc(0.058 * H, hz, sxCh * 0.98) + 0.003 * H);
  patch(0.075 * H, (0.075 * H * 96) / 512, TAPE, ch, eva, -0.06 * H, 0.1 * H, zc(-0.06 * H, hz, sxCh * 0.98) + 0.003 * H);
  mk(new RoundedBoxGeometry(0.09 * H, 0.06 * H, 0.03 * H, 3, 0.008 * H), grey, ch, eva, 0, 0.055 * H, hz * 0.96 + 0.012 * H);
  const plss = mk(new RoundedBoxGeometry(0.27 * H, 0.36 * H, 0.14 * H, 3, 0.02 * H), white, ch, eva, 0, 0.09 * H, -(hz + 0.05 * H));
  mk(new RoundedBoxGeometry(0.2 * H, 0.05 * H, 0.1 * H, 3, 0.01 * H), grey, plss, eva, 0, 0.2 * H, 0);
  patch(0.18 * H, (0.18 * H * 96) / 512, plateTexture('NASA'), plss, eva, 0, 0.04 * H, -0.072 * H, PI);
  mk(new THREE.CylinderGeometry(0.03 * H * b, 0.034 * H * b, 0.075 * H, 14), skinM, nk, skinEx, 0, 0.03 * H, 0);
  ring(0.052 * H, 0.011 * H, white, nk, 0.012 * H);

  // ---- arms ----
  const shW = 0.128 * H * s.sw, shY = 0.5 * T - 0.03 * H;
  const sh: THREE.Group[] = [], el: THREE.Group[] = [], wr: THREE.Group[] = [], hold: THREE.Group[] = [];
  for (const sg of [1, -1]) {
    const g1 = new THREE.Group(); g1.position.set(sg * shW, shY, 0); ch.add(g1); sh.push(g1);
    mk(new THREE.SphereGeometry(0.04 * H * b, 14, 10), poloM, g1, ind);
    mk(seg(L.ua, 0.037 * H * b, 0.03 * H * b, 0.002 * H), skinM, g1, skinEx);
    mk(seg(L.ua * 0.6, 0.042 * H * b, 0.038 * H * b), poloM, g1, ind);
    mk(new THREE.SphereGeometry(0.058 * H, 14, 10), white, g1, eva);
    mk(seg(L.ua, 0.056 * H, 0.05 * H), white, g1, eva); ring(0.052 * H, 0.007 * H, stripeM, g1, -0.45 * L.ua);
    patch(0.032 * H, 0.032 * H, sg > 0 ? BALL : FLAG, g1, ind, sg * (0.043 * H * b + 0.002 * H), -0.06 * H, 0, sg * (PI / 2));
    if (sg < 0) patch(0.04 * H, 0.04 * H, FLAG, g1, eva, -0.062 * H, -0.03 * H, 0, -PI / 2);
    const e = new THREE.Group(); e.position.y = -L.ua; g1.add(e); el.push(e);
    mk(new THREE.SphereGeometry(0.03 * H * b, 12, 8), skinM, e, skinEx);
    mk(seg(L.fa, 0.029 * H * b, 0.022 * H * b, 0.002 * H), skinM, e, skinEx);
    mk(seg(L.fa, 0.05 * H, 0.046 * H), white, e, eva); ring(0.048 * H, 0.006 * H, grey, e, -L.fa * 0.5);
    const w = new THREE.Group(); w.position.y = -L.fa; e.add(w); wr.push(w);
    const palm = mk(new THREE.SphereGeometry(1, 12, 10), skinM, w, skinEx, 0, -0.042 * H, 0); palm.scale.set(0.02 * H, 0.046 * H, 0.011 * H);
    const th = mk(new THREE.SphereGeometry(1, 8, 6), skinM, w, skinEx, -sg * 0.016 * H, -0.03 * H, 0.008 * H); th.scale.set(0.007 * H, 0.02 * H, 0.007 * H);
    const gl = mk(new THREE.SphereGeometry(1, 12, 10), white, w, eva, 0, -0.05 * H, 0); gl.scale.set(0.034 * H, 0.06 * H, 0.024 * H);
    ring(0.04 * H, 0.007 * H, grey, w, -0.004 * H);
    const hg = new THREE.Group(); hg.position.y = -0.045 * H; w.add(hg); hold.push(hg);
  }

  // ---- legs ----
  const hipH = 0.085 * H * s.hw;
  const hip: THREE.Group[] = [], kn: THREE.Group[] = [], an: THREE.Group[] = [];
  for (const sg of [1, -1]) {
    const h1 = new THREE.Group(); h1.position.set(sg * hipH, 0, 0); pv.add(h1); hip.push(h1);
    mk(seg(L.thigh, 0.062 * H * b, 0.043 * H * b, 0.004 * H), pantsM, h1, ind);
    mk(seg(L.thigh, 0.088 * H, 0.07 * H), white, h1, eva); ring(0.078 * H, 0.007 * H, stripeM, h1, -0.4 * L.thigh);
    const k1 = new THREE.Group(); k1.position.y = -L.thigh; h1.add(k1); kn.push(k1);
    mk(seg(L.shin, 0.043 * H * b, 0.031 * H * b, 0.005 * H), pantsM, k1, ind);
    mk(seg(L.shin, 0.07 * H, 0.064 * H), white, k1, eva); ring(0.067 * H, 0.007 * H, stripeM, k1, -0.2 * L.shin);
    const a1 = new THREE.Group(); a1.position.y = -L.shin; k1.add(a1); an.push(a1);
    mk(new RoundedBoxGeometry(0.05 * H * b, 0.045 * H, 0.15 * H, 3, 0.012 * H), shoeM, a1, ind, 0, -0.0165 * H, 0.04 * H);
    mk(new RoundedBoxGeometry(0.08 * H, 0.075 * H, 0.2 * H, 3, 0.02 * H), grey, a1, eva, 0, -0.0045 * H, 0.05 * H);
  }

  // ---- head: egg-shaped skull with a tapered jaw, features placed by raycasting onto the surface ----
  const rx = 0.043 * H, ry = 0.065 * H, rz = 0.054 * H, cy = 0.052 * H, cz = 0.004 * H;
  const hg = new THREE.SphereGeometry(1, 44, 30), hp = hg.attributes.position, jaw = s.female ? 0.3 : 0.25;
  for (let i = 0; i < hp.count; i++) {
    let x = hp.getX(i), y = hp.getY(i), z = hp.getZ(i);
    const t = clamp((0.1 - y) / 1.1, 0, 1), k = t * t * (3 - 2 * t);
    x *= 1 - jaw * k; z *= 1 - 0.08 * k; if (y < 0 && z > 0) z += 0.05 * k;
    hp.setXYZ(i, x * rx, y * ry + cy, z * rz + cz);
  }
  hg.computeVertexNormals();
  const head = mk(hg, headM, hd);
  head.updateMatrixWorld(true);
  const rc = new THREE.Raycaster();
  const surf = (x: number, y: number) => { rc.set(new THREE.Vector3(x, y, 1), new THREE.Vector3(0, 0, -1)); const h = rc.intersectObject(head)[0]; return h ? h.point.z : rz * 0.8 + cz; };
  const add = (o: THREE.Mesh, x: number, y: number, z: number) => { o.position.set(x, y, z); o.castShadow = false; hd.add(o); return o; };
  const eyeX = 0.0185 * H, eyeY = cy + 0.006 * H, eyeR = 0.0072 * H, eyeT = eyeTexture(s.eye);
  const eye: THREE.Group[] = [], lid: THREE.Mesh[] = [];
  for (const sg of [1, -1]) {
    const zE = surf(sg * eyeX, eyeY) - 0.0032 * H;
    const eg = new THREE.Group(); eg.position.set(sg * eyeX, eyeY, zE); hd.add(eg); eye.push(eg);
    eg.add(new THREE.Mesh(new THREE.SphereGeometry(eyeR, 20, 14), new THREE.MeshStandardMaterial({ map: eyeT, roughness: 0.2 })));
    const ld = add(new THREE.Mesh(new THREE.SphereGeometry(eyeR * 1.13, 20, 10, 0, TAU, 0, PI / 2).rotateX(PI / 2), skinM), sg * eyeX, eyeY, zE); ld.rotation.x = -2.0; lid.push(ld);
    const browY = cy + 0.0185 * H;
    const br = add(new THREE.Mesh(new THREE.CapsuleGeometry((s.female ? 0.0019 : 0.0027) * H, 0.017 * H, 3, 6).rotateZ(PI / 2), browM), sg * eyeX, browY, surf(sg * eyeX, browY) + 0.0012 * H); br.rotation.z = sg * 0.12;
    const ear = add(new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), skinM), sg * rx * 0.965, cy - 0.002 * H, cz - 0.002 * H); ear.scale.set(0.0045 * H, 0.016 * H, 0.011 * H);
    const ala = add(new THREE.Mesh(new THREE.SphereGeometry(0.0052 * H, 8, 6), skinM), sg * 0.0072 * H, cy - 0.0205 * H, surf(sg * 0.0072 * H, cy - 0.0205 * H) + 0.0018 * H); void ala;
  }
  const nose = add(new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), skinM), 0, cy - 0.011 * H, surf(0, cy - 0.012 * H) + 0.002 * H); nose.scale.set(0.0085 * H, 0.0175 * H, 0.0105 * H);
  add(new THREE.Mesh(new THREE.SphereGeometry(0.0072 * H, 10, 8), skinM), 0, cy - 0.021 * H, surf(0, cy - 0.021 * H) + 0.0058 * H);
  const lipC = new THREE.Color(s.skin).lerp(new THREE.Color(0x8c3a3a), 0.5).getHex(), my = cy - 0.036 * H;
  const mouth = add(new THREE.Mesh(new THREE.TorusGeometry(0.0105 * H, 0.0017 * H, 6, 16, PI).rotateZ(PI), std(lipC, 0.5)), 0, my, surf(0, my) + 0.0006 * H); mouth.scale.set(1, 0.28, 1);
  const lower = add(new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), std(lipC, 0.45)), 0, my - 0.0042 * H, surf(0, my - 0.0042 * H) + 0.0004 * H); lower.scale.set(0.0085 * H, 0.0024 * H, 0.0028 * H);

  // ---- hair ----
  const tilt = -0.35, pole = new THREE.Vector3(0, cos(tilt), sin(tilt));
  const shell = (k: number, len: number) => { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18, 0, TAU, 0, len), hairM); m.scale.set(rx * k * 1.04, ry * k * 1.03, rz * k * 1.06); m.position.set(0, cy + 0.002 * H, cz); m.rotation.x = tilt; m.castShadow = true; hd.add(m); return m; };
  const puffs = (n: number, r0: number, r1: number, cap: number, shellK: number) => {
    const im = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), hairM, n), d = new THREE.Object3D(), v = new THREE.Vector3(); let i = 0;
    while (i < n) { v.randomDirection(); if (v.dot(pole) < cos(cap)) continue; const r = rnd(r0, r1) * H; d.position.set(v.x * rx * shellK, cy + v.y * ry * shellK, cz + v.z * rz * shellK); d.scale.setScalar(r); d.updateMatrix(); im.setMatrixAt(i++, d.matrix); }
    im.castShadow = true; hd.add(im);
  };
  let tail: THREE.Group | null = null;
  if (s.style === 'buzz') shell(1.012, 1.28);
  else if (s.style === 'wavy') { shell(1.05, 1.34); puffs(28, 0.012, 0.018, 0.9, 1.08); }
  else if (s.style === 'curly') { shell(1.04, 1.3); puffs(90, 0.016, 0.024, 1.25, 1.1); }
  else {
    shell(1.035, 1.34); tail = new THREE.Group(); tail.position.set(0, cy + 0.016 * H, cz - rz * 0.95); hd.add(tail);
    mk(seg(0.17 * H, 0.015 * H, 0.007 * H, 0.002 * H), hairM, tail, undefined, 0, 0, 0); mk(new THREE.TorusGeometry(0.014 * H, 0.004 * H, 6, 12), std(0x7a1f2b, 0.8), tail, undefined, 0, -0.012 * H, 0);
  }

  // ---- EVA helmet: clear bubble, half-raised gold sun visor, lights ----
  mk(new THREE.SphereGeometry(0.095 * H, 28, 20), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.02, transparent: true, opacity: 0.1, depthWrite: false }), hd, eva, 0, cy, cz).castShadow = false;
  const visor = mk(new THREE.SphereGeometry(0.099 * H, 28, 12, 0, TAU, 0, 0.85).rotateX(0.436), std(0xd8b04a, 0.15, 0.85, { emissive: 0x2b1e05, side: THREE.DoubleSide }), hd, eva, 0, cy, cz); void visor;
  mk(new THREE.SphereGeometry(0.1 * H, 28, 14, 0, TAU, 0, 1.15).rotateX(-0.55), white, hd, eva, 0, cy, cz);
  for (const sg of [1, -1]) mk(new THREE.BoxGeometry(0.014 * H, 0.01 * H, 0.014 * H), new THREE.MeshBasicMaterial({ color: 0xfff6dc }), hd, eva, sg * 0.07 * H, cy + 0.065 * H, cz + 0.04 * H);

  // ---- hand-held props (shown per task) ----
  const items: Record<string, THREE.Object3D> = {};
  const prop = (name: string, hand: 0 | 1, o: THREE.Object3D) => { o.visible = false; hold[hand].add(o); items[name] = o; return o; };
  const bx = (w: number, h: number, d: number, c: number, em = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), std(c, 0.5, 0.2, em ? { emissive: em, emissiveIntensity: 0.9 } : {})); m.castShadow = true; return m; };
  const tab = prop('tablet', 0, new THREE.Group()); const tb = bx(0.012, 0.2, 0.15, 0x20262e, 0x2a6a8a); tb.position.set(0, -0.07, 0); tab.add(tb);
  const pad = prop('pad', 0, new THREE.Group()); const pb = bx(0.012, 0.2, 0.15, 0xe8e2cf); pb.position.set(0, -0.07, 0); pad.add(pb);
  const pen = prop('pen', 1, new THREE.Group()); const pn = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.14, 8), std(0x222222)); pn.position.set(0, -0.05, 0.03); pn.rotation.x = 0.6; pen.add(pn);
  const cam = prop('camera', 1, new THREE.Group()); const cb = bx(0.14, 0.09, 0.07, 0x15181c); cb.position.set(0, -0.03, 0.04); cam.add(cb);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.06, 14), std(0x0a0a0c, 0.2, 0.6)); lens.rotation.x = PI / 2; lens.position.set(0, -0.03, 0.09); cam.add(lens);
  const pou = prop('pouch', 1, new THREE.Group()); const po = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.13, 12), std(0xdfe6ee, 0.4)); po.position.set(0, -0.04, 0.02); pou.add(po);
  const sco = prop('scoop', 1, new THREE.Group()); const sc1 = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.62, 8), std(0x9aa1ab, 0.4, 0.6)); sc1.position.set(0, -0.2, 0.18); sc1.rotation.x = -0.75; sco.add(sc1);
  const sc2 = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8, 0, TAU, 0, PI / 2), std(0x9aa1ab, 0.4, 0.6)); sc2.position.set(0, -0.43, 0.4); sc2.rotation.x = 2.3; sco.add(sc2);
  const bru = prop('brush', 1, new THREE.Group()); const br1 = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.4, 8), std(0x40464e)); br1.position.set(0, -0.12, 0.12); br1.rotation.x = -0.9; bru.add(br1);
  const br2 = bx(0.14, 0.03, 0.05, 0xb8a888); br2.position.set(0, -0.3, 0.3); br2.rotation.x = -0.9; bru.add(br2);
  const bag = prop('bag', 0, new THREE.Group()); const bg = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), std(0xf4f4f0, 0.9)); bg.scale.set(1, 1.35, 0.8); bg.position.set(0, -0.14, 0); bag.add(bg);

  return { root, pv, sp, ch, nk, hd, sh, el, wr, hip, kn, an, eye, lid, mouth, tail, ind, eva, skinEx, items, L: { thigh: L.thigh, shin: L.shin, ankle: L.ankle } };
}

// ---------------------------------------------------------------- poses
const KEYS = ['spX', 'spY', 'spZ', 'chX', 'chY', 'chZ', 'nkX', 'nkY', 'nkZ', 'hdX', 'hdY', 'hdZ', 'lsX', 'lsY', 'lsZ', 'leX', 'leY', 'lwX', 'lwZ', 'rsX', 'rsY', 'rsZ', 'reX', 'reY', 'rwX', 'rwZ', 'lhX', 'lhZ', 'lkX', 'rhX', 'rhZ', 'rkX', 'lie', 'pitch', 'roll', 'tilt'];
const BASE: Pose = Object.fromEntries(KEYS.map((k) => [k, 0])) as Pose;
Object.assign(BASE, { lsX: 0.04, rsX: 0.04, lsZ: 0.09, rsZ: -0.09, leX: -0.2, reX: -0.2, lkX: 0.05, rkX: 0.05, spX: 0.02 });
function apply(r: Rig, p: Pose) {
  r.sp.rotation.set(p.spX, p.spY, p.spZ); r.ch.rotation.set(p.chX, p.chY, p.chZ); r.nk.rotation.set(p.nkX, p.nkY, p.nkZ);
  r.sh[0].rotation.set(p.lsX, p.lsY, p.lsZ); r.sh[1].rotation.set(p.rsX, p.rsY, p.rsZ);
  r.el[0].rotation.set(p.leX, p.leY, 0); r.el[1].rotation.set(p.reX, p.reY, 0);
  r.wr[0].rotation.set(p.lwX, 0, p.lwZ); r.wr[1].rotation.set(p.rwX, 0, p.rwZ);
  r.hip[0].rotation.set(p.lhX, 0, p.lhZ); r.hip[1].rotation.set(p.rhX, 0, p.rhZ);
  r.kn[0].rotation.x = p.lkX; r.kn[1].rotation.x = p.rkX;
  r.an[0].rotation.x = -(p.lhX + p.lkX) * 0.85; r.an[1].rotation.x = -(p.rhX + p.rkX) * 0.85;
  r.pv.rotation.set(p.pitch - p.lie * (PI / 2), p.roll, p.tilt);
}
const legH = (r: Rig, h: number, k: number) => r.L.thigh * cos(h) + r.L.shin * cos(h + k) + r.L.ankle;

// ---------------------------------------------------------------- tasks
interface Stop { x: number; z: number; yaw: number; anim: string; dwell: number; eva?: boolean; bay?: number }
interface TaskDef { id: string; slot: Slot; w: number; dur: [number, number]; stops: (b: Bot) => Stop[] }
interface Node { x: number; z: number; ev?: string; wait?: number; lane?: boolean; speed?: number; lk?: number }
const BAYS = [0.28 * PI, 0.5 * PI, 0.72 * PI];
const bedStop = (bay: number): Stop => ({ ...pol(6.52, BAYS[bay]), yaw: -BAYS[bay], anim: 'sleep', dwell: 1e9, bay });
const win = (anim: string, d: [number, number]): Stop => { const a = pick([1.22, 1.92]); return { ...pol(6.38, a), yaw: faceOut(a), anim, dwell: rnd(d[0], d[1]) }; };
const PROPS = [{ x: -10, z: 9.5, r: 3.2 }, { x: 10.2, z: -9, r: 3.2 }, { x: -7, z: -11, r: 3.2 }, { x: 14, z: 6, r: 1.8 }, { x: 8.5, z: 7.5, r: 0.8 }];
const ROOM = [{ x: -2.6, z: -2.08, r: 0.75 }, { x: 0, z: -2.08, r: 0.75 }, { x: 2.6, z: -2.08, r: 0.75 }, { x: 0, z: 2.47, r: 1.25 }];
const farPoint = () => { for (let i = 0; i < 40; i++) { const a = rnd(0, TAU), r = rnd(17, 44), p = pol(r, a); if (PROPS.every((c) => hypot(p.x - c.x, p.z - c.z) > c.r + 2)) return p; } return pol(30, 1); };
const evaStops = (anim: string, n: number, d: [number, number]): Stop[] => Array.from({ length: n }, () => ({ ...farPoint(), yaw: rnd(0, TAU), anim, dwell: rnd(d[0], d[1]), eva: true }));
const TASKS: TaskDef[] = [
  { id: 'sleep', slot: 'sleep', w: 1, dur: [1e9, 1e9], stops: (b) => [bedStop(b.bay)] },
  { id: 'stargaze', slot: 'window', w: 5, dur: [70, 120], stops: () => [win('gaze', [60, 110])] },
  { id: 'photo', slot: 'window', w: 2, dur: [40, 70], stops: () => [win('photo', [40, 60])] },
  { id: 'journal', slot: 'window', w: 1.5, dur: [45, 80], stops: () => [win('journal', [45, 70])] },
  { id: 'coffee', slot: 'window', w: 1.4, dur: [30, 45], stops: () => [{ ...pol(5.72, -0.3 * PI), yaw: faceOut(-0.3 * PI), anim: 'drink', dwell: rnd(30, 45) }] },
  { id: 'stretch', slot: 'window', w: 1, dur: [24, 34], stops: () => [{ x: rnd(-1.2, 1.2), z: rnd(-0.5, 0.5), yaw: rnd(0, TAU), anim: 'stretch', dwell: rnd(24, 34) }] },
  { id: 'update', slot: 'comms', w: 5, dur: [70, 120], stops: () => [{ ...pol(5.78, -0.9 * PI), yaw: faceOut(-0.9 * PI), anim: 'type', dwell: rnd(70, 120) }] },
  { id: 'radio', slot: 'comms', w: 1.6, dur: [35, 55], stops: () => [{ ...pol(5.78, -0.9 * PI), yaw: faceOut(-0.9 * PI), anim: 'radio', dwell: rnd(35, 55) }] },
  { id: 'rack', slot: 'comms', w: 2, dur: [45, 75], stops: () => { const a = pick([-0.48, -0.62, -0.76]) * PI; return [{ ...pol(5.55, a), yaw: faceOut(a), anim: 'tablet', dwell: rnd(45, 75) }]; } },
  { id: 'lab', slot: 'comms', w: 1.5, dur: [45, 75], stops: () => [{ x: pick([-2.6, 0, 2.6]), z: -1.12, yaw: PI, anim: 'lab', dwell: rnd(45, 75) }] },
  { id: 'moonwalk', slot: 'eva', w: 3, dur: [90, 140], stops: () => evaStops('look', 3, [6, 11]) },
  { id: 'sample', slot: 'eva', w: 3, dur: [90, 140], stops: () => evaStops('sample', 3, [16, 22]) },
  { id: 'dust', slot: 'eva', w: 1.5, dur: [50, 70], stops: () => [{ x: 12.0, z: 6, yaw: PI / 2, anim: 'dust', dwell: rnd(50, 70), eva: true }] },
  { id: 'inspect', slot: 'eva', w: 1.5, dur: [70, 100], stops: () => [
    { x: 10.2, z: -7.4, yaw: PI, anim: 'tablet', dwell: rnd(14, 20), eva: true }, { x: -6.5, z: 9.5, yaw: -PI / 2, anim: 'tablet', dwell: rnd(14, 20), eva: true }, { x: -4.8, z: -11, yaw: -PI / 2, anim: 'tablet', dwell: rnd(14, 20), eva: true }] },
];
const NEXT: Record<Slot, Slot> = { sleep: 'window', window: 'comms', comms: 'eva', eva: 'sleep' };

// ---------------------------------------------------------------- one crew member
class Bot {
  rig: Rig; x = 0; z = 0; yaw = 0; v = 0; phase = Math.random() * TAU; t = Math.random() * 50; ph0 = Math.random() * 10;
  eva = false; slot: Slot = 'window'; task: TaskDef | null = null; taskLeft = 0; stops: Stop[] = []; si = 0; dwell = 0; doing = false;
  nodes: Node[] = []; waitLeft = 0; sleepStage = 0; bay = 0; pending: Slot | null = null; hold = 0; waitFor: Bot | null = null;
  cur: Pose = { ...BASE }; py = 0.9; roll = 0; rollT = rnd(40, 90); blink = 0; blinkT = rnd(1, 4); sacT = 0; sac: [number, number] = [0, 0];
  gaze: [number, number] = [0, 0]; glance = 0; glanceT = rnd(6, 16); talk = 0; cruise: number;
  constructor(public spec: Spec, private crew: Crew) { this.rig = build(spec); this.cruise = 1.05 * spec.tempo; this.setEva(false); }

  setEva(on: boolean) { this.eva = on; for (const o of this.rig.ind) o.visible = !on; for (const o of this.rig.skinEx) o.visible = !on; for (const o of this.rig.eva) o.visible = on; }
  get asleep() { return this.sleepStage === 3; }

  assign(slot: Slot, immediate: boolean, bay?: number) {
    this.slot = slot; if (bay !== undefined) this.bay = bay;
    this.pickTask(); if (immediate) this.teleport(); else this.goStop(0);
  }
  private pickTask() {
    const pool = TASKS.filter((t) => t.slot === this.slot && t !== this.task); const all = pool.length ? pool : TASKS.filter((t) => t.slot === this.slot);
    let r = Math.random() * all.reduce((s, t) => s + t.w, 0); let t = all[0]; for (const c of all) { r -= c.w; if (r <= 0) { t = c; break; } }
    this.task = t; this.taskLeft = rnd(t.dur[0], t.dur[1]); this.stops = t.stops(this); this.si = 0;
  }
  private teleport() {
    const s = this.stops[0]; this.x = s.x; this.z = s.z; this.yaw = s.yaw; this.setEva(!!s.eva); this.nodes = []; this.doing = true; this.dwell = s.dwell; this.v = 0;
    if (s.anim === 'sleep') { this.sleepStage = 3; this.bay = s.bay ?? this.bay; this.py = 0.85; }
  }
  private goStop(i: number) {
    this.si = i; const s = this.stops[i]; this.doing = false; this.dwell = s.dwell; this.nodes = this.route(s);
  }
  private lock(k: number, out: boolean): Node[] {
    const a = k * PI, P = (u: number, ev?: string, wait?: number): Node => ({ ...pol(u, a), ev: ev ? `${ev}` : undefined, wait, lk: k, lane: true });
    const iN = HAB_R - 1.4, iM = HAB_R + 0.9, oM = HAB_R + TL - 0.9, oX = HAB_R + TL + 1.9;
    return out ? [P(iN, 'o:i', 1.1), P(iM, 'c:i', 1.0), P(iM, 'eva', 9), P(iM, 'o:o', 1.1), P(oX, 'c:o', 0.4)]
      : [P(oX, 'o:o', 1.1), P(oM, 'c:o', 1.0), P(oM, 'ind', 8), P(oM, 'o:i', 1.1), P(iN, 'c:i', 0.4)];
  }
  private route(s: Stop): Node[] {
    const n: Node[] = [];
    if (this.sleepStage > 0) { // wake up: sit up on the bunk edge, then stand and leave through the curtain gap
      const th = BAYS[this.bay]; n.push({ ...pol(6.3, th), lane: true, speed: 0.4, ev: 'sit-up', wait: 3.5 }, { ...pol(5.65, th), lane: true, speed: 0.7, ev: 'stand' });
    }
    if (!this.eva && s.eva) n.push(...this.lock(0, true));
    else if (this.eva && !s.eva) n.push(...this.lock(1, false));
    if (s.anim === 'sleep') { const th = BAYS[s.bay ?? 0]; n.push({ ...pol(5.15, th) }, { ...pol(5.72, th), ev: 'sit' }, { ...pol(6.3, th), lane: true, speed: 0.6, ev: 'lie', wait: 3.5 }, { ...pol(6.52, th), lane: true, speed: 0.25, ev: 'asleep' }); }
    else n.push({ x: s.x, z: s.z });
    return n;
  }
  private arrive(n: Node) {
    switch (n.ev) {
      case 'o:i': this.crew.hab.setDoor(n.lk ?? 0, 'inner', true); break; case 'c:i': this.crew.hab.setDoor(n.lk ?? 0, 'inner', false); break;
      case 'o:o': this.crew.hab.setDoor(n.lk ?? 0, 'outer', true); break; case 'c:o': this.crew.hab.setDoor(n.lk ?? 0, 'outer', false); break;
      case 'eva': this.setEva(true); break; case 'ind': this.setEva(false); break;
      case 'sit': this.sleepStage = 1; break; case 'lie': this.sleepStage = 2; break; case 'asleep': this.sleepStage = 3; this.rollT = rnd(40, 90); break;
      case 'sit-up': this.sleepStage = 1; break; case 'stand': this.sleepStage = 0; break;
    }
    if (n.wait) this.waitLeft = n.wait;
  }
  private circles() { return this.eva ? PROPS.concat([{ x: 0, z: 0, r: HAB_R + 1.3 }]) : ROOM; }

  update(dt: number, cam: THREE.Vector3) {
    this.t += dt; const T = this.t * this.spec.tempo + this.ph0, r = this.rig;
    if (this.pending && (!this.waitFor || this.waitFor.asleep) && (this.hold -= dt) <= 0) { const s = this.pending; this.pending = null; this.waitFor = null; this.assign(s, false); }

    // ---- scheduling and locomotion ----
    let moving = false;
    if (this.waitLeft > 0) { this.waitLeft -= dt; this.v *= 0.8; }
    else if (this.nodes.length) {
      const n = this.nodes[0]; let dx = n.x - this.x, dz = n.z - this.z; const d = hypot(dx, dz);
      if (d < 0.18) { this.nodes.shift(); this.arrive(n); if (!this.nodes.length) { this.doing = true; this.v = 0; } }
      else {
        dx /= d; dz /= d;
        if (!n.lane) for (const c of this.circles()) {
          const ox = this.x - c.x, oz = this.z - c.z, od = hypot(ox, oz), R = c.r + 0.45;
          if (od < R + 1.2 && od > 0.01) { const w = clamp((R + 1.2 - od) / 1.2, 0, 1) * (od < R ? 2.5 : 1.4), tx = -oz / od, tz = ox / od, side = dx * tx + dz * tz >= 0 ? 1 : -1; dx += ((ox / od) * 0.9 + tx * side * 1.3) * w; dz += ((oz / od) * 0.9 + tz * side * 1.3) * w; }
        }
        const m = hypot(dx, dz) || 1; dx /= m; dz /= m;
        const cr = (n.speed ?? this.cruise * (this.eva ? 1.55 : 1)), tv = this.nodes.length === 1 ? min(cr, 0.35 + d * 0.9) : cr;
        const da = wrap(atan2(dx, dz) - this.yaw); this.yaw += clamp(da, -3.2 * dt, 3.2 * dt);
        this.v += (tv * max(0, cos(da)) - this.v) * min(1, dt * 3);
        this.x += sin(this.yaw) * this.v * dt; this.z += cos(this.yaw) * this.v * dt; moving = this.v > 0.12;
        if (!this.eva && !n.lane) { const rr = hypot(this.x, this.z), lim = HAB_R - 0.55; if (rr > lim) { this.x *= lim / rr; this.z *= lim / rr; } }
      }
    } else { this.v *= 0.8; }
    if (this.doing && !this.nodes.length && this.waitLeft <= 0) {
      const s = this.stops[this.si];
      if (this.sleepStage === 0) this.yaw += clamp(wrap(s.yaw - this.yaw), -2 * dt, 2 * dt);
      this.dwell -= dt; this.taskLeft -= dt;
      if (this.slot !== 'sleep' && !this.pending) {
        if (this.taskLeft <= 0) { this.pickTask(); this.goStop(0); }
        else if (this.dwell <= 0 && this.stops.length > 1) { const ni = (this.si + 1) % this.stops.length; if (ni === 0 && this.task) this.stops = this.task.stops(this); this.goStop(ni); }
      }
    }
    if (this.sleepStage >= 2) { // settle onto the bunk and turn to lie along it
      const th = BAYS[this.bay], p = pol(6.52, th); this.x += (p.x - this.x) * min(1, dt * 0.8); this.z += (p.z - this.z) * min(1, dt * 0.8); this.yaw += wrap(-th - this.yaw) * min(1, dt * 1.2);
    }
    if (moving) this.phase += (dt * TAU * this.v) / (0.83 * this.spec.h * (this.eva ? 1.4 : 1));

    // ---- choose animation ----
    const stop = this.stops[this.si];
    const anim = this.sleepStage === 1 ? 'sitbed' : this.sleepStage >= 2 ? 'sleep' : moving ? 'walk' : this.doing && !this.nodes.length && this.waitLeft <= 0 && stop ? stop.anim : 'idle';
    const { p: tp, gaze, hand, talk } = this.animate(anim, T);
    if (this.eva && anim !== 'walk' && anim !== 'sample') { tp.lsZ = (tp.lsZ ?? BASE.lsZ) + 0.1; tp.rsZ = (tp.rsZ ?? BASE.rsZ) - 0.1; }
    const tgt: Pose = { ...BASE, ...tp };
    if (anim === 'sleep') { this.rollT -= dt; if (this.rollT <= 0) { this.rollT = rnd(60, 140); this.roll = pick([-0.9, 0, 0, 0.9]); } tgt.roll = this.roll; } else this.roll = 0;
    const rate = anim === 'sleep' || anim === 'sitbed' ? 2.4 : anim === 'walk' ? 14 : 5;
    const a = 1 - Math.exp(-dt * rate); for (const k of KEYS) this.cur[k] += (tgt[k] - this.cur[k]) * a;

    // ---- gaze: saccades, glances at the player, head/eye split ----
    let [gy, gp] = gaze;
    this.sacT -= dt; if (this.sacT <= 0) { this.sacT = rnd(0.7, 2.4); this.sac = [rnd(-0.07, 0.07), rnd(-0.04, 0.04)]; }
    this.glanceT -= dt; if (this.glanceT <= 0 && !this.asleep && this.sleepStage === 0) { this.glanceT = rnd(9, 22); const dd = hypot(cam.x - this.x, cam.z - this.z); if (dd < 7) this.glance = rnd(1.3, 2.6); }
    if (this.glance > 0) {
      this.glance -= dt; const dx = cam.x - this.x, dz = cam.z - this.z, lx = dx * cos(this.yaw) - dz * sin(this.yaw), lz = dx * sin(this.yaw) + dz * cos(this.yaw), yy = atan2(lx, lz);
      if (abs(yy) < 1.9) { gy = yy; gp = atan2(cam.y - (this.crew.floor(this.x, this.z) + this.py + 0.4 * this.spec.h), hypot(lx, lz)); }
    }
    const ga = 1 - Math.exp(-dt * 7); this.gaze[0] += (gy + this.sac[0] - this.gaze[0]) * ga; this.gaze[1] += (gp + this.sac[1] - this.gaze[1]) * ga;
    const hy = clamp(this.gaze[0] * 0.55, -0.9, 0.9), hx = -clamp(this.gaze[1] * 0.5, -0.5, 0.45);
    r.hd.rotation.set(this.cur.hdX + hx, this.cur.hdY + hy, this.cur.hdZ);
    const ey = clamp(this.gaze[0] - hy, -0.5, 0.5), ep = clamp(this.gaze[1] + hx * 2, -0.4, 0.4);
    for (const e of r.eye) e.rotation.set(-ep, ey, 0);
    this.blinkT -= dt; if (this.blinkT <= 0) { this.blink = 0.16; this.blinkT = rnd(2.2, 6.5); }
    this.blink = max(0, this.blink - dt);
    const closed = this.sleepStage >= 2 ? 1 : this.blink > 0 ? sin((this.blink / 0.16) * PI) : 0;
    for (const l of r.lid) l.rotation.x = lerp(-2.0, -0.12, closed);
    this.talk = talk ? 0.5 + 0.5 * sin(T * 11) * sin(T * 3.1) : 0;
    r.mouth.scale.y = 0.28 + this.talk * 0.9;

    // ---- body placement: ground contact solved from the leg pose, breathing, props ----
    apply(r, this.cur);
    const c = this.cur, br = sin(T * (this.sleepStage >= 2 ? 1.2 : 1.7));
    r.ch.scale.set(1 + 0.008 * br, 1 + 0.006 * br, 1 + 0.02 * br);
    const floor = this.crew.floor(this.x, this.z);
    let py = max(legH(r, c.lhX, c.lkX), legH(r, c.rhX, c.rkX));
    if (anim === 'walk') py += (this.eva ? 0.1 : 0.035) * abs(sin(this.phase)) * clamp(this.v / 1.5, 0, 1);
    if (this.sleepStage === 1) py = 0.82; else if (this.sleepStage >= 2) py = 0.85;
    this.py += (py - this.py) * min(1, dt * (this.sleepStage ? 3 : 14));
    r.root.position.set(this.x, floor + this.py, this.z);
    r.pv.position.y = 0; r.root.rotation.y = this.yaw;
    if (r.tail) r.tail.rotation.x = 0.22 + 0.1 * sin(this.phase * 2) * clamp(this.v, 0, 1) - c.hdX * 0.4 + 0.03 * sin(T * 1.3);
    for (const k in r.items) r.items[k].visible = k === hand[0] || k === hand[1];
  }

  // ---------------------------------------------------------------- animation library (target joint angles)
  private animate(name: string, T: number): { p: Pose; gaze: [number, number]; hand: (string | null)[]; talk: boolean } {
    const eva = this.eva, o = (p: Pose, gaze: [number, number] = [0, 0], hand: (string | null)[] = [null, null], talk = false) => ({ p, gaze, hand, talk });
    switch (name) {
      case 'walk': {
        const k = clamp(this.v / (eva ? 1.8 : 1.15), 0, 1.25), A = (eva ? 0.62 : 0.4) * k, K = (eva ? 1.0 : 0.75) * k, ph = this.phase, s1 = sin(ph), s2 = -s1;
        const kn = (q: number) => 0.07 + K * max(0, cos(q - 0.35)) ** 1.4, arm = (eva ? 0.28 : 0.5) * k;
        return o({ lhX: -A * s1, rhX: -A * s2, lkX: kn(ph), rkX: kn(ph + PI), lsX: arm * s1 + 0.05, rsX: arm * s2 + 0.05, leX: -0.25 - 0.25 * k, reX: -0.25 - 0.25 * k, spY: 0.12 * k * s1, chY: -0.14 * k * s1, tilt: 0.03 * k * s1, spX: (eva ? 0.16 : 0.05) * k, hdY: 0.05 * k * s1 }, [0, 0.03]);
      }
      case 'gaze': { const c = sm(sin(T * 0.12) * 3); return o({ hdX: -0.12, nkX: -0.08, spX: 0.05, lsX: lerp(-0.1, -0.75, c), lsZ: lerp(0.1, -0.45, c), leX: lerp(-0.25, -1.9, c), rsX: lerp(0, -0.75, c), rsZ: lerp(-0.1, 0.45, c), reX: lerp(-0.3, -1.9, c), tilt: 0.02 * sin(T * 0.3), lkX: 0.06 + 0.05 * max(0, sin(T * 0.25)), rkX: 0.06 + 0.05 * max(0, -sin(T * 0.25)) }, [0.05 * sin(T * 0.3), 0.55 + 0.12 * sin(T * 0.2)]); }
      case 'photo': { const u = clamp((0.62 - (T % 10) / 10) * 12, 0, 1); return o({ lsX: lerp(-0.1, -1.2, u), leX: lerp(-0.25, -1.65, u), lsZ: 0.12, rsX: lerp(0.05, -1.25, u), reX: lerp(-0.3, -1.7, u), rsZ: -0.12, spX: 0.04 }, [0, 0.3 * u + 0.1], [null, u > 0.5 ? 'camera' : null]); }
      case 'journal': { const up = sin(T * 0.35) > 0.85 ? 1 : 0; return o({ lsX: -0.5, leX: -1.55, leY: 1.2, lsZ: 0.12, rsX: -0.55, reX: -1.5, rsZ: -0.12, rwX: 0.12 * sin(T * 9), chX: 0.1, hdX: 0.34 - 0.34 * up }, [0, up ? 0.3 : -0.45], ['pad', 'pen']); }
      case 'drink': { const c = T % 11, sip = c > 5 && c < 8.5 ? 1 : 0; return o({ rsX: lerp(-0.3, -0.85, sip), reX: lerp(-0.5, -2.15, sip), lsX: -0.35 + 0.1 * sin(T * 0.6), leX: -0.9, chX: 0.06, hdX: sip ? -0.14 : 0.08 }, [0.3 * sin(T * 0.3), sip ? 0.1 : -0.1], [null, 'pouch']); }
      case 'stretch': { const f = (T % 15) / 15; if (f < 0.35) return o({ lsX: -3.0, rsX: -3.0, lsZ: 0.15, rsZ: -0.15, spX: -0.12, chX: -0.1, hdX: -0.15 }, [0, 0.5]); if (f < 0.7) { const sd = f < 0.52 ? 1 : -1; return o({ lsX: sd > 0 ? -2.9 : 0.1, rsX: sd > 0 ? 0.1 : -2.9, lsZ: sd > 0 ? 0.3 : 0.2, rsZ: sd > 0 ? -0.2 : -0.3, spZ: sd * 0.3, chZ: sd * 0.12, lhZ: 0.1, rhZ: -0.1 }); } return o({ spX: 1.15, chX: 0.25, hdX: 0.25, lsX: 0.3, rsX: 0.3, lkX: 0.08, rkX: 0.08 }, [0, -0.6]); }
      case 'type': { const c = T % 15, rub = c > 10 && c < 13.2 ? 1 : 0, lean = c > 6 && c < 8.5 ? 1 : 0; return o({ lsX: -0.7, leX: -1.25, lwX: 0.25 + 0.06 * sin(T * 17), rsX: lerp(-0.7, -2.3, rub), reX: lerp(-1.25, -1.7, rub), rwX: 0.25 + 0.06 * sin(T * 13.3), chX: 0.1 + 0.1 * lean - 0.05 * rub, hdX: 0.1, hdY: lean * 0.25 * sin(T * 0.9), lsZ: 0.06, rsZ: -0.06 }, [lean * 0.4 * sin(T * 0.7), -0.2]); }
      case 'radio': return o({ rsX: -0.85, rsZ: -0.45, reX: -2.4, lsX: -0.6, leX: -1.0, lwX: 0.2, chX: 0.08, hdX: 0.05 + 0.05 * sin(T * 1.4), hdY: 0.12 * sin(T * 0.5) }, [0.2 * sin(T * 0.4), -0.1], [null, null], true);
      case 'tablet': { const c = T % 10, up = c > 7 ? 1 : 0; return o({ lsX: -0.55, leX: -1.7, leY: 1.25, rsX: -0.75, reX: -1.55, rwX: 0.1 * sin(T * 8), hdX: lerp(0.32, -0.02, up), chX: 0.06, hdY: up * 0.25 * sin(T) }, [up * 0.3 * sin(T * 0.8), up ? 0.1 : -0.4], ['tablet', null]); }
      case 'lab': { const lk = sin(T * 0.45) > 0.6 ? 1 : 0; return o({ lsX: -0.75 + 0.1 * sin(T * 1.3), leX: -1.15, rsX: -0.7 + 0.1 * sin(T * 0.9 + 1), reX: -1.2, chX: 0.22, spX: 0.1, hdX: lerp(0.35, 0, lk) }, [lk * 0.4 * sin(T), lk ? 0.2 : -0.45]); }
      case 'sample': { const c = T % 20, dn = clamp(min(c / 2, (18 - c) / 2), 0, 1); return o({ lhX: -1.05 * dn, rhX: -1.0 * dn, lkX: lerp(0.05, 1.35, dn), rkX: lerp(0.05, 1.3, dn), spX: lerp(0.02, 0.75, dn), chX: 0.25 * dn, hdX: -0.3 * dn, lsX: lerp(0, -0.9, dn), leX: -0.5, rsX: lerp(0, -1.15, dn) + 0.25 * sin(T * 2.2) * dn, reX: -0.5 - 0.3 * dn }, [0, -0.5 * dn], dn > 0.5 ? ['bag', 'scoop'] : ['bag', null]); }
      case 'dust': return o({ rsX: -1.55 + 0.3 * sin(T * 3.1), reX: -0.4, lsX: -1.1, leX: -0.8, spX: 0.08, hdX: -0.2 }, [0, 0.4], [null, 'brush']);
      case 'look': { const c = T % 12, ph = c > 8 && c < 10.5 ? 1 : 0; return o({ chX: 0.015 * sin(T * 1.5), hdY: 0.1 * sin(T * 0.2), rsX: lerp(0.05, -1.25, ph), reX: lerp(-0.3, -1.7, ph), rsZ: -0.12, lsX: -0.2, leX: -1.2, spX: 0.04 }, [0.7 * sin(T * 0.45), 0.1], [null, ph > 0.5 ? 'camera' : null]); }
      case 'sitbed': return o({ lhX: -1.45, rhX: -1.5, lkX: 1.45, rkX: 1.4, spX: 0.1, chX: 0.08, lsX: -0.3, lsZ: 0.12, leX: -0.5, rsX: -0.3, reX: -0.5, hdX: 0.1 }, [0, 0]);
      case 'sleep': return o({ lie: 1, lhX: -0.1, rhX: -0.05, lkX: 0.2, rkX: 0.25, lhZ: 0.06, rhZ: -0.06, lsX: 0.05, lsZ: 0.16, leX: -0.2, rsX: -0.35, rsZ: 0.25, reX: -1.4, hdX: -0.08, hdZ: 0.12 + 0.05 * sin(T * 0.1), nkX: 0 }, [0, 0]);
      default: { const w = sin(T * 0.3); return o({ chX: 0.015 * sin(T * 1.5), lsZ: 0.1 + 0.02 * sin(T * 0.7), hdY: 0.1 * sin(T * 0.21), tilt: 0.02 * w, lkX: 0.04 + 0.05 * max(0, w), rkX: 0.04 + 0.05 * max(0, -w) }, [0.25 * sin(T * 0.17), 0.02]); }
    }
  }
}

// ---------------------------------------------------------------- crew manager
export class Crew {
  bots: Bot[] = []; private next = rnd(CREW_CFG.rotateMin, CREW_CFG.rotateMax); private open = [0, 0, 0];
  constructor(scene: THREE.Scene, readonly ground: (x: number, z: number) => number, readonly hab: CrewHab) {
    for (const s of ROSTER) { const b = new Bot(s, this); this.bots.push(b); scene.add(b.rig.root); }
    const slots: Slot[] = ['sleep', 'window', 'comms', 'eva'];
    this.bots.forEach((b, i) => b.assign(slots[i], true, i === 0 ? 1 : undefined));
  }
  /** floor height under a point: hab/airlock decking sits 3 cm above the pad */
  floor(x: number, z: number) { const inH = hypot(x, z) < HAB_R || (abs(z) < 0.9 && abs(x) < HAB_R + TL); return this.ground(x, z) + (inH ? 0.03 : 0); }
  private by(s: Slot) { return this.bots.find((b) => (b.pending ?? b.slot) === s)!; }
  /** shift change: sleeper -> window -> comms -> EVA -> sleeper. The new sleeper is in bed before the old one wakes. */
  rotate() {
    const sl = this.by('sleep'), wi = this.by('window'), co = this.by('comms'), ev = this.by('eva');
    ev.assign('sleep', false, pick([0, 1, 2].filter((i) => i !== sl.bay)));
    co.assign('eva', false);
    wi.pending = 'comms'; wi.hold = 7; wi.waitFor = null;
    sl.pending = 'window'; sl.hold = 2; sl.waitFor = ev;
  }
  update(dt: number, cam: THREE.Vector3) {
    dt = min(dt, 0.1);
    this.next -= dt; if (this.next <= 0 && this.bots.every((b) => !b.pending)) { this.rotate(); this.next = rnd(CREW_CFG.rotateMin, CREW_CFG.rotateMax); }
    for (const b of this.bots) b.update(dt, cam);
    this.hab.curtains.forEach((g, i) => { // bunk curtain draws back while someone is in the bay
      const occ = this.bots.some((b) => b.sleepStage > 0 && b.bay === i) ? 1 : 0; this.open[i] += (occ - this.open[i]) * min(1, dt * 1.5);
      const m = g.children[0]; if (m) { m.scale.z = lerp(1, 0.3, this.open[i]); m.position.z = lerp(0, 0.7, this.open[i]); } if (g.children[1]) g.children[1].visible = this.open[i] < 0.5;
    });
  }
}
