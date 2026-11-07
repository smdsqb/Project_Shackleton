import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Sim } from './sim';
import { NASA, panelTexture, tileTexture, crinkleTexture, meatball, worm, plateTexture, flagTexture } from './livery';

// The Hab: a rigid, painted-aluminium surface habitat (drum + dome, ~155 m2 of floor) with a thermal-blanket skirt,
// two airlocks with interlocked hatches, lab racks, oxygenator, atmospheric regulator and water reclaimer, and
// quarters for a crew of five. Footprint and fittings follow the original layout; airlock timings and costs are
// design placeholders. Every edge is radiused, every surface carries NASA livery.
const K = 1.3; // footprint scale over the original 5.41 m drum: about 92 m2 of floor becomes about 155 m2
export const HAB_R = 5.41 * K, WALL_H = 2.2, CAP_H = 1.4 * K;
const DR = HAB_R - 5.41, GZ = 1.9 * K; // DR: how far the wall-mounted fittings move outwards
const TL = 2.2, R_IN = 4.4 + DR, PR = 0.3, LOCK_P = 101.3, EVA_H = 8, CYCLE_S = 14;
const DON_S = 30, DOFF_S = 14; // seconds to get into / out of the suit
const DON_STAGES = ['TAKING SUIT OFF THE RACK', 'LCVG AND COMMS CAP ON', 'HARD UPPER TORSO AND BOOTS', 'GLOVES AND HELMET RING LATCHED', 'O2 AND WATER UMBILICAL CONNECTED', 'LEAK CHECK AT 4.3 PSI', 'PURGING SUIT WITH PURE O2'];
const DOFF_STAGES = ['VENTING SUIT', 'HELMET AND GLOVES OFF', 'RACKING SUIT, RECHARGING O2'];
// portholes: angle psi around the drum (x = cos, z = sin) and height; each is a real hole in the wall
const WINDOWS = [{ psi: -0.3 * Math.PI, y: 1.65 }, { psi: -0.9 * Math.PI, y: 1.7 }, { psi: 1.22, y: 1.5 }, { psi: 1.92, y: 1.5 }];
const WIN_R = 0.29;
type Door = { open: boolean; k: number; pivot: THREE.Group; lamp: THREE.MeshBasicMaterial; dir: number };
type Lock = { name: string; ang: number; ca: number; sa: number; p: number; cyc: number | null; inner: Door; outer: Door };
type Item = { x: number; z: number; reach: number; text: () => string; run: () => string };

const mat = (c: number, glow = false, rough = 0.55, metal = 0.1) =>
  new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal, ...(glow ? { emissive: c, emissiveIntensity: 1.2 } : {}) });
const rbox = (w: number, h: number, d: number, r = 0.04) => new RoundedBoxGeometry(w, h, d, 3, Math.max(0.002, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)));
function label(text: string, w = 0.55) {
  return new THREE.Mesh(new THREE.PlaneGeometry(w, (w * 96) / 512), new THREE.MeshBasicMaterial({ map: plateTexture(text) }));
}
/** Alpha mask for one wall arc: opaque everywhere except where a porthole is cut through. */
function windowAlpha(start: number, arc: number) {
  const c = document.createElement('canvas'); c.width = 2048; c.height = 512;
  const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, 2048, 512); g.fillStyle = '#000';
  for (const w of WINDOWS) {
    const th = ((((Math.PI / 2 - w.psi) - start) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    if (th > arc) continue;
    g.beginPath(); g.ellipse((th / arc) * 2048, (1 - w.y / WALL_H) * 512, (WIN_R / (arc * HAB_R)) * 2048, (WIN_R / WALL_H) * 512, 0, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; return t;
}
/** Soft contact shadow on the floor under furniture and racks: cheap ambient occlusion. */
let aoTex: THREE.CanvasTexture | null = null;
function aoBlob(w: number, d: number) {
  if (!aoTex) {
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(64, 64, 8, 64, 64, 64); gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128); aoTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: aoTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  m.renderOrder = 1; return m;
}

export class Hab {
  prompt = ''; toast = ''; suitHours = EVA_H; exposed = false; where = 'HAB';
  suitState: 'rack' | 'donning' | 'on' | 'doffing' = 'rack';
  taskLabel = ''; taskProgress = 0; onComms: (() => void) | null = null;
  get suitOn() { return this.suitState === 'on'; }
  get busy() { return this.suitState === 'donning' || this.suitState === 'doffing'; }
  private suitT = 0; private suitStage = -1; private suitMeshes: THREE.Group[] = []; private suitTaken: THREE.Group | null = null;
  private lights: { l: THREE.PointLight; base: number; color: number }[] = []; private glows: { m: THREE.MeshStandardMaterial; base: number }[] = []; private clock = 0; private powerK = 1;
  private locks: Lock[] = []; private circles: { x: number; z: number; r: number }[] = [];
  private items: Item[] = []; private best: Item | null = null; private toastT = 0;
  private root = new THREE.Group();

  constructor(scene: THREE.Scene, y0: number) {
    this.root.position.y = y0; scene.add(this.root);
    const R = HAB_R, P = Math.PI;
    const mesh = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = this.root, shadow = false) => {
      const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = shadow; o.receiveShadow = true; parent.add(o); return o;
    };

    // ---- shell: painted panels outside, soft lining inside, gold MLI skirt, blue interior band ----
    const gap = Math.asin(0.8 / R), arc = P - 2 * gap, starts = [P / 2 + gap, (3 * P) / 2 + gap];
    const shellM = new THREE.MeshStandardMaterial({ map: panelTexture('#f2f4f6', '#a9b1ba', 13, 2), roughness: 0.42, metalness: 0.2 });
    const liningM = new THREE.MeshStandardMaterial({ map: panelTexture('#e9edf0', '#c5cbd2', 13, 2), roughness: 0.75, metalness: 0.03, side: THREE.BackSide });
    const domeM = new THREE.MeshStandardMaterial({ map: panelTexture('#f2f4f6', '#a9b1ba', 28, 3), roughness: 0.42, metalness: 0.2 });
    const ceilM = new THREE.MeshStandardMaterial({ map: panelTexture('#eef1f4', '#cdd3da', 28, 3), roughness: 0.8, metalness: 0.02, side: THREE.BackSide });
    const gold = new THREE.MeshStandardMaterial({ color: NASA.gold, roughness: 0.32, metalness: 0.85, bumpMap: crinkleTexture(16, 1), bumpScale: 2 });
    const bandM = new THREE.MeshStandardMaterial({ color: NASA.blue, roughness: 0.6, side: THREE.BackSide });
    const kickM = new THREE.MeshStandardMaterial({ color: NASA.graphite, roughness: 0.7, side: THREE.BackSide });
    const trimM = mat(0xc9ced6, false, 0.35, 0.45);
    for (const s of starts) {
      const alpha = windowAlpha(s, arc), shellW = shellM.clone(), liningW = liningM.clone();
      shellW.alphaMap = liningW.alphaMap = alpha; shellW.alphaTest = liningW.alphaTest = 0.5;
      mesh(new THREE.CylinderGeometry(R, R, WALL_H, 72, 1, true, s, arc), shellW, 0, WALL_H / 2, 0, this.root, true);
      mesh(new THREE.CylinderGeometry(R - 0.06, R - 0.06, WALL_H, 72, 1, true, s, arc), liningW, 0, WALL_H / 2, 0);
      mesh(new THREE.CylinderGeometry(R + 0.14, R + 0.14, 0.55, 72, 1, true, s, arc), gold, 0, 0.275, 0, this.root, true);
      mesh(new THREE.CylinderGeometry(R - 0.07, R - 0.07, 0.14, 72, 1, true, s, arc), bandM, 0, 1.0, 0);
      mesh(new THREE.CylinderGeometry(R - 0.07, R - 0.07, 0.28, 72, 1, true, s, arc), kickM, 0, 0.14, 0);
      const ring = mesh(new THREE.TorusGeometry(R + 0.02, 0.1, 12, 72, arc).rotateX(-P / 2), trimM, 0, WALL_H, 0, this.root, true); ring.rotation.y = s - P / 2;
      const foot = mesh(new THREE.TorusGeometry(R + 0.16, 0.06, 10, 72, arc).rotateX(-P / 2), trimM, 0, 0.56, 0); foot.rotation.y = s - P / 2;
    }
    const cap = mesh(new THREE.SphereGeometry(R, 72, 28, 0, P * 2, 0, P / 2), domeM, 0, WALL_H, 0, this.root, true); cap.scale.y = CAP_H / R;
    const capIn = mesh(new THREE.SphereGeometry(R - 0.06, 72, 28, 0, P * 2, 0, P / 2), ceilM, 0, WALL_H, 0); capIn.scale.y = (CAP_H - 0.04) / (R - 0.06);
    const rib = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.6 });
    for (let i = 0; i < 8; i++) { const t = mesh(new THREE.TorusGeometry(R - 0.07, 0.05, 10, 48, P), rib, 0, WALL_H, 0); t.scale.y = CAP_H / R; t.rotation.y = (i * P) / 8; }

    // floor (tiled composite decking) and the soft ceiling light ring
    mesh(new THREE.CircleGeometry(R - 0.06, 64).rotateX(-P / 2), new THREE.MeshStandardMaterial({ map: tileTexture('#a3a9b2', '#7d848e', 12), roughness: 0.8 }), 0, 0.03, 0);
    const glowM = (c: number, k = 1.1) => { const m = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: k, roughness: 0.4 }); this.glows.push({ m, base: k }); return m; };
    mesh(new THREE.TorusGeometry(3 * K, 0.05, 12, 64).rotateX(P / 2), glowM(0xe6eeff, 0.9), 0, 3.5, 0);
    mesh(new THREE.TorusGeometry(1.2 * K, 0.04, 12, 48).rotateX(P / 2), glowM(0xffe2bd, 0.6), 0, 3.75, 0);
    // lighting plan: cool general light, cooler task light over the lab, warm light at the galley and bunks, a cyan wash at the comms desk
    const lamp = (c: number, i: number, dist: number, x: number, y: number, z: number) => { const l = new THREE.PointLight(c, i, dist, 2); l.position.set(x, y, z); this.root.add(l); this.lights.push({ l, base: i, color: c }); };
    lamp(0xe4ecff, 22, 15, 0, 3.4, 0);
    for (const x of [-2, 0, 2]) lamp(0xd2e4ff, 8, 6, x * K, 2.5, -1.6 * K);
    lamp(0xffd6a6, 11, 7, 0, 2.5, GZ);
    lamp(0xffcf9a, 6, 6, 0, 2.3, 3.6 * K);
    lamp(0x9fe4ff, 5, 5.5, -3.5 * K, 2.0, -1.2 * K);
    lamp(0xffe9d6, 5, 6, 2.4 * K, 2.2, -3.2 * K);

    // ---- portholes, decals, livery ----
    const trim2 = mat(0xb9bfc8, false, 0.3, 0.6), sleeveM = new THREE.MeshStandardMaterial({ color: 0xb9bfc8, roughness: 0.4, metalness: 0.5, side: THREE.DoubleSide });
    const paneM = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.07, depthWrite: false });
    const porthole = (psi: number, y: number) => {
      const at = (r: number) => { const g = new THREE.Group(); g.position.set(r * Math.cos(psi), y, r * Math.sin(psi)); g.rotation.y = -psi; this.root.add(g); return g; };
      for (const r of [R + 0.02, R - 0.085]) at(r).add(new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.045, 12, 40).rotateY(P / 2), trim2));
      const mid = at(R - 0.03);
      mid.add(new THREE.Mesh(new THREE.CylinderGeometry(WIN_R + 0.005, WIN_R + 0.005, 0.16, 32, 1, true).rotateZ(P / 2), sleeveM));
      mid.add(new THREE.Mesh(new THREE.CircleGeometry(WIN_R, 32).rotateY(P / 2), paneM));
    };
    for (const w of WINDOWS) porthole(w.psi, w.y);
    const decal = (psi: number, w: number, h: number, y: number, map: THREE.Texture, r: number, inside = false) => {
      const g = new THREE.CylinderGeometry(r, r, h, 28, 1, true, P / 2 - psi - w / (2 * r), w / r);
      if (inside) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i)); }
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map, transparent: true, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false, side: inside ? THREE.BackSide : THREE.FrontSide }));
      m.position.y = y; this.root.add(m);
    };
    const ball = meatball(), wm = worm();
    decal(P / 2, 1.3, 1.3, 1.4, ball, R + 0.012); decal(-P / 2, 1.3, 1.3, 1.4, ball, R + 0.012);
    decal(P / 2 + 0.9, 2.0, 0.68, 1.4, wm, R + 0.012); decal(-P / 2 - 0.9, 2.0, 0.68, 1.4, wm, R + 0.012);
    decal(0.67, 1.8, 0.34, 0.95, plateTexture('HAB-1  SHACKLETON OUTPOST'), R + 0.012);
    decal(-0.67, 0.95, 0.5, 1.65, flagTexture(), R + 0.012);
    decal(-0.9 * P, 0.5, 0.5, 1.93, ball, R - 0.075, true);

    // ---- wall-mounted fittings, set around the inside of the drum by angle ----
    const fit = (th: number, o: { w: number; h: number; d?: number; y?: number; color: number; text?: string; glow?: boolean; r?: number; accent?: number | null; badge?: boolean }) => {
      const g = new THREE.Group(), r = (o.r ?? 4.9) + DR, d = o.d ?? 0.8, y0f = o.y ?? 0;
      g.position.set(r * Math.cos(th), 0, r * Math.sin(th)); g.rotation.y = -th; this.root.add(g);
      mesh(rbox(d, o.h, o.w, 0.07), mat(o.color, o.glow), 0, y0f + o.h / 2, 0, g);
      if (o.accent !== null && o.h >= 0.9) mesh(rbox(d + 0.012, 0.07, o.w + 0.012, 0.03), mat(o.accent ?? NASA.blue), 0, y0f + o.h * 0.72, 0, g);
      if (o.badge) { const b = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), new THREE.MeshBasicMaterial({ map: ball, transparent: true })); b.position.set(-d / 2 - 0.012, y0f + o.h * 0.4, 0); b.rotation.y = -P / 2; g.add(b); }
      if (o.text) { const l = label(o.text); l.position.set(-d / 2 - 0.014, y0f + (o.h >= 1.2 ? o.h - 0.12 : o.h * 0.5), 0); l.rotation.y = -P / 2; g.add(l); }
      // contact shadow on the floor in front of and under the unit
      if (y0f < 0.4 && (o.r ?? 4.9) > 4.5) { const ao = aoBlob(d + 0.6, o.w + 0.7); ao.position.set(-0.35, 0.035, 0); g.add(ao); }
      return g;
    };
    const rack = 0xe9edf1;
    fit(-0.48 * P, { w: 1.1, h: 1.9, color: rack, text: 'OXYGENATOR', badge: true }); fit(-0.62 * P, { w: 1.1, h: 1.9, color: rack, text: 'ATMOS. REGULATOR', badge: true });
    fit(-0.76 * P, { w: 1.1, h: 1.9, color: rack, text: 'WATER RECLAIMER', badge: true }); const ops = fit(-0.9 * P, { w: 2.0, h: 0.9, color: NASA.graphite, text: 'COMMS / OPS', accent: NASA.red });
    const scr = (lines: string[]) => { const c = document.createElement('canvas'); c.width = 256; c.height = 160; const g = c.getContext('2d')!; g.fillStyle = '#04141c'; g.fillRect(0, 0, 256, 160); g.fillStyle = '#4fd8ff'; g.font = '13px monospace'; lines.forEach((t, i) => g.fillText(t, 8, 22 + i * 17)); g.strokeStyle = 'rgba(79,216,255,.5)'; g.strokeRect(2, 2, 252, 156); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
    for (const [z, lines] of [[-0.62, ['EARTH LINK  X-BAND', 'DSN  GOLDSTONE', 'LIGHT TIME  1.28 S', 'TLM  NOMINAL']], [0, ['CAPCOM LOOP', 'FLIGHT  GO', 'SURGEON  GO', 'METOP  GO']], [0.62, ['SPACE WX', 'KP  --', 'FLARE  --', 'DOSE  --']]] as const) {
      const sc = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.31), new THREE.MeshBasicMaterial({ map: scr([...lines]) })); sc.position.set(-0.05, 1.1, z); sc.rotation.set(0, -P / 2, 0); sc.rotation.x = 0; ops.add(sc);
      const bezel = mesh(rbox(0.04, 0.35, 0.54, 0.015), mat(0x20262e), 0.0, 1.1, z, ops); bezel.position.x = 0.0;
    }
    mesh(rbox(0.3, 0.025, 0.55, 0.01), mat(0x2a3038), -0.22, 0.915, 0, ops);
    mesh(new THREE.TorusGeometry(0.11, 0.015, 8, 20, P), mat(0x20262e), -0.25, 0.98, 0.8, ops);
    fit(-0.3 * P, { w: 2.0, h: 0.95, color: 0xdfe3e8, text: 'GALLEY' }); fit(0.9 * P, { w: 1.4, h: 1.4, color: 0xf6f7f9, text: 'MEDICAL', accent: NASA.red });
    for (const th of [0.28 * P, 0.5 * P, 0.72 * P]) {
      fit(th, { w: 2.0, h: 0.5, y: 0.25, d: 0.95, color: 0xc4ceda, accent: null }); fit(th, { w: 2.0, h: 0.5, y: 1.3, d: 0.95, color: 0xc4ceda, accent: null });
      fit(th, { w: 2.0, h: 1.9, d: 0.04, r: 4.35, color: 0x2c5aa0, accent: null, text: th === 0.5 * P ? 'CREW QUARTERS' : undefined });
    }
    // suit rack (five suits) beside Airlock 1
    const rackTh = -0.13 * P, rg = fit(rackTh, { w: 2.3, h: 2.0, d: 0.15, r: 5.2, color: 0x59626d, text: 'EVA SUITS', accent: NASA.red });
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Group(); s.position.set(-0.3, 0, (i - 2) * 0.44); rg.add(s); this.suitMeshes.push(s);
      mesh(new THREE.CapsuleGeometry(0.17, 0.8, 8, 16), mat(0xf6f6f6), 0, 1.0, 0, s); mesh(new THREE.SphereGeometry(0.16, 20, 16), mat(0xe6edf5), 0, 1.65, 0, s);
      const v = mesh(new THREE.SphereGeometry(0.12, 16, 12), mat(0x1a2330, false, 0.1, 0.7), -0.09, 1.66, 0, s); v.scale.set(0.6, 0.85, 1);
      mesh(rbox(0.05, 0.12, 0.22, 0.02), mat(NASA.red), -0.16, 1.2, 0, s);
    }
    // centre of the floor: three lab tables and the galley table with five stools
    for (const x0 of [-2, 0, 2]) {
      const x = x0 * K, zt = -1.6 * K;
      mesh(rbox(1.6, 0.06, 0.8, 0.03), mat(0xeef1f4, false, 0.35), x, 0.9, zt); mesh(rbox(0.2, 0.87, 0.6, 0.05), mat(0x7a838f), x, 0.45, zt);
      const m = mesh(rbox(0.45, 0.3, 0.04, 0.02), mat(0x6fd3ff, true), x, 1.1, zt - 0.2); m.rotation.x = -0.25;
      this.circles.push({ x, z: zt, r: 0.75 });
    }
    mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.05, 48), mat(0xeef1f4, false, 0.35), 0, 0.75, GZ);
    mesh(new THREE.TorusGeometry(0.85, 0.025, 10, 48).rotateX(P / 2), mat(NASA.blue), 0, 0.75, GZ);
    mesh(new THREE.CylinderGeometry(0.1, 0.2, 0.72, 16), mat(0x7a838f), 0, 0.38, GZ);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * 2 * P, sx = 1.15 * Math.cos(a), sz = GZ + 1.15 * Math.sin(a);
      mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.36, 10), mat(0x7a838f), sx, 0.2, sz);
      const seat = mesh(new THREE.SphereGeometry(0.24, 20, 14), mat(0x2c5aa0, false, 0.85), sx, 0.45, sz); seat.scale.y = 0.4;
    }
    this.circles.push({ x: 0, z: GZ, r: 1.25 });

    // airlocks: curved-roof, sealed tunnels with an inner and an outer hatch
    this.locks = [this.makeLock('AIRLOCK 1', 0), this.makeLock('AIRLOCK 2', Math.PI)];
    const w = (l: Lock, u: number, v: number) => [u * l.ca - v * l.sa, u * l.sa + v * l.ca];
    for (const l of this.locks) {
      const hatch = (door: Door, u: number, nm: string, ok: () => string): Item => {
        const [x, z] = w(l, u, 0);
        return { x, z, reach: 1.6, text: () => `[E] ${door.open ? 'CLOSE' : 'OPEN'} ${nm} HATCH`, run: () => { if (door.open) { door.open = false; return `${nm} HATCH SEALED`; } const e = ok(); if (e) return e; door.open = true; return `${nm} HATCH OPEN`; } };
      };
      this.items.push(
        hatch(l.inner, HAB_R, 'INNER', () => (l.outer.open ? 'CLOSE OUTER HATCH FIRST' : l.cyc !== null ? 'AIRLOCK IS CYCLING' : l.p < 99 ? 'PRESSURISE THE AIRLOCK FIRST' : '')),
        hatch(l.outer, HAB_R + TL, 'OUTER', () => (l.inner.open ? 'CLOSE INNER HATCH FIRST' : l.cyc !== null ? 'AIRLOCK IS CYCLING' : !this.suitOn ? 'EVA SUIT NOT SEALED' : l.p > 1 ? 'DEPRESSURISE THE AIRLOCK FIRST' : '')),
        { ...(([x, z]) => ({ x, z }))(w(l, HAB_R + TL / 2, 0.75)), reach: 1.3,
          text: () => (l.cyc !== null ? `${l.name} CYCLING  ${l.p.toFixed(0)} kPa` : `[E] ${l.p > 50 ? 'DEPRESSURISE' : 'REPRESSURISE'} ${l.name}`),
          run: () => {
            if (l.cyc !== null) return 'CYCLE IN PROGRESS';
            if (l.inner.open || l.outer.open) return 'CLOSE BOTH HATCHES BEFORE CYCLING';
            if (l.p > 50 && !this.suitOn) return 'REFUSED: EVA SUIT NOT SEALED';
            l.cyc = l.p > 50 ? 0 : LOCK_P; return l.cyc === 0 ? 'PUMPING AIR BACK TO THE HAB' : 'REPRESSURISING FROM HAB SUPPLY';
          } });
    }
    this.items.push({ x: (4.0 + DR) * Math.cos(-0.9 * P), z: (4.0 + DR) * Math.sin(-0.9 * P), reach: 1.7, text: () => '[E] OPEN COMMS TERMINAL', run: () => { this.onComms?.(); return ''; } });
    const rx = (5.0 + DR) * Math.cos(rackTh), rz = (5.0 + DR) * Math.sin(rackTh);
    this.items.push({ x: rx * 0.85, z: rz * 0.85, reach: 1.9,
      text: () => (this.busy ? '' : this.suitOn ? '[E] DOFF EVA SUIT AND RECHARGE' : '[E] DON EVA SUIT (TAKES ABOUT 30 S)'),
      run: () => {
        if (this.busy) return 'SUIT-UP IN PROGRESS';
        if (this.exposed) return 'RETURN TO THE HAB FIRST';
        this.suitT = 0; this.suitStage = -1;
        if (!this.suitOn) { this.suitTaken = this.suitMeshes.find((m) => m.visible) ?? null; this.suitState = 'donning'; return ''; }
        this.suitState = 'doffing'; return '';
      } });
  }

  private makeLock(name: string, ang: number): Lock {
    const g = new THREE.Group(); g.rotation.y = -ang; this.root.add(g);
    const R = HAB_R, P = Math.PI, hull = new THREE.MeshStandardMaterial({ map: panelTexture('#f0f2f5', '#a9b1ba', 2, 1), roughness: 0.45, metalness: 0.2, side: THREE.DoubleSide });
    const frameM = mat(NASA.grey, false, 0.45, 0.4), doorM = mat(0xe6e9ed, false, 0.4, 0.3);
    const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, m: THREE.Material, p: THREE.Object3D = g, r = 0.04) => {
      const o = new THREE.Mesh(rbox(sx, sy, sz, r), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; p.add(o); return o;
    };
    box(TL, WALL_H, 0.1, R + TL / 2, WALL_H / 2, -0.85, hull); box(TL, WALL_H, 0.1, R + TL / 2, WALL_H / 2, 0.85, hull);
    // curved roof: a flattened half-cylinder along the tunnel, ribbed
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, TL, 32, 1, true, 0, P).rotateZ(P / 2), hull);
    roof.position.set(R + TL / 2, WALL_H, 0); roof.scale.y = 0.38; roof.castShadow = roof.receiveShadow = true; g.add(roof);
    for (const u of [-0.6, 0, 0.6]) { const rb = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.035, 8, 24, P).rotateY(P / 2), frameM); rb.position.set(R + TL / 2 + u, WALL_H, 0); rb.scale.y = 0.38; g.add(rb); }
    box(TL, 0.04, 1.7, R + TL / 2, 0.04, 0, mat(0x6d737b), g, 0.015);
    const pl = new THREE.PointLight(0xfff6ec, 6, 6, 2); pl.position.set(R + TL / 2, 2, 0); g.add(pl);
    const lampStrip = new THREE.Mesh(rbox(0.9, 0.05, 0.14, 0.02), mat(0xf4f7ff, true)); lampStrip.position.set(R + TL / 2, WALL_H + 0.3, 0); g.add(lampStrip);
    box(0.06, 0.5, 0.4, R + TL / 2, 1.3, 0.78, mat(0x6fd3ff, true), g, 0.02);
    const mkDoor = (u: number, dir: number): Door => {
      box(0.16, WALL_H, 0.1, u, WALL_H / 2, -0.75, frameM, g, 0.05); box(0.16, WALL_H, 0.1, u, WALL_H / 2, 0.75, frameM, g, 0.05); box(0.16, 0.2, 1.6, u, 2.1, 0, frameM, g, 0.06);
      const pivot = new THREE.Group(); pivot.position.set(u, 0, -0.7); g.add(pivot);
      // door leaf with a real round window cut through it, glazed with thin see-through glass
      const sh = new THREE.Shape(), hw = 0.7, hh = 1.0, rr = 0.1;
      sh.moveTo(-hw + rr, -hh); sh.lineTo(hw - rr, -hh); sh.quadraticCurveTo(hw, -hh, hw, -hh + rr); sh.lineTo(hw, hh - rr); sh.quadraticCurveTo(hw, hh, hw - rr, hh);
      sh.lineTo(-hw + rr, hh); sh.quadraticCurveTo(-hw, hh, -hw, hh - rr); sh.lineTo(-hw, -hh + rr); sh.quadraticCurveTo(-hw, -hh, -hw + rr, -hh);
      const hole = new THREE.Path(); hole.absarc(0, 0.6, 0.26, 0, P * 2, true); sh.holes.push(hole);
      const leaf = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.12, bevelEnabled: false, curveSegments: 40 }).translate(0, 0, -0.06).rotateY(-P / 2), doorM);
      leaf.position.set(0, 1.0, 0.7); leaf.castShadow = leaf.receiveShadow = true; pivot.add(leaf);
      const glassM = new THREE.MeshPhysicalMaterial({ color: 0xcfe9ff, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide });
      const glass = new THREE.Mesh(new THREE.CircleGeometry(0.26, 40).rotateY(P / 2), glassM); glass.position.set(0, 1.6, 0.7); pivot.add(glass);
      for (const s of [1, -1]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.035, 10, 40).rotateY(P / 2), frameM); ring.position.set(s * 0.065, 1.6, 0.7); pivot.add(ring); }
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.035, 12, 28), mat(NASA.red)); wheel.position.set(0.09 * dir, 0.95, 0.7); wheel.rotation.y = P / 2; pivot.add(wheel);
      const lampM = new THREE.MeshBasicMaterial({ color: 0xff4d4d }); const lamp = new THREE.Mesh(rbox(0.06, 0.12, 0.12, 0.02), lampM); lamp.position.set(u, 2.3, -0.75); g.add(lamp);
      return { open: false, k: 0, pivot, lamp: lampM, dir };
    };
    const inner = mkDoor(R, 1), outer = mkDoor(R + TL, -1);
    const lbl = label(name, 0.5); lbl.position.set(R + TL / 2, 1.75, 0.795); lbl.rotation.y = Math.PI; g.add(lbl);
    return { name, ang, ca: Math.cos(ang), sa: Math.sin(ang), p: LOCK_P, cyc: null, inner, outer };
  }

  private local(l: Lock, x: number, z: number) { return [x * l.ca + z * l.sa, -x * l.sa + z * l.ca]; }

  blocked(x: number, z: number): boolean {
    const r = Math.hypot(x, z); let lane = false;
    for (const l of this.locks) {
      const [u, v] = this.local(l, x, z), av = Math.abs(v);
      if (u > HAB_R - 0.1 && u < HAB_R + TL && av >= 0.72 && av < 0.95) return true;
      if (av < 0.8) {
        if (!l.inner.open && u > HAB_R - 0.12 && u < HAB_R + 0.12) return true;
        if (!l.outer.open && u > HAB_R + TL - 0.12 && u < HAB_R + TL + 0.12) return true;
      }
      if (u > R_IN - 0.3 && u < HAB_R + 0.25 && av < 0.7) lane = true;
    }
    if (!lane && r > R_IN && r < HAB_R + 0.25) return true;
    return this.circles.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + PR);
  }
  inHab(x: number, z: number) { return Math.hypot(x, z) < HAB_R - 0.2; }

  press() { if (this.best) { this.toast = this.best.run(); this.toastT = 2.8; } }

  update(dt: number, dtSim: number, p: THREE.Vector3, sim: Sim) {
    this.clock += dt;
    // power-aware lighting: slow mains wander, brown-out when the battery is low, red emergency lighting when the bus is dead
    const batt = sim.batteryKwh / 600, live = batt > 0 || sim.genKw >= 12, target = !live ? 0.1 : batt < 0.12 && sim.genKw < 12 ? 0.55 + batt * 3 : 1;
    this.powerK += (target - this.powerK) * Math.min(1, dt * 2.5);
    const wander = 1 + 0.012 * Math.sin(this.clock * 3.1) + 0.008 * Math.sin(this.clock * 7.3 + 1);
    for (const { l, base, color } of this.lights) { l.intensity = base * this.powerK * wander; l.color.setHex(this.powerK < 0.3 ? 0xff3b2a : color); }
    for (const { m, base } of this.glows) m.emissiveIntensity = base * Math.min(1, this.powerK * 1.1);
    this.stepSuit(dt, sim);
    for (const l of this.locks) {
      for (const d of [l.inner, l.outer]) {
        d.k = Math.min(1, Math.max(0, d.k + (d.open ? 1 : -1) * dt * 1.2)); d.pivot.rotation.y = d.dir * d.k * 1.7;
        d.lamp.color.setHex(d.open ? 0xffb000 : 0x4fd8ff);
      }
      if (l.cyc !== null) {
        const s = (LOCK_P / CYCLE_S) * dt; l.p = l.cyc > l.p ? Math.min(l.cyc, l.p + s) : Math.max(l.cyc, l.p - s);
        if (l.p === l.cyc) { if (l.cyc === 0) sim.spend(0.12, 0.6); else sim.spend(0.25, 0.4); l.cyc = null; this.toast = `${l.name} ${l.p === 0 ? 'DEPRESSURISED' : 'PRESSURISED'}`; this.toastT = 2.8; }
      }
    }
    this.where = 'SURFACE'; this.exposed = true;
    if (Math.hypot(p.x, p.z) < HAB_R) { this.where = 'HAB'; this.exposed = false; }
    for (const l of this.locks) {
      const [u, v] = this.local(l, p.x, p.z);
      if (u >= HAB_R - 0.05 && u < HAB_R + TL + 0.15 && Math.abs(v) < 0.9) { this.where = l.name; this.exposed = l.p < 50; }
    }
    if (this.suitOn && this.exposed) this.suitHours = Math.max(0, this.suitHours - dtSim / 3600);
    this.toastT -= dt; if (this.toastT <= 0) this.toast = '';
    let best: Item | null = null, bd = 1e9;
    for (const i of this.items) { const d = Math.hypot(p.x - i.x, p.z - i.z); if (d < i.reach && d < bd) { best = i; bd = d; } }
    this.best = best; this.prompt = best ? best.text() : '';
  }

  private stepSuit(dt: number, sim: Sim) {
    if (!this.busy) { this.taskLabel = ''; this.taskProgress = 0; return; }
    const don = this.suitState === 'donning', total = don ? DON_S : DOFF_S, stages = don ? DON_STAGES : DOFF_STAGES;
    this.suitT += dt; const f = Math.min(1, this.suitT / total), st = Math.min(stages.length - 1, Math.floor(f * stages.length));
    this.taskProgress = f; this.taskLabel = `${don ? 'SUITING UP' : 'SUIT DOFF'} · ${stages[st]}`;
    if (st !== this.suitStage) { this.suitStage = st; if (st === 0 && don && this.suitTaken) this.suitTaken.visible = false; }
    if (f >= 1) {
      if (don) { this.suitState = 'on'; this.suitHours = EVA_H; sim.spend(0.05, 0.05); this.toast = 'EVA SUIT SEALED · 4.3 PSI · O2 ' + EVA_H + ' H'; }
      else { this.suitState = 'rack'; this.suitHours = EVA_H; if (this.suitTaken) this.suitTaken.visible = true; this.suitTaken = null; this.toast = 'EVA SUIT STOWED, CONSUMABLES RECHARGED'; }
      this.toastT = 3.2; this.taskLabel = ''; this.taskProgress = 0;
    }
  }

  status(): [string, string, string][] {
    const rows: [string, string, string][] = [
      ['LOCATION', this.where, this.exposed ? 'bad' : 'ok'],
      ['EVA SUIT', this.suitOn ? `SEALED · ${this.suitHours.toFixed(1)} h O2` : this.suitState === 'donning' ? 'SUITING UP' : this.suitState === 'doffing' ? 'DOFFING' : 'ON RACK', this.suitOn && this.suitHours < 1.5 ? 'bad' : this.busy ? 'warn' : 'ok'],
    ];
    for (const l of this.locks) {
      const st = l.cyc !== null ? (l.cyc === 0 ? 'DEPRESSURISING' : 'REPRESSURISING') : l.inner.open ? 'INNER OPEN' : l.outer.open ? 'OUTER OPEN' : 'SEALED';
      rows.push([l.name, `${l.p.toFixed(0)} kPa · ${st}`, l.cyc !== null || l.outer.open ? 'warn' : 'ok']);
    }
    return rows;
  }
}
