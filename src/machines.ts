import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { wornMat } from './livery';

// Life-support hardware, each unit shaped after the real thing: an ISS-style 2 m rack with an electrolysis cell stack
// (oxygen), a gas manifold with regulators and bottles (atmosphere), filtration beds, waste tank and pump skid (water),
// and zeolite beds with a blower (CO2). Local frame: floor at y = 0, front face toward -x, wall behind at +x, width along z.
const P = Math.PI;
type V = [number, number, number];
const rb = (w: number, h: number, d: number, r = 0.03) => new RoundedBoxGeometry(w, h, d, 3, Math.max(0.002, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)));
const M = (c: number, rough = 0.5, metal = 0.2) => wornMat(c, metal >= 0.45 ? 'metal' : 'paint', { rough, metal: metal >= 0.45 ? metal : 0.04, repeat: 2 });
const G = (c: number, k = 1.3) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: k, roughness: 0.4 });
const glass = (o = 0.1, c = 0xcfe9ff) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.03, transparent: true, opacity: o, depthWrite: false });
export const COL = { steel: 0xb4bac2, white: 0xe9edf1, dark: 0x262b32, black: 0x14171b, orange: 0xe8832a, green: 0x2f9d58, blue: 0x2f6fd0, red: 0xc0392b, gold: 0xc8a035, grey: 0x8b929c };

const gaugeCache = new Map<number, THREE.CanvasTexture>();
function gaugeTex(v: number) {
  const k = Math.round(v * 10); let t = gaugeCache.get(k);
  if (!t) {
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d')!;
    g.fillStyle = '#f4f4f0'; g.beginPath(); g.arc(64, 64, 62, 0, P * 2); g.fill(); g.strokeStyle = '#222'; g.lineWidth = 3;
    for (let i = 0; i <= 10; i++) { const a = P * 0.75 + (P * 1.5 * i) / 10; g.beginPath(); g.moveTo(64 + Math.cos(a) * 50, 64 + Math.sin(a) * 50); g.lineTo(64 + Math.cos(a) * 58, 64 + Math.sin(a) * 58); g.stroke(); }
    g.strokeStyle = '#c0392b'; g.lineWidth = 5; g.beginPath(); g.arc(64, 64, 44, P * 0.75 + P * 1.5 * 0.82, P * 2.25); g.stroke();
    const a = P * 0.75 + P * 1.5 * (k / 10); g.strokeStyle = '#111'; g.lineWidth = 4; g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + Math.cos(a) * 42, 64 + Math.sin(a) * 42); g.stroke();
    g.fillStyle = '#111'; g.beginPath(); g.arc(64, 64, 6, 0, P * 2); g.fill();
    t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; gaugeCache.set(k, t);
  }
  return t;
}

class B {
  constructor(public g: THREE.Group, private fans: THREE.Object3D[]) {}
  m(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
    const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.castShadow = o.receiveShadow = true; this.g.add(o); return o;
  }
  box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, r = 0.03) { return this.m(rb(w, h, d, r), mat, x, y, z); }
  cyl(r: number, h: number, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, seg = 24) { return this.m(new THREE.CylinderGeometry(r, r, h, seg), mat, x, y, z, rx, ry, rz); }
  dome(r: number, mat: THREE.Material, x: number, y: number, z: number, flip = false) { return this.m(new THREE.SphereGeometry(r, 18, 10, 0, P * 2, 0, P / 2), mat, x, y, z, flip ? P : 0); }
  pipe(pts: V[], r: number, mat: THREE.Material) {
    const o = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), false, 'centripetal'), pts.length * 12, r, 8), mat); o.castShadow = o.receiveShadow = true; this.g.add(o); return o;
  }
  gauge(x: number, y: number, z: number, v: number) {
    this.m(new THREE.TorusGeometry(0.045, 0.008, 8, 24).rotateY(P / 2), M(COL.steel, 0.3, 0.7), x, y, z);
    const f = new THREE.Mesh(new THREE.CircleGeometry(0.043, 24).rotateY(-P / 2), new THREE.MeshBasicMaterial({ map: gaugeTex(v) })); f.position.set(x - 0.002, y, z); this.g.add(f);
  }
  wheel(x: number, y: number, z: number, axis: 'x' | 'y' = 'y') { return this.m(new THREE.TorusGeometry(0.04, 0.007, 8, 16).rotateX(axis === 'y' ? P / 2 : 0).rotateY(axis === 'x' ? P / 2 : 0), M(COL.red, 0.5, 0.2), x, y, z); }
  fan(x: number, y: number, z: number, r: number) {
    const f = new THREE.Group(); f.position.set(x, y, z); this.g.add(f);
    for (let i = 0; i < 7; i++) { const bl = new THREE.Mesh(new THREE.BoxGeometry(0.004, r * 0.85, r * 0.3), M(0x30363d, 0.5, 0.4)); bl.rotation.x = (i * 2 * P) / 7; bl.position.set(0, 0, 0); bl.geometry.translate(0, r * 0.45, 0); bl.rotation.z = 0.35; f.add(bl); }
    f.add(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.16, r * 0.16, 0.03, 16).rotateZ(P / 2), M(COL.steel, 0.3, 0.8)));
    this.fans.push(f); return f;
  }
}

function shell(b: B, w = 1.1, h = 1.95, d = 0.8, panels = true) {
  const white = M(COL.white, 0.5, 0.1), frame = M(COL.steel, 0.35, 0.6);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.05, h, 0.05, frame, sx * (d / 2 - 0.025), h / 2, sz * (w / 2 - 0.025), 0.015);
  b.box(d, 0.04, w, white, 0, h - 0.02, 0, 0.012); b.box(d, 0.06, w, white, 0, 0.03, 0, 0.012); b.box(0.03, h, w, white, d / 2 - 0.015, h / 2, 0, 0.01);
  if (panels) for (const sz of [-1, 1]) b.box(d, h, 0.025, white, 0, h / 2, sz * (w / 2 - 0.0125), 0.008);
}

/** Oxygen Generation Assembly: power module on top, electrolysis cell stack behind an acrylic window, separator tank, plumbing. */
export function oxygenator(fans: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group(), b = new B(g, fans); shell(b);
  const steel = M(COL.steel, 0.3, 0.75), gold = M(COL.gold, 0.35, 0.8), dark = M(COL.dark, 0.6, 0.3), white = M(COL.white, 0.45, 0.1), tank = M(0x6c7f95, 0.35, 0.6);
  b.box(0.04, 0.36, 1.02, white, -0.37, 1.72, 0);
  for (let i = 0; i < 9; i++) b.box(0.014, 0.012, 0.62, dark, -0.395, 1.6 + i * 0.026, -0.12, 0.004);
  for (let i = 0; i < 3; i++) b.box(0.012, 0.03, 0.03, G(i === 2 ? 0xffb000 : COL.green), -0.395, 1.84, 0.28 + i * 0.07, 0.008);
  b.box(0.03, 0.03, 0.2, steel, -0.4, 1.78, 0.4, 0.012);
  for (let i = 0; i < 16; i++) b.cyl(0.16, 0.036, i % 2 ? gold : steel, -0.04, 0.82 + i * 0.039, -0.16, 0, 0, 0, 28);
  for (let i = 0; i < 4; i++) { const a = (i * P) / 2 + P / 4; b.cyl(0.011, 0.76, steel, -0.04 + Math.cos(a) * 0.178, 1.14, -0.16 + Math.sin(a) * 0.178, 0, 0, 0, 8); }
  b.cyl(0.19, 0.05, steel, -0.04, 0.78, -0.16); b.cyl(0.19, 0.05, steel, -0.04, 1.48, -0.16);
  b.cyl(0.1, 0.55, tank, -0.04, 1.08, 0.3); b.dome(0.1, tank, -0.04, 1.355, 0.3); b.dome(0.1, tank, -0.04, 0.805, 0.3, true);
  b.pipe([[-0.04, 1.5, -0.16], [-0.04, 1.62, -0.16], [-0.04, 1.62, 0.12], [-0.04, 1.5, 0.3]], 0.018, steel);
  b.pipe([[-0.04, 1.44, 0.3], [-0.2, 1.56, 0.32], [-0.3, 1.66, 0.48]], 0.014, M(COL.green, 0.45, 0.2));
  b.pipe([[0.05, 1.0, 0.3], [0.2, 1.3, 0.35], [0.3, 1.9, 0.4]], 0.012, M(COL.red, 0.45, 0.2));
  b.pipe([[-0.04, 0.76, -0.16], [-0.3, 0.6, -0.3], [-0.34, 0.5, -0.5]], 0.014, M(COL.blue, 0.45, 0.2));
  for (const [x, y, z] of [[-0.3, 1.66, 0.48], [-0.34, 0.5, -0.5]] as V[]) b.cyl(0.03, 0.07, dark, x, y, z, 0, 0, P / 2, 14);
  b.m(rb(0.012, 0.82, 0.92, 0.01), glass(), -0.388, 1.1, 0);
  for (const y of [0.68, 1.52]) b.box(0.02, 0.03, 0.96, steel, -0.392, y, 0, 0.01);
  for (const z of [-0.48, 0.48]) b.box(0.02, 0.86, 0.03, steel, -0.392, 1.1, z, 0.01);
  b.box(0.04, 0.56, 1.02, white, -0.37, 0.4, 0); b.box(0.03, 0.04, 0.4, steel, -0.395, 0.62, 0, 0.012);
  b.gauge(-0.396, 0.34, -0.3, 0.7); b.gauge(-0.396, 0.34, 0.3, 0.45);
  return g;
}

/** Atmosphere regulator: colour-coded gas manifold with valves, regulators and gauges, plus strapped O2 and N2 bottles. */
export function atmosReg(fans: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group(), b = new B(g, fans);
  const plate = M(0xd6dbe1, 0.6, 0.1), steel = M(COL.steel, 0.3, 0.75), dark = M(COL.dark, 0.5, 0.3);
  b.box(0.05, 1.7, 1.14, plate, 0.33, 1.0, 0, 0.012); b.box(0.55, 0.08, 1.14, dark, 0.1, 0.04, 0, 0.02);
  const lines: [number, number, number][] = [[1.78, COL.green, 0], [1.58, COL.black, 0], [1.38, COL.grey, 0]];
  for (const [y, c] of lines) {
    b.cyl(0.03, 1.0, M(c, 0.45, 0.3), 0.25, y, 0, P / 2, 0, 0, 14); for (const z of [-0.5, 0.5]) b.cyl(0.04, 0.03, steel, 0.25, y, z, P / 2, 0, 0, 14);
    for (const z of [-0.3, 0.05, 0.38]) { b.m(new THREE.SphereGeometry(0.04, 12, 10), M(COL.steel, 0.3, 0.7), 0.25, y, z); b.wheel(0.25, y + 0.07, z); b.cyl(0.012, 0.07, steel, 0.25, y + 0.035, z, 0, 0, 0, 8); }
    b.box(0.1, 0.14, 0.1, M(0x5d6670, 0.4, 0.5), 0.2, y - 0.14, -0.15); b.dome(0.045, M(COL.steel, 0.3, 0.7), 0.2, y - 0.07, -0.15);
  }
  for (const [x, y, z, v] of [[0.145, 1.62, -0.15, 0.62], [0.145, 1.42, -0.15, 0.4], [0.145, 1.82, 0.2, 0.78], [0.145, 1.22, 0.2, 0.3]] as [number, number, number, number][]) b.gauge(x - 0.05, y - 0.04, z, v);
  for (const sz of [-1, 1]) {
    const col = sz < 0 ? COL.green : COL.black, bm = M(col, 0.35, 0.5), x = -0.02, z = sz * 0.4;
    b.cyl(0.115, 1.0, bm, x, 0.62, z, 0, 0, 0, 28); b.dome(0.115, bm, x, 1.12, z); b.cyl(0.115, 0.1, M(COL.white, 0.4, 0.2), x, 0.9, z, 0, 0, 0, 28);
    b.cyl(0.03, 0.1, steel, x, 1.25, z, 0, 0, 0, 12); b.wheel(x, 1.31, z); b.cyl(0.126, 0.03, M(COL.steel, 0.3, 0.8), x, 0.55, z, 0, 0, 0, 28); b.cyl(0.126, 0.03, M(COL.steel, 0.3, 0.8), x, 0.95, z, 0, 0, 0, 28);
    b.pipe([[x, 1.31, z], [0.05, 1.55, z * 0.8], [0.22, sz < 0 ? 1.78 : 1.58, sz * 0.4]], 0.014, M(col, 0.45, 0.3));
  }
  b.box(0.1, 0.28, 0.34, dark, 0.26, 0.88, 0, 0.02); b.box(0.01, 0.12, 0.26, G(0x6fd3ff, 0.9), 0.205, 0.92, 0, 0.004);
  for (let i = 0; i < 3; i++) b.box(0.01, 0.02, 0.02, G(i === 0 ? 0xffb000 : COL.green), 0.205, 0.8, -0.1 + i * 0.1, 0.005);
  return g;
}

/** Water recovery: multifiltration beds, translucent waste-water tank, catalytic reactor, separator drum, pump skid, potable tap. */
export function waterReclaimer(fans: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group(), b = new B(g, fans); shell(b, 1.1, 1.95, 0.8, false);
  const steel = M(COL.steel, 0.3, 0.75), dark = M(COL.dark, 0.5, 0.3), white = M(COL.white, 0.45, 0.1), gold = M(COL.gold, 0.35, 0.8);
  b.box(0.8, 0.03, 1.0, steel, 0, 1.15, 0, 0.01); b.box(0.8, 0.03, 1.0, steel, 0, 0.12, 0, 0.01);
  for (const z of [-0.36, -0.2]) { b.cyl(0.075, 0.85, steel, -0.12, 0.6, z, 0, 0, 0, 24); b.dome(0.075, white, -0.12, 1.025, z); b.cyl(0.02, 0.07, dark, -0.12, 1.09, z, 0, 0, 0, 10); b.dome(0.075, white, -0.12, 0.175, z, true); b.cyl(0.082, 0.025, white, -0.12, 0.85, z, 0, 0, 0, 24); }
  b.cyl(0.19, 0.76, glass(0.28, 0x9cc8ff), -0.06, 0.52, 0.12, 0, 0, 0, 32); b.cyl(0.172, 0.5, new THREE.MeshStandardMaterial({ color: COL.blue, roughness: 0.15, transparent: true, opacity: 0.75, emissive: COL.blue, emissiveIntensity: 0.12 }), -0.06, 0.4, 0.12, 0, 0, 0, 28);
  b.cyl(0.2, 0.03, steel, -0.06, 0.905, 0.12, 0, 0, 0, 32); b.cyl(0.2, 0.03, steel, -0.06, 0.145, 0.12, 0, 0, 0, 32);
  for (let i = 0; i <= 6; i++) b.box(0.012, 0.008, i % 2 ? 0.06 : 0.1, white, -0.255, 0.2 + i * 0.1, 0.12, 0.003);
  b.cyl(0.058, 0.62, M(0x70757c, 0.4, 0.5), 0.14, 1.5, -0.36, 0, 0, 0, 20); for (const y of [1.3, 1.5, 1.7]) b.cyl(0.066, 0.05, M(COL.orange, 0.5, 0.3), 0.14, y, -0.36, 0, 0, 0, 20);
  b.dome(0.058, M(0x70757c, 0.4, 0.5), 0.14, 1.81, -0.36);
  b.cyl(0.1, 0.3, steel, -0.1, 1.38, 0.2, P / 2, 0, 0, 24); b.cyl(0.105, 0.03, dark, -0.1, 1.38, 0.06, P / 2, 0, 0, 24); b.cyl(0.105, 0.03, dark, -0.1, 1.38, 0.34, P / 2, 0, 0, 24);
  b.box(0.24, 0.14, 0.3, dark, -0.1, 0.22, 0.38, 0.03); b.cyl(0.06, 0.2, M(COL.orange, 0.5, 0.4), -0.1, 0.2, 0.18, P / 2, 0, 0, 20);
  b.box(0.3, 0.5, 0.34, white, -0.1, 1.55, -0.1, 0.03); b.box(0.005, 0.16, 0.2, G(0x6fd3ff, 0.8), -0.255, 1.62, -0.1, 0.002);
  b.pipe([[-0.12, 1.1, -0.28], [-0.05, 1.12, -0.1], [-0.06, 0.92, 0.12]], 0.014, M(COL.blue, 0.4, 0.2));
  b.pipe([[-0.06, 0.2, 0.2], [-0.2, 0.15, 0.3], [-0.1, 0.22, 0.38]], 0.016, M(0xd8e8f5, 0.2, 0.1));
  b.pipe([[0.14, 1.82, -0.36], [0.2, 1.9, -0.1], [0.26, 1.7, 0.25]], 0.012, M(COL.steel, 0.3, 0.7));
  b.pipe([[-0.1, 1.38, 0.34], [-0.28, 1.2, 0.46], [-0.34, 0.5, 0.48], [-0.3, 0.3, 0.42]], 0.014, M(COL.blue, 0.4, 0.2));
  b.cyl(0.012, 0.1, steel, -0.36, 0.62, 0.48, 0, 0, P / 2, 10); b.box(0.04, 0.03, 0.04, G(COL.blue, 1.0), -0.37, 0.7, 0.48, 0.01); b.box(0.12, 0.012, 0.16, dark, -0.36, 0.5, 0.48, 0.005);
  b.box(0.04, 0.3, 1.0, white, -0.37, 0.28, -0.0, 0.01); b.cyl(0.35, 0.02, gold, 0.2, 0.2, -0.2, 0, 0, 0, 24);
  return g;
}

/** CO2 removal: two horizontal zeolite beds with insulation and heaters, valve blocks, blower with a spinning fan, ducting. */
export function co2Scrubber(fans: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group(), b = new B(g, fans); shell(b, 1.1, 1.95, 0.8, false);
  const steel = M(COL.steel, 0.3, 0.75), dark = M(COL.dark, 0.5, 0.3), white = M(COL.white, 0.45, 0.1), gold = M(COL.gold, 0.32, 0.85), grey = M(0x9aa1ab, 0.55, 0.4);
  for (const y of [1.5, 1.2]) {
    b.cyl(0.14, 0.95, steel, -0.08, y, 0, P / 2, 0, 0, 28); b.cyl(0.152, 0.5, gold, -0.08, y, 0.1, P / 2, 0, 0, 28); b.cyl(0.157, 0.03, M(COL.orange, 0.5, 0.3), -0.08, y, -0.2, P / 2, 0, 0, 28);
    for (const z of [-0.5, 0.5]) { b.m(new THREE.SphereGeometry(0.14, 20, 12, 0, P * 2, 0, P / 2), white, -0.08, y, z * 0.99, 0, 0, z < 0 ? P / 2 : -P / 2); b.cyl(0.16, 0.03, steel, -0.08, y, z * 0.9, P / 2, 0, 0, 28); }
  }
  b.box(0.2, 0.18, 0.16, dark, -0.08, 1.35, 0.52, 0.03); b.box(0.2, 0.18, 0.16, dark, -0.08, 1.35, -0.52, 0.03);
  b.cyl(0.1, 0.55, M(COL.blue, 0.4, 0.4), -0.1, 0.62, -0.3, 0, 0, 0, 24); b.dome(0.1, M(COL.blue, 0.4, 0.4), -0.1, 0.895, -0.3); b.cyl(0.108, 0.04, steel, -0.1, 0.4, -0.3, 0, 0, 0, 24);
  b.box(0.34, 0.28, 0.3, dark, -0.1, 0.45, 0.3, 0.04); b.cyl(0.11, 0.02, steel, -0.268, 0.45, 0.3, 0, 0, P / 2, 28); b.fan(-0.262, 0.45, 0.3, 0.1);
  b.pipe([[-0.1, 0.6, 0.3], [0.05, 0.9, 0.34], [0.1, 1.1, 0.5], [-0.08, 1.2, 0.52]], 0.05, grey);
  b.pipe([[-0.08, 1.5, -0.52], [0.1, 1.7, -0.3], [0.3, 2.0, -0.2]], 0.07, grey);
  b.pipe([[-0.1, 0.9, -0.3], [0.0, 1.0, -0.4], [-0.08, 1.2, -0.52]], 0.03, grey);
  for (let i = 0; i < 9; i++) { const t = i / 8; b.m(new THREE.TorusGeometry(0.074, 0.008, 6, 16), steel, 0.1 + 0.2 * t, 1.7 + 0.3 * t, -0.3 + 0.1 * t, 0.9, 0, 0); }
  b.gauge(-0.396, 1.78, 0.35, 0.5); b.gauge(-0.396, 1.78, -0.35, 0.35); b.box(0.04, 0.2, 0.5, white, -0.37, 1.82, 0, 0.01);
  b.box(0.04, 0.16, 0.36, dark, -0.37, 0.88, 0.3, 0.02); b.box(0.005, 0.08, 0.28, G(0x6fd3ff, 0.9), -0.395, 0.88, 0.3, 0.002);
  return g;
}

/** Wall-mounted fire extinguisher. */
export function extinguisher(): THREE.Group {
  const g = new THREE.Group(), b = new B(g, []);
  b.cyl(0.075, 0.38, M(0xc0392b, 0.35, 0.3), 0, 0.5, 0, 0, 0, 0, 20); b.dome(0.075, M(0xc0392b, 0.35, 0.3), 0, 0.69, 0); b.cyl(0.03, 0.08, M(COL.black, 0.5, 0.3), 0, 0.77, 0, 0, 0, 0, 12);
  b.box(0.05, 0.03, 0.09, M(COL.black, 0.5, 0.3), -0.02, 0.8, 0, 0.01); b.pipe([[0.0, 0.76, 0.0], [-0.1, 0.6, 0.05], [-0.1, 0.4, 0.0]], 0.012, M(COL.black, 0.6, 0.2));
  b.box(0.02, 0.02, 0.2, M(COL.steel, 0.3, 0.7), 0.09, 0.6, 0, 0.005);
  return g;
}
