import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// Crew furnishings that open and close: wardrobe, medical cabinet, first-aid kit, and the hygiene compartment.
// Local frame (same as the machines): floor y = 0, front toward -x, wall behind at +x, width along z.
const P = Math.PI;
export type Hinge = { pivot: THREE.Object3D; axis: 'x' | 'y' | 'z'; open: number };
const rb = (w: number, h: number, d: number, r = 0.015) => new RoundedBoxGeometry(w, h, d, 3, Math.max(0.002, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)));
const M = (c: number, rough = 0.6, metal = 0.05) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal });
const glassM = (o = 0.14, c = 0xdfeaf3) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.05, transparent: true, opacity: o, depthWrite: false, side: THREE.DoubleSide });

class B {
  constructor(public g: THREE.Object3D) {}
  m(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, parent: THREE.Object3D = this.g) {
    const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.castShadow = mat !== undefined && !(mat as THREE.Material).transparent; o.receiveShadow = true; parent.add(o); return o;
  }
  box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, r = 0.015, parent: THREE.Object3D = this.g) { return this.m(rb(w, h, d, r), mat, x, y, z, 0, 0, 0, parent); }
  cyl(r: number, h: number, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, parent: THREE.Object3D = this.g, seg = 20) { return this.m(new THREE.CylinderGeometry(r, r, h, seg), mat, x, y, z, rx, ry, rz, parent); }
}
const pivotAt = (g: THREE.Object3D, x: number, y: number, z: number) => { const p = new THREE.Group(); p.position.set(x, y, z); g.add(p); return p; };

/** Medium crew wardrobe: hanging side with coveralls and shirts, shelved side with folded clothes, boots and a duffel. */
export function wardrobe() {
  const g = new THREE.Group(), b = new B(g), doors: Hinge[] = [];
  const lam = M(0xe6e8eb, 0.55, 0.02), inner = M(0xcdd1d6, 0.7, 0.02), dark = M(0x3b4048, 0.5, 0.3), steel = M(0xb4bac2, 0.3, 0.7);
  const W = 1.3, D = 0.65, H = 2.05;
  b.box(0.03, H, W, inner, 0.31, H / 2, 0); for (const s of [-1, 1]) b.box(D, H, 0.03, lam, 0, H / 2, s * (W / 2 - 0.015));
  b.box(D, 0.04, W, lam, 0, H - 0.02, 0); b.box(D, 0.08, W, dark, 0, 0.04, 0); b.box(D - 0.04, H - 0.1, 0.02, inner, 0, H / 2, 0);
  b.cyl(0.012, 0.6, steel, 0, 1.82, -0.32, P / 2);                                                    // hanging rail
  const cloth = [0x28457f, 0xd8dce2, 0x6b7480, 0x25282d, 0x2f4f87, 0xb9bfc7, 0x28457f];
  cloth.forEach((c, i) => { const z = -0.58 + i * 0.087, h = i % 3 === 0 ? 1.05 : 0.72; b.box(0.4, h, 0.045, M(c, 0.9, 0), 0.0 + (i % 2) * 0.01, 1.8 - h / 2 - 0.04, z, 0.02); b.cyl(0.004, 0.06, steel, 0, 1.82, z); });
  for (const y of [0.45, 0.85, 1.25, 1.65]) b.box(D - 0.06, 0.025, 0.6, lam, 0, y, 0.33);
  [[0.45, 0x28457f], [0.85, 0xd8dce2], [0.85, 0x6b7480], [1.25, 0x2f4f87], [1.25, 0xb9bfc7], [1.65, 0x25282d]].forEach(([y, c], i) => { const n = 2 + (i % 3); for (let k = 0; k < n; k++) b.box(0.36, 0.045, 0.27, M(c as number, 0.95, 0), 0.0, (y as number) + 0.0345 + k * 0.047, 0.17 + (i % 2) * 0.2, 0.012); });
  for (const z of [0.2, 0.42]) { b.box(0.14, 0.12, 0.3, M(0x3a3f46, 0.8, 0.1), -0.02, 0.1, z, 0.04); b.cyl(0.055, 0.2, M(0x3a3f46, 0.8, 0.1), 0.05, 0.22, z, 0, 0, 0, g, 14); }   // boots
  b.m(new THREE.CapsuleGeometry(0.1, 0.38, 6, 14).rotateX(P / 2), M(0x4a5462, 0.9, 0), 0, 1.79, 0.33);   // duffel
  b.box(0.012, 0.11, 0.15, M(0x2a2d32, 0.5, 0.2), 0.0, 1.72, 0.03 + 0.0, 0.004).position.set(-0.28, 1.4, 0.64);   // framed photo on the divider side
  for (const s of [-1, 1]) {
    const pv = pivotAt(g, -D / 2, 0.08, s * (W / 2 + 0.005)); b.box(0.025, 1.93, 0.64, lam, 0, 0.965, -s * 0.32, 0.01, pv);
    b.cyl(0.011, 0.34, steel, -0.03, 1.0, -s * 0.58, 0, 0, 0, pv, 10); b.box(0.012, 0.16, 0.012, dark, -0.02, 1.0, -s * 0.58, 0.004, pv);
    doors.push({ pivot: pv, axis: 'y', open: s < 0 ? -1.75 : 1.75 });
  }
  return { g, doors };
}

/** Wall medical cabinet: two doors, red cross, shelves of supplies, an AED and an oxygen bottle. */
export function medicalCabinet() {
  const g = new THREE.Group(), b = new B(g), doors: Hinge[] = [];
  const wh = M(0xf1f2f4, 0.5, 0.02), inner = M(0xdde1e5, 0.7, 0.02), red = M(0xc0392b, 0.5, 0.05), steel = M(0xb4bac2, 0.3, 0.7);
  const W = 0.9, D = 0.42, H = 1.75;
  b.box(0.03, H, W, inner, 0.195, H / 2 + 0.05, 0); for (const s of [-1, 1]) b.box(D, H, 0.025, wh, 0, H / 2 + 0.05, s * (W / 2 - 0.0125));
  b.box(D, 0.03, W, wh, 0, H + 0.035, 0); b.box(D, 0.05, W, M(0x3b4048, 0.5, 0.3), 0, 0.075, 0);
  for (const y of [0.5, 0.95, 1.4]) b.box(D - 0.04, 0.02, W - 0.06, inner, 0, y, 0);
  [[0.5, 0xe8832a], [0.5, 0x2f6fd0], [0.5, 0xeef1f4], [0.95, 0x2f9d58], [0.95, 0xe8832a], [0.95, 0xc0392b], [1.4, 0x2f6fd0], [1.4, 0xeef1f4]].forEach(([y, c], i) => {
    const z = -0.32 + (i % 4) * 0.11 + (i > 3 ? 0.02 : 0); b.cyl(0.026, 0.11, M(0xf5f1e8, 0.4, 0), 0, (y as number) + 0.065, z, 0, 0, 0, g, 14); b.cyl(0.027, 0.03, M(c as number, 0.5, 0.1), 0, (y as number) + 0.13, z, 0, 0, 0, g, 14);
  });
  b.box(0.12, 0.2, 0.22, M(0xb8d430, 0.5, 0.1), 0, 1.07 + 0.0, 0.25, 0.02); b.box(0.01, 0.07, 0.1, M(0x1c2a1a, 0.3, 0.3), -0.062, 1.1, 0.25, 0.004);    // AED
  b.box(0.16, 0.16, 0.3, red, 0, 0.58, 0.18, 0.03); b.cyl(0.06, 0.36, M(0x2f9d58, 0.4, 0.4), 0, 1.6, -0.25);                            // trauma bag, oxygen bottle
  for (const s of [-1, 1]) {
    const pv = pivotAt(g, -D / 2, 0.1, s * (W / 2 + 0.003)); b.box(0.022, 1.64, 0.44, wh, 0, 0.82 + 0.05, -s * 0.22, 0.008, pv);
    b.cyl(0.01, 0.3, steel, -0.025, 0.9, -s * 0.4, 0, 0, 0, pv, 10);
    if (s > 0) { b.box(0.006, 0.28, 0.07, red, -0.014, 1.15, -s * 0.22, 0.002, pv); b.box(0.006, 0.07, 0.28, red, -0.014, 1.15, -s * 0.22, 0.002, pv); }
    doors.push({ pivot: pv, axis: 'y', open: s < 0 ? -1.7 : 1.7 });
  }
  return { g, doors };
}

/** Wall first-aid kit with a drop-down lid. Origin at the box centre. */
export function firstAidKit() {
  const g = new THREE.Group(), b = new B(g), wh = M(0xf4f5f6, 0.45, 0.02), red = M(0xc0392b, 0.5, 0.05), inner = M(0xe2e5e8, 0.7, 0.02);
  b.box(0.02, 0.3, 0.42, inner, 0.05, 0, 0, 0.005); for (const s of [-1, 1]) b.box(0.12, 0.3, 0.015, wh, 0, 0, s * 0.2025, 0.004);
  b.box(0.12, 0.015, 0.42, wh, 0, 0.1425, 0, 0.004); b.box(0.12, 0.015, 0.42, wh, 0, -0.1425, 0, 0.004);
  for (let i = 0; i < 4; i++) b.cyl(0.02, 0.07, M(0xf1efe6, 0.6, 0), 0.0, 0.06, -0.15 + i * 0.045, P / 2, 0, 0, g, 12);
  b.box(0.05, 0.06, 0.1, red, -0.0, -0.03, -0.12, 0.01); b.box(0.05, 0.06, 0.1, M(0x2f6fd0, 0.6, 0.0), 0.0, -0.03, 0.0, 0.01); b.cyl(0.018, 0.1, M(0x2f9d58, 0.4, 0.2), 0.0, -0.08, 0.14);
  b.box(0.03, 0.01, 0.12, M(0xb4bac2, 0.3, 0.7), -0.02, 0.1, 0.12, 0.003);
  const pv = pivotAt(g, -0.065, -0.15, 0); b.box(0.02, 0.3, 0.42, wh, 0, 0.15, 0, 0.006, pv); b.box(0.006, 0.07, 0.015, red, -0.012, 0.15, 0, 0.002, pv); b.box(0.006, 0.015, 0.07, red, -0.012, 0.15, 0, 0.002, pv);
  return { g, lid: { pivot: pv, axis: 'z', open: 1.55 } as Hinge };
}

/**
 * Closed hygiene compartment: 1.7 m x 1.7 m, door in the front wall, waste collector, shower stall, basin and mirror, own light.
 * x runs from -1.2 (door wall) to +0.5 (hab wall).
 */
export function washroom() {
  const g = new THREE.Group(), b = new B(g);
  const pan = M(0xe9edf0, 0.5, 0.03), floor = M(0x8e97a1, 0.75, 0.05), steel = M(0xc4cad2, 0.25, 0.8), dark = M(0x2a2f36, 0.5, 0.3), wh = M(0xf6f7f8, 0.35, 0.02);
  const X0 = -1.2, X1 = 0.5, W = 1.7, Hh = 2.2, DW = 0.38;
  b.box(X1 - X0, 0.03, W, floor, (X0 + X1) / 2, 0.015, 0, 0.006);
  b.box(0.03, Hh, W, pan, X1 - 0.015, Hh / 2, 0, 0.008);                                              // back (tiled) panel against the hab wall
  for (const s of [-1, 1]) b.box(X1 - X0, Hh, 0.06, pan, (X0 + X1) / 2, Hh / 2, s * (W / 2 - 0.03), 0.01);
  for (const s of [-1, 1]) b.box(0.06, Hh, W / 2 - DW, pan, X0 + 0.03, Hh / 2, s * ((W / 2 + DW) / 2), 0.01);
  b.box(0.06, Hh - 2.0, DW * 2, pan, X0 + 0.03, 2.0 + (Hh - 2.0) / 2, 0, 0.01);
  b.box(X1 - X0, 0.06, W, pan, (X0 + X1) / 2, Hh - 0.03, 0, 0.01);
  const pv = pivotAt(g, X0, 0, -DW + 0.01), leaf = b.box(0.04, 1.97, 2 * DW - 0.02, pan, 0, 0.04 + 0.985, DW - 0.01, 0.01, pv);
  b.box(0.05, 0.42, 0.3, glassM(0.5, 0xe8f0f6), 0, 1.5, DW - 0.01, 0.01, pv); b.cyl(0.011, 0.3, steel, -0.04, 1.0, 2 * DW - 0.1, 0, 0, 0, pv, 10);
  void leaf;
  const occ = new THREE.MeshStandardMaterial({ color: 0x2f9d58, emissive: 0x2f9d58, emissiveIntensity: 1.1 }); b.box(0.02, 0.05, 0.14, occ, X0 - 0.015, 2.1, 0, 0.008);
  b.box(0.5, 0.02, 0.32, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf4f7ff, emissiveIntensity: 0.8 }), -0.45, Hh - 0.07, 0.0, 0.006); b.box(0.22, 0.01, 0.16, dark, 0.2, Hh - 0.065, 0.55, 0.003);
  // waste collector (suction toilet with seat, handrails and foot restraints), back right
  b.cyl(0.17, 0.3, steel, 0.12, 0.17, 0.52, 0, 0, 0, g, 24); b.m(new THREE.TorusGeometry(0.15, 0.04, 12, 28).rotateX(P / 2), wh, 0.12, 0.44, 0.52); b.m(new THREE.CylinderGeometry(0.15, 0.12, 0.1, 24), M(0xd9dde2, 0.4, 0.05), 0.12, 0.38, 0.52);
  b.box(0.1, 0.34, 0.26, wh, 0.38, 0.3, 0.52, 0.03); for (const dz of [-0.26, 0.26]) b.cyl(0.012, 0.55, steel, -0.05, 0.75, 0.52 + dz, 0, 0, 0, g, 10);
  for (const x of [-0.3, -0.45]) b.m(new THREE.TorusGeometry(0.05, 0.01, 8, 16).rotateX(P / 2), dark, x, 0.04, 0.5);
  // shower stall, back left: pan, drain, curved curtain, rail, head and hand shower
  b.cyl(0.4, 0.03, M(0xaab2bb, 0.5, 0.1), 0.05, 0.045, -0.45, 0, 0, 0, g, 28); b.cyl(0.05, 0.012, dark, 0.05, 0.062, -0.45, 0, 0, 0, g, 16);
  const cur = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.43, 1.95, 28, 1, true, -P / 2 + 0.95, 2 * P - 1.9), glassM(0.3, 0xe9f1f7)); cur.position.set(0.05, 1.03, -0.45); g.add(cur);
  b.cyl(0.011, 1.8, steel, 0.42, 1.0, -0.45, 0, 0, 0, g, 10); b.cyl(0.09, 0.018, steel, 0.3, 2.0, -0.45, 0, 0, P / 2 - 0.35); b.cyl(0.011, 0.22, steel, 0.36, 2.0, -0.45, 0, 0, P / 2);
  b.cyl(0.02, 0.16, steel, 0.4, 1.35, -0.38, 0, 0, 0, g, 12); b.box(0.12, 0.02, 0.08, wh, 0.43, 1.1, -0.2, 0.006);
  // basin, tap and mirror on the right wall; towel
  b.box(0.42, 0.1, 0.36, wh, -0.72, 0.92, 0.64, 0.04); b.box(0.36, 0.05, 0.3, M(0xcfd4d9, 0.2, 0.1), -0.72, 0.95, 0.64, 0.03); b.cyl(0.01, 0.12, steel, -0.72, 1.02, 0.78); b.cyl(0.009, 0.1, steel, -0.68, 1.075, 0.78, 0, 0, P / 2);
  b.box(0.012, 0.5, 0.42, new THREE.MeshStandardMaterial({ color: 0xd5dde3, roughness: 0.06, metalness: 0.25 }), -0.72, 1.55, 0.815, 0.004).rotation.y = P / 2;
  b.cyl(0.01, 0.4, steel, -0.7, 1.2, -0.78, P / 2, 0, 0, g, 8); b.box(0.02, 0.5, 0.36, M(0x4a5b73, 0.95, 0), -0.7, 0.93, -0.78, 0.008);
  return { g, door: { pivot: pv, axis: 'y', open: -1.7 } as Hinge, occ, size: { X0, X1, W, DW } };
}
