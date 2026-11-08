import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { NASA, panelTexture, tileTexture, crinkleTexture, meatball, worm, plateTexture, flagTexture } from './livery';

// Pressurised Lunar Terrain Vehicle, modelled on the white faceted pressurised rover in the reference images:
// six big balloon tyres with yellow hubs on independent tubular suspension, a faceted two-seat cab with a
// three-pane windscreen and lattice-framed side windows, a gold-and-white equipment bay with hex modules and a
// slanted solar blanket, and an open flatbed with cargo. Local frame: +x forward, +y up, +z starboard, y = 0 is the ground.
export const WHEEL_R = 0.9, WHEEL_W = 0.8, TRACK = 1.9, AXLES = [4.0, 0.2, -3.6], FLOOR_Y = 1.5, ROOF_Y = 3.85;
export const CAB = { x0: 1.4, x1: 4.9, half: 1.45 };
// interaction and camera anchors inside the cab (local metres)
export const SEAT_EYE = new THREE.Vector3(3.55, 2.98, -0.62);
export const HATCH = { x: 2.15, z: -1.45 };
export const RADIO = { x: 1.95, z: 0.95 };
export const AISLE = { x0: 1.78, x1: 2.98, z0: -1.3, z1: 1.3 };

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const cv = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const tex = (c: HTMLCanvasElement, rx = 1, ry = 1, srgb = true) => {
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; return t;
};
const rbox = (w: number, h: number, d: number, r = 0.04) => new RoundedBoxGeometry(w, h, d, 3, Math.max(0.002, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)));
const std = (c: number, rough = 0.5, metal = 0.2, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal, ...extra });
const glowMat = (c: number, k = 1.4) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: k, roughness: 0.4 });
function mk(parent: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, shadow = true) {
  const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = shadow; o.receiveShadow = true; parent.add(o); return o;
}
/** Place a unit-height cylinder between two points; returns an updater for moving parts. */
function strut(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material, seg = 10) {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, seg), m); o.castShadow = true; parent.add(o);
  const up = V(0, 1, 0), d = new THREE.Vector3();
  const set = (p: THREE.Vector3, q: THREE.Vector3) => { d.subVectors(q, p); const L = d.length(); o.position.copy(p).addScaledVector(d, 0.5); o.scale.set(1, Math.max(L, 1e-4), 1); o.quaternion.setFromUnitVectors(up, d.normalize()); };
  set(a, b); return Object.assign(o, { set });
}
function tube(parent: THREE.Object3D, pts: THREE.Vector3[], r: number, m: THREE.Material, seg = 40) {
  const o = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.2), seg, r, 8, false), m); o.castShadow = true; parent.add(o); return o;
}

// ---------- textures ----------
function treadTex() {
  const c = cv(256, 512), g = c.getContext('2d')!;
  g.fillStyle = '#2b2c2e'; g.fillRect(0, 0, 256, 512);
  for (let i = 1; i < 12; i++) { g.fillStyle = '#0d0d0e'; g.fillRect(0, (i * 512) / 12 - 3, 256, 6); }
  for (let i = 0; i < 12; i++) for (let j = 0; j < 8; j++) { g.fillStyle = (i + j) % 2 ? '#4a4b4e' : '#3a3b3e'; g.fillRect(j * 32 + 4, (i * 512) / 12 + 6, 24, 512 / 12 - 12); }
  return tex(c, 36, 1, false);
}
function hubTex() {
  const c = cv(512, 512), g = c.getContext('2d')!;
  g.fillStyle = '#e4b21c'; g.fillRect(0, 0, 512, 512);
  g.fillStyle = '#3a3320'; g.beginPath(); g.arc(256, 256, 252, 0, 7); g.arc(256, 256, 236, 0, 7, true); g.fill();
  g.strokeStyle = '#8a6a10'; g.lineWidth = 6;
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; g.beginPath(); g.moveTo(256 + Math.cos(a) * 90, 256 + Math.sin(a) * 90); g.lineTo(256 + Math.cos(a) * 225, 256 + Math.sin(a) * 225); g.stroke(); }
  g.fillStyle = '#4b3f14';
  for (let i = 0; i < 12; i++) { const a = ((i + 0.5) / 12) * Math.PI * 2; g.beginPath(); g.ellipse(256 + Math.cos(a) * 160, 256 + Math.sin(a) * 160, 36, 17, a, 0, 7); g.fill(); }
  g.strokeStyle = '#8a6a10'; g.beginPath(); g.arc(256, 256, 95, 0, 7); g.stroke(); g.beginPath(); g.arc(256, 256, 228, 0, 7); g.stroke();
  return tex(c, 1, 1);
}
function hazardTex() {
  const c = cv(128, 128), g = c.getContext('2d')!;
  g.fillStyle = '#e8b923'; g.fillRect(0, 0, 128, 128); g.fillStyle = '#16181b';
  for (let i = -2; i < 6; i++) { g.beginPath(); g.moveTo(i * 32, 128); g.lineTo(i * 32 + 16, 128); g.lineTo(i * 32 + 16 + 128, 0); g.lineTo(i * 32 + 128, 0); g.fill(); }
  return tex(c, 3, 1);
}
function grateTex(rx: number, ry: number) {
  const c = cv(64, 64), g = c.getContext('2d')!;
  g.fillStyle = '#17191c'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#8f969e';
  for (let i = 0; i < 4; i++) { g.fillRect(i * 16, 0, 4, 64); g.fillRect(0, i * 16, 64, 4); }
  return tex(c, rx, ry);
}
function diamondTex(rx: number, ry: number) {
  const c = cv(64, 64), g = c.getContext('2d')!;
  g.fillStyle = '#7d848c'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#a9b0b8';
  for (const [x, y] of [[16, 16], [48, 48]]) { g.save(); g.translate(x, y); g.rotate(0.6); g.fillRect(-9, -3, 18, 6); g.restore(); }
  for (const [x, y] of [[48, 16], [16, 48]]) { g.save(); g.translate(x, y); g.rotate(-0.6); g.fillRect(-9, -3, 18, 6); g.restore(); }
  return tex(c, rx, ry);
}
function coilTex() {
  const c = cv(32, 128), g = c.getContext('2d')!;
  g.fillStyle = '#d65a14'; g.fillRect(0, 0, 32, 128); g.fillStyle = '#7a2d08';
  for (let i = 0; i < 12; i++) g.fillRect(0, i * 10.7 + 6, 32, 3);
  return tex(c, 1, 1);
}
export function makeScreen(w = 256, h = 160) {
  const c = cv(w, h), g = c.getContext('2d')!, t = tex(c, 1, 1); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  g.fillStyle = '#04141c'; g.fillRect(0, 0, w, h); t.needsUpdate = true;
  return { c, g, t };
}
const letterTex = (text: string, fg: string, bg: string, w = 256, h = 96) => {
  const c = cv(w, h), g = c.getContext('2d')!; g.fillStyle = bg; g.fillRect(0, 0, w, h); g.fillStyle = fg;
  g.font = `bold ${h * 0.55}px Helvetica, Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 + 3);
  g.strokeStyle = fg; g.lineWidth = 3; g.strokeRect(2, 2, w - 4, h - 4); return tex(c, 1, 1);
};

// ---------- planar faces with real window openings ----------
type Poly = [number, number][];
type Face = { q: THREE.Vector3[]; out: THREE.Vector3; win?: Poly[] };
const bil = (q: THREE.Vector3[], s: number, t: number) =>
  q[0].clone().multiplyScalar((1 - s) * (1 - t)).addScaledVector(q[1], s * (1 - t)).addScaledVector(q[2], s * t).addScaledVector(q[3], (1 - s) * t);
function basis(q: THREE.Vector3[], out: THREE.Vector3) {
  const u = q[1].clone().sub(q[0]).normalize(), n = u.clone().cross(q[3].clone().sub(q[0])).normalize();
  if (n.dot(out) < 0) n.negate();
  const v = n.clone().cross(u).normalize(); return { p0: q[0].clone(), u, v, n };
}
function polyGeom(pts: THREE.Vector3[], holes: THREE.Vector3[][], b: ReturnType<typeof basis>) {
  const to2 = (P: THREE.Vector3) => { const d = P.clone().sub(b.p0); return new THREE.Vector2(d.dot(b.u), d.dot(b.v)); };
  const sh = new THREE.Shape(pts.map(to2)); for (const h of holes) sh.holes.push(new THREE.Path(h.map(to2)));
  const g = new THREE.ShapeGeometry(sh), p = g.attributes.position, nor: number[] = [], col: number[] = [], tmp = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    tmp.copy(b.p0).addScaledVector(b.u, p.getX(i)).addScaledVector(b.v, p.getY(i)); p.setXYZ(i, tmp.x, tmp.y, tmp.z); nor.push(b.n.x, b.n.y, b.n.z);
    const k = 0.58 + 0.42 * Math.min(1, Math.max(0, (tmp.y - 1.5) / 1.5)); col.push(k, k * 0.985, k * 0.96); // lunar dust darkens the lower panels
  }
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); return g;
}
const glassM = new THREE.MeshPhysicalMaterial({ color: 0x8fa4b4, roughness: 0.03, metalness: 0.1, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide });

export type Wheel = { side: number; x: number; front: boolean; hub: THREE.Group; steer: THREE.Group; spin: THREE.Group; links: ((hubY: number) => void) };
export type RoverModel = ReturnType<typeof buildRoverModel>;

export function buildRoverModel() {
  const root = new THREE.Group(), chassis = new THREE.Group(); root.add(chassis);
  const body = std(0xffffff, 0.45, 0.15, { map: panelTexture('#f3f3f1', '#b4b8bb', 1, 1), side: THREE.DoubleSide, vertexColors: true });
  const white = std(0xf1f2f0, 0.45, 0.15, { map: panelTexture('#f3f3f1', '#b4b8bb', 1, 1) });
  const bodyPlain = std(0xf1f2f0, 0.45, 0.15, { map: panelTexture('#f3f3f1', '#b4b8bb', 1, 1), side: THREE.DoubleSide });
  const grey = std(NASA.grey, 0.45, 0.45), steel = std(0xb9bfc8, 0.35, 0.65), dark = std(0x23272d, 0.7, 0.35), rubber = std(0x151618, 0.95, 0);
  const gold = std(NASA.gold, 0.32, 0.85, { bumpMap: crinkleTexture(3, 3), bumpScale: 2 }), copper = std(0xb87333, 0.35, 0.85), brass = std(0xc9a24a, 0.35, 0.8);
  const yellow = std(0xe8b923, 0.5, 0.2), red = std(NASA.red, 0.5, 0.2), blue = std(NASA.blue, 0.5, 0.2), hazard = std(0xffffff, 0.6, 0.1, { map: hazardTex() });
  const lampOn = glowMat(0xfff4dc, 1.8), amber = glowMat(0xffa31a, 1.5), taillamp = glowMat(0xff2a1a, 1.3);

  // ---- ladder-frame chassis, cross members, skid plates, under-floor battery in gold foil ----
  for (const s of [-1, 1]) {
    mk(chassis, rbox(10.6, 0.34, 0.26, 0.06), grey, -0.1, 1.2, s * 0.95); mk(chassis, rbox(10.6, 0.1, 0.34, 0.03), steel, -0.1, 1.04, s * 0.95);
    mk(chassis, rbox(9.4, 0.08, 0.5, 0.02), dark, -0.4, 0.8, s * 0.7); // skid rail
  }
  for (let x = -5; x <= 4.8; x += 1.0) mk(chassis, rbox(0.18, 0.22, 2.0, 0.04), grey, x, 1.16, 0);
  mk(chassis, rbox(3.0, 0.5, 1.5, 0.1), gold, 1.4, 0.98, 0); mk(chassis, rbox(0.1, 0.4, 1.5, 0.02), dark, 2.9, 0.98, 0);
  mk(chassis, rbox(2.2, 0.36, 1.3, 0.1), gold, -2.5, 1.02, 0);
  mk(chassis, rbox(2.6, 0.04, 1.7, 0.02), dark, 1.4, 0.7, 0, false); // belly plate
  // propellant / water tanks slung between the rails
  for (const [x, r, L] of [[-0.9, 0.3, 1.3], [-1.6, 0.26, 1.1]] as const) for (const s of [-1, 1]) {
    const t = mk(chassis, new THREE.CapsuleGeometry(r, L, 6, 16), steel, x, 0.98, s * 0.55); t.rotation.z = Math.PI / 2; t.rotation.x = 0; t.rotation.y = Math.PI / 2;
  }

  // ---- six wheels on independent tubular suspension ----
  const tireM = std(0xffffff, 0.95, 0, { map: treadTex(), bumpMap: treadTex(), bumpScale: 1.6 });
  const prof = [[0.56, -0.36], [0.68, -0.42], [0.8, -0.4], [0.87, -0.33], [0.9, -0.22], [0.9, 0.22], [0.87, 0.33], [0.8, 0.4], [0.68, 0.42], [0.56, 0.36]].map(([r, y]) => new THREE.Vector2(r, y));
  const tireG = new THREE.LatheGeometry(prof, 72).rotateX(Math.PI / 2), hubM = std(0xffffff, 0.45, 0.3, { map: hubTex() });
  const coilM = std(0xffffff, 0.5, 0.3, { map: coilTex() });
  const wheels: Wheel[] = [];
  for (const ax of AXLES) for (const side of [-1, 1]) {
    const front = ax === AXLES[0], hub = new THREE.Group(); hub.userData.dynGroup = true; hub.position.set(ax, WHEEL_R, side * TRACK); chassis.add(hub);
    const steer = new THREE.Group(), spin = new THREE.Group(); hub.add(steer); steer.add(spin);
    mk(spin, tireG, tireM);
    // wheel disc, rim lip, hub cap, lug nuts, hub motor boss
    const face = new THREE.CylinderGeometry(0.58, 0.58, 0.06, 56).rotateX(Math.PI / 2);
    mk(spin, face, hubM, 0, 0, side * 0.36); mk(spin, face, hubM, 0, 0, -side * 0.36);
    for (const zz of [0.38, -0.38]) { const lip = mk(spin, new THREE.TorusGeometry(0.58, 0.035, 8, 48), gold, 0, 0, zz); lip.castShadow = false; }
    mk(spin, new THREE.CylinderGeometry(0.2, 0.22, 0.12, 24).rotateX(Math.PI / 2), grey, 0, 0, side * 0.42);
    mk(spin, new THREE.CylinderGeometry(0.1, 0.1, 0.05, 20).rotateX(Math.PI / 2), steel, 0, 0, side * 0.49);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; mk(spin, new THREE.CylinderGeometry(0.028, 0.028, 0.05, 6).rotateX(Math.PI / 2), steel, Math.cos(a) * 0.31, Math.sin(a) * 0.31, side * 0.4, false); }
    // fixed to the hub (not the spin): motor housing and brake calliper
    mk(hub, new THREE.CylinderGeometry(0.17, 0.17, 0.36, 20).rotateX(Math.PI / 2), dark, 0, 0, -side * 0.5);
    mk(hub, rbox(0.14, 0.26, 0.1, 0.03), red, 0.38, 0.1, -side * 0.34);
    // fender with lip trims
    const fender = mk(chassis, new THREE.CylinderGeometry(1.08, 1.08, WHEEL_W + 0.3, 40, 1, true, Math.PI / 2, Math.PI).rotateX(Math.PI / 2), bodyPlain, ax, WHEEL_R + 0.05, side * TRACK);
    fender.castShadow = true;
    for (const zz of [-1, 1]) { const lip = mk(chassis, new THREE.TorusGeometry(1.08, 0.03, 6, 40, Math.PI), steel, ax, WHEEL_R + 0.05, side * TRACK + zz * (WHEEL_W / 2 + 0.15), false); lip.castShadow = false; }
    mk(chassis, rbox(0.9, 0.05, WHEEL_W + 0.34, 0.02), grey, ax, WHEEL_R + 1.12, side * TRACK, false); // fender top spine
    // suspension: lower and upper wishbones, damper with coil
    const aLo = V(ax, 1.0, side * 0.95), aUp = V(ax, 1.4, side * 0.95), aSh = V(ax - 0.3, 1.42, side * 1.12);
    const lo = strut(chassis, aLo, aLo.clone(), 0.055, steel), up = strut(chassis, aUp, aUp.clone(), 0.045, steel), lo2 = strut(chassis, aLo, aLo.clone(), 0.04, steel);
    const shO = strut(chassis, aSh, aSh.clone(), 0.07, dark), shI = strut(chassis, aSh, aSh.clone(), 0.045, steel), coil = strut(chassis, aSh, aSh.clone(), 0.11, coilM, 14);
    const tie = front ? strut(chassis, V(ax + 0.5, 1.0, side * 0.95), V(ax + 0.5, 0.9, side * 1.4), 0.03, steel) : null;
    for (const o of [lo, up, lo2, shO, shI, coil, tie]) if (o) o.userData.dyn = true;
    const links = (hubY: number) => {
      const hp = V(ax, hubY, side * (TRACK - 0.45));
      lo.set(aLo, hp.clone().add(V(0.15, -0.14, 0))); lo2.set(aLo.clone().add(V(-0.3, 0, 0)), hp.clone().add(V(-0.15, -0.14, 0)));
      up.set(aUp, hp.clone().add(V(0, 0.32, 0)));
      const sb = hp.clone().add(V(-0.3, -0.14, side * 0.1)), mid = aSh.clone().lerp(sb, 0.55);
      shO.set(aSh, mid); shI.set(mid, sb); coil.set(aSh.clone().lerp(sb, 0.08), aSh.clone().lerp(sb, 0.62));
      if (tie) tie.set(V(ax + 0.5, 1.0, side * 0.95), hp.clone().add(V(0.5, -0.1, side * 0.35)));
    };
    links(WHEEL_R); wheels.push({ side, x: ax, front, hub, steer, spin, links });
    // axle housing visible between rail and hub
    mk(chassis, new THREE.CylinderGeometry(0.1, 0.1, 0.5, 14).rotateX(Math.PI / 2), dark, ax, 0.95, side * (TRACK - 0.55));
  }
  // anti-roll bars and drive-line harness
  for (const ax of AXLES) mk(chassis, new THREE.CylinderGeometry(0.035, 0.035, 2 * TRACK - 1.0, 10).rotateX(Math.PI / 2), steel, ax - 0.5, 0.75, 0);
  tube(chassis, [V(4.2, 1.02, -0.5), V(2.0, 0.78, -0.6), V(0.2, 0.9, -0.4), V(-1.6, 0.8, -0.5), V(-3.5, 0.95, -0.4)], 0.035, copper);
  tube(chassis, [V(4.2, 1.0, 0.5), V(2.0, 0.76, 0.6), V(0.2, 0.88, 0.4), V(-1.6, 0.78, 0.5), V(-3.5, 0.93, 0.4)], 0.035, std(0x1f4aa0, 0.5, 0.2));

  // ---- cab: faceted shell with real window openings ----
  const cabHalf = CAB.half, X0 = CAB.x0, Yb = FLOOR_Y, Yt = ROOF_Y;
  const L = (x: number, y: number) => V(x, y, -cabHalf), Rr = (x: number, y: number) => V(x, y, cabHalf);
  const faces: Face[] = [
    // port side: hatch opening + one window; starboard side: two windows
    { q: [L(X0, Yb), L(3.6, Yb), L(3.6, Yt), L(X0, Yt)], out: V(0, 0, -1), win: [[[0.07, 0.06], [0.62, 0.06], [0.62, 0.8], [0.07, 0.8]], [[0.7, 0.42], [0.93, 0.42], [0.93, 0.8], [0.7, 0.8]]] },
    { q: [Rr(X0, Yb), Rr(3.6, Yb), Rr(3.6, Yt), Rr(X0, Yt)], out: V(0, 0, 1), win: [[[0.07, 0.42], [0.46, 0.42], [0.46, 0.8], [0.07, 0.8]], [[0.54, 0.42], [0.93, 0.42], [0.93, 0.8], [0.54, 0.8]]] },
    // angled side-front facets with diamond windows
    { q: [L(3.6, 2.5), V(4.75, 2.5, -1.25), V(3.9, Yt, -1.1), L(3.6, Yt)], out: V(0.3, 0, -1), win: [[[0.2, 0.22], [0.78, 0.22], [0.58, 0.8], [0.22, 0.8]]] },
    { q: [Rr(3.6, 2.5), V(4.75, 2.5, 1.25), V(3.9, Yt, 1.1), Rr(3.6, Yt)], out: V(0.3, 0, 1), win: [[[0.2, 0.22], [0.78, 0.22], [0.58, 0.8], [0.22, 0.8]]] },
    { q: [L(3.6, Yb), V(4.9, Yb, -1.15), V(4.75, 2.5, -1.25), L(3.6, 2.5)], out: V(0.4, 0, -1) },
    { q: [Rr(3.6, Yb), V(4.9, Yb, 1.15), V(4.75, 2.5, 1.25), Rr(3.6, 2.5)], out: V(0.4, 0, 1) },
    // three-pane windscreen and the lower nose with two warm-lit triangular lights
    { q: [V(4.75, 2.5, -1.25), V(4.75, 2.5, 1.25), V(3.9, Yt, 1.1), V(3.9, Yt, -1.1)], out: V(1, 0.6, 0), win: [[[0.03, 0.1], [0.28, 0.1], [0.27, 0.9], [0.05, 0.9]], [[0.32, 0.1], [0.68, 0.1], [0.68, 0.9], [0.32, 0.9]], [[0.72, 0.1], [0.97, 0.1], [0.95, 0.9], [0.73, 0.9]]] },
    { q: [V(4.9, Yb, -1.15), V(4.9, Yb, 1.15), V(4.75, 2.5, 1.25), V(4.75, 2.5, -1.25)], out: V(1, 0, 0), win: [[[0.1, 0.3], [0.32, 0.3], [0.21, 0.82]], [[0.68, 0.3], [0.9, 0.3], [0.79, 0.82]]] },
    { q: [L(X0, Yb), Rr(X0, Yb), Rr(X0, Yt), L(X0, Yt)], out: V(-1, 0, 0) },
    { q: [L(X0, Yb), L(4.9, Yb), Rr(4.9, Yb), Rr(X0, Yb)], out: V(0, -1, 0) },
  ];
  const cabG = new THREE.Group(); root.add(cabG);
  for (const f of faces) {
    const b = basis(f.q, f.out), holes = (f.win ?? []).map((w) => w.map(([s, t]) => bil(f.q, s, t)));
    mk(cabG, polyGeom(f.q, holes, b), body);
    for (const h of holes) {
      const c = h.reduce((a, p) => a.add(p), V(0, 0, 0)).multiplyScalar(1 / h.length), outer = h.map((p) => p.clone().add(p.clone().sub(c).normalize().multiplyScalar(0.08)));
      const ring = new THREE.ExtrudeGeometry((() => { const to2 = (P: THREE.Vector3) => { const d = P.clone().sub(b.p0); return new THREE.Vector2(d.dot(b.u), d.dot(b.v)); }; const s = new THREE.Shape(outer.map(to2)); s.holes.push(new THREE.Path(h.map(to2))); return s; })(), { depth: 0.07, bevelEnabled: false });
      ring.applyMatrix4(new THREE.Matrix4().makeBasis(b.u, b.v, b.n).setPosition(b.p0)); mk(cabG, ring, grey);
      const glass = new THREE.ShapeGeometry(new THREE.Shape(h.map((P) => { const d = P.clone().sub(b.p0); return new THREE.Vector2(d.dot(b.u), d.dot(b.v)); })));
      glass.applyMatrix4(new THREE.Matrix4().makeBasis(b.u, b.v, b.n).setPosition(b.p0.clone().addScaledVector(b.n, 0.02))); const gm = new THREE.Mesh(glass, glassM); gm.renderOrder = 2; cabG.add(gm);
    }
  }
  // roof (hexagon), with a hatch plate and structural ribs
  {
    const q = [L(X0, Yt), L(3.6, Yt), V(3.9, Yt, -1.1), V(3.9, Yt, 1.1), Rr(3.6, Yt), Rr(X0, Yt)], b = basis([q[0], q[5], q[3], q[1]], V(0, 1, 0));
    mk(cabG, polyGeom(q, [], b), body);
  }
  // lattice: diagonal struts over the windscreen and side facets, like the reference frames
  for (const s of [-1, 1]) {
    strut(cabG, V(4.75, 2.5, s * 0.5), V(3.9, Yt, s * 0.6), 0.03, white); strut(cabG, V(4.75, 2.5, s * 1.25), V(3.9, Yt, s * 1.1), 0.045, white);
    strut(cabG, V(3.6, Yb + 0.05, s * 1.47), V(3.6, Yt, s * 1.47), 0.05, white); strut(cabG, V(X0, Yb, s * 1.47), V(X0, Yt, s * 1.47), 0.06, white);
    strut(cabG, V(X0, Yt, s * 1.47), V(3.6, Yt, s * 1.47), 0.05, white);
  }
  strut(cabG, V(4.75, 2.5, -1.25), V(4.75, 2.5, 1.25), 0.05, white); strut(cabG, V(3.9, Yt, -1.1), V(3.9, Yt, 1.1), 0.05, white);
  // hazard bumper, tow points, headlamp bank, light bars, amber beacon
  mk(cabG, rbox(0.22, 0.26, 2.5, 0.06), hazard, 5.02, 1.62, 0);
  for (const s of [-1, 1]) { mk(cabG, new THREE.TorusGeometry(0.1, 0.025, 8, 16), steel, 5.1, 1.62, s * 0.75).rotation.y = Math.PI / 2; }
  for (const z of [-0.95, -0.55, -0.2, 0.2, 0.55, 0.95]) mk(cabG, rbox(0.06, 0.16, 0.2, 0.03), lampOn, 4.93, 2.12, z, false);
  for (const z of [-0.8, 0.8]) mk(cabG, rbox(0.08, 0.1, 0.3, 0.03), amber, 4.9, 1.82, z, false);
  mk(cabG, rbox(0.12, 0.1, 2.1, 0.03), lampOn, 3.97, Yt + 0.1, 0, false); mk(cabG, rbox(0.12, 0.06, 1.5, 0.03), lampOn, 3.55, Yt + 0.08, 0, false);
  for (const z of [-1, 1]) for (const x of [1.7, 3.3]) mk(cabG, rbox(0.12, 0.1, 0.1, 0.03), lampOn, x, Yt + 0.04, z * 1.4, false);
  mk(cabG, new THREE.CylinderGeometry(0.1, 0.12, 0.14, 16), amber, 2.2, Yt + 0.12, 0.9, false);
  // roof rails and rack
  for (const s of [-1, 1]) { tube(cabG, [V(X0 + 0.1, Yt + 0.28, s * 1.3), V(3.7, Yt + 0.28, s * 1.3)], 0.025, steel, 4); for (const x of [X0 + 0.1, 2.5, 3.7]) strut(cabG, V(x, Yt, s * 1.3), V(x, Yt + 0.28, s * 1.3), 0.02, steel, 6); }
  tube(cabG, [V(X0 + 0.1, Yt + 0.28, -1.3), V(X0 + 0.1, Yt + 0.28, 1.3)], 0.025, steel, 4); tube(cabG, [V(3.7, Yt + 0.28, -1.3), V(3.7, Yt + 0.28, 1.3)], 0.025, steel, 4);
  // X-band dish on a gimballed mast, UHF whips, mast camera pod, star tracker, mirror
  const dishG = new THREE.Group(); dishG.position.set(2.0, Yt, -0.7); cabG.add(dishG);
  mk(dishG, new THREE.CylinderGeometry(0.07, 0.1, 0.8, 14), steel, 0, 0.4, 0); mk(dishG, rbox(0.3, 0.2, 0.3, 0.05), grey, 0, 0.85, 0);
  const bowl = mk(dishG, new THREE.SphereGeometry(0.55, 40, 14, 0, Math.PI * 2, 0, 0.62), std(0xf4f5f4, 0.3, 0.3, { side: THREE.DoubleSide }), 0.05, 1.15, 0); bowl.scale.y = 0.5; bowl.rotation.set(0, 0, -1.15);
  strut(dishG, V(0.05, 1.15, 0), V(0.45, 1.5, 0), 0.02, steel, 6); mk(dishG, new THREE.CylinderGeometry(0.03, 0.05, 0.14, 10), brass, 0.47, 1.52, 0).rotation.z = -1.0;
  for (const [x, z, h] of [[1.6, 0.85, 1.7], [1.5, 0.55, 1.2]] as const) { const w = strut(cabG, V(x, Yt, z), V(x, Yt + h, z), 0.012, dark, 6); void w; mk(cabG, new THREE.SphereGeometry(0.03, 8, 8), steel, x, Yt + h, z, false); }
  const mast = new THREE.Group(); mast.position.set(3.55, Yt, 0.85); cabG.add(mast);
  mk(mast, new THREE.CylinderGeometry(0.045, 0.06, 1.2, 12), steel, 0, 0.6, 0); mk(mast, rbox(0.22, 0.14, 0.7, 0.04), grey, 0, 1.25, 0);
  for (const z of [-0.26, 0.26]) { mk(mast, new THREE.CylinderGeometry(0.05, 0.05, 0.12, 16).rotateZ(Math.PI / 2), dark, 0.14, 1.27, z); mk(mast, new THREE.CircleGeometry(0.045, 16).rotateY(Math.PI / 2), glowMat(0x2a6aff, 0.8), 0.205, 1.27, z, false); }
  mk(cabG, rbox(0.16, 0.12, 0.16, 0.03), dark, 2.9, Yt + 0.06, 0.4); mk(cabG, new THREE.CylinderGeometry(0.05, 0.05, 0.1, 12), glowMat(0x2a6aff, 0.5), 2.9, Yt + 0.15, 0.4, false);
  for (const s of [-1, 1]) { strut(cabG, V(4.0, 3.3, s * 1.1), V(4.0, 3.3, s * 1.55), 0.02, steel, 6); mk(cabG, rbox(0.04, 0.2, 0.13, 0.015), dark, 4.0, 3.3, s * 1.58); }

  // ---- hatch: swings outwards on a vertical hinge; step plates, handrails, hazard threshold ----
  const hatch = new THREE.Group(); hatch.userData.dynGroup = true; hatch.position.set(2.8, 0, -cabHalf); cabG.add(hatch);
  {
    const hw = 1.3, hy0 = Yb + 0.1, hy1 = 3.22, leaf = new THREE.Shape();
    leaf.moveTo(-hw, hy0); leaf.lineTo(0, hy0); leaf.lineTo(0, hy1); leaf.lineTo(-hw, hy1); leaf.lineTo(-hw, hy0);
    const hole = new THREE.Path(); hole.absarc(-hw / 2, 2.75, 0.24, 0, Math.PI * 2, true); leaf.holes.push(hole);
    const lg = new THREE.ExtrudeGeometry(leaf, { depth: 0.1, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.02, bevelSegments: 2, curveSegments: 32 });
    lg.translate(0, 0, -0.1); mk(hatch, lg, std(0xffffff, 0.45, 0.2, { map: panelTexture('#f3f3f1', '#b4b8bb', 1, 1) }));
    for (const dz of [0.06, -0.1]) mk(hatch, new THREE.TorusGeometry(0.255, 0.035, 10, 36), grey, -hw / 2, 2.75, dz);
    mk(hatch, new THREE.CircleGeometry(0.24, 36), glassM, -hw / 2, 2.75, -0.04).renderOrder = 2;
    mk(hatch, new THREE.TorusGeometry(0.14, 0.03, 10, 24), red, -hw / 2, 2.15, -0.14); // handwheel
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI; mk(hatch, new THREE.CylinderGeometry(0.012, 0.012, 0.28, 6), steel, -hw / 2, 2.15, -0.14).rotation.z = a; }
    for (const y of [1.8, 2.5, 3.1]) mk(hatch, new THREE.CylinderGeometry(0.03, 0.03, 0.14, 8).rotateX(Math.PI / 2), steel, 0.03, y, -0.04); // hinges
    mk(hatch, rbox(0.1, 0.4, 0.04, 0.015), hazard, -0.12, 1.92, -0.12);
  }
  mk(cabG, rbox(1.4, 0.05, 0.75, 0.02), std(0xffffff, 0.8, 0.3, { map: grateTex(5, 3) }), 2.15, 0.84, -cabHalf - 0.38);
  mk(cabG, rbox(1.4, 0.06, 0.1, 0.02), hazard, 2.15, 0.86, -cabHalf - 0.76);
  mk(cabG, rbox(1.4, 0.05, 0.7, 0.02), std(0xffffff, 0.8, 0.3, { map: grateTex(5, 3) }), 2.15, 1.18, -cabHalf - 0.35);
  for (const x of [1.5, 2.8]) { tube(cabG, [V(x, 0.85, -cabHalf - 0.7), V(x, 1.5, -cabHalf - 0.7), V(x, 2.9, -cabHalf - 0.38), V(x, 3.0, -cabHalf - 0.06)], 0.025, steel); strut(cabG, V(x, 0.86, -cabHalf - 0.7), V(x, 0.7, -cabHalf - 0.1), 0.02, steel, 6); }

  // ---- cab interior ----
  const cab = new THREE.Group(); root.add(cab);
  mk(cab, new THREE.PlaneGeometry(CAB.x1 - CAB.x0 - 0.4, 2.8).rotateX(-Math.PI / 2), std(0xffffff, 0.8, 0.05, { map: tileTexture('#8d949c', '#6a7078', 5) }), 3.1, Yb + 0.04, 0, false);
  mk(cab, rbox(0.06, 0.1, 2.8, 0.02), blue, CAB.x0 + 0.04, Yb + 0.35, 0, false); // blue interior band
  for (const z of [-0.8, 0.8]) mk(cab, rbox(1.2, 0.03, 0.4, 0.01), glowMat(0xfff1dd, 1.0), z < 0 ? 2.6 : 3.5, Yt - 0.04, z * 0.2, false);
  mk(cab, rbox(3.4, 0.04, 2.7, 0.02), std(0xe9edf0, 0.85, 0.02), 3.2, Yt - 0.06, 0, false);
  // seats, harnesses and armrests
  const seatM = std(0x2c3340, 0.85, 0.05), seatTrim = std(0x1f4aa0, 0.8, 0.05);
  for (const z of [-0.62, 0.62]) {
    mk(cab, rbox(0.55, 0.14, 0.52, 0.06), seatM, 3.45, 1.96, z); mk(cab, rbox(0.14, 0.82, 0.5, 0.06), seatM, 3.14, 2.4, z); mk(cab, rbox(0.12, 0.26, 0.34, 0.05), seatM, 3.1, 2.95, z);
    mk(cab, rbox(0.4, 0.04, 0.54, 0.015), seatTrim, 3.45, 2.04, z); mk(cab, new THREE.CylinderGeometry(0.06, 0.08, 0.4, 12), dark, 3.45, 1.7, z);
    for (const s of [-1, 1]) { mk(cab, rbox(0.4, 0.05, 0.07, 0.02), dark, 3.45, 2.25, z + s * 0.31); strut(cab, V(3.08, 2.88, z + s * 0.15), V(3.28, 2.3, z + s * 0.1), 0.012, red, 6); }
  }
  // dash with three live screens, hood, joystick and throttle
  mk(cab, rbox(0.5, 0.8, 2.3, 0.07), dark, 4.55, 1.95, 0); const dashTop = mk(cab, rbox(0.62, 0.1, 2.3, 0.04), grey, 4.5, 2.4, 0); dashTop.rotation.z = -0.18;
  mk(cab, rbox(0.3, 0.16, 2.3, 0.05), dark, 4.42, 2.52, 0);
  const screens = [makeScreen(), makeScreen(), makeScreen()];
  [-0.7, 0, 0.7].forEach((z, i) => { const m = mk(cab, new THREE.PlaneGeometry(0.58, 0.36), new THREE.MeshBasicMaterial({ map: screens[i].t }), 4.27, 2.35, z, false); m.rotation.y = -Math.PI / 2; m.rotation.x = 0.25; mk(cab, rbox(0.04, 0.42, 0.64, 0.015), dark, 4.28, 2.35, z, false).rotation.z = 0.25; });
  for (let i = 0; i < 14; i++) mk(cab, new THREE.BoxGeometry(0.03, 0.03, 0.05), glowMat(i % 4 === 0 ? 0xffa31a : 0x4fd8ff, 1.2), 4.24, 2.12, -1.0 + i * 0.15, false);
  for (const [x, z, y] of [[3.62, -0.05, 2.26], [3.62, 0.05, 2.26]] as const) { void x; mk(cab, new THREE.CylinderGeometry(0.02, 0.02, 0.2, 8), steel, 3.75, y - 0.04, z * 1.0 - 0.18, false); }
  const stick = new THREE.Group(); stick.position.set(3.7, 2.22, -0.28); cab.add(stick); mk(stick, new THREE.CylinderGeometry(0.03, 0.04, 0.2, 12), dark, 0, 0.1, 0); mk(stick, new THREE.SphereGeometry(0.05, 14, 12), red, 0, 0.22, 0); mk(stick, rbox(0.1, 0.04, 0.1, 0.015), dark, 0, 0.0, 0);
  // centre console, comms radio panel, overhead switch panel
  mk(cab, rbox(1.0, 0.5, 0.34, 0.06), grey, 3.7, 1.82, 0); mk(cab, rbox(0.55, 0.05, 0.3, 0.02), dark, 3.7, 2.1, 0);
  for (let i = 0; i < 8; i++) mk(cab, new THREE.BoxGeometry(0.035, 0.02, 0.035), glowMat(i % 3 ? 0x4fd8ff : 0xffa31a, 1.2), 3.55 + (i % 4) * 0.1, 2.13, -0.08 + Math.floor(i / 4) * 0.12, false);
  mk(cab, rbox(0.9, 0.12, 1.3, 0.04), dark, 3.9, Yt - 0.14, 0);
  for (let i = 0; i < 18; i++) { const sw = mk(cab, new THREE.CylinderGeometry(0.012, 0.012, 0.06, 6), steel, 3.55 + (i % 3) * 0.12 + 0.2, Yt - 0.22, -0.55 + Math.floor(i / 3) * 0.2, false); sw.rotation.z = (i % 2) * 0.5 - 0.25; }
  // rear bulkhead: lockers, radio rack, handholds
  for (const [z, w, txt] of [[-0.95, 0.7, 'SAMPLES'], [-0.2, 0.7, 'TOOLS'], [0.55, 0.7, 'MED KIT']] as const) {
    mk(cab, rbox(0.5, 1.5, w, 0.05), std(0xe3e6e9, 0.5, 0.15), CAB.x0 + 0.3, Yb + 0.8, z);
    const pl = mk(cab, new THREE.PlaneGeometry(0.4, 0.075), new THREE.MeshBasicMaterial({ map: plateTexture(txt) }), CAB.x0 + 0.56, Yb + 1.3, z, false); pl.rotation.y = Math.PI / 2;
  }
  mk(cab, rbox(0.46, 1.5, 0.75, 0.05), graphiteMat(), RADIO.x - 0.2, Yb + 0.8, RADIO.z + 0.15); const radioScr = makeScreen(256, 160);
  const rs = mk(cab, new THREE.PlaneGeometry(0.42, 0.26), new THREE.MeshBasicMaterial({ map: radioScr.t }), RADIO.x + 0.04, Yb + 1.15, RADIO.z + 0.15, false); rs.rotation.y = Math.PI / 2;
  for (let i = 0; i < 9; i++) mk(cab, new THREE.BoxGeometry(0.02, 0.04, 0.04), glowMat(i % 3 ? 0x4fd8ff : 0xffa31a, 1.2), RADIO.x + 0.045, Yb + 0.82, RADIO.z + 0.15 - 0.2 + (i % 3) * 0.08 + 0.04, false).position.y += Math.floor(i / 3) * 0.07;
  for (const z of [-1.3, 1.3]) tube(cab, [V(2.0, Yb + 0.4, z), V(2.0, Yb + 1.25, z), V(3.0, Yb + 1.25, z)], 0.02, steel, 8);
  // port window glass sits behind the hatch; interior light
  const cabLight = new THREE.PointLight(0xfff0dc, 0, 9, 2); cabLight.position.set(2.9, 3.4, 0); cab.add(cabLight);

  // ---- equipment bay: frame, hex modules, tanks, plumbing, slanted solar blanket ----
  const bay = new THREE.Group(); root.add(bay);
  const bx0 = -1.2, bx1 = 1.4;
  for (const s of [-1, 1]) for (const x of [bx0, bx1]) strut(bay, V(x, FLOOR_Y, s * 1.4), V(x, 3.35, s * 1.4), 0.05, white);
  for (const s of [-1, 1]) { strut(bay, V(bx0, 3.0, s * 1.4), V(bx1, 3.4, s * 1.4), 0.05, white); strut(bay, V(bx0, FLOOR_Y, s * 1.4), V(bx1, 3.4, s * 1.4), 0.03, steel); strut(bay, V(bx1, FLOOR_Y, s * 1.4), V(bx0, 3.0, s * 1.4), 0.03, steel); }
  strut(bay, V(bx0, 3.0, -1.4), V(bx0, 3.0, 1.4), 0.05, white); strut(bay, V(bx1, 3.4, -1.4), V(bx1, 3.4, 1.4), 0.05, white);
  mk(bay, rbox(2.6, 0.12, 2.9, 0.03), std(0xffffff, 0.8, 0.3, { map: diamondTex(5, 5) }), 0.1, FLOOR_Y + 0.03, 0);
  for (const s of [-1, 1]) for (const x of [-0.45, 0.8]) {
    const hex = mk(bay, new THREE.CylinderGeometry(0.58, 0.58, 0.55, 6).rotateX(Math.PI / 2), gold, x, 2.35, s * 1.05);
    mk(bay, new THREE.CylinderGeometry(0.5, 0.5, 0.06, 6).rotateX(Math.PI / 2), white, x, 2.35, s * 1.36); void hex;
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + Math.PI / 6; mk(bay, new THREE.CylinderGeometry(0.025, 0.025, 0.05, 6).rotateX(Math.PI / 2), steel, x + Math.cos(a) * 0.4, 2.35 + Math.sin(a) * 0.4, s * 1.4, false); }
    mk(bay, new THREE.CylinderGeometry(0.16, 0.16, 0.08, 16).rotateX(Math.PI / 2), grey, x, 2.35, s * 1.4);
    mk(bay, new THREE.TorusGeometry(0.1, 0.02, 8, 16), copper, x, 2.35, s * 1.45);
  }
  for (const s of [-1, 1]) {
    const t = mk(bay, new THREE.CapsuleGeometry(0.3, 1.4, 8, 20), steel, 0.1, 2.0, s * 0.35); t.rotation.z = Math.PI / 2;
    for (const x of [-0.6, 0.8]) mk(bay, new THREE.TorusGeometry(0.305, 0.03, 8, 24).rotateY(Math.PI / 2), yellow, x, 2.0, s * 0.35);
    mk(bay, new THREE.CylinderGeometry(0.06, 0.06, 0.2, 10), brass, 0.9, 2.0 + 0.3, s * 0.35); mk(bay, new THREE.TorusGeometry(0.07, 0.015, 8, 14), red, 0.9, 2.52, s * 0.35).rotation.x = Math.PI / 2;
  }
  mk(bay, rbox(0.8, 0.9, 0.5, 0.05), grey, -0.9, 2.1, 0); for (let i = 0; i < 12; i++) mk(bay, rbox(0.7, 0.012, 0.46, 0.004), steel, -0.9, 1.7 + i * 0.07, 0, false); // finned fuel-cell stack
  tube(bay, [V(-0.9, 2.5, 0), V(-0.4, 2.9, 0.3), V(0.3, 2.8, 0.5), V(0.9, 2.7, 0.9)], 0.04, copper); tube(bay, [V(-0.9, 2.3, 0), V(-0.3, 2.9, -0.3), V(0.4, 2.7, -0.5), V(0.9, 2.6, -0.9)], 0.04, brass);
  tube(bay, [V(0.1, 2.9, -1.0), V(0.5, 3.2, -0.2), V(0.9, 3.0, 0.5), V(1.2, 2.6, 1.0)], 0.03, std(0x1f4aa0, 0.5, 0.2));
  const solar = new THREE.Group(); solar.position.set((bx0 + bx1) / 2, 3.2, 0); solar.rotation.z = Math.atan2(0.4, bx1 - bx0); bay.add(solar);
  mk(solar, new THREE.BoxGeometry(2.7, 0.05, 2.9), std(0xffffff, 0.3, 0.5, { map: (() => { const t = tex((() => { const c = cv(128, 128), g = c.getContext('2d')!; g.fillStyle = '#12224d'; g.fillRect(0, 0, 128, 128); g.strokeStyle = '#8b97b8'; g.lineWidth = 2; g.strokeRect(1, 1, 126, 126); g.beginPath(); g.moveTo(64, 0); g.lineTo(64, 128); g.moveTo(0, 64); g.lineTo(128, 64); g.stroke(); return c; })(), 7, 7); return t; })() }));
  for (const s of [-1, 1]) mk(solar, rbox(2.75, 0.08, 0.08, 0.02), steel, 0, 0, s * 1.46); for (const x of [-1.37, 1.37]) mk(solar, rbox(0.08, 0.08, 2.95, 0.02), steel, x, 0, 0);
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.8), new THREE.MeshBasicMaterial({ map: meatball(), transparent: true })); p.position.set(0.1, 2.0, s * 1.47); if (s < 0) p.rotation.y = Math.PI; bay.add(p); }

  // ---- flatbed: deck, rails, tie-downs, cargo, tool rack, hitch ----
  const bed = new THREE.Group(); root.add(bed);
  mk(bed, rbox(4.0, 0.12, 3.1, 0.03), std(0xffffff, 0.75, 0.35, { map: diamondTex(8, 6) }), -3.2, FLOOR_Y + 0.02, 0);
  mk(bed, rbox(4.0, 0.3, 0.1, 0.03), white, -3.2, FLOOR_Y - 0.14, -1.5); mk(bed, rbox(4.0, 0.3, 0.1, 0.03), white, -3.2, FLOOR_Y - 0.14, 1.5);
  for (const s of [-1, 1]) {
    tube(bed, [V(-1.25, FLOOR_Y + 0.5, s * 1.5), V(-5.15, FLOOR_Y + 0.5, s * 1.5)], 0.025, steel, 4);
    for (let x = -1.3; x > -5.2; x -= 0.95) strut(bed, V(x, FLOOR_Y + 0.05, s * 1.5), V(x, FLOOR_Y + 0.5, s * 1.5), 0.022, steel, 6);
  }
  tube(bed, [V(-5.15, FLOOR_Y + 0.5, -1.5), V(-5.15, FLOOR_Y + 0.5, 1.5)], 0.025, steel, 4);
  for (const [x, z] of [[-1.6, -1.2], [-1.6, 1.2], [-4.9, -1.2], [-4.9, 1.2], [-3.2, -1.35], [-3.2, 1.35]] as const) mk(bed, new THREE.TorusGeometry(0.07, 0.015, 6, 14).rotateX(Math.PI / 2), steel, x, FLOOR_Y + 0.1, z, false);
  const crateM = std(0xe6e9ec, 0.5, 0.2), plates = ['LUNAR SAMPLES 1', 'LUNAR SAMPLES 2', 'DRILL KIT'];
  [[-1.9, -0.75], [-1.9, 0.5], [-3.0, -0.8]].forEach(([x, z], i) => {
    mk(bed, rbox(0.9, 0.55, 0.65, 0.06), crateM, x, FLOOR_Y + 0.4, z); mk(bed, rbox(0.92, 0.05, 0.67, 0.02), i === 2 ? red : blue, x, FLOOR_Y + 0.52, z);
    const pl = mk(bed, new THREE.PlaneGeometry(0.5, 0.094), new THREE.MeshBasicMaterial({ map: plateTexture(plates[i]) }), x, FLOOR_Y + 0.36, z + 0.335, false); pl.position.z = z + 0.335; });
  mk(bed, new THREE.CylinderGeometry(0.2, 0.2, 1.1, 16), steel, -3.7, FLOOR_Y + 0.62, 0.9); mk(bed, new THREE.CylinderGeometry(0.2, 0.2, 1.1, 16), steel, -4.2, FLOOR_Y + 0.62, 0.9);
  for (const x of [-3.7, -4.2]) { mk(bed, new THREE.TorusGeometry(0.2, 0.025, 8, 20).rotateX(Math.PI / 2), yellow, x, FLOOR_Y + 0.9, 0.9); mk(bed, new THREE.SphereGeometry(0.2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), steel, x, FLOOR_Y + 1.17, 0.9); }
  for (const z of [-1, 1]) for (const x of [-2.4, -3.4]) mk(bed, rbox(0.06, 0.012, 0.8, 0.004), std(0xe8b923, 0.8, 0), x, FLOOR_Y + 0.72, z * 0.3, false); // cargo straps
  tube(bed, [V(-5.15, FLOOR_Y + 1.1, -1.4), V(-5.15, FLOOR_Y + 1.1, 1.4)], 0.02, steel, 4); for (const s of [-1, 1]) strut(bed, V(-5.15, FLOOR_Y, s * 1.4), V(-5.15, FLOOR_Y + 1.1, s * 1.4), 0.02, steel, 6);
  // lunar tools on the rack: shovel, rake, hammer, tongs
  for (const [z, kind] of [[-0.9, 'shovel'], [-0.6, 'rake'], [-0.3, 'hammer'], [0.0, 'tongs']] as const) {
    strut(bed, V(-5.1, FLOOR_Y + 0.8, z * 1.0 - 0.4), V(-4.05, FLOOR_Y + 0.8, z * 1.0 - 0.4), 0.018, steel, 6);
    if (kind === 'shovel') mk(bed, rbox(0.3, 0.015, 0.2, 0.005), steel, -4.1, FLOOR_Y + 0.8, z - 0.4); else if (kind === 'rake') mk(bed, rbox(0.04, 0.03, 0.3, 0.01), steel, -4.1, FLOOR_Y + 0.8, z - 0.4); else if (kind === 'hammer') mk(bed, rbox(0.07, 0.07, 0.14, 0.02), dark, -4.1, FLOOR_Y + 0.8, z - 0.4); else mk(bed, rbox(0.2, 0.012, 0.05, 0.005), steel, -4.1, FLOOR_Y + 0.8, z - 0.4);
  }
  mk(bed, new THREE.CylinderGeometry(0.1, 0.1, 0.4, 14).rotateZ(Math.PI / 2), steel, -5.45, FLOOR_Y - 0.1, 0); mk(bed, new THREE.SphereGeometry(0.08, 14, 12), brass, -5.7, FLOOR_Y - 0.1, 0); // tow hitch
  for (const s of [-1, 1]) { mk(bed, rbox(0.06, 0.16, 0.3, 0.02), taillamp, -5.22, FLOOR_Y - 0.05, s * 1.35, false); mk(bed, rbox(0.05, 0.08, 0.2, 0.02), lampOn, -5.22, FLOOR_Y + 0.12, s * 1.35, false); }
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.56), new THREE.MeshBasicMaterial({ map: worm(), transparent: true })); p.position.set(-3.2, FLOOR_Y - 0.14, s * 1.555); if (s < 0) p.rotation.y = Math.PI; bed.add(p); }

  // ---- livery: meatball, flags, name plates, call-outs on the cab ----
  const ball = meatball(), flag = flagTexture();
  const decal = (map: THREE.Texture, w: number, h: number, x: number, y: number, z: number, ry: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map, transparent: true, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    m.position.set(x, y, z); m.rotation.y = ry; cabG.add(m); return m;
  };
  decal(ball, 0.7, 0.7, 2.95, 1.98, cabHalf + 0.012, 0); decal(ball, 0.7, 0.7, 3.2, 1.98, -cabHalf - 0.012, Math.PI);
  decal(flag, 0.5, 0.26, 2.1, 1.85, cabHalf + 0.012, 0); decal(plateTexture('LTV-01  SHACKLETON'), 0.9, 0.17, 2.2, 1.7, cabHalf + 0.012, 0); decal(plateTexture('LTV-01'), 0.5, 0.094, 3.3, 1.65, -cabHalf - 0.012, Math.PI);
  decal(letterTex('PRESSURISED', '#0b3d91', '#f3f5f7', 256, 64), 0.7, 0.175, 2.5, 3.78, -cabHalf - 0.013, Math.PI);
  decal(letterTex('NO STEP', '#fc3d21', '#f3f5f7', 128, 48), 0.3, 0.11, 4.8, 1.62, 0, Math.PI / 2).position.set(5.14, 1.42, 0);

  for (const w of wheels) bake(w.spin, false);
  bake(hatch, false);
  const draws0 = bake(root);
  return { draws0, root, chassis, cab, cabG, hatch, wheels, screens, radioScr, cabLight, bodyMat: body, headlampMat: lampOn };
}
function graphiteMat() { return std(NASA.graphite, 0.5, 0.3); }

/** Merge every static opaque mesh by material (and shadow flag) so the whole rover is a few dozen draw calls. */
function bake(rootObj: THREE.Object3D, respectDyn = true) {
  rootObj.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(rootObj.matrixWorld).invert();
  const buckets = new Map<string, { mat: THREE.Material; cast: boolean; geos: THREE.BufferGeometry[] }>(), done: THREE.Mesh[] = [];
  rootObj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData.dyn || Array.isArray(m.material)) return;
    if (respectDyn) for (let p: THREE.Object3D | null = m.parent; p; p = p.parent) if (p.userData.dynGroup) return;
    const mat = m.material as THREE.MeshStandardMaterial;
    if (mat.transparent) return;
    let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    for (const n of Object.keys(g.attributes)) if (!(n === 'position' || n === 'normal' || n === 'uv' || (n === 'color' && mat.vertexColors))) g.deleteAttribute(n);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    const key = mat.uuid + (m.castShadow ? 'c' : 'n'); let b = buckets.get(key); if (!b) buckets.set(key, (b = { mat, cast: m.castShadow, geos: [] })); b.geos.push(g); done.push(m);
  });
  for (const m of done) m.parent?.remove(m);
  let n = 0;
  for (const b of buckets.values()) {
    const g = mergeGeometries(b.geos, false); if (!g) continue;
    const o = new THREE.Mesh(g, b.mat); o.castShadow = b.cast; o.receiveShadow = true; rootObj.add(o); n++;
  }
  return n;
}
