import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { NASA, panelTexture, tileTexture, meatball, worm, plateTexture, flagTexture, groundDustTexture, wornMat, goldFoil, wearTextures, dustGradient } from './livery';

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
// every surface goes through the wear system: painted panels are dielectric (metalness ~0) with patchy roughness,
// scuffs and grime; only genuinely bare metal keeps metalness. A uniform sheen is what made it read as a toy.
const std = (c: number, rough = 0.5, metal = 0.2, extra: THREE.MeshStandardMaterialParameters = {}) =>
  wornMat(c, metal >= 0.45 ? 'metal' : 'paint', { rough, metal: metal >= 0.45 ? metal : 0.04, repeat: 2, extra });
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
  // regolith packed into the tread: grey-brown dust settled into every groove and smeared across the lugs
  for (let i = 0; i < 12; i++) { g.fillStyle = `rgba(118,112,102,${0.5 + Math.random() * 0.28})`; g.fillRect(0, (i * 512) / 12 - 4, 256, 9); }
  for (let i = 0; i < 12; i++) for (let j = 0; j < 8; j++) { g.fillStyle = `rgba(126,120,109,${0.14 + Math.random() * 0.2})`; g.fillRect(j * 32 + 4, (i * 512) / 12 + 6, 24, 512 / 12 - 12); }
  for (let i = 0; i < 700; i++) { g.fillStyle = `rgba(122,116,105,${0.16 + Math.random() * 0.36})`; g.fillRect(Math.random() * 250, Math.random() * 508, 1 + Math.random() * 5, 1 + Math.random() * 3); }
  return tex(c, 36, 1, false);
}
function hubTex() {
  const c = cv(512, 512), g = c.getContext('2d')!;
  g.fillStyle = '#b9902a'; g.fillRect(0, 0, 512, 512);   // mustard industrial enamel, not glossy taxi yellow
  g.fillStyle = '#3a3320'; g.beginPath(); g.arc(256, 256, 252, 0, 7); g.arc(256, 256, 236, 0, 7, true); g.fill();
  g.strokeStyle = '#8a6a10'; g.lineWidth = 6;
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; g.beginPath(); g.moveTo(256 + Math.cos(a) * 90, 256 + Math.sin(a) * 90); g.lineTo(256 + Math.cos(a) * 225, 256 + Math.sin(a) * 225); g.stroke(); }
  g.fillStyle = '#4b3f14';
  for (let i = 0; i < 12; i++) { const a = ((i + 0.5) / 12) * Math.PI * 2; g.beginPath(); g.ellipse(256 + Math.cos(a) * 160, 256 + Math.sin(a) * 160, 36, 17, a, 0, 7); g.fill(); }
  g.strokeStyle = '#8a6a10'; g.beginPath(); g.arc(256, 256, 95, 0, 7); g.stroke(); g.beginPath(); g.arc(256, 256, 228, 0, 7); g.stroke();
  // tonal fade: paint chalks and shadows unevenly across the face
  const fade = g.createRadialGradient(256, 200, 40, 256, 256, 250);
  fade.addColorStop(0, 'rgba(255,244,200,0.10)'); fade.addColorStop(0.7, 'rgba(60,55,40,0)'); fade.addColorStop(1, 'rgba(40,36,28,0.22)');
  g.fillStyle = fade; g.fillRect(0, 0, 512, 512);
  // dust flung radially across the face between the bolts and the rim
  g.strokeStyle = 'rgba(138,131,120,0.35)'; g.lineWidth = 3;
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2 + 0.11; g.beginPath(); g.moveTo(256 + Math.cos(a) * 96, 256 + Math.sin(a) * 96); g.lineTo(256 + Math.cos(a) * 222, 256 + Math.sin(a) * 222); g.stroke(); }
  for (let i = 0; i < 320; i++) { g.fillStyle = `rgba(126,120,109,${0.12 + Math.random() * 0.34})`; g.fillRect(Math.random() * 508, Math.random() * 508, 2 + Math.random() * 3, 1 + Math.random() * 2); }
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
/** Screen canvas at 2x resolution; draw in logical w by h units (the context is pre-scaled). */
export function makeScreen(w = 256, h = 160) {
  const c = cv(w * 2, h * 2), g = c.getContext('2d')!, t = tex(c, 1, 1); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = 8;
  g.setTransform(2, 0, 0, 2, 0, 0); g.fillStyle = '#04141c'; g.fillRect(0, 0, w, h); t.needsUpdate = true;
  return { c, g, t, w, h };
}
const letterTex = (text: string, fg: string, bg: string, w = 256, h = 96) => {
  const c = cv(w * 2, h * 2), g = c.getContext('2d')!; g.scale(2, 2); g.fillStyle = bg; g.fillRect(0, 0, w, h); g.fillStyle = fg;
  g.font = `bold ${h * 0.55}px Helvetica, Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 + 3);
  g.strokeStyle = fg; g.lineWidth = 3; g.strokeRect(2, 2, w - 4, h - 4); return tex(c, 1, 1);
};

// ---------- geometry helpers: planar faces with real window openings, rounded corners, edge beads ----------
type Poly = [number, number][];
type Face = { q: THREE.Vector3[]; out: THREE.Vector3; win?: Poly[] };
type Basis = { p0: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3; n: THREE.Vector3 };
const bil = (q: THREE.Vector3[], s: number, t: number) =>
  q[0].clone().multiplyScalar((1 - s) * (1 - t)).addScaledVector(q[1], s * (1 - t)).addScaledVector(q[2], s * t).addScaledVector(q[3], (1 - s) * t);
function basis(q: THREE.Vector3[], out: THREE.Vector3): Basis {
  const u = q[1].clone().sub(q[0]).normalize(), n = u.clone().cross(q[3].clone().sub(q[0])).normalize();
  if (n.dot(out) < 0) n.negate();
  const v = n.clone().cross(u).normalize(); return { p0: q[0].clone(), u, v, n };
}
const to2 = (b: Basis, P: THREE.Vector3) => { const d = P.clone().sub(b.p0); return new THREE.Vector2(d.dot(b.u), d.dot(b.v)); };
/** Round every corner of a planar polygon with a small quadratic arc. */
function roundPoly(P: THREE.Vector3[], r: number, seg = 5): THREE.Vector3[] {
  const out: THREE.Vector3[] = [], n = P.length;
  for (let i = 0; i < n; i++) {
    const a = P[(i + n - 1) % n], b = P[i], c = P[(i + 1) % n], ba = a.clone().sub(b), bc = c.clone().sub(b), t = Math.min(r, ba.length() * 0.45, bc.length() * 0.45);
    const p1 = b.clone().addScaledVector(ba.normalize(), t), p2 = b.clone().addScaledVector(bc.normalize(), t);
    for (let k = 0; k <= seg; k++) { const u = k / seg, p = p1.clone().multiplyScalar((1 - u) * (1 - u)).addScaledVector(b, 2 * u * (1 - u)).addScaledVector(p2, u * u); if (!out.length || out[out.length - 1].distanceTo(p) > 1e-4) out.push(p); }
  }
  return out;
}
/** Push a planar polygon outwards by w, along in-plane normals (uniform frame width). */
function offsetPoly(P: THREE.Vector3[], w: number, n: THREE.Vector3): THREE.Vector3[] {
  const c = P.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / P.length);
  return P.map((p, i) => { const t = P[(i + 1) % P.length].clone().sub(P[(i + P.length - 1) % P.length]).normalize(), nn = t.cross(n).normalize(); if (nn.dot(p.clone().sub(c)) < 0) nn.negate(); return p.clone().addScaledVector(nn, w); });
}
function polyGeom(pts: THREE.Vector3[], holes: THREE.Vector3[][], b: Basis) {
  const sh = new THREE.Shape(pts.map((p) => to2(b, p))); for (const h of holes) sh.holes.push(new THREE.Path(h.map((p) => to2(b, p))));
  const g = new THREE.ShapeGeometry(sh), p = g.attributes.position, nor: number[] = [], col: number[] = [], tmp = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    tmp.copy(b.p0).addScaledVector(b.u, p.getX(i)).addScaledVector(b.v, p.getY(i)); p.setXYZ(i, tmp.x, tmp.y, tmp.z); nor.push(b.n.x, b.n.y, b.n.z);
    // regolith dust: heavy up to about 1.2 m, fading out by 3.1 m, with a per-vertex mottle so it is never a flat wash.
    // the tint is warm grey (r > g > b) like real lunar dust, never the clean darker-white a shadow would give.
    const hv = Math.sin(tmp.x * 12.9898 + tmp.y * 78.233 + tmp.z * 37.719) * 43758.5453, n = hv - Math.floor(hv);
    const f = Math.min(1, Math.max(0, (3.4 - tmp.y) / 2.1)) * (0.62 + 0.38 * n);
    const k = 1 - 0.58 * f;
    col.push(k, k * (1 - 0.045 * f), k * (1 - 0.12 * f));
  }
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); return g;
}
const glassM = new THREE.MeshPhysicalMaterial({ color: 0x8fa4b4, roughness: 0.03, metalness: 0.1, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide });
function hexShape(r: number, round: number) {
  const pts = Array.from({ length: 6 }, (_, i) => { const a = (i / 6) * Math.PI * 2 + Math.PI / 6; return new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0); });
  return new THREE.Shape(roundPoly(pts, round, 4).map((p) => new THREE.Vector2(p.x, p.y)));
}
function roundedRect(w: number, h: number, r: number) {
  const s = new THREE.Shape(); s.moveTo(-w + r, 0); s.lineTo(-r, 0); s.quadraticCurveTo(0, 0, 0, r); s.lineTo(0, h - r); s.quadraticCurveTo(0, h, -r, h); s.lineTo(-w + r, h); s.quadraticCurveTo(-w, h, -w, h - r); s.lineTo(-w, r); s.quadraticCurveTo(-w, 0, -w + r, 0); return s;
}
function dentTex() {
  const c = cv(256, 256), g = c.getContext('2d')!, r = g.createRadialGradient(128, 128, 4, 128, 128, 120);
  r.addColorStop(0, 'rgba(20,18,16,.78)'); r.addColorStop(0.5, 'rgba(40,36,32,.4)'); r.addColorStop(1, 'rgba(60,55,50,0)'); g.fillStyle = r; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(235,235,230,.55)'; g.lineWidth = 3; g.beginPath(); g.arc(128, 128, 62, 0.4, 2.2); g.stroke();
  g.strokeStyle = 'rgba(15,14,12,.7)'; g.lineWidth = 2; for (let i = 0; i < 7; i++) { const a = i * 0.9 + 0.3; g.beginPath(); g.moveTo(128 + Math.cos(a) * 20, 128 + Math.sin(a) * 20); g.lineTo(128 + Math.cos(a + 0.2) * 100, 128 + Math.sin(a + 0.2) * 100); g.stroke(); }
  return tex(c, 1, 1, true);
}
function crackTex() {
  const c = cv(512, 512), g = c.getContext('2d')!; g.strokeStyle = 'rgba(235,242,248,.85)'; g.lineWidth = 2.5; g.lineCap = 'round';
  const ox = 200, oy = 260; let seed = 9; const rn = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 11; i++) { const a = (i / 11) * Math.PI * 2 + rn() * 0.4; let x = ox, y = oy, ang = a; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 6; k++) { ang += (rn() - 0.5) * 0.7; x += Math.cos(ang) * (30 + rn() * 40); y += Math.sin(ang) * (30 + rn() * 40); g.lineTo(x, y); if (rn() < 0.35) { g.moveTo(x, y); g.lineTo(x + Math.cos(ang + 0.9) * 30, y + Math.sin(ang + 0.9) * 30); g.moveTo(x, y); } } g.stroke(); }
  g.lineWidth = 1.6; for (let r = 40; r < 170; r += 38) { g.beginPath(); for (let k = 0; k <= 9; k++) { const a = (k / 9) * Math.PI * 2; const rr = r + (rn() - 0.5) * 14; g.lineTo(ox + Math.cos(a) * rr, oy + Math.sin(a) * rr * 0.9); } g.stroke(); }
  return tex(c, 1, 1, true);
}
/** Dust thrown up by the wheels and sprayed back onto the body: a soft mottled splash with rising streaks. */
function dustStreakTex() {
  const c = cv(128, 128), g = c.getContext('2d')!;
  g.translate(64, 78); g.scale(1, 0.6);
  const gr = g.createRadialGradient(0, 0, 6, 0, 0, 58);
  gr.addColorStop(0, 'rgba(96,91,84,0.62)'); gr.addColorStop(0.5, 'rgba(100,95,87,0.34)'); gr.addColorStop(1, 'rgba(104,99,90,0)');
  g.fillStyle = gr; g.fillRect(-64, -64, 128, 128);
  g.setTransform(1, 0, 0, 1, 0, 0);
  for (let i = 0; i < 30; i++) {   // fine spray rising off the splash
    const x = 12 + Math.random() * 104, y0 = 60 + Math.random() * 34, h = 8 + Math.random() * 34;
    g.strokeStyle = `rgba(110,104,94,${0.1 + Math.random() * 0.22})`; g.lineWidth = 1 + Math.random() * 2;
    g.beginPath(); g.moveTo(x, y0); g.lineTo(x + (Math.random() - 0.5) * 10, y0 - h); g.stroke();
  }
  for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(112,106,96,${0.1 + Math.random() * 0.26})`; g.beginPath(); g.arc(14 + Math.random() * 100, 40 + Math.random() * 70, 0.6 + Math.random() * 1.8, 0, 7); g.fill(); }
  return tex(c, 1, 1, true);
}

export type Wheel = { side: number; x: number; front: boolean; hub: THREE.Group; steer: THREE.Group; spin: THREE.Group; links: (hubY: number) => void; rotor: THREE.MeshStandardMaterial; anchor: THREE.Vector3; name: string };
export type RoverModel = ReturnType<typeof buildRoverModel>;

export function buildRoverModel() {
  const root = new THREE.Group(), chassis = new THREE.Group(); root.add(chassis);
  const panelMap = () => panelTexture('#f3f3f1', '#b4b8bb', 1, 1);
  const body = std(0xffffff, 0.55, 0.05, { map: panelMap(), side: THREE.DoubleSide, vertexColors: true });
  const white = std(0xf1f2f0, 0.55, 0.05, { map: panelMap() });
  const bodyPlain = std(0xe9eae7, 0.6, 0.04, { map: panelMap(), side: THREE.DoubleSide, vertexColors: true });   // pre-dusted white: never showroom-clean
  const grey = std(NASA.grey, 0.55, 0.4), steel = std(0xb9bfc8, 0.5, 0.6), dark = std(0x23272d, 0.72, 0.3);
  const foil = goldFoil(3, 3);
  const gold = new THREE.MeshStandardMaterial({ color: 0xffffff, map: foil.map, bumpMap: foil.bump, bumpScale: 1.5, metalness: 0.85, roughness: 0.4, roughnessMap: wearTextures('metal', 2).rough }), copper = std(0xb87333, 0.45, 0.8), brass = std(0xc9a24a, 0.45, 0.75);
  const yellow = std(0xcfa22d, 0.6, 0.1), red = std(0xc8452c, 0.6, 0.08), blue = std(0x2a4a8c, 0.6, 0.08), hazard = std(0xd8c49a, 0.7, 0.05, { map: hazardTex() });
  const lampOn = glowMat(0xfff4dc, 1.8), amber = glowMat(0xffa31a, 1.5), taillamp = glowMat(0xff2a1a, 1.3);
  const dyn = <T extends THREE.Object3D>(o: T) => { o.userData.dyn = true; return o; };
  const dynGroup = (g: THREE.Group) => { g.userData.dynGroup = true; return g; };

  // ---- ladder-frame chassis, cross members, skid plates, under-floor battery in gold foil ----
  for (const s of [-1, 1]) {
    mk(chassis, rbox(10.6, 0.34, 0.26, 0.1), grey, -0.1, 1.2, s * 0.95); mk(chassis, rbox(10.6, 0.1, 0.34, 0.04), steel, -0.1, 1.04, s * 0.95);
    mk(chassis, rbox(9.4, 0.08, 0.5, 0.04), dark, -0.4, 0.8, s * 0.7);
  }
  for (let x = -5; x <= 4.8; x += 1.0) mk(chassis, rbox(0.18, 0.22, 2.0, 0.07), grey, x, 1.16, 0);
  mk(chassis, rbox(3.0, 0.5, 1.5, 0.16), gold, 1.4, 0.98, 0); mk(chassis, rbox(0.1, 0.4, 1.5, 0.04), dark, 2.9, 0.98, 0);
  mk(chassis, rbox(2.2, 0.36, 1.3, 0.14), gold, -2.5, 1.02, 0);
  mk(chassis, rbox(2.6, 0.05, 1.7, 0.03), dark, 1.4, 0.7, 0, false);
  for (const [x, r, L] of [[-0.9, 0.3, 1.3], [-1.6, 0.26, 1.1]] as const) for (const s of [-1, 1]) {
    const t = mk(chassis, new THREE.CapsuleGeometry(r, L, 8, 18), steel, x, 0.98, s * 0.55); t.rotation.z = Math.PI / 2;
  }

  // ---- six wheels on independent tubular suspension ----
  const tireM = std(0xc6c1b6, 0.92, 0, { map: treadTex(), bumpMap: treadTex(), bumpScale: 1.6 });   // dusty pale rubber, not showroom white
  const prof = [[0.56, -0.36], [0.64, -0.41], [0.74, -0.43], [0.83, -0.38], [0.88, -0.3], [0.9, -0.2], [0.9, 0.2], [0.88, 0.3], [0.83, 0.38], [0.74, 0.43], [0.64, 0.41], [0.56, 0.36]].map(([r, y]) => new THREE.Vector2(r, y));
  const tireG = new THREE.LatheGeometry(prof, 80).rotateX(Math.PI / 2), hubM = std(0xffffff, 0.55, 0.05, { map: hubTex() });
  const coilM = std(0xd8d4c8, 0.6, 0.05, { map: coilTex() });
  const FEND_R = 1.15, names = ['FRONT PORT WHEEL', 'FRONT STARBOARD WHEEL', 'MID PORT WHEEL', 'MID STARBOARD WHEEL', 'REAR PORT WHEEL', 'REAR STARBOARD WHEEL'];
  const wheels: Wheel[] = [];
  for (const ax of AXLES) for (const side of [-1, 1]) {
    const front = ax === AXLES[0], hub = dynGroup(new THREE.Group()); hub.position.set(ax, WHEEL_R, side * TRACK); chassis.add(hub);
    const steer = new THREE.Group(), spin = new THREE.Group(); hub.add(steer); steer.add(spin);
    mk(spin, tireG, tireM);
    // geometric chevron lugs around the circumference: a smooth torus with a tread *texture* still reads as a
    // road tyre at gameplay distance; 20 angled blocks per wheel read as an off-road tyre from any angle
    {
      const lugM = std(0x3a3733, 0.95, 0);
      const lugG = rbox(0.14, 0.1, 0.64, 0.03);
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        const lug = mk(spin, lugG, lugM, Math.cos(a) * 0.84, Math.sin(a) * 0.84, 0, false);
        lug.rotation.z = a + (i % 2 ? 0.22 : -0.22);
      }
    }
    const face = new THREE.CylinderGeometry(0.58, 0.58, 0.06, 64).rotateX(Math.PI / 2);
    mk(spin, face, hubM, 0, 0, side * 0.36); mk(spin, face, hubM, 0, 0, -side * 0.36);
    for (const zz of [0.38, -0.38]) { const lip = mk(spin, new THREE.TorusGeometry(0.58, 0.04, 10, 56), std(0x43464a, 0.85, 0.15), 0, 0, zz); lip.castShadow = false; }   // bead ring: dusty composite, not polished gold
    mk(spin, new THREE.CylinderGeometry(0.2, 0.23, 0.12, 28).rotateX(Math.PI / 2), grey, 0, 0, side * 0.42);
    mk(spin, new THREE.SphereGeometry(0.1, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2 * side), steel, 0, 0, side * 0.46);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; mk(spin, new THREE.CylinderGeometry(0.03, 0.03, 0.05, 8).rotateX(Math.PI / 2), steel, Math.cos(a) * 0.31, Math.sin(a) * 0.31, side * 0.4, false); }
    const rotorM = new THREE.MeshStandardMaterial({ color: 0x6b7077, metalness: 0.8, roughness: 0.4, emissive: 0xff4a10, emissiveIntensity: 0 });
    dyn(mk(spin, new THREE.CylinderGeometry(0.42, 0.42, 0.035, 48).rotateX(Math.PI / 2), rotorM, 0, 0, -side * 0.22, false));
    mk(hub, new THREE.CylinderGeometry(0.17, 0.17, 0.36, 24).rotateX(Math.PI / 2), dark, 0, 0, -side * 0.5);
    mk(hub, rbox(0.14, 0.26, 0.1, 0.05), red, 0.38, 0.1, -side * 0.24);
    // fender: big half-round arch, rolled lips, a rounded inner liner — dust settles along its lower edge
    mk(chassis, dustGradient(new THREE.CylinderGeometry(FEND_R, FEND_R, WHEEL_W + 0.3, 48, 4, true, Math.PI / 2, Math.PI).rotateX(Math.PI / 2), { y0: 0.15, y1: 1.9, max: 0.4, hash: 4.7 }), bodyPlain, ax, WHEEL_R + 0.12, side * TRACK);
    for (const zz of [-1, 1]) { const lip = mk(chassis, new THREE.TorusGeometry(FEND_R, 0.045, 10, 48, Math.PI), white, ax, WHEEL_R + 0.12, side * TRACK + zz * (WHEEL_W / 2 + 0.15), false); lip.castShadow = false; }
    // suspension
    const aLo = V(ax, 1.0, side * 0.95), aUp = V(ax, 1.4, side * 0.95), aSh = V(ax - 0.3, 1.42, side * 1.12);
    const lo = strut(chassis, aLo, aLo.clone(), 0.055, steel), up = strut(chassis, aUp, aUp.clone(), 0.045, steel), lo2 = strut(chassis, aLo, aLo.clone(), 0.04, steel);
    const shO = strut(chassis, aSh, aSh.clone(), 0.07, dark), shI = strut(chassis, aSh, aSh.clone(), 0.045, steel), coil = strut(chassis, aSh, aSh.clone(), 0.11, coilM, 16);
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
    links(WHEEL_R); wheels.push({ side, x: ax, front, hub, steer, spin, links, rotor: rotorM, anchor: V(ax, WHEEL_R, side * (TRACK + 0.2)), name: names[wheels.length] });
    mk(chassis, new THREE.CylinderGeometry(0.1, 0.1, 0.5, 16).rotateX(Math.PI / 2), dark, ax, 0.95, side * (TRACK - 0.55));
  }
  for (const ax of AXLES) mk(chassis, new THREE.CylinderGeometry(0.035, 0.035, 2 * TRACK - 1.0, 10).rotateX(Math.PI / 2), steel, ax - 0.5, 0.75, 0);
  // ground contact: a mottled dust/shadow pool under the whole vehicle and one under each wheel, so the rover
  // visibly sits in the regolith instead of hovering on a clean slab (transparent: bake() leaves these live)
  {
    const gd = groundDustTexture();
    const poolM = new THREE.MeshBasicMaterial({ map: gd, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(11.5, 5.6).rotateX(-Math.PI / 2), poolM);
    pool.position.set(-0.2, 0.045, 0); pool.renderOrder = 1; root.add(pool);
    const wheelM = new THREE.MeshBasicMaterial({ map: gd, transparent: true, opacity: 0.95, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    for (const w of wheels) { const wp = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 2.3).rotateX(-Math.PI / 2), wheelM); wp.position.set(0, -WHEEL_R + 0.1, 0); wp.renderOrder = 1; w.hub.add(wp); }
  }
  tube(chassis, [V(4.2, 1.02, -0.5), V(2.0, 0.78, -0.6), V(0.2, 0.9, -0.4), V(-1.6, 0.8, -0.5), V(-3.5, 0.95, -0.4)], 0.035, copper);
  tube(chassis, [V(4.2, 1.0, 0.5), V(2.0, 0.76, 0.6), V(0.2, 0.88, 0.4), V(-1.6, 0.78, 0.5), V(-3.5, 0.93, 0.4)], 0.035, std(0x1f4aa0, 0.5, 0.2));

  // ---- cab: faceted shell with real, rounded window openings and filleted edges ----
  const cabHalf = CAB.half, X0 = CAB.x0, Yb = FLOOR_Y, Yt = ROOF_Y, XT = 3.8;
  const L = (x: number, y: number) => V(x, y, -cabHalf), Rr = (x: number, y: number) => V(x, y, cabHalf);
  const faces: Face[] = [
    { q: [L(X0, Yb), L(3.6, Yb), L(3.6, Yt), L(X0, Yt)], out: V(0, 0, -1), win: [[[0.07, 0.06], [0.62, 0.06], [0.62, 0.8], [0.07, 0.8]], [[0.7, 0.42], [0.93, 0.42], [0.93, 0.8], [0.7, 0.8]]] },
    { q: [Rr(X0, Yb), Rr(3.6, Yb), Rr(3.6, Yt), Rr(X0, Yt)], out: V(0, 0, 1), win: [[[0.07, 0.42], [0.46, 0.42], [0.46, 0.8], [0.07, 0.8]], [[0.54, 0.42], [0.93, 0.42], [0.93, 0.8], [0.54, 0.8]]] },
    { q: [L(3.6, 2.5), V(4.75, 2.5, -1.25), V(XT, Yt, -1.1), L(3.6, Yt)], out: V(0.3, 0, -1), win: [[[0.12, 0.15], [0.9, 0.15], [0.66, 0.88], [0.2, 0.88]]] },
    { q: [Rr(3.6, 2.5), V(4.75, 2.5, 1.25), V(XT, Yt, 1.1), Rr(3.6, Yt)], out: V(0.3, 0, 1), win: [[[0.12, 0.15], [0.9, 0.15], [0.66, 0.88], [0.2, 0.88]]] },
    { q: [L(3.6, Yb), V(4.9, Yb, -1.15), V(4.75, 2.5, -1.25), L(3.6, 2.5)], out: V(0.4, 0, -1) },
    { q: [Rr(3.6, Yb), V(4.9, Yb, 1.15), V(4.75, 2.5, 1.25), Rr(3.6, 2.5)], out: V(0.4, 0, 1) },
    { q: [V(4.75, 2.5, -1.25), V(4.75, 2.5, 1.25), V(XT, Yt, 1.1), V(XT, Yt, -1.1)], out: V(1, 0.6, 0), win: [[[0.03, 0.08], [0.3, 0.08], [0.29, 0.92], [0.05, 0.92]], [[0.34, 0.08], [0.66, 0.08], [0.66, 0.92], [0.34, 0.92]], [[0.7, 0.08], [0.97, 0.08], [0.95, 0.92], [0.71, 0.92]]] },
    { q: [V(4.9, Yb, -1.15), V(4.9, Yb, 1.15), V(4.75, 2.5, 1.25), V(4.75, 2.5, -1.25)], out: V(1, 0, 0), win: [[[0.06, 0.18], [0.43, 0.18], [0.36, 0.86], [0.1, 0.86]], [[0.57, 0.18], [0.94, 0.18], [0.9, 0.86], [0.64, 0.86]]] },
    { q: [L(X0, Yb), Rr(X0, Yb), Rr(X0, Yt), L(X0, Yt)], out: V(-1, 0, 0) },
    { q: [L(X0, Yb), L(4.9, Yb), Rr(4.9, Yb), Rr(X0, Yb)], out: V(0, -1, 0) },
  ];
  const cabG = new THREE.Group(); root.add(cabG);
  const outlines: THREE.Vector3[][] = faces.map((f) => f.q);
  const winInfo: { b: Basis; pts: THREE.Vector3[]; face: number; idx: number }[] = [];
  faces.forEach((f, fi) => {
    const b = basis(f.q, f.out), holes = (f.win ?? []).map((w) => roundPoly(w.map(([s, t]) => bil(f.q, s, t)), 0.11));
    mk(cabG, polyGeom(f.q, holes, b), body);
    holes.forEach((h, wi) => {
      winInfo.push({ b, pts: h, face: fi, idx: wi });
      const frame = new THREE.Shape(offsetPoly(h, 0.085, b.n).map((p) => to2(b, p))); frame.holes.push(new THREE.Path(h.map((p) => to2(b, p))));
      const ring = new THREE.ExtrudeGeometry(frame, { depth: 0.06, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2 });
      ring.applyMatrix4(new THREE.Matrix4().makeBasis(b.u, b.v, b.n).setPosition(b.p0)); mk(cabG, ring, grey);
      const glass = new THREE.ShapeGeometry(new THREE.Shape(h.map((p) => to2(b, p))));
      glass.applyMatrix4(new THREE.Matrix4().makeBasis(b.u, b.v, b.n).setPosition(b.p0.clone().addScaledVector(b.n, 0.02))); const gm = new THREE.Mesh(glass, glassM); gm.renderOrder = 2; cabG.add(gm);
    });
  });
  // roof (rounded hexagon) with a flush access plate
  const roofPts = [L(X0, Yt), L(3.6, Yt), V(XT, Yt, -1.1), V(XT, Yt, 1.1), Rr(3.6, Yt), Rr(X0, Yt)];
  { const b = basis([roofPts[0], roofPts[5], roofPts[3], roofPts[1]], V(0, 1, 0)); mk(cabG, polyGeom(roofPts, [], b), body); outlines.push(roofPts); }
  mk(cabG, rbox(0.9, 0.04, 0.7, 0.03), white, 2.3, Yt + 0.02, 0.1);
  // fillets: a bead along every outer edge and a ball at every corner, so nothing is razor sharp
  const edgeSeen = new Set<string>(), vertSeen = new Set<string>(), rb = 0.058, kk = (p: THREE.Vector3) => p.toArray().map((v) => Math.round(v * 100)).join(',');
  for (const poly of outlines) for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], ek = [kk(a), kk(b)].sort().join('|');
    if (!edgeSeen.has(ek)) { edgeSeen.add(ek); strut(cabG, a, b, rb, white, 10); }
    for (const p of [a, b]) { const k = kk(p); if (!vertSeen.has(k)) { vertSeen.add(k); mk(cabG, new THREE.SphereGeometry(rb, 12, 8), white, p.x, p.y, p.z, false); } }
  }
  // structural lattice: A-pillars, cross rails, diagonals, gusset plates (as in the reference frames)
  for (const s of [-1, 1]) {
    strut(cabG, V(4.75, 2.5, s * 0.5), V(XT, Yt, s * 0.6), 0.04, white); strut(cabG, V(4.75, 2.5, s * 1.25), V(XT, Yt, s * 1.1), 0.05, white);
    strut(cabG, V(3.6, Yb + 0.05, s * 1.47), V(3.6, Yt, s * 1.47), 0.06, white); strut(cabG, V(X0, Yb, s * 1.47), V(X0, Yt, s * 1.47), 0.07, white);
    strut(cabG, V(X0, Yt, s * 1.47), V(3.6, Yt, s * 1.47), 0.06, white);
    strut(cabG, V(3.6, 2.5, s * 1.47), V(4.75, 2.5, s * 1.27), 0.05, white); strut(cabG, V(4.9, Yb, s * 1.17), V(4.75, 2.5, s * 1.27), 0.05, white);
    strut(cabG, V(4.8, 2.1, s * 1.2), V(4.9, Yb, s * 0.55), 0.035, steel); // lower nose diagonal
  }
  strut(cabG, V(4.75, 2.5, -1.25), V(4.75, 2.5, 1.25), 0.06, white); strut(cabG, V(XT, Yt, -1.1), V(XT, Yt, 1.1), 0.06, white);
  // dust thrown back off the front wheels onto the lower cab flanks (static decals; bake skips transparent materials)
  {
    const splashM = new THREE.MeshBasicMaterial({ map: dustStreakTex(), transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const splash = (x: number, y: number, z: number, ry: number, s = 1) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.2 * s, 0.9 * s), splashM); m.position.set(x, y, z); m.rotation.y = ry; cabG.add(m); return m;
    };
    for (const s of [-1, 1]) {
      splash(3.05, 1.78, s * (cabHalf + 0.013), s < 0 ? Math.PI : 0);                 // behind the front wheels, on the cab flanks
      splash(1.9, 1.66, s * (cabHalf + 0.013), s < 0 ? Math.PI : 0, 0.7);
    }
  }
  // brow visor with integrated light bar above the windscreen
  const brow = mk(cabG, rbox(0.4, 0.12, 2.6, 0.06), white, XT + 0.1, Yt + 0.1, 0); brow.rotation.z = -0.2;
  mk(cabG, rbox(0.08, 0.07, 2.2, 0.03), lampOn, XT + 0.3, Yt + 0.03, 0, false).rotation.z = -0.2;
  mk(cabG, rbox(0.12, 0.06, 1.5, 0.03), lampOn, 3.5, Yt + 0.08, 0, false);
  for (const z of [-1, 1]) for (const x of [1.7, 3.3]) mk(cabG, rbox(0.12, 0.1, 0.12, 0.04), lampOn, x, Yt + 0.04, z * 1.4, false);
  mk(cabG, new THREE.CylinderGeometry(0.1, 0.12, 0.14, 20), amber, 2.2, Yt + 0.12, 0.9, false);
  // lower-nose grille slats and warm footwell glow behind the two big lower lights
  for (let i = 0; i < 5; i++) mk(cabG, rbox(0.04, 0.035, 0.7, 0.012), dark, 4.84, 1.75 + i * 0.1, 0, false);
  for (const s of [-1, 1]) mk(cabG, new THREE.PlaneGeometry(0.7, 0.55), new THREE.MeshBasicMaterial({ color: 0xff9a2e }), 4.55, 2.0, s * 0.72, false).rotation.y = Math.PI / 2;
  // bumper assembly (crumples when hit): hazard bar, tow rings, bull bar
  const bumper = dynGroup(new THREE.Group()); cabG.add(bumper);
  mk(bumper, rbox(0.26, 0.28, 2.5, 0.12), hazard, 5.02, 1.62, 0);
  for (const s of [-1, 1]) { const r = mk(bumper, new THREE.TorusGeometry(0.1, 0.028, 10, 20), steel, 5.15, 1.62, s * 0.75); r.rotation.y = Math.PI / 2; }
  tube(bumper, [V(5.12, 1.85, -1.2), V(5.3, 2.0, -0.8), V(5.32, 2.1, 0), V(5.3, 2.0, 0.8), V(5.12, 1.85, 1.2)], 0.04, steel, 30);
  for (const z of [-0.9, 0.9]) strut(bumper, V(5.05, 1.7, z), V(5.2, 1.98, z * 0.9), 0.035, steel, 8);
  bake(bumper, false);
  // individually breakable headlamp clusters
  const lampMat = [glowMat(0xfff4dc, 1.8), glowMat(0xfff4dc, 1.8)], lampMeshes: THREE.Mesh[][] = [[], []];
  [[-0.95, -0.55, -0.2], [0.2, 0.55, 0.95]].forEach((zs, si) => zs.forEach((z) => { const m = dyn(mk(cabG, rbox(0.07, 0.17, 0.22, 0.05), lampMat[si], 4.93, 2.12, z, false)); lampMeshes[si].push(m); }));
  for (const z of [-0.8, 0.8]) mk(cabG, rbox(0.08, 0.1, 0.3, 0.04), amber, 4.88, 1.82, z, false);
  // roof rails and rack
  for (const s of [-1, 1]) { tube(cabG, [V(X0 + 0.1, Yt + 0.28, s * 1.3), V(3.5, Yt + 0.28, s * 1.3)], 0.025, steel, 4); for (const x of [X0 + 0.1, 2.5, 3.5]) strut(cabG, V(x, Yt, s * 1.3), V(x, Yt + 0.28, s * 1.3), 0.022, steel, 8); }
  tube(cabG, [V(X0 + 0.1, Yt + 0.28, -1.3), V(X0 + 0.1, Yt + 0.28, 1.3)], 0.025, steel, 4); tube(cabG, [V(3.5, Yt + 0.28, -1.3), V(3.5, Yt + 0.28, 1.3)], 0.025, steel, 4);
  // X-band dish on a gimballed mast (dynamic so damage can bend it), UHF whips, mast camera, star tracker, mirror pods
  const dishG = dynGroup(new THREE.Group()); dishG.position.set(2.0, Yt, -0.7); cabG.add(dishG);
  mk(dishG, new THREE.CylinderGeometry(0.07, 0.1, 0.8, 16), steel, 0, 0.4, 0); mk(dishG, rbox(0.3, 0.2, 0.3, 0.09), grey, 0, 0.85, 0);
  const bowl = mk(dishG, new THREE.SphereGeometry(0.55, 44, 16, 0, Math.PI * 2, 0, 0.62), std(0xe8e6df, 0.55, 0.05, { side: THREE.DoubleSide }), 0.05, 1.15, 0); bowl.scale.y = 0.5; bowl.rotation.set(0, 0, -1.15);
  strut(dishG, V(0.05, 1.15, 0), V(0.45, 1.5, 0), 0.02, steel, 6); mk(dishG, new THREE.CylinderGeometry(0.03, 0.05, 0.14, 12), brass, 0.47, 1.52, 0).rotation.z = -1.0;
  bake(dishG, false);
  for (const [x, z, h] of [[1.6, 0.85, 1.7], [1.5, 0.55, 1.2]] as const) { strut(cabG, V(x, Yt, z), V(x, Yt + h, z), 0.012, dark, 6); mk(cabG, new THREE.SphereGeometry(0.03, 10, 8), steel, x, Yt + h, z, false); }
  const mast = new THREE.Group(); mast.position.set(3.35, Yt, 0.85); cabG.add(mast);
  mk(mast, new THREE.CylinderGeometry(0.045, 0.06, 1.2, 14), steel, 0, 0.6, 0); mk(mast, rbox(0.22, 0.14, 0.7, 0.06), grey, 0, 1.25, 0);
  for (const z of [-0.26, 0.26]) { mk(mast, new THREE.CylinderGeometry(0.05, 0.05, 0.12, 20).rotateZ(Math.PI / 2), dark, 0.14, 1.27, z); mk(mast, new THREE.CircleGeometry(0.045, 20).rotateY(Math.PI / 2), glowMat(0x2a6aff, 0.8), 0.205, 1.27, z, false); }
  mk(cabG, rbox(0.16, 0.12, 0.16, 0.05), dark, 2.9, Yt + 0.06, 0.4); mk(cabG, new THREE.CylinderGeometry(0.05, 0.05, 0.1, 14), glowMat(0x2a6aff, 0.5), 2.9, Yt + 0.15, 0.4, false);
  for (const s of [-1, 1]) { strut(cabG, V(4.0, 3.3, s * 1.1), V(4.0, 3.3, s * 1.55), 0.02, steel, 6); mk(cabG, rbox(0.04, 0.2, 0.13, 0.02), dark, 4.0, 3.3, s * 1.58); }

  // ---- hatch: a rounded plug door that overlaps its opening on every side, hinged at the front edge ----
  const hp = winInfo.find((w) => w.face === 0 && w.idx === 0)!.pts, hxs = hp.map((p) => p.x), hys = hp.map((p) => p.y), M = 0.13;
  const hx0 = Math.min(...hxs) - M, hx1 = Math.max(...hxs) + M, hy0 = Math.min(...hys) - M, hy1 = Math.max(...hys) + M, hw = hx1 - hx0;
  const hatch = dynGroup(new THREE.Group()); hatch.position.set(hx1, 0, -cabHalf); cabG.add(hatch);
  {
    const leaf = roundedRect(hw, hy1 - hy0, 0.2), hole = new THREE.Path(); hole.absarc(-hw / 2, (hy1 - hy0) * 0.7, 0.25, 0, Math.PI * 2, true); leaf.holes.push(hole);
    const lg = new THREE.ExtrudeGeometry(leaf, { depth: 0.1, bevelEnabled: true, bevelSize: 0.035, bevelThickness: 0.03, bevelSegments: 3, curveSegments: 20 });
    lg.translate(0, hy0, -0.22); mk(hatch, lg, std(0xffffff, 0.55, 0.05, { map: panelMap() }));
    const py = hy0 + (hy1 - hy0) * 0.7;
    for (const dz of [-0.17, 0.03]) mk(hatch, new THREE.TorusGeometry(0.27, 0.038, 12, 40), grey, -hw / 2, py, dz);
    mk(hatch, new THREE.CircleGeometry(0.25, 40), glassM, -hw / 2, py, -0.1).renderOrder = 2;
    mk(hatch, new THREE.TorusGeometry(0.15, 0.03, 12, 28), red, -hw / 2, py - 0.8, -0.27);
    for (let i = 0; i < 4; i++) mk(hatch, new THREE.CylinderGeometry(0.012, 0.012, 0.3, 8), steel, -hw / 2, py - 0.8, -0.27).rotation.z = (i / 4) * Math.PI;
    tube(hatch, [V(-hw + 0.25, py - 0.5, 0.0), V(-hw + 0.25, py - 0.5, 0.1), V(-hw + 0.25, py - 1.0, 0.1), V(-hw + 0.25, py - 1.0, 0.0)], 0.022, steel, 12); // inside grab handle
    for (const y of [hy0 + 0.35, (hy0 + hy1) / 2, hy1 - 0.35]) mk(hatch, new THREE.CylinderGeometry(0.035, 0.035, 0.16, 12).rotateX(Math.PI / 2), steel, 0.02, y, -0.16);
    for (const y of [hy0 + 0.3, hy1 - 0.3]) mk(hatch, new THREE.CylinderGeometry(0.03, 0.03, 0.12, 10), dark, -hw + 0.08, y, -0.12); // latch bolts on the free edge
    mk(hatch, rbox(0.12, 0.42, 0.03, 0.012), hazard, -0.2, hy0 + 0.5, -0.24);
    bake(hatch, false);
  }
  const STEP_X = (hx0 + hx1) / 2;
  mk(cabG, rbox(1.4, 0.06, 0.75, 0.03), std(0xffffff, 0.8, 0.3, { map: grateTex(5, 3) }), STEP_X, 0.84, -cabHalf - 0.38); mk(cabG, rbox(1.4, 0.07, 0.1, 0.03), hazard, STEP_X, 0.87, -cabHalf - 0.76);
  mk(cabG, rbox(1.4, 0.06, 0.7, 0.03), std(0xffffff, 0.8, 0.3, { map: grateTex(5, 3) }), STEP_X, 1.18, -cabHalf - 0.35);
  for (const x of [STEP_X - 0.65, STEP_X + 0.65]) { tube(cabG, [V(x, 0.85, -cabHalf - 0.7), V(x, 1.5, -cabHalf - 0.7), V(x, 2.9, -cabHalf - 0.4), V(x, 3.0, -cabHalf - 0.08)], 0.025, steel); strut(cabG, V(x, 0.86, -cabHalf - 0.7), V(x, 0.7, -cabHalf - 0.1), 0.02, steel, 8); }

  // ---- cab interior ----
  const cab = new THREE.Group(); root.add(cab);
  mk(cab, new THREE.PlaneGeometry(CAB.x1 - CAB.x0 - 0.4, 2.8).rotateX(-Math.PI / 2), std(0xffffff, 0.8, 0.05, { map: tileTexture('#8d949c', '#6a7078', 5) }), 3.1, Yb + 0.04, 0, false);
  mk(cab, rbox(0.06, 0.1, 2.8, 0.03), blue, CAB.x0 + 0.04, Yb + 0.35, 0, false);
  for (const z of [-0.8, 0.8]) mk(cab, rbox(1.2, 0.03, 0.4, 0.015), glowMat(0xfff1dd, 1.0), z < 0 ? 2.6 : 3.5, Yt - 0.04, z * 0.2, false);
  mk(cab, rbox(3.4, 0.04, 2.7, 0.03), std(0xe9edf0, 0.85, 0.02), 3.2, Yt - 0.06, 0, false);
  const seatM = std(0x2c3340, 0.9, 0.03), seatTrim = std(0x42506b, 0.85, 0.03);   // fabric seats with worn foam, muted navy trim
  for (const z of [-0.62, 0.62]) {
    mk(cab, rbox(0.55, 0.14, 0.52, 0.07), seatM, 3.45, 1.96, z); mk(cab, rbox(0.14, 0.82, 0.5, 0.07), seatM, 3.14, 2.4, z); mk(cab, rbox(0.12, 0.26, 0.34, 0.06), seatM, 3.1, 2.95, z);
    mk(cab, rbox(0.4, 0.04, 0.54, 0.02), seatTrim, 3.45, 2.04, z); mk(cab, new THREE.CylinderGeometry(0.06, 0.08, 0.4, 14), dark, 3.45, 1.7, z);
    for (const s of [-1, 1]) { mk(cab, rbox(0.4, 0.05, 0.07, 0.025), dark, 3.45, 2.25, z + s * 0.31); strut(cab, V(3.08, 2.88, z + s * 0.15), V(3.28, 2.3, z + s * 0.1), 0.012, red, 6); }
  }
  // dash, three high-res screens, warning-light row
  mk(cab, rbox(0.5, 0.8, 2.3, 0.1), dark, 4.55, 1.95, 0); const dashTop = mk(cab, rbox(0.62, 0.1, 2.3, 0.05), grey, 4.5, 2.4, 0); dashTop.rotation.z = -0.18;
  mk(cab, rbox(0.3, 0.16, 2.3, 0.07), dark, 4.42, 2.52, 0);
  const screens = [makeScreen(), makeScreen(), makeScreen()];
  [-0.7, 0, 0.7].forEach((z, i) => { const m = mk(cab, new THREE.PlaneGeometry(0.58, 0.36), new THREE.MeshBasicMaterial({ map: screens[i].t }), 4.27, 2.35, z, false); m.rotation.y = -Math.PI / 2; m.rotation.x = 0.25; mk(cab, rbox(0.04, 0.42, 0.64, 0.02), dark, 4.28, 2.35, z, false).rotation.z = 0.25; });
  const indMats = ['park', 'abs', 'over', 'dmg', 'lamps', 'link'].map((k, i) => ({ k, m: new THREE.MeshStandardMaterial({ color: 0x222222, emissive: [0xff3322, 0xffa31a, 0xff3322, 0xffa31a, 0x4fd8ff, 0x55ff88][i], emissiveIntensity: 0 }) }));
  indMats.forEach(({ m }, i) => dyn(mk(cab, new THREE.SphereGeometry(0.022, 12, 8), m, 4.24, 2.13, -0.75 + i * 0.1, false)));
  for (let i = 0; i < 8; i++) mk(cab, new THREE.BoxGeometry(0.03, 0.03, 0.05), glowMat(i % 4 === 0 ? 0xffa31a : 0x4fd8ff, 1.2), 4.24, 2.13, 0.05 + i * 0.1, false);
  // animated controls: joystick (fore-aft = throttle/brake, side = steer), throttle lever, two pedals, parking-brake lever
  const stick = dynGroup(new THREE.Group()); stick.position.set(3.62, 2.2, -0.3); cab.add(stick);
  mk(stick, new THREE.CylinderGeometry(0.03, 0.04, 0.22, 14), dark, 0, 0.11, 0); mk(stick, new THREE.SphereGeometry(0.055, 16, 12), red, 0, 0.24, 0); mk(stick, rbox(0.1, 0.05, 0.1, 0.02), dark, 0, 0.0, 0);
  mk(cab, rbox(0.14, 0.05, 0.14, 0.02), dark, 3.62, 2.19, -0.3);
  const thrLever = dynGroup(new THREE.Group()); thrLever.position.set(3.55, 2.2, -0.95); cab.add(thrLever);
  mk(thrLever, new THREE.CylinderGeometry(0.022, 0.028, 0.2, 12), dark, 0, 0.1, 0); mk(thrLever, new THREE.SphereGeometry(0.04, 14, 10), blue, 0, 0.22, 0);
  mk(cab, rbox(0.3, 0.04, 0.08, 0.02), dark, 3.55, 2.19, -0.95);
  const pedalT = dynGroup(new THREE.Group()), pedalB = dynGroup(new THREE.Group()); pedalT.position.set(4.05, 1.58, -0.5); pedalB.position.set(4.05, 1.58, -0.76); cab.add(pedalT, pedalB);
  mk(pedalT, rbox(0.04, 0.2, 0.15, 0.02), dark, 0, 0.1, 0); mk(pedalB, rbox(0.04, 0.2, 0.2, 0.02), dark, 0, 0.1, 0);
  mk(cab, rbox(0.06, 0.04, 0.6, 0.02), grey, 4.08, 1.57, -0.63);
  const parkLever = dynGroup(new THREE.Group()); parkLever.position.set(3.82, 2.07, 0.12); cab.add(parkLever);
  mk(parkLever, new THREE.CylinderGeometry(0.02, 0.025, 0.24, 12), steel, 0, 0.12, 0); mk(parkLever, rbox(0.07, 0.05, 0.04, 0.02), red, 0, 0.26, 0);
  // centre console and overhead panel
  mk(cab, rbox(1.0, 0.5, 0.34, 0.09), grey, 3.7, 1.82, 0); mk(cab, rbox(0.55, 0.05, 0.3, 0.025), dark, 3.7, 2.1, 0);
  for (let i = 0; i < 8; i++) mk(cab, new THREE.BoxGeometry(0.035, 0.02, 0.035), glowMat(i % 3 ? 0x4fd8ff : 0xffa31a, 1.2), 3.55 + (i % 4) * 0.1, 2.13, -0.08 + Math.floor(i / 4) * 0.12, false);
  mk(cab, rbox(0.9, 0.12, 1.3, 0.06), dark, 3.9, Yt - 0.14, 0);
  for (let i = 0; i < 18; i++) { const sw = mk(cab, new THREE.CylinderGeometry(0.012, 0.012, 0.06, 8), steel, 3.55 + (i % 3) * 0.12 + 0.2, Yt - 0.22, -0.55 + Math.floor(i / 3) * 0.2, false); sw.rotation.z = (i % 2) * 0.5 - 0.25; }
  // rear bulkhead: lockers, radio rack, handholds
  const lockerPlates: THREE.Mesh[] = [];
  for (const [z, w, txt] of [[-0.95, 0.7, 'SAMPLES'], [-0.2, 0.7, 'REPAIR KITS'], [0.55, 0.7, 'MED KIT']] as const) {
    mk(cab, rbox(0.5, 1.5, w, 0.07), std(0xe3e6e9, 0.5, 0.15), CAB.x0 + 0.3, Yb + 0.8, z);
    const pl = mk(cab, new THREE.PlaneGeometry(0.4, 0.075), new THREE.MeshBasicMaterial({ map: plateTexture(txt) }), CAB.x0 + 0.56, Yb + 1.3, z, false); pl.rotation.y = Math.PI / 2; lockerPlates.push(pl);
    mk(cab, rbox(0.04, 0.12, 0.2, 0.015), steel, CAB.x0 + 0.56, Yb + 0.9, z, false);
  }
  mk(cab, rbox(0.46, 1.5, 0.75, 0.07), graphiteMat(), RADIO.x - 0.2, Yb + 0.8, RADIO.z + 0.15); const radioScr = makeScreen(256, 160);
  const rs = mk(cab, new THREE.PlaneGeometry(0.42, 0.26), new THREE.MeshBasicMaterial({ map: radioScr.t }), RADIO.x + 0.04, Yb + 1.15, RADIO.z + 0.15, false); rs.rotation.y = Math.PI / 2;
  for (let i = 0; i < 9; i++) mk(cab, new THREE.BoxGeometry(0.02, 0.04, 0.04), glowMat(i % 3 ? 0x4fd8ff : 0xffa31a, 1.2), RADIO.x + 0.045, Yb + 0.82 + Math.floor(i / 3) * 0.07, RADIO.z + 0.15 - 0.2 + (i % 3) * 0.08 + 0.04, false);
  mk(cab, new THREE.CylinderGeometry(0.02, 0.02, 0.2, 10).rotateX(Math.PI / 2), dark, RADIO.x + 0.1, Yb + 0.62, RADIO.z + 0.15, false); // handset cradle
  for (const z of [-1.3, 1.3]) tube(cab, [V(2.0, Yb + 0.4, z), V(2.0, Yb + 1.25, z), V(3.0, Yb + 1.25, z)], 0.02, steel, 8);
  const cabLight = new THREE.PointLight(0xfff0dc, 0, 9, 2); cabLight.position.set(2.9, 3.4, 0); cab.add(cabLight);

  // ---- equipment bay: frame, rounded hex modules, tanks, plumbing, slanted solar blanket ----
  const bay = new THREE.Group(); root.add(bay);
  const bx0 = -1.2, bx1 = 1.4;
  for (const s of [-1, 1]) for (const x of [bx0, bx1]) strut(bay, V(x, FLOOR_Y, s * 1.4), V(x, 3.35, s * 1.4), 0.055, white);
  for (const s of [-1, 1]) { strut(bay, V(bx0, 3.0, s * 1.4), V(bx1, 3.4, s * 1.4), 0.055, white); strut(bay, V(bx0, FLOOR_Y, s * 1.4), V(bx1, 3.4, s * 1.4), 0.03, steel); strut(bay, V(bx1, FLOOR_Y, s * 1.4), V(bx0, 3.0, s * 1.4), 0.03, steel); }
  strut(bay, V(bx0, 3.0, -1.4), V(bx0, 3.0, 1.4), 0.055, white); strut(bay, V(bx1, 3.4, -1.4), V(bx1, 3.4, 1.4), 0.055, white);
  mk(bay, rbox(2.6, 0.12, 2.9, 0.05), std(0xa8adb3, 0.65, 0.5, { map: diamondTex(5, 5) }), 0.1, FLOOR_Y + 0.03, 0);
  const hexG = new THREE.ExtrudeGeometry(hexShape(0.58, 0.07), { depth: 0.45, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.05, bevelSegments: 3 }).translate(0, 0, -0.225);
  for (const s of [-1, 1]) for (const x of [-0.45, 0.8]) {
    mk(bay, hexG, gold, x, 2.35, s * 1.05);
    const cap = new THREE.ExtrudeGeometry(hexShape(0.46, 0.06), { depth: 0.04, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 2 }).translate(0, 0, 0.0);
    mk(bay, cap, white, x, 2.35, s * 1.31).rotation.y = s < 0 ? Math.PI : 0;
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + Math.PI / 6; mk(bay, new THREE.CylinderGeometry(0.025, 0.025, 0.05, 8).rotateX(Math.PI / 2), steel, x + Math.cos(a) * 0.4, 2.35 + Math.sin(a) * 0.4, s * 1.37, false); }
    mk(bay, new THREE.CylinderGeometry(0.16, 0.16, 0.08, 20).rotateX(Math.PI / 2), grey, x, 2.35, s * 1.38);
    mk(bay, new THREE.TorusGeometry(0.1, 0.02, 10, 20), copper, x, 2.35, s * 1.43);
  }
  for (const s of [-1, 1]) {
    const t = mk(bay, new THREE.CapsuleGeometry(0.3, 1.4, 10, 24), steel, 0.1, 2.0, s * 0.35); t.rotation.z = Math.PI / 2;
    for (const x of [-0.6, 0.8]) mk(bay, new THREE.TorusGeometry(0.305, 0.03, 10, 28).rotateY(Math.PI / 2), yellow, x, 2.0, s * 0.35);
    mk(bay, new THREE.CylinderGeometry(0.06, 0.06, 0.2, 12), brass, 0.9, 2.3, s * 0.35); mk(bay, new THREE.TorusGeometry(0.07, 0.015, 8, 16), red, 0.9, 2.52, s * 0.35).rotation.x = Math.PI / 2;
  }
  mk(bay, rbox(0.8, 0.9, 0.5, 0.09), grey, -0.9, 2.1, 0); for (let i = 0; i < 12; i++) mk(bay, rbox(0.7, 0.012, 0.46, 0.005), steel, -0.9, 1.7 + i * 0.07, 0, false);
  tube(bay, [V(-0.9, 2.5, 0), V(-0.4, 2.9, 0.3), V(0.3, 2.8, 0.5), V(0.9, 2.7, 0.9)], 0.04, copper); tube(bay, [V(-0.9, 2.3, 0), V(-0.3, 2.9, -0.3), V(0.4, 2.7, -0.5), V(0.9, 2.6, -0.9)], 0.04, brass);
  tube(bay, [V(0.1, 2.9, -1.0), V(0.5, 3.2, -0.2), V(0.9, 3.0, 0.5), V(1.2, 2.6, 1.0)], 0.03, std(0x1f4aa0, 0.5, 0.2));
  const solar = new THREE.Group(); solar.position.set((bx0 + bx1) / 2, 3.2, 0); solar.rotation.z = Math.atan2(0.4, bx1 - bx0); bay.add(solar);
  // solar blanket: a 2x2-cell image (each cell a slightly different navy with its own faint highlight, hairline bus
  // bars and dust speckle) so the array does not read as one flat repeated sticker
  const cellTex = (() => {
    const c = cv(256, 256), g = c.getContext('2d')!;
    for (let cy = 0; cy < 2; cy++) for (let cx = 0; cx < 2; cx++) {
      const X = cx * 128, Y = cy * 128;
      const b = 22 + ((cx * 7 + cy * 13) % 5) * 4;   // per-cell tint variation
      g.fillStyle = `rgb(${16 + b / 2},${28 + b},${64 + b})`; g.fillRect(X, Y, 128, 128);
      const hl = g.createLinearGradient(X, Y, X + 128, Y + 128); hl.addColorStop(0, 'rgba(160,185,225,0.13)'); hl.addColorStop(0.4, 'rgba(140,165,205,0.03)'); hl.addColorStop(1, 'rgba(0,0,0,0.06)');
      g.fillStyle = hl; g.fillRect(X, Y, 128, 128);
      g.strokeStyle = '#8b97b8'; g.lineWidth = 3; g.strokeRect(X + 1, Y + 1, 126, 126);
      g.strokeStyle = 'rgba(139,151,184,0.7)'; g.lineWidth = 1;
      for (const t of [0.33, 0.66]) { g.beginPath(); g.moveTo(X + 128 * t, Y); g.lineTo(X + 128 * t, Y + 128); g.moveTo(X, Y + 128 * t); g.lineTo(X + 128, Y + 128 * t); g.stroke(); }
    }
    for (let i = 0; i < 240; i++) { g.fillStyle = `rgba(112,106,96,${0.06 + Math.random() * 0.18})`; g.beginPath(); g.arc(Math.random() * 256, Math.random() * 256, 0.5 + Math.random() * 1.6, 0, 7); g.fill(); }
    return tex(c, 7, 7);
  })();
  mk(solar, rbox(2.7, 0.05, 2.9, 0.02), std(0xbcc3cc, 0.33, 0.62, { map: cellTex }));
  for (const s of [-1, 1]) mk(solar, rbox(2.75, 0.09, 0.09, 0.04), steel, 0, 0, s * 1.46); for (const x of [-1.37, 1.37]) mk(solar, rbox(0.09, 0.09, 2.95, 0.04), steel, x, 0, 0);
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.8), new THREE.MeshBasicMaterial({ map: meatball(), transparent: true })); p.position.set(0.1, 2.0, s * 1.47); if (s < 0) p.rotation.y = Math.PI; bay.add(p); }

  // ---- flatbed: deck, rails, tie-downs, cargo, tool rack, hitch ----
  const bed = new THREE.Group(); root.add(bed);
  // dust sprayed back off the mid and rear wheels onto the bed rails
  {
    const splashM = new THREE.MeshBasicMaterial({ map: dustStreakTex(), transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    for (const s of [-1, 1]) for (const x of [-0.55, -4.55]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.8), splashM); m.position.set(x, 1.5, s * 1.56); m.rotation.y = s < 0 ? Math.PI : 0; bed.add(m);
    }
  }
  mk(bed, rbox(4.0, 0.12, 3.1, 0.05), std(0xb4b6ae, 0.7, 0.5, { map: diamondTex(8, 6) }), -3.2, FLOOR_Y + 0.02, 0);   // dusty deck plate
  mk(bed, rbox(4.0, 0.3, 0.1, 0.05), white, -3.2, FLOOR_Y - 0.14, -1.5); mk(bed, rbox(4.0, 0.3, 0.1, 0.05), white, -3.2, FLOOR_Y - 0.14, 1.5);
  for (const s of [-1, 1]) {
    tube(bed, [V(-1.25, FLOOR_Y + 0.5, s * 1.5), V(-5.15, FLOOR_Y + 0.5, s * 1.5)], 0.025, steel, 4);
    for (let x = -1.3; x > -5.2; x -= 0.95) strut(bed, V(x, FLOOR_Y + 0.05, s * 1.5), V(x, FLOOR_Y + 0.5, s * 1.5), 0.022, steel, 8);
  }
  tube(bed, [V(-5.15, FLOOR_Y + 0.5, -1.5), V(-5.15, FLOOR_Y + 0.5, 1.5)], 0.025, steel, 4);
  for (const [x, z] of [[-1.6, -1.2], [-1.6, 1.2], [-4.9, -1.2], [-4.9, 1.2], [-3.2, -1.35], [-3.2, 1.35]] as const) mk(bed, new THREE.TorusGeometry(0.07, 0.015, 8, 16).rotateX(Math.PI / 2), steel, x, FLOOR_Y + 0.1, z, false);
  const crateM = std(0xe0ddd3, 0.65, 0.05), plates = ['LUNAR SAMPLES 1', 'LUNAR SAMPLES 2', 'DRILL KIT'];
  [[-1.9, -0.75], [-1.9, 0.5], [-3.0, -0.8]].forEach(([x, z], i) => {
    // cargo is never square to the frame: each crate sits at its own slight angle, label and all
    const cg = new THREE.Group(); cg.position.set(x, FLOOR_Y, z); cg.rotation.y = (i - 1) * 0.14 + 0.05; bed.add(cg);
    mk(cg, rbox(0.9, 0.55, 0.65, 0.1), crateM, 0, 0.4, 0);
    mk(cg, rbox(0.92, 0.05, 0.67, 0.03), i === 2 ? red : blue, 0, 0.52, 0);
    mk(cg, new THREE.PlaneGeometry(0.5, 0.094), new THREE.MeshBasicMaterial({ map: plateTexture(plates[i]) }), 0, 0.36, 0.336, false);
  });
  for (const x of [-3.7, -4.2]) { mk(bed, new THREE.CylinderGeometry(0.2, 0.2, 1.1, 20), steel, x, FLOOR_Y + 0.62, 0.9); mk(bed, new THREE.TorusGeometry(0.2, 0.025, 8, 24).rotateX(Math.PI / 2), yellow, x, FLOOR_Y + 0.9, 0.9); mk(bed, new THREE.SphereGeometry(0.2, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), steel, x, FLOOR_Y + 1.17, 0.9); }
  for (const z of [-1, 1]) for (const x of [-2.4, -3.4]) mk(bed, rbox(0.06, 0.012, 0.8, 0.005), std(0xe8b923, 0.8, 0), x, FLOOR_Y + 0.72, z * 0.3, false);
  tube(bed, [V(-5.15, FLOOR_Y + 1.1, -1.4), V(-5.15, FLOOR_Y + 1.1, 1.4)], 0.02, steel, 4); for (const s of [-1, 1]) strut(bed, V(-5.15, FLOOR_Y, s * 1.4), V(-5.15, FLOOR_Y + 1.1, s * 1.4), 0.02, steel, 8);
  for (const [z, kind] of [[-0.9, 'shovel'], [-0.6, 'rake'], [-0.3, 'hammer'], [0.0, 'tongs']] as const) {
    strut(bed, V(-5.1, FLOOR_Y + 0.8, z - 0.4), V(-4.05, FLOOR_Y + 0.8, z - 0.4), 0.018, steel, 8);
    if (kind === 'shovel') mk(bed, rbox(0.3, 0.02, 0.2, 0.008), steel, -4.1, FLOOR_Y + 0.8, z - 0.4); else if (kind === 'rake') mk(bed, rbox(0.04, 0.03, 0.3, 0.012), steel, -4.1, FLOOR_Y + 0.8, z - 0.4); else if (kind === 'hammer') mk(bed, rbox(0.07, 0.07, 0.14, 0.03), dark, -4.1, FLOOR_Y + 0.8, z - 0.4); else mk(bed, rbox(0.2, 0.015, 0.05, 0.007), steel, -4.1, FLOOR_Y + 0.8, z - 0.4);
  }
  mk(bed, new THREE.CylinderGeometry(0.1, 0.1, 0.4, 16).rotateZ(Math.PI / 2), steel, -5.45, FLOOR_Y - 0.1, 0); mk(bed, new THREE.SphereGeometry(0.08, 16, 12), brass, -5.7, FLOOR_Y - 0.1, 0);
  for (const s of [-1, 1]) { mk(bed, rbox(0.06, 0.16, 0.3, 0.04), taillamp, -5.22, FLOOR_Y - 0.05, s * 1.35, false); mk(bed, rbox(0.05, 0.08, 0.2, 0.03), lampOn, -5.22, FLOOR_Y + 0.12, s * 1.35, false); }
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.56), new THREE.MeshBasicMaterial({ map: worm(), transparent: true })); p.position.set(-3.2, FLOOR_Y - 0.14, s * 1.555); if (s < 0) p.rotation.y = Math.PI; bed.add(p); }

  // ---- livery ----
  const ball = meatball(), flag = flagTexture();
  const decal = (map: THREE.Texture, w: number, h: number, x: number, y: number, z: number, ry: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map, transparent: true, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    m.position.set(x, y, z); m.rotation.y = ry; cabG.add(m); return m;
  };
  decal(ball, 0.7, 0.7, 3.05, 1.98, cabHalf + 0.012, 0); decal(ball, 0.7, 0.7, 3.2, 1.98, -cabHalf - 0.012, Math.PI);
  decal(flag, 0.5, 0.26, 2.1, 1.85, cabHalf + 0.012, 0); decal(plateTexture('LTV-01  SHACKLETON'), 0.9, 0.17, 2.2, 1.7, cabHalf + 0.012, 0); decal(plateTexture('LTV-01'), 0.5, 0.094, 3.3, 1.65, -cabHalf - 0.012, Math.PI);
  decal(letterTex('PRESSURISED', '#0b3d91', '#f3f5f7', 256, 64), 0.7, 0.175, 2.5, 3.78, -cabHalf - 0.013, Math.PI);

  // ---- damage visuals, hidden until needed: dents on the panels most likely to be hit, cracks on the windscreen panes ----
  const dentM = new THREE.MeshBasicMaterial({ map: dentTex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const dents: { m: THREE.Mesh; zone: string }[] = [];
  const addDent = (zone: string, p: THREE.Vector3, n: THREE.Vector3, size: number, parent: THREE.Object3D = cabG) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), dentM); m.position.copy(p).addScaledVector(n, 0.03); m.quaternion.setFromUnitVectors(V(0, 0, 1), n.clone().normalize()); m.visible = false; parent.add(m); dents.push({ m, zone });
  };
  for (const z of [-0.75, -0.25, 0.25, 0.75]) addDent('front', V(5.16, 1.62, z), V(1, 0, 0), 0.5, bumper); // on the bumper bar, so they crumple with it
  for (const fi of [4, 5]) { const f = faces[fi], b = basis(f.q, f.out); addDent('front', bil(f.q, 0.5, 0.45), b.n, 0.6); addDent('front', bil(f.q, 0.25, 0.7), b.n, 0.4); }
  addDent('port', V(3.3, 1.95, -cabHalf), V(0, 0, -1), 0.5); addDent('starboard', V(1.75, 2.15, cabHalf), V(0, 0, 1), 0.45); addDent('rear', V(X0, 2.4, 0.4), V(-1, 0, 0), 0.7);
  for (const side of [-1, 1]) for (const ax of [AXLES[0], AXLES[1]]) { const a = 0.75, n = V(Math.cos(a), Math.sin(a), 0); addDent('wheel', V(ax + FEND_R * Math.cos(a), WHEEL_R + 0.12 + FEND_R * Math.sin(a), side * TRACK), n, 0.55); }
  const crackM = new THREE.MeshBasicMaterial({ map: crackTex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const cracks: THREE.Mesh[] = [];
  const wsFace = faces[6], wsB = basis(wsFace.q, wsFace.out);
  [[0.165, 0.5, 0.27], [0.5, 0.5, 0.32], [0.835, 0.5, 0.27]].forEach(([s, t, w]) => {
    const c = bil(wsFace.q, s, t), width = w * wsFace.q[0].distanceTo(wsFace.q[1]) * 0.95, height = wsFace.q[0].distanceTo(wsFace.q[3]) * 0.8;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(width, height), crackM); m.position.copy(c).addScaledVector(wsB.n, 0.045); m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(wsB.u, wsB.v, wsB.n)); m.visible = false; cabG.add(m); cracks.push(m);
  });

  // ---- anchors for gaze interaction and repair prompts (local metres) ----
  const anchors = {
    hatchOut: V(STEP_X, 2.35, -cabHalf - 0.05), hatchIn: V(STEP_X, 2.35, -cabHalf + 0.1), seat: V(3.4, 2.3, -0.62), radio: V(RADIO.x + 0.04, Yb + 1.15, RADIO.z + 0.15), locker: V(CAB.x0 + 0.5, Yb + 1.0, -0.2),
    bumper: V(5.1, 1.7, 0), windscreen: V(4.3, 3.1, 0), dish: V(2.0, Yt + 1.2, -0.7),
  };

  const draws0 = bake(root), spinN = wheels.map((w) => bake(w.spin, false));
  return { draws0, spinN, root, chassis, cab, cabG, hatch, wheels, screens, radioScr, cabLight, bumper, dishG, stick, thrLever, pedalT, pedalB, parkLever, lamps: { mat: lampMat, meshes: lampMeshes }, ind: Object.fromEntries(indMats.map(({ k, m }) => [k, m])) as Record<string, THREE.MeshStandardMaterial>, dents, cracks, anchors, lockerPlates, STEP_X };
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
