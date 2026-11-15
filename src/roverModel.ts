import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { NASA, panelTexture, tileTexture, crinkleTexture, meatball, worm, plateTexture, flagTexture } from './livery';

// Pressurised Lunar Terrain Vehicle, modelled on the white faceted pressurised rover in the reference images:
// six big balloon tyres with yellow hubs on independent tubular suspension, a faceted two-seat cab with a
// three-pane windscreen and lattice-framed side windows, a gold-and-white equipment bay with hex modules and a
// slanted solar blanket, and an open flatbed with cargo. Local frame: +x forward, +y up, +z starboard, y = 0 is the ground.

// Pressurised Lunar Terrain Vehicle, rebuilt from the reference renders: a rounded white cab "pod" (tall door slab plus a faceted
// nose with big recessed windows between thick ribs), a perforated flat deck on tubular wishbones with black coil-over springs,
// a module bay (white racks, hex fan pods, scaly solar panel), and tall chevron-lug tyres on flat gold swirl discs, no fenders.
// Local frame: +x forward, +y up, +z starboard, y = 0 is the ground.
export const WHEEL_R = 0.95, WHEEL_W = 0.95, TRACK = 1.95, AXLES = [3.9, -0.5, -3.0], FLOOR_Y = 1.3, ROOF_Y = 3.8;
export const CAB = { x0: 1.2, x1: 5.3, half: 1.45 };
// interaction and camera anchors inside the cab (local metres)
export const SEAT_EYE = new THREE.Vector3(3.85, 2.52, -0.62);
export const HATCH = { x: 2.3, z: -1.45 };
export const HATCH_OPEN = 1.6;
export const RADIO = { x: 1.8, z: 1.0 };
export const AISLE = { x0: 1.85, x1: 3.3, z0: -1.25, z1: 1.25 };
export const ANT = new THREE.Vector3(2.5, ROOF_Y + 0.95, -0.55);

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
    const k = 0.58 + 0.42 * Math.min(1, Math.max(0, (tmp.y - 1.5) / 1.5)); col.push(k, k * 0.985, k * 0.96); // lunar dust darkens the lower panels
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



// ---------- new helpers for the rebuilt model ----------
/** Rounded convex polyhedron: every edge becomes a cylinder and every corner a ball of radius r, so nothing is sharp.
 *  Returns the inset face polygons (still on the original planes) plus the core edges and corners. */
function roundedHull(P: THREE.Vector3[], F: number[][], r: number) {
  const c0 = P.reduce((a, p) => a.add(p), V(0, 0, 0)).multiplyScalar(1 / P.length);
  const planes = F.map((f) => {
    const n = V(0, 0, 0); for (let i = 0; i < f.length; i++) { const a = P[f[i]], b = P[f[(i + 1) % f.length]]; n.x += (a.y - b.y) * (a.z + b.z); n.y += (a.z - b.z) * (a.x + b.x); n.z += (a.x - b.x) * (a.y + b.y); }
    n.normalize(); const fc = f.reduce((a, i) => a.add(P[i]), V(0, 0, 0)).multiplyScalar(1 / f.length); if (n.dot(fc.clone().sub(c0)) < 0) n.negate(); return { n, d: n.dot(P[f[0]]) };
  });
  const core = P.map((p, vi) => {
    const inc = F.map((f, fi) => (f.includes(vi) ? fi : -1)).filter((i) => i >= 0), m = [0, 0, 0, 0, 0, 0, 0, 0, 0], b = V(0, 0, 0), avg = V(0, 0, 0);
    for (const fi of inc) { const { n, d } = planes[fi]; avg.add(n); const a = [n.x, n.y, n.z]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i * 3 + j] += a[i] * a[j]; b.addScaledVector(n, d - r); }
    const M = new THREE.Matrix3().set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]);
    if (Math.abs(M.determinant()) < 1e-6) return p.clone().addScaledVector(avg.normalize(), -r);
    return b.applyMatrix3(M.invert());
  });
  const faces = F.map((f, fi) => ({ poly: f.map((i) => core[i].clone().addScaledVector(planes[fi].n, r)), n: planes[fi].n, orig: f.map((i) => P[i]) }));
  const seen = new Set<string>(), edges: [THREE.Vector3, THREE.Vector3][] = [];
  F.forEach((f) => f.forEach((a, i) => { const b = f[(i + 1) % f.length], k = a < b ? `${a}-${b}` : `${b}-${a}`; if (!seen.has(k)) { seen.add(k); edges.push([core[a], core[b]]); } }));
  return { faces, edges, core };
}
function closedTube(parent: THREE.Object3D, pts: THREE.Vector3[], r: number, m: THREE.Material) {
  const o = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true, 'centripetal'), Math.max(24, pts.length * 3), r, 8, true), m); o.castShadow = true; parent.add(o); return o;
}
/** Recessed window wall: a short collar from the opening in the face to the glass plane. */
function revealGeom(h: THREE.Vector3[], n: THREE.Vector3, depth: number) {
  const pos: number[] = []; for (let i = 0; i < h.length; i++) { const a = h[i], b = h[(i + 1) % h.length], a2 = a.clone().addScaledVector(n, -depth), b2 = b.clone().addScaledVector(n, -depth); pos.push(a.x, a.y, a.z, b.x, b.y, b.z, b2.x, b2.y, b2.z, a.x, a.y, a.z, b2.x, b2.y, b2.z, a2.x, a2.y, a2.z); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2)); g.computeVertexNormals(); return g;
}

// ---------- new textures ----------
/** Flat gold swirl disc with a bolted grey plate: no hub cap. */
function discTex() {
  const S = 1024, c = cv(S, S), g = c.getContext('2d')!, R = S / 2; g.translate(R, R);
  g.fillStyle = '#c9971f'; g.beginPath(); g.arc(0, 0, R, 0, 7); g.fill();
  const grd = g.createRadialGradient(0, 0, R * 0.3, 0, 0, R); grd.addColorStop(0, 'rgba(255,220,120,.25)'); grd.addColorStop(1, 'rgba(60,35,0,.28)'); g.fillStyle = grd; g.beginPath(); g.arc(0, 0, R, 0, 7); g.fill();
  const N = 16; g.lineCap = 'round';
  for (const [w, col] of [[40, '#2b2c2e'], [30, '#8b9097']] as const) { g.strokeStyle = col; g.lineWidth = w; for (let i = 0; i < N; i++) { g.beginPath(); for (let k = 0; k <= 48; k++) { const u = k / 48, rr = (0.36 + 0.58 * u) * R, a = (i / N) * Math.PI * 2 + u * 1.5; k ? g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); } g.stroke(); } }
  g.strokeStyle = '#5a5e64'; g.lineWidth = 26; g.beginPath(); g.arc(0, 0, R - 13, 0, 7); g.stroke(); g.strokeStyle = '#a7acb2'; g.lineWidth = 8; g.beginPath(); g.arc(0, 0, R - 8, 0, 7); g.stroke();
  g.fillStyle = '#8f949b'; g.beginPath(); g.arc(0, 0, R * 0.4, 0, 7); g.fill(); g.strokeStyle = '#4b4f55'; g.lineWidth = 6; g.stroke();
  g.fillStyle = '#26282b'; for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.3; g.beginPath(); g.arc(Math.cos(a) * R * 0.27, Math.sin(a) * R * 0.27, R * 0.045, 0, 7); g.fill(); }
  g.fillStyle = '#a9aeb4'; g.beginPath(); g.arc(0, 0, R * 0.13, 0, 7); g.fill(); g.strokeStyle = '#3b3e43'; g.lineWidth = 7; g.stroke(); g.fillStyle = '#5b5f65'; g.beginPath(); g.arc(0, 0, R * 0.065, 0, 7); g.fill();
  return tex(c, 1, 1);
}
/** Hex pod side with a circular louvre fan. */
function fanTex() {
  const S = 512, c = cv(S, S), g = c.getContext('2d')!; g.fillStyle = '#cfd2d5'; g.fillRect(0, 0, S, S); g.translate(S / 2, S / 2);
  g.strokeStyle = '#8c9096'; g.lineWidth = 8; g.beginPath(); g.arc(0, 0, 196, 0, 7); g.stroke(); g.fillStyle = '#9a9ea3'; g.beginPath(); g.arc(0, 0, 186, 0, 7); g.fill();
  for (let i = 0; i < 10; i++) { g.save(); g.rotate((i / 10) * Math.PI * 2); g.fillStyle = '#e4e6e8'; g.beginPath(); g.moveTo(26, -6); g.quadraticCurveTo(110, -60, 176, -18); g.lineTo(168, 22); g.quadraticCurveTo(100, -10, 30, 22); g.closePath(); g.fill(); g.strokeStyle = '#6e7278'; g.lineWidth = 3; g.stroke(); g.restore(); }
  g.fillStyle = '#d6d8da'; g.beginPath(); g.arc(0, 0, 40, 0, 7); g.fill(); g.strokeStyle = '#6e7278'; g.lineWidth = 5; g.stroke();
  const t = tex(c, 1, 1); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.offset.set(0.5, 0.5); return t;
}
function perfTex(rx: number, ry: number) {
  const c = cv(128, 128), g = c.getContext('2d')!; g.fillStyle = '#a3a9af'; g.fillRect(0, 0, 128, 128); g.fillStyle = '#25282c';
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { g.beginPath(); g.ellipse(i * 32 + (j % 2 ? 16 : 0) + 8, j * 32 + 8, 9, 6, 0, 0, 7); g.fill(); }
  return tex(c, rx, ry);
}
function moduleTex() {
  const c = cv(256, 256), g = c.getContext('2d')!; g.fillStyle = '#e9ebec'; g.fillRect(0, 0, 256, 256); g.strokeStyle = '#9ca1a6'; g.lineWidth = 4; g.strokeRect(2, 2, 252, 252);
  g.strokeRect(24, 24, 96, 208); g.strokeRect(136, 24, 96, 208); g.fillStyle = '#9ca1a6'; g.fillRect(100, 110, 12, 36); g.fillRect(144, 110, 12, 36);
  const t = tex(c, 1, 1); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
}
function solarTex() {
  const c = cv(512, 512), g = c.getContext('2d')!; g.fillStyle = '#7a4a2e'; g.fillRect(0, 0, 512, 512);
  for (let j = 0; j < 12; j++) for (let i = 0; i < 9; i++) { const x = i * 56 + (j % 2 ? 28 : 0) + 6, y = j * 42 + 6; g.fillStyle = '#16243f'; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 46, y); g.lineTo(x + 46, y + 26); g.quadraticCurveTo(x + 23, y + 38, x, y + 26); g.closePath(); g.fill(); g.strokeStyle = 'rgba(120,150,200,.4)'; g.lineWidth = 1.5; g.stroke(); }
  return tex(c, 1, 1);
}
function plateDotTex() {
  const c = cv(128, 128), g = c.getContext('2d')!; g.fillStyle = '#c9b48f'; g.fillRect(0, 0, 128, 128); g.fillStyle = '#a89572'; for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { g.beginPath(); g.arc(i * 16 + 8, j * 16 + 8, 2.4, 0, 7); g.fill(); }
  return tex(c, 14, 8);
}

export type Wheel = { side: number; x: number; front: boolean; hub: THREE.Group; steer: THREE.Group; spin: THREE.Group; links: (hubY: number) => void; rotor: THREE.MeshStandardMaterial; anchor: THREE.Vector3; name: string };
export type RoverModel = ReturnType<typeof buildRoverModel>;

export function buildRoverModel() {
  const root = new THREE.Group(), chassis = new THREE.Group(); root.add(chassis);
  const panelMap = () => panelTexture('#f4f3ef', '#bdbdb8', 1, 1);
  const body = std(0xffffff, 0.35, 0.12, { map: panelMap(), side: THREE.DoubleSide, vertexColors: true });
  const white = std(0xf3f2ee, 0.35, 0.12, { map: panelMap() });
  const grey = std(0x8a9096, 0.45, 0.5), steel = std(0xc2c7cd, 0.32, 0.7), dark = std(0x24282d, 0.7, 0.35), blackM = std(0x121316, 0.6, 0.3);
  const brass = std(0xb98a43, 0.32, 0.85), copper = std(0xb87333, 0.35, 0.85), yellowCable = std(0xe8c21a, 0.5, 0.1), red = std(NASA.red, 0.5, 0.2), blue = std(NASA.blue, 0.5, 0.2), hazard = std(0xffffff, 0.6, 0.1, { map: hazardTex() });
  const revealM = std(0xe4e3df, 0.6, 0.05, { side: THREE.DoubleSide });
  const mkGlass = (c: number, o: number) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.04, metalness: 0.15, transparent: true, opacity: o, depthWrite: false, side: THREE.DoubleSide });
  const glassBlue = mkGlass(0x86b6d6, 0.42), glassDark = mkGlass(0x3d5a5c, 0.55);
  const dyn = <T extends THREE.Object3D>(o: T) => { o.userData.dyn = true; return o; };
  const dynGroup = (g: THREE.Group) => { g.userData.dynGroup = true; return g; };
  const ledMat = [glowMat(0xffffff, 2.2), glowMat(0xffffff, 2.2)]; // left / right lamp banks (headlamps)
  const ledMeshes: THREE.Mesh[][] = [[], []];
  /** Black square work lamp with a bank of white LEDs, facing dir (unit, in the xz plane). */
  const sqLamp = (parent: THREE.Object3D, x: number, y: number, z: number, yaw: number, side: 0 | 1, size = 0.15, leds: 'six' | 'four' = 'six') => {
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = yaw; parent.add(g);
    mk(g, rbox(0.07, size, size, 0.02), blackM, 0, 0, 0, false);
    const pts = leds === 'six' ? [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]] : [[-1, -1], [-1, 1], [1, -1], [1, 1], [0, 0]];
    for (const [a, b] of pts) { const l = dyn(mk(g, new THREE.CylinderGeometry(size * 0.12, size * 0.12, 0.02, 12).rotateZ(Math.PI / 2), ledMat[side], 0.04, leds === 'six' ? a * size * 0.22 : a * size * 0.25, leds === 'six' ? b * size * 0.3 : b * size * 0.25, false)); ledMeshes[side].push(l); }
    return g;
  };

  // ================= CAB: a rounded polyhedron (tall door slab + faceted nose) =================
  const X0 = CAB.x0, XS = 3.4, XF = CAB.x1, Yb = 1.2, Yt = ROOF_Y, H = CAB.half;
  const P = [V(X0, Yb, -H), V(X0, Yb, H), V(X0, Yt, H), V(X0, Yt, -H), V(XS, Yb, -H), V(XS, Yb, H), V(XS, Yt, H), V(XS, Yt, -H), V(XF, 1.55, -0.95), V(XF, 1.55, 0.95), V(XF, 2.75, 0.95), V(XF, 2.75, -0.95)];
  const F = [[0, 1, 2, 3], [0, 4, 5, 1], [3, 2, 6, 7], [0, 3, 7, 4], [1, 5, 6, 2], [4, 8, 9, 5], [7, 6, 10, 11], [8, 11, 10, 9], [4, 7, 11, 8], [5, 9, 10, 6]];
  const RF = 0.17, hull = roundedHull(P, F, RF);
  type WinDef = { q: THREE.Vector3[]; polys: [number, number][][]; tint: ('b' | 'd')[]; r?: number; opening?: boolean };
  const win: Record<number, WinDef> = {
    7: { q: [P[8], P[9], P[10], P[11]], polys: [[[.05, .16], [.29, .16], [.29, .84], [.05, .7]], [[.36, .12], [.64, .12], [.64, .9], [.36, .9]], [[.71, .16], [.95, .16], [.95, .7], [.71, .84]]], tint: ['b', 'b', 'b'] },
    5: { q: [P[4], P[5], P[9], P[8]], polys: [[[.12, .4], [.44, .4], [.44, .78], [.12, .78]], [[.56, .4], [.88, .4], [.88, .78], [.56, .78]]], tint: ['b', 'b'] },
    6: { q: [P[7], P[6], P[10], P[11]], polys: [[[.04, .14], [.25, .14], [.29, .84], [.09, .84]], [[.31, .12], [.69, .12], [.65, .86], [.35, .86]], [[.75, .14], [.96, .14], [.91, .84], [.71, .84]]], tint: ['d', 'd', 'd'] },
    8: { q: [P[4], P[8], P[11], P[7]], polys: [[[.08, .92], [.58, .92], [.3, .1]], [[.66, .9], [.94, .78], [.94, .22], [.38, .1]]], tint: ['b', 'b'], r: 0.14 },
    9: { q: [P[5], P[9], P[10], P[6]], polys: [[[.08, .92], [.58, .92], [.3, .1]], [[.66, .9], [.94, .78], [.94, .22], [.38, .1]]], tint: ['b', 'b'], r: 0.14 },
    3: { q: [P[0], P[4], P[7], P[3]], polys: [[[.136, .096], [.864, .096], [.864, .904], [.136, .904]]], tint: [], r: 0.25, opening: true },
    4: { q: [P[1], P[5], P[6], P[2]], polys: [[[.23, .62], [.23, .86], [.58, .86], [.77, .74], [.77, .62]]], tint: ['b'], r: 0.07 },
  };
  const cabG = new THREE.Group(); root.add(cabG);
  const windows: { pts: THREE.Vector3[]; b: Basis; face: number; idx: number }[] = [];
  hull.faces.forEach((f, fi) => {
    const def = win[fi], b = basis(def ? def.q : f.orig, f.n);
    const holes = def ? def.polys.map((pl) => roundPoly(pl.map(([s, t]) => bil(def.q, s, t)), def.r ?? 0.13)) : [];
    mk(cabG, polyGeom(f.poly, holes, b), body);
    holes.forEach((h, wi) => {
      windows.push({ pts: h, b, face: fi, idx: wi });
      mk(cabG, revealGeom(h, f.n, 0.1), revealM, 0, 0, 0, false);
      closedTube(cabG, h.map((p) => p.clone().addScaledVector(f.n, 0.015)), 0.042, white);
      if (def!.opening) return;
      const gg = new THREE.ShapeGeometry(new THREE.Shape(h.map((p) => to2(b, p)))); gg.applyMatrix4(new THREE.Matrix4().makeBasis(b.u, b.v, b.n).setPosition(b.p0.clone().addScaledVector(b.n, -0.1)));
      const gm = new THREE.Mesh(gg, def!.tint[wi] === 'd' ? glassDark : glassBlue); gm.renderOrder = 2; cabG.add(gm);
    });
  });
  for (const [a, b] of hull.edges) strut(cabG, a, b, RF, white, 14);
  for (const c of hull.core) mk(cabG, new THREE.SphereGeometry(RF, 18, 12), white, c.x, c.y, c.z, false);

  // door: a rounded plug door overlapping its opening, hinged at the rear edge, with its own window, lever handle and hinge pins
  {
    const op = windows.find((w) => w.face === 3)!.pts, xs = op.map((p) => p.x), ys = op.map((p) => p.y), M = 0.065, x0 = Math.min(...xs) - M, y0 = Math.min(...ys) - M, W = Math.max(...xs) + M - x0, Hh = Math.max(...ys) + M - y0;
    const hatch = dynGroup(new THREE.Group()); hatch.position.set(x0, 0, -H); cabG.add(hatch);
    const leaf = roundedRect(W, Hh, 0.3);
    // roundedRect builds from (-W..0): shift to (0..W) by translating the geometry afterwards
    const wp: [number, number][] = [[0.1, 0.7], [0.1, 0.93], [0.58, 0.93], [0.9, 0.78], [0.9, 0.7]];
    const wpts = roundPoly(wp.map(([u, v]) => V(-W + u * W, v * Hh, 0)), 0.07).map((p) => new THREE.Vector2(p.x, p.y)), hole = new THREE.Path(wpts); leaf.holes.push(hole);
    const lg = new THREE.ExtrudeGeometry(leaf, { depth: 0.06, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.025, bevelSegments: 3, curveSegments: 18 }); lg.translate(W, y0, -0.095);
    mk(hatch, lg, std(0xffffff, 0.35, 0.12, { map: panelMap() }));
    const gl = new THREE.ShapeGeometry(new THREE.Shape(wpts)); gl.translate(W, y0, -0.06); const gm = new THREE.Mesh(gl, glassBlue); gm.renderOrder = 2; hatch.add(gm);
    closedTube(hatch, wpts.map((p) => V(p.x + W, p.y + y0, -0.1)), 0.026, grey);
    mk(hatch, new THREE.CylinderGeometry(0.055, 0.055, 0.025, 20).rotateX(Math.PI / 2), blackM, W * 0.86, y0 + Hh * 0.47, -0.13, false);
    mk(hatch, rbox(0.2, 0.034, 0.034, 0.012), blackM, W * 0.86 - 0.05, y0 + Hh * 0.47, -0.16, false);
    for (const y of [y0 + 0.3, y0 + Hh * 0.5, y0 + Hh - 0.3]) mk(hatch, new THREE.CylinderGeometry(0.03, 0.03, 0.16, 12), steel, 0.0, y, -0.1);
    const idp = mk(hatch, new THREE.PlaneGeometry(0.46, 0.09), new THREE.MeshBasicMaterial({ map: plateTexture('LTV-01'), transparent: true }), W * 0.3, y0 + Hh * 0.62, -0.13, false); idp.rotation.y = Math.PI;
    tube(hatch, [V(W * 0.84, y0 + Hh * 0.38, 0.0), V(W * 0.84, y0 + Hh * 0.38, 0.08), V(W * 0.84, y0 + Hh * 0.56, 0.08), V(W * 0.84, y0 + Hh * 0.56, 0.0)], 0.02, steel, 12);
    bake(hatch, false); (cabG as any).hatchObj = hatch; (cabG as any).hatchX = x0 + W / 2;
  }
  const hatchObj = (cabG as any).hatchObj as THREE.Group, STEP_X = (cabG as any).hatchX as number;

  // roof gear: light-bar rack with two LED bars and four square lamps, brass grab rails, cameras, panel antenna, mast
  tube(cabG, [V(3.52, Yt + 0.13, -1.38), V(3.52, Yt + 0.13, 1.38)], 0.022, steel, 4);
  for (const z of [-1.3, -0.5, 0.5, 1.3]) strut(cabG, V(3.52, Yt + 0.02, z), V(3.52, Yt + 0.13, z), 0.02, steel, 8);
  [[-0.55, 0], [0.55, 1]].forEach(([z, side]) => {
    const g = new THREE.Group(); g.position.set(3.58, Yt + 0.2, z); cabG.add(g); mk(g, rbox(0.1, 0.1, 0.84, 0.03), blackM, 0, 0, 0, false);
    for (let i = 0; i < 8; i++) { const l = dyn(mk(g, new THREE.CylinderGeometry(0.034, 0.034, 0.02, 14).rotateZ(Math.PI / 2), ledMat[side], 0.055, 0, -0.35 + i * 0.1, false)); ledMeshes[side].push(l); }
  });
  [[-1.34, 0], [-1.12, 0], [1.12, 1], [1.34, 1]].forEach(([z, side]) => sqLamp(cabG, 3.58, Yt + 0.19, z, 0, side as 0 | 1, 0.15, 'four'));
  for (const x of [1.95, 3.05]) { tube(cabG, [V(x, Yt + 0.02, -0.75), V(x, Yt + 0.2, -0.75), V(x, Yt + 0.2, 0.75), V(x, Yt + 0.02, 0.75)], 0.02, brass, 14); }
  for (const z of [-1.3, 1.3]) { mk(cabG, rbox(0.12, 0.12, 0.12, 0.03), blackM, 1.65, Yt + 0.08, z); mk(cabG, new THREE.CylinderGeometry(0.03, 0.03, 0.04, 12).rotateZ(Math.PI / 2), glowMat(0x2a6aff, 0.5), 1.71, Yt + 0.08, z, false); }
  const dishG = dynGroup(new THREE.Group()); dishG.position.set(ANT.x, Yt, ANT.z); cabG.add(dishG);
  mk(dishG, new THREE.CylinderGeometry(0.05, 0.07, 0.55, 16), steel, 0, 0.28, 0); mk(dishG, rbox(0.16, 0.12, 0.16, 0.05), white, 0, 0.1, 0);
  const plate = mk(dishG, rbox(0.62, 0.04, 0.42, 0.02), std(0xf7f8f7, 0.25, 0.3), 0.04, 0.68, 0); plate.rotation.set(0, 0.2, -0.45);
  mk(dishG, new THREE.CylinderGeometry(0.03, 0.03, 0.14, 12), steel, 0, 0.58, 0); mk(dishG, new THREE.SphereGeometry(0.05, 12, 10), steel, 0, 0.62, 0); bake(dishG, false);
  const mastG = new THREE.Group(); mastG.position.set(1.75, Yt, 0.95); cabG.add(mastG);
  mk(mastG, new THREE.CylinderGeometry(0.04, 0.05, 0.3, 12), brass, 0, 0.15, 0); mk(mastG, new THREE.CylinderGeometry(0.055, 0.055, 0.62, 16), std(0xf3f4f3, 0.3, 0.2), 0, 0.62, 0); mk(mastG, new THREE.SphereGeometry(0.055, 12, 10), std(0xf3f4f3, 0.3, 0.2), 0, 0.93, 0);
  for (const y of [0.32, 0.56]) mk(mastG, new THREE.TorusGeometry(0.06, 0.012, 8, 16).rotateX(Math.PI / 2), brass, 0, y, 0, false);
  tube(mastG, [V(0.04, 0.3, 0), V(0.14, 0.2, 0.05), V(0.1, 0.02, 0.1)], 0.01, yellowCable, 12);

  // brass grab rails, side lamp stacks, running board with folding step, stainless trim
  for (const s of [-1, 1]) {
    tube(cabG, [V(3.52, 2.15, s * 1.56), V(3.52, 2.15, s * 1.62), V(3.52, 3.0, s * 1.62), V(3.52, 3.0, s * 1.56)], 0.022, brass, 14);
    tube(cabG, [V(3.42, 1.55, s * 1.62), V(3.34, 1.62, s * 1.62), V(3.3, 2.1, s * 1.62)], 0.02, brass, 14);
    tube(cabG, [V(2.85, 3.5, s * 1.55), V(3.35, 3.6, s * 1.6)], 0.02, brass, 8);
    sqLamp(cabG, 3.42, 2.0, s * 1.6, s < 0 ? 0.9 : -0.9, s < 0 ? 0 : 1); sqLamp(cabG, 3.42, 1.76, s * 1.6, s < 0 ? 0.9 : -0.9, s < 0 ? 0 : 1);
  }
  mk(cabG, rbox(1.75, 0.05, 0.55, 0.02), std(0xc9ced3, 0.3, 0.8), 2.3, 1.1, -H - 0.2); for (const x of [1.65, 2.95]) mk(cabG, rbox(0.06, 0.1, 0.5, 0.02), grey, x, 1.02, -H - 0.18);
  mk(cabG, rbox(0.9, 0.04, 0.4, 0.02), std(0xc9ced3, 0.3, 0.8), 2.3, 0.66, -H - 0.42);
  for (const x of [1.95, 2.65]) { strut(cabG, V(x, 1.1, -H - 0.1), V(x, 0.7, -H - 0.38), 0.022, steel, 8); strut(cabG, V(x + 0.1, 1.1, -H - 0.1), V(x + 0.1, 0.68, -H - 0.36), 0.016, dark, 8); }
  mk(cabG, rbox(0.9, 0.04, 0.4, 0.02), std(0xc9ced3, 0.3, 0.8), 3.0, 1.1, H + 0.2);
  // chin: bumper beam, four square lamps, recovery loop and tow eyes
  const bumper = dynGroup(new THREE.Group()); cabG.add(bumper);
  mk(bumper, rbox(0.3, 0.2, 2.5, 0.08), std(0xcfd3d7, 0.3, 0.75), 5.18, 1.3, 0);
  for (const z of [-0.85, -0.45, 0.45, 0.85]) sqLamp(bumper, 5.37, 1.38, z, 0, z < 0 ? 0 : 1, 0.15, 'four');
  tube(bumper, [V(5.3, 1.5, 0.7), V(5.62, 1.38, 0.72), V(5.72, 1.22, 0.9), V(5.55, 1.14, 1.12), V(5.3, 1.2, 1.1)], 0.035, steel, 30);
  for (const z of [-0.2, 0.2]) mk(bumper, new THREE.TorusGeometry(0.06, 0.016, 8, 16), steel, 5.34, 1.17, z);
  bake(bumper, false);

  // ================= WHEELS: chevron-lug tyres, flat swirl discs, no fenders =================
  const tireM = std(0x242527, 0.93, 0.02), lugM = std(0x1b1c1e, 0.95, 0), discT = discTex();
  const prof = [[0.62, -0.36], [0.7, -0.43], [0.8, -0.475], [0.89, -0.46], [0.94, -0.38], [0.955, -0.25], [0.955, 0.25], [0.94, 0.38], [0.89, 0.46], [0.8, 0.475], [0.7, 0.43], [0.62, 0.36]].map(([r, y]) => new THREE.Vector2(r, y));
  const tireG = new THREE.LatheGeometry(prof, 96).rotateX(Math.PI / 2);
  const lugs: THREE.BufferGeometry[] = [], NL = 28;
  for (let i = 0; i < NL; i++) for (const sg of [-1, 1]) for (const [zc, len, ang, rr] of [[sg * 0.2, 0.5, sg * 0.52, 0.955], [sg * 0.43, 0.26, sg * 0.9, 0.9]] as const) {
    const g = new THREE.BoxGeometry(0.075, 0.16, len), phi = ((i + (zc > 0 ? 0.5 : 0) + (Math.abs(zc) > 0.3 ? 0.25 : 0)) / NL) * Math.PI * 2;
    g.applyMatrix4(new THREE.Matrix4().makeRotationZ(phi).multiply(new THREE.Matrix4().makeTranslation(rr + 0.005, 0, zc)).multiply(new THREE.Matrix4().makeRotationX(ang))); lugs.push(g);
  }
  const lugG = mergeGeometries(lugs.map((g) => { const n = g.toNonIndexed(); return n; }), false)!;
  const wheels: Wheel[] = [], names = ['FRONT PORT WHEEL', 'FRONT STARBOARD WHEEL', 'MID PORT WHEEL', 'MID STARBOARD WHEEL', 'REAR PORT WHEEL', 'REAR STARBOARD WHEEL'];
  const helix = (() => { const pts: THREE.Vector3[] = [], T = 8; for (let k = 0; k <= T * 14; k++) { const u = k / (T * 14), a = u * T * Math.PI * 2; pts.push(V(Math.cos(a) * 0.13, u, Math.sin(a) * 0.13)); } return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), T * 28, 0.024, 6, false); })();
  const springM = std(0x17181a, 0.5, 0.5);
  const spring = (parent: THREE.Object3D) => {
    const o = new THREE.Mesh(helix, springM); o.castShadow = true; parent.add(o); const up = V(0, 1, 0), d = new THREE.Vector3();
    return Object.assign(o, { set: (p: THREE.Vector3, q: THREE.Vector3) => { d.subVectors(q, p); const Lh = d.length(); o.position.copy(p); o.scale.set(1, Math.max(Lh, 1e-3), 1); o.quaternion.setFromUnitVectors(up, d.normalize()); } });
  };
  for (const ax of AXLES) for (const side of [-1, 1]) {
    const front = ax === AXLES[0], hub = dynGroup(new THREE.Group()); hub.position.set(ax, WHEEL_R, side * TRACK); chassis.add(hub);
    const steer = new THREE.Group(), spin = new THREE.Group(); hub.add(steer); steer.add(spin);
    mk(spin, tireG, tireM); mk(spin, lugG, lugM);
    const discM = new THREE.MeshStandardMaterial({ map: discT, metalness: 0.45, roughness: 0.42, emissive: 0xff5a14, emissiveIntensity: 0 });
    for (const sg of [-1, 1]) {
      const d = dyn(mk(spin, new THREE.CircleGeometry(0.64, 80), discM, 0, 0, sg * 0.35, false)); if (sg < 0) d.rotation.y = Math.PI;
      mk(spin, new THREE.CylinderGeometry(0.095, 0.1, 0.05, 28).rotateX(Math.PI / 2), grey, 0, 0, sg * 0.37, false);
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.3; mk(spin, new THREE.CylinderGeometry(0.024, 0.024, 0.025, 10).rotateX(Math.PI / 2), steel, Math.cos(a) * 0.17, Math.sin(a) * 0.17, sg * 0.366, false); }
      const rim = mk(spin, new THREE.TorusGeometry(0.635, 0.022, 8, 72), steel, 0, 0, sg * 0.352, false); rim.castShadow = false;
    }
    mk(hub, rbox(0.46, 0.62, 0.3, 0.1), dark, 0, 0, -side * 0.55); mk(hub, new THREE.CylinderGeometry(0.13, 0.13, 0.4, 20).rotateX(Math.PI / 2), grey, 0, 0, -side * 0.42);
    const aLo = V(ax, 1.15, side * 0.9), aUp = V(ax, 1.62, side * 0.9), aSh = V(ax - 0.3, 1.62, side * 1.18);
    const lo = strut(chassis, aLo, aLo.clone(), 0.052, steel), lo2 = strut(chassis, aLo, aLo.clone(), 0.04, steel), up = strut(chassis, aUp, aUp.clone(), 0.045, steel);
    const shO = strut(chassis, aSh, aSh.clone(), 0.05, dark), shI = strut(chassis, aSh, aSh.clone(), 0.032, steel), coil = spring(chassis);
    const tie = front ? strut(chassis, V(ax + 0.5, 1.15, side * 0.9), V(ax + 0.5, 1.0, side * 1.4), 0.03, steel) : null;
    for (const o of [lo, up, lo2, shO, shI, coil, tie]) if (o) o.userData.dyn = true;
    const links = (hubY: number) => {
      const hp = V(ax, hubY, side * (TRACK - 0.62));
      lo.set(aLo, hp.clone().add(V(0.2, -0.26, 0))); lo2.set(aLo.clone().add(V(-0.36, 0, 0)), hp.clone().add(V(-0.2, -0.26, 0)));
      up.set(aUp, hp.clone().add(V(0, 0.32, 0)));
      const sb = hp.clone().add(V(-0.28, -0.24, side * 0.12)), mid = aSh.clone().lerp(sb, 0.5);
      shO.set(aSh, mid); shI.set(mid, sb); coil.set(aSh.clone().lerp(sb, 0.04), aSh.clone().lerp(sb, 0.7));
      if (tie) tie.set(V(ax + 0.5, 1.15, side * 0.9), hp.clone().add(V(0.5, -0.12, side * 0.35)));
    };
    links(WHEEL_R); wheels.push({ side, x: ax, front, hub, steer, spin, links, rotor: discM, anchor: V(ax, WHEEL_R, side * (TRACK + 0.55)), name: names[wheels.length] });
  }

  // ================= CHASSIS: tubular rails, perforated deck, white boxes =================
  const deckY = 1.72;
  for (const s of [-1, 1]) {
    mk(chassis, rbox(10.2, 0.26, 0.22, 0.09), grey, 0.3, 1.0, s * 0.9); mk(chassis, rbox(10.2, 0.07, 0.3, 0.03), steel, 0.3, 0.84, s * 0.9);
    for (const x of [-4.2, -2.6, -1.2, 0.6, 1.4]) strut(chassis, V(x, 1.1, s * 0.9), V(x, deckY - 0.04, s * 1.2), 0.04, steel, 8);
  }
  for (let x = -4.5; x <= 4.8; x += 1.1) mk(chassis, rbox(0.16, 0.2, 1.8, 0.06), grey, x, 1.02, 0);
  mk(chassis, rbox(5.9, 0.07, 2.9, 0.03), std(0xffffff, 0.55, 0.45, { map: perfTex(16, 8) }), -1.75, deckY, 0);
  for (const s of [-1, 1]) mk(chassis, rbox(5.9, 0.14, 0.07, 0.025), steel, -1.75, deckY - 0.07, s * 1.47); mk(chassis, rbox(0.07, 0.14, 2.94, 0.025), steel, -4.7, deckY - 0.07, 0);
  for (const s of [-1, 1]) mk(chassis, rbox(1.75, 0.5, 0.56, 0.1), std(0xf2f2ef, 0.35, 0.2, { map: moduleTex() }), -1.9, 1.4, s * 1.1);
  mk(chassis, rbox(1.2, 0.34, 0.5, 0.1), std(0xf2f2ef, 0.35, 0.2), 0.45, 1.3, -1.05); mk(chassis, rbox(2.4, 0.36, 1.6, 0.14), std(NASA.gold, 0.32, 0.85, { bumpMap: crinkleTexture(3, 3), bumpScale: 2 }), 2.3, 0.88, 0);
  for (const ax of AXLES) mk(chassis, new THREE.CylinderGeometry(0.035, 0.035, 2 * TRACK - 1.2, 10).rotateX(Math.PI / 2), steel, ax - 0.55, 0.78, 0);
  tube(chassis, [V(4.4, 1.0, -0.5), V(2.0, 0.8, -0.6), V(0.2, 0.92, -0.4), V(-1.6, 0.85, -0.5), V(-4.2, 0.95, -0.4)], 0.032, copper); tube(chassis, [V(4.4, 1.0, 0.5), V(2.0, 0.78, 0.6), V(0.2, 0.9, 0.4), V(-1.6, 0.82, 0.5), V(-4.2, 0.93, 0.4)], 0.032, std(0x1f4aa0, 0.5, 0.2));
  // rear deck rails and tail gear
  for (const s of [-1, 1]) { tube(chassis, [V(-2.4, deckY + 0.4, s * 1.45), V(-4.7, deckY + 0.4, s * 1.45)], 0.025, steel, 4); for (const x of [-2.5, -3.5, -4.6]) strut(chassis, V(x, deckY, s * 1.45), V(x, deckY + 0.4, s * 1.45), 0.022, steel, 8); mk(chassis, rbox(0.06, 0.16, 0.3, 0.04), std(0xff2a1a, 0.5, 0.1, { emissive: 0xff2a1a, emissiveIntensity: 1.2 }), -4.74, deckY - 0.05, s * 1.3, false); }
  tube(chassis, [V(-4.7, deckY + 0.4, -1.45), V(-4.7, deckY + 0.4, 1.45)], 0.025, steel, 4); mk(chassis, new THREE.CylinderGeometry(0.1, 0.1, 0.4, 16).rotateZ(Math.PI / 2), steel, -5.0, deckY - 0.18, 0); mk(chassis, new THREE.SphereGeometry(0.08, 16, 12), brass, -5.25, deckY - 0.18, 0);
  for (const [x, z] of [[-3.0, -1.3], [-3.0, 1.3], [-4.4, -1.3], [-4.4, 1.3]] as const) mk(chassis, new THREE.TorusGeometry(0.07, 0.015, 8, 16).rotateX(Math.PI / 2), steel, x, deckY + 0.05, z, false);

  // ================= MODULE BAY: white racks with yellow cables, hex fan pods, fairing, flat roof, scaly solar panel =================
  const bay = new THREE.Group(); root.add(bay); const modTex = moduleTex();
  for (const x of [0.65, -0.1]) for (const y of [2.22, 2.86]) {
    mk(bay, rbox(0.72, 0.6, 2.66, 0.07), std(0xf2f2ef, 0.35, 0.2, { map: modTex }), x, y, 0);
    for (const s of [-1, 1]) { mk(bay, rbox(0.1, 0.16, 0.2, 0.03), grey, x - 0.05, y + 0.22, s * 1.36); mk(bay, new THREE.CylinderGeometry(0.035, 0.035, 0.12, 10).rotateX(Math.PI / 2), brass, x, y - 0.05, s * 1.38); }
  }
  for (const s of [-1, 1]) {
    for (const x of [1.0, -0.45]) strut(bay, V(x, deckY, s * 1.4), V(x, 3.3, s * 1.4), 0.045, white);
    tube(bay, [V(1.0, 2.54, s * 1.4), V(-0.5, 2.54, s * 1.4)], 0.032, brass, 8); tube(bay, [V(1.0, 2.5, s * 1.38), V(-0.5, 2.5, s * 1.38)], 0.02, copper, 8);
    for (const x of [0.65, -0.1]) { tube(bay, [V(x, 2.9, s * 1.4), V(x + 0.08, 2.6, s * 1.46), V(x - 0.1, 2.2, s * 1.46), V(x, 1.8, s * 1.4)], 0.016, yellowCable, 20); }
    tube(bay, [V(-0.3, 1.78, s * 1.4), V(-0.9, 1.9, s * 1.5), V(-1.3, 1.8, s * 1.4), V(-1.7, 1.88, s * 1.5)], 0.016, yellowCable, 20);
  }
  const hexG = new THREE.ExtrudeGeometry(hexShape(0.5, 0.07), { depth: 0.32, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 3 });
  const fanM = std(0xffffff, 0.45, 0.3, { map: fanTex() }), podM = std(0xdcdfe2, 0.4, 0.3);
  mk(bay, rbox(2.15, 1.45, 2.1, 0.12), white, -1.65, 2.52, 0);
  for (const s of [-1, 1]) for (const x of [-1.05, -2.25]) {
    const pod = new THREE.Group(); pod.position.set(x, 2.5, s * 1.04); if (s < 0) pod.rotation.y = Math.PI; bay.add(pod);
    mk(pod, hexG, podM); const face = mk(pod, new THREE.ShapeGeometry(hexShape(0.5, 0.07)), fanM, 0, 0, 0.36, false); face.scale.setScalar(0.96);
    for (const sg of [-1, 1]) mk(pod, rbox(0.12, 0.18, 0.08, 0.02), blackM, sg * 0.42, -0.26, 0.28);
    tube(pod, [V(0.3, -0.1, 0.34), V(0.34, -0.3, 0.45), V(0.1, -0.5, 0.4)], 0.014, yellowCable, 12);
  }
  mk(bay, rbox(3.8, 0.1, 2.9, 0.05), std(0xffffff, 0.8, 0.1, { map: plateDotTex() }), -0.65, 3.36, 0); for (const s of [-1, 1]) mk(bay, rbox(3.8, 0.16, 0.08, 0.04), white, -0.65, 3.3, s * 1.45);
  const solar = new THREE.Group(); solar.position.set(-1.65, 3.52, 0); solar.rotation.z = 0.12; bay.add(solar);
  mk(solar, rbox(2.0, 0.05, 2.6, 0.02), std(0xffffff, 0.3, 0.5, { map: solarTex() })); for (const s of [-1, 1]) mk(solar, rbox(2.04, 0.07, 0.06, 0.02), copper, 0, 0.0, s * 1.31); mk(solar, rbox(0.06, 0.07, 2.66, 0.02), copper, -1.0, 0, 0);
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.46), new THREE.MeshBasicMaterial({ map: meatball(), transparent: true })); p.position.set(0.3, 2.55, s * 1.371); if (s < 0) p.rotation.y = Math.PI; bay.add(p); }

  // ================= INTERIOR: unobstructed entry, seats, a proper dash with live screens, lockers, radio rack =================
  const cab = new THREE.Group(); root.add(cab);
  const fl = std(0xffffff, 0.8, 0.05, { map: tileTexture('#8d949c', '#6a7078', 5) });
  mk(cab, new THREE.PlaneGeometry(2.9, 2.7).rotateX(-Math.PI / 2), fl, 2.7, FLOOR_Y + 0.04, 0, false);
  const ramp = mk(cab, rbox(0.95, 0.05, 1.5, 0.02), fl, 4.62, 1.58, 0); ramp.rotation.z = 0.184;
  mk(cab, rbox(0.04, 0.1, 2.7, 0.02), blue, X0 + 0.06, FLOOR_Y + 0.4, 0, false);
  for (const z of [-0.8, 0.8]) mk(cab, rbox(0.8, 0.03, 0.4, 0.015), glowMat(0xfff1dd, 1.0), z < 0 ? 2.0 : 2.8, Yt - 0.04, z * 0.2, false);
  mk(cab, rbox(2.0, 0.04, 2.6, 0.03), std(0xe9edf0, 0.85, 0.02), 2.35, Yt - 0.05, 0, false); // ceiling only under the tall roof; the nose roof slopes down
  const seatM = std(0x2c3340, 0.85, 0.05), seatTrim = std(0x1f4aa0, 0.8, 0.05);
  for (const z of [-0.62, 0.62]) {
    mk(cab, rbox(0.55, 0.14, 0.52, 0.07), seatM, 3.97, 1.82, z); mk(cab, rbox(0.14, 0.82, 0.5, 0.07), seatM, 3.66, 2.25, z); mk(cab, rbox(0.12, 0.26, 0.34, 0.06), seatM, 3.62, 2.78, z);
    mk(cab, rbox(0.4, 0.04, 0.54, 0.02), seatTrim, 3.97, 1.9, z); mk(cab, new THREE.CylinderGeometry(0.06, 0.08, 0.45, 14), dark, 3.97, 1.55, z);
    for (const s of [-1, 1]) { mk(cab, rbox(0.4, 0.05, 0.07, 0.025), dark, 3.97, 2.12, z + s * 0.31); strut(cab, V(3.64, 2.72, z + s * 0.15), V(3.8, 2.2, z + s * 0.1), 0.012, red, 6); }
  }
  // dash: low console under the front windows, three live screens tilted to face the driver (left drive, centre map, right systems)
  mk(cab, rbox(0.7, 0.6, 2.0, 0.1), dark, 4.88, 1.62, 0); mk(cab, rbox(0.3, 0.1, 2.0, 0.05), grey, 4.55, 1.9, 0);
  const screens = [makeScreen(256, 160), makeScreen(320, 200), makeScreen(256, 160)], eye = SEAT_EYE.clone();
  [[-0.7, 0.5, 0.31], [0, 0.62, 0.39], [0.7, 0.5, 0.31]].forEach(([z, w, h], i) => {
    const p = V(4.78, 2.0, z), m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: screens[i].t })); m.position.copy(p); cab.add(m); m.lookAt(eye);
    const hs = mk(cab, rbox(w + 0.06, h + 0.06, 0.05, 0.02), dark, p.x, p.y, p.z, false); hs.quaternion.copy(m.quaternion); hs.position.copy(p).addScaledVector(V(0, 0, -1).applyQuaternion(m.quaternion), 0.04);
  });
  const indMats = ['park', 'abs', 'over', 'dmg', 'lamps', 'link'].map((k, i) => ({ k, m: new THREE.MeshStandardMaterial({ color: 0x222222, emissive: [0xff3322, 0xffa31a, 0xff3322, 0xffa31a, 0x4fd8ff, 0x55ff88][i], emissiveIntensity: 0 }) }));
  indMats.forEach(({ m }, i) => dyn(mk(cab, new THREE.SphereGeometry(0.02, 12, 8), m, 4.5, 1.97, -0.95 + i * 0.07, false)));
  // controls that follow the inputs: joystick, throttle lever, two pedals, parking-brake lever
  const stick = dynGroup(new THREE.Group()); stick.position.set(4.16, 2.1, -0.32); cab.add(stick);
  mk(stick, new THREE.CylinderGeometry(0.03, 0.04, 0.22, 14), dark, 0, 0.11, 0); mk(stick, new THREE.SphereGeometry(0.055, 16, 12), red, 0, 0.24, 0); mk(stick, rbox(0.1, 0.05, 0.1, 0.02), dark, 0, 0.0, 0);
  const thrLever = dynGroup(new THREE.Group()); thrLever.position.set(4.1, 2.1, -0.93); cab.add(thrLever);
  mk(thrLever, new THREE.CylinderGeometry(0.022, 0.028, 0.2, 12), dark, 0, 0.1, 0); mk(thrLever, new THREE.SphereGeometry(0.04, 14, 10), blue, 0, 0.22, 0); mk(cab, rbox(0.3, 0.04, 0.08, 0.02), dark, 4.1, 2.09, -0.93);
  const pedalT = dynGroup(new THREE.Group()), pedalB = dynGroup(new THREE.Group()); pedalT.position.set(4.52, 1.6, -0.5); pedalB.position.set(4.52, 1.6, -0.76); cab.add(pedalT, pedalB);
  mk(pedalT, rbox(0.04, 0.2, 0.15, 0.02), dark, 0, 0.1, 0); mk(pedalB, rbox(0.04, 0.2, 0.2, 0.02), dark, 0, 0.1, 0);
  mk(cab, rbox(1.0, 0.4, 0.26, 0.08), grey, 4.1, 1.7, 0); mk(cab, rbox(0.4, 0.05, 0.22, 0.02), dark, 4.1, 1.92, 0);
  const parkLever = dynGroup(new THREE.Group()); parkLever.position.set(4.2, 1.92, 0.0); cab.add(parkLever);
  mk(parkLever, new THREE.CylinderGeometry(0.02, 0.025, 0.24, 12), steel, 0, 0.12, 0); mk(parkLever, rbox(0.07, 0.05, 0.04, 0.02), red, 0, 0.26, 0);
  for (let i = 0; i < 8; i++) mk(cab, new THREE.BoxGeometry(0.03, 0.02, 0.03), glowMat(i % 3 ? 0x4fd8ff : 0xffa31a, 1.2), 3.95 + (i % 4) * 0.09, 1.93, -0.08 + Math.floor(i / 4) * 0.12, false);
  mk(cab, rbox(0.8, 0.12, 1.2, 0.06), dark, 2.95, Yt - 0.11, 0);
  for (let i = 0; i < 15; i++) { const sw = mk(cab, new THREE.CylinderGeometry(0.012, 0.012, 0.06, 8), steel, 2.65 + (i % 3) * 0.12 + 0.2, Yt - 0.18, -0.5 + Math.floor(i / 3) * 0.2, false); sw.rotation.z = (i % 2) * 0.5 - 0.25; }
  // rear bulkhead: three lockers (repair kits in the middle), radio rack on the starboard side. The doorway is clear.
  const lockerPlates: THREE.Mesh[] = [];
  for (const [z, txt] of [[-0.95, 'SAMPLES'], [-0.3, 'REPAIR KITS'], [0.35, 'MED KIT']] as const) {
    mk(cab, rbox(0.5, 1.5, 0.6, 0.07), std(0xe3e6e9, 0.5, 0.15), X0 + 0.32, FLOOR_Y + 0.8, z);
    const pl = mk(cab, new THREE.PlaneGeometry(0.4, 0.075), new THREE.MeshBasicMaterial({ map: plateTexture(txt) }), X0 + 0.58, FLOOR_Y + 1.3, z, false); pl.rotation.y = Math.PI / 2; lockerPlates.push(pl);
    mk(cab, rbox(0.04, 0.12, 0.2, 0.015), steel, X0 + 0.58, FLOOR_Y + 0.9, z, false);
  }
  mk(cab, rbox(0.46, 1.5, 0.6, 0.07), std(NASA.graphite, 0.5, 0.3), X0 + 0.3, FLOOR_Y + 0.8, RADIO.z); const radioScr = makeScreen(256, 160);
  const rs = mk(cab, new THREE.PlaneGeometry(0.42, 0.26), new THREE.MeshBasicMaterial({ map: radioScr.t }), X0 + 0.55, FLOOR_Y + 1.15, RADIO.z, false); rs.rotation.y = Math.PI / 2;
  for (let i = 0; i < 9; i++) mk(cab, new THREE.BoxGeometry(0.02, 0.04, 0.04), glowMat(i % 3 ? 0x4fd8ff : 0xffa31a, 1.2), X0 + 0.55, FLOOR_Y + 0.82 + Math.floor(i / 3) * 0.07, RADIO.z - 0.12 + (i % 3) * 0.08, false);
  mk(cab, new THREE.CylinderGeometry(0.02, 0.02, 0.2, 10).rotateX(Math.PI / 2), dark, X0 + 0.58, FLOOR_Y + 0.6, RADIO.z, false);
  const cabLight = new THREE.PointLight(0xfff0dc, 0, 9, 2); cabLight.position.set(2.9, 3.3, 0); cab.add(cabLight);

  // ================= DAMAGE VISUALS, hidden until needed =================
  const dentM = new THREE.MeshBasicMaterial({ map: dentTex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const dents: { m: THREE.Mesh; zone: string }[] = [];
  const addDent = (zone: string, p: THREE.Vector3, n: THREE.Vector3, size: number, parent: THREE.Object3D = cabG) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), dentM); m.position.copy(p).addScaledVector(n, 0.03); m.quaternion.setFromUnitVectors(V(0, 0, 1), n.clone().normalize()); m.visible = false; parent.add(m); dents.push({ m, zone });
  };
  for (const z of [-0.75, -0.25, 0.25, 0.75]) addDent('front', V(5.34, 1.3, z), V(1, 0, 0), 0.45, bumper);
  { const k = hull.faces[5]; addDent('front', bil(win[5].q, 0.5, 0.15), k.n, 0.5); addDent('front', bil(win[5].q, 0.2, 0.2), k.n, 0.4); addDent('front', bil(win[5].q, 0.8, 0.2), k.n, 0.4); }
  for (const fi of [8, 9]) { const f = hull.faces[fi]; addDent('front', bil(win[fi].q, 0.14, 0.16), f.n, 0.4); addDent('front', bil(win[fi].q, 0.5, 0.05), f.n, 0.35); }
  addDent('port', V(3.28, 1.6, -H), V(0, 0, -1), 0.32); addDent('starboard', V(2.2, 1.8, H), V(0, 0, 1), 0.45); addDent('rear', V(X0, 2.4, 0.4), V(-1, 0, 0), 0.6);
  const crackM = new THREE.MeshBasicMaterial({ map: crackTex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const cracks: THREE.Mesh[] = [];
  for (const w of windows.filter((q) => q.face === 6)) {
    const us = w.pts.map((p) => p.clone().sub(w.b.p0)), uu = us.map((d) => d.dot(w.b.u)), vv = us.map((d) => d.dot(w.b.v)), cu = (Math.min(...uu) + Math.max(...uu)) / 2, cv2 = (Math.min(...vv) + Math.max(...vv)) / 2;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(...uu) - Math.min(...uu), Math.max(...vv) - Math.min(...vv)), crackM);
    m.position.copy(w.b.p0).addScaledVector(w.b.u, cu).addScaledVector(w.b.v, cv2).addScaledVector(w.b.n, -0.085); m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(w.b.u, w.b.v, w.b.n)); m.visible = false; cabG.add(m); cracks.push(m);
  }

  // ================= anchors for gaze interaction and repair prompts (local metres) =================
  const anchors = {
    hatchOut: V(STEP_X, 2.3, -H - 0.1), hatchIn: V(STEP_X, 2.3, -H + 0.12), seat: V(3.9, 2.3, -0.62), radio: V(X0 + 0.55, FLOOR_Y + 1.15, RADIO.z), locker: V(X0 + 0.58, FLOOR_Y + 1.2, -0.3),
    bumper: V(5.5, 1.3, 0), windscreen: V(4.4, 3.2, 0), dish: V(ANT.x, ROOF_Y + 0.7, ANT.z),
  };

  const draws0 = bake(root), spinN = wheels.map((w) => bake(w.spin, false));
  return { draws0, spinN, root, chassis, cab, cabG, hatch: hatchObj, wheels, screens, radioScr, cabLight, bumper, dishG, stick, thrLever, pedalT, pedalB, parkLever, lamps: { mat: ledMat, meshes: ledMeshes }, ind: Object.fromEntries(indMats.map(({ k, m }) => [k, m])) as Record<string, THREE.MeshStandardMaterial>, dents, cracks, anchors, lockerPlates, STEP_X };
}

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
