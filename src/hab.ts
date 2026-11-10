import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Sim } from './sim';
import { buildSuit } from './suit';
import { oxygenator, atmosReg, waterReclaimer, co2Scrubber, extinguisher } from './machines';
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
type Door = { open: boolean; vis?: boolean; k: number; pivot: THREE.Group; lamp: THREE.MeshBasicMaterial; dir: number };
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
/** Alpha mask for the whole wall ring: portholes plus two arched doorways (straight jambs, round head). */
function wallAlpha() {
  const W = 4096, H = 1024, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.fillStyle = '#000';
  const X = (psi: number) => (((((Math.PI / 2 - psi) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI)) * W;
  const px = W / (2 * Math.PI * HAB_R), py = H / WALL_H;
  for (const w of WINDOWS) { g.beginPath(); g.ellipse(X(w.psi), (1 - w.y / WALL_H) * H, WIN_R * px, WIN_R * py, 0, 0, Math.PI * 2); g.fill(); }
  for (const psi of [0, Math.PI]) {
    const x = X(psi), hw = 0.7 * px, yb = H - 1.3 * py;
    g.fillRect(x - hw, yb, 2 * hw, 1.3 * py + 2);
    g.beginPath(); g.ellipse(x, yb, hw, 0.7 * py, 0, Math.PI, Math.PI * 2); g.fill();
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
  lockdown = false; alarm = false; lockHeld: boolean[] = [false, false]; private paneM!: THREE.MeshPhysicalMaterial; private shutterK = 0;
  curtains: THREE.Group[] = []; bags: THREE.Object3D[] = [];
  suitState: 'rack' | 'donning' | 'on' | 'doffing' = 'rack';
  taskLabel = ''; taskProgress = 0; onComms: (() => void) | null = null;
  shelter = false; // set while the player is in a pressurised vehicle
  get suitOn() { return this.suitState === 'on'; }
  get busy() { return this.suitState === 'donning' || this.suitState === 'doffing'; }
  private suitT = 0; private suitStage = -1; private suitMeshes: THREE.Group[] = []; private suitTaken: THREE.Group | null = null;
  private lights: { l: THREE.PointLight; base: number; color: number }[] = []; private glows: { m: THREE.MeshStandardMaterial; base: number }[] = []; private clock = 0; private powerK = 1;
  private locks: Lock[] = []; private fans: THREE.Object3D[] = []; private circles: { x: number; z: number; r: number }[] = [];
  private items: Item[] = []; private best: Item | null = null; private toastT = 0;
  private root = new THREE.Group();

  constructor(scene: THREE.Scene, y0: number) {
    this.root.position.y = y0; scene.add(this.root);
    const R = HAB_R, P = Math.PI;
    let shadowOn = false;
    const mesh = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = this.root, shadow?: boolean) => {
      const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = shadow ?? shadowOn; o.receiveShadow = true; parent.add(o); return o;
    };

    // ---- shell: painted panels outside, soft lining inside, gold MLI skirt, blue interior band ----
    const gap = Math.asin(0.8 / R), arc = P - 2 * gap, starts = [P / 2 + gap, (3 * P) / 2 + gap];
    const shellM = new THREE.MeshStandardMaterial({ map: panelTexture('#f2f4f6', '#a9b1ba', 30, 2), roughness: 0.42, metalness: 0.2 });
    const liningM = new THREE.MeshStandardMaterial({ map: panelTexture('#e9edf0', '#c5cbd2', 30, 2), roughness: 0.75, metalness: 0.03, side: THREE.BackSide });
    const domeM = new THREE.MeshStandardMaterial({ map: panelTexture('#f2f4f6', '#a9b1ba', 28, 3), roughness: 0.42, metalness: 0.2 });
    const ceilM = new THREE.MeshStandardMaterial({ map: panelTexture('#eef1f4', '#cdd3da', 28, 3), roughness: 0.8, metalness: 0.02, side: THREE.BackSide });
    const gold = new THREE.MeshStandardMaterial({ color: NASA.gold, roughness: 0.32, metalness: 0.85, bumpMap: crinkleTexture(16, 1), bumpScale: 2 });
    const bandM = new THREE.MeshStandardMaterial({ color: NASA.blue, roughness: 0.6, side: THREE.BackSide });
    const kickM = new THREE.MeshStandardMaterial({ color: NASA.graphite, roughness: 0.7, side: THREE.BackSide });
    const trimM = mat(0xc9ced6, false, 0.35, 0.45);
    const wallA = wallAlpha(), shellW = shellM.clone(), liningW = liningM.clone();
    shellW.alphaMap = liningW.alphaMap = wallA; shellW.alphaTest = liningW.alphaTest = 0.5;
    mesh(new THREE.CylinderGeometry(R, R, WALL_H, 144, 1, true), shellW, 0, WALL_H / 2, 0, this.root, true);
    mesh(new THREE.CylinderGeometry(R - 0.06, R - 0.06, WALL_H, 144, 1, true), liningW, 0, WALL_H / 2, 0);
    for (const s of starts) {
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
    const lamp = (c: number, i: number, dist: number, x: number, y: number, z: number, sh = false) => { const l = new THREE.PointLight(c, i, dist, 2); if (sh) { l.castShadow = true; l.shadow.mapSize.set(1024, 1024); l.shadow.bias = -0.002; l.shadow.normalBias = 0.03; l.shadow.radius = 3; } l.position.set(x, y, z); this.root.add(l); this.lights.push({ l, base: i, color: c }); };
    lamp(0xe4ecff, 22, 15, 0, 3.4, 0, true);
    for (const x of [-2, 0, 2]) lamp(0xd2e4ff, 8, 6, x * K, 2.5, -1.6 * K);
    lamp(0xffd6a6, 11, 7, 0, 2.5, GZ, true);
    lamp(0xffcf9a, 6, 6, 0, 2.3, 3.6 * K);
    lamp(0x9fe4ff, 5, 5.5, -3.5 * K, 2.0, -1.2 * K);
    lamp(0xffe9d6, 5, 6, 2.4 * K, 2.2, -3.2 * K);

    // ---- portholes, decals, livery ----
    const trim2 = mat(0xb9bfc8, false, 0.3, 0.6), sleeveM = new THREE.MeshStandardMaterial({ color: 0xb9bfc8, roughness: 0.4, metalness: 0.5, side: THREE.DoubleSide });
    const paneM = this.paneM = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.07, depthWrite: false });
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

    shadowOn = true;
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
    const machine = (th: number, mg: THREE.Group, text: string) => {
      const g = new THREE.Group(), r = 4.9 + DR; g.position.set(r * Math.cos(th), 0, r * Math.sin(th)); g.rotation.y = -th; this.root.add(g); g.add(mg);
      const l = label(text, 0.8); l.position.set(-0.405, 2.08, 0); l.rotation.y = -P / 2; g.add(l);
      for (const z of [-0.3, 0.3]) mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.14, 6), mat(0x8b929c, false, 0.4, 0.6), -0.4, 2.02, z, g);
      const ao = aoBlob(1.5, 1.7); ao.position.set(-0.3, 0.035, 0); g.add(ao);
    };
    const rack = 0xe9edf1;
    machine(-0.44 * P, oxygenator(this.fans), 'OXYGEN GENERATION');
    machine(-0.54 * P, co2Scrubber(this.fans), 'CO2 REMOVAL');
    machine(-0.65 * P, atmosReg(this.fans), 'ATMOSPHERE CONTROL');
    machine(-0.77 * P, waterReclaimer(this.fans), 'WATER RECOVERY');
    const ops = fit(-0.9 * P, { w: 2.0, h: 0.9, color: NASA.graphite, text: 'COMMS / OPS', accent: NASA.red });
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
      this.curtains.push(fit(th, { w: 2.0, h: 1.9, d: 0.04, r: 4.35, color: 0x2c5aa0, accent: null, text: th === 0.5 * P ? 'CREW QUARTERS' : undefined }));
    }
    // suit rack: five human-shaped EVA suits hanging from a rail, facing the room
    const rackTh = -0.13 * P, rg = fit(rackTh, { w: 2.9, h: 2.05, d: 0.15, r: 5.2, color: 0x59626d, text: 'EVA SUITS', accent: NASA.red });
    mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.8, 10).rotateX(P / 2), mat(0xb4bac2, false, 0.3, 0.7), -0.28, 2.04, 0, rg);
    for (let i = 0; i < 5; i++) {
      const sz = (i - 2) * 0.58, s = buildSuit({ suited: true }); s.position.set(-0.4, 0.04, sz); s.rotation.y = P / 2; s.scale.setScalar(0.97); rg.add(s); this.suitMeshes.push(s);
      mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.12, 6), mat(0xb4bac2, false, 0.3, 0.7), -0.28, 1.98, sz, rg);
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

    // ---- dressing: lab equipment, bedding, galley fittings, stool backs, safety gear, exposed pipe and duct runs ----
    {
      const top = 0.93, zt = -1.6 * K, steel = mat(0xb4bac2, false, 0.3, 0.7), dk = mat(0x262b32, false, 0.5, 0.3), wh = mat(0xeef1f4, false, 0.45, 0.1), r0 = 4.9 + DR;
      const place = (x: number, z: number) => { const g = new THREE.Group(); g.position.set(x, top, z); this.root.add(g); return g; };
      const at = (th: number, r: number) => { const g = new THREE.Group(); g.position.set(r * Math.cos(th), 0, r * Math.sin(th)); g.rotation.y = -th; this.root.add(g); return g; };
      const laptop = (g: THREE.Group, x: number, z: number, ry: number, lines: string[]) => {
        const l = new THREE.Group(); l.position.set(x, 0, z); l.rotation.y = ry; g.add(l);
        mesh(rbox(0.34, 0.02, 0.24, 0.01), dk, 0, 0.01, 0, l, true);
        const lid = mesh(rbox(0.34, 0.22, 0.015, 0.008), dk, 0, 0.12, -0.11, l, true); lid.rotation.x = -0.28;
        const sc = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.18), new THREE.MeshBasicMaterial({ map: scr(lines) })); sc.position.set(0, 0.122, -0.102); sc.rotation.x = -0.28; l.add(sc);
      };
      const t0 = place(-2 * K, zt);   // microscope bench
      mesh(rbox(0.16, 0.03, 0.22, 0.01), dk, 0.35, 0.015, 0, t0, true); mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.3, 10), steel, 0.35, 0.17, -0.07, t0, true);
      mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 14), dk, 0.35, 0.3, -0.03, t0, true).rotation.x = 0.5; mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.07, 8), steel, 0.35, 0.37, 0.02, t0, true).rotation.x = 0.5;
      mesh(rbox(0.12, 0.012, 0.1, 0.004), steel, 0.35, 0.12, 0.03, t0, true); mesh(rbox(0.3, 0.02, 0.2, 0.008), wh, -0.3, 0.01, 0.1, t0, true);
      for (let i = 0; i < 6; i++) mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.06, 10), mat([0x2f6fd0, 0xe8832a, 0x2f9d58][i % 3], false, 0.2, 0), -0.4 + i * 0.045, 0.05, 0.1, t0, true);
      laptop(t0, -0.1, -0.16, 0.2, ['SAMPLE LOG', 'REGOLITH 07', 'RUN 14  OK']);
      const t1 = place(0, zt);        // glove box
      mesh(rbox(0.8, 0.46, 0.5, 0.02), new THREE.MeshPhysicalMaterial({ color: 0xcfe9ff, roughness: 0.03, transparent: true, opacity: 0.12, depthWrite: false }), -0.1, 0.25, 0, t1);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.46, 6), steel, -0.1 + sx * 0.4, 0.25, sz * 0.25, t1, true);
      for (const gx of [-0.28, 0.08]) { mesh(new THREE.TorusGeometry(0.075, 0.015, 8, 20), dk, gx, 0.2, 0.25, t1, true); mesh(new THREE.CapsuleGeometry(0.045, 0.2, 6, 10).rotateX(P / 2), mat(0x3a4048, false, 0.8, 0), gx, 0.2, 0.15, t1, true); }
      mesh(rbox(0.16, 0.1, 0.2, 0.02), wh, -0.1, 0.07, -0.05, t1, true); laptop(t1, 0.5, 0.0, -0.3, ['GLOVEBOX', 'N2 PURGE  OK']);
      const t2 = place(2 * K, zt);    // analysis bench
      laptop(t2, -0.45, 0, -0.1, ['SPECTRA', 'CO2  0.4 %']); laptop(t2, -0.05, 0.05, 0.1, ['TELEMETRY', 'BUS  28 V  OK']);
      mesh(rbox(0.26, 0.2, 0.26, 0.02), steel, 0.42, 0.1, -0.05, t2, true); mesh(new THREE.PlaneGeometry(0.16, 0.08), new THREE.MeshBasicMaterial({ map: scr(['ANALYZER', 'READY']) }), 0.42, 0.13, 0.0815, t2);
      for (const [i, th] of [0.28 * P, 0.5 * P, 0.72 * P].entries()) {   // bedding on the five bunks, gear on the spare
        const bg = at(th, r0);
        for (const [j, y] of [0.87, 1.92].entries()) {
          if (i === 2 && j === 1) { for (let k = 0; k < 3; k++) mesh(rbox(0.5, 0.28, 0.4, 0.06), mat([0x39424d, 0x4a5668, 0x2c5aa0][k], false, 0.9, 0), 0.0, y + 0.0, -0.6 + k * 0.6, bg, true); continue; }
          const bagM = mesh(new THREE.CapsuleGeometry(0.17, 1.3, 6, 14).rotateX(P / 2), mat([0x3a5f9a, 0x6b7f8f, 0x7a4b3a, 0x40664f, 0x5b4a7a][(i * 2 + j) % 5], false, 0.9, 0), 0.03, y, 0.05, bg, true);
          if (j === 0) this.bags[i] = bagM;   // lower-bunk sleeping bag: the crew hides it while a sleeper is in that bay
          mesh(rbox(0.34, 0.1, 0.4, 0.04), wh, 0.03, y + 0.02, -0.78, bg, true);
        }
      }
      { const gg = at(-0.3 * P, r0);   // galley counter fittings
        mesh(rbox(0.5, 0.02, 0.6, 0.008), dk, 0, 0.955, -0.4, gg, true); mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 8), steel, 0.2, 1.03, -0.4, gg, true); mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 8).rotateZ(P / 2), steel, 0.13, 1.1, -0.4, gg, true);
        mesh(rbox(0.4, 0.28, 0.5, 0.03), steel, 0.12, 1.09, 0.45, gg, true); mesh(new THREE.PlaneGeometry(0.3, 0.16), new THREE.MeshBasicMaterial({ map: scr(['FOOD WARMER', 'READY']) }), -0.0815, 1.1, 0.45, gg).rotation.y = -P / 2;
        mesh(rbox(0.36, 0.5, 1.8, 0.03), wh, 0.27, 1.8, 0, gg, true); for (const z of [-0.45, 0.45]) mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.18, 6), steel, 0.08, 1.8, z, gg);
      }
      for (let i = 0; i < 5; i++) {   // stool backs, trays and cups on the galley table
        const a = (i / 5) * 2 * P, c = Math.cos(a), sn = Math.sin(a);
        mesh(rbox(0.04, 0.26, 0.32, 0.015), mat(0x4a5668, false, 0.85, 0), 1.15 * c + 0.26 * c, 0.62, GZ + 1.15 * sn + 0.26 * sn, this.root, true).rotation.y = -a;
        mesh(rbox(0.3, 0.015, 0.2, 0.006), mat(0xcfd5dc, false, 0.5, 0.1), 0.55 * c, 0.785, GZ + 0.55 * sn, this.root, true).rotation.y = -a;
        mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.09, 12), mat([0xe8832a, 0x2f6fd0, 0xeef1f4, 0xc0392b, 0x2f9d58][i], false, 0.4, 0), 0.72 * c, 0.82, GZ + 0.72 * sn, this.root, true);
      }
      { const eg = at(0.12 * P, R - 0.3); eg.add(extinguisher());   // safety gear beside Airlock 1
        mesh(rbox(0.05, 0.3, 0.42, 0.02), wh, 0.1, 1.25, 0.7, eg, true); mesh(rbox(0.006, 0.2, 0.05, 0.002), mat(0xc0392b, true), 0.07, 1.25, 0.7, eg); mesh(rbox(0.006, 0.05, 0.2, 0.002), mat(0xc0392b, true), 0.07, 1.25, 0.7, eg);
        mesh(rbox(0.06, 0.26, 0.3, 0.02), mat(0xe6c229, false, 0.5, 0.1), 0.1, 1.25, -0.7, eg, true);
      }
      const run = (th0: number, th1: number, y: number, rr: number, rad: number, color: number) => {   // exposed pipes and ducts along the wall
        const pts: THREE.Vector3[] = []; for (let i = 0; i <= 28; i++) { const t = th0 + ((th1 - th0) * i) / 28; pts.push(new THREE.Vector3(rr * Math.cos(t), y, rr * Math.sin(t))); }
        const o = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, rad, 8), mat(color, false, 0.4, 0.5)); o.castShadow = true; this.root.add(o);
        for (let i = 1; i < 12; i++) { const t = th0 + ((th1 - th0) * i) / 12; mesh(new THREE.TorusGeometry(rad * 1.5, rad * 0.35, 8, 16), mat(0x8b929c, false, 0.4, 0.6), rr * Math.cos(t), y, rr * Math.sin(t), this.root, true).rotation.y = -t; }
      };
      run(-0.77 * P, -0.44 * P, 2.02, R - 0.14, 0.028, 0x2f6fd0); run(-0.65 * P, -0.44 * P, 2.1, R - 0.14, 0.022, 0x2f9d58); run(-0.9 * P, -0.35 * P, 2.12, R - 0.38, 0.1, 0x9aa1ab);
      for (const dy of [0, 0.04, 0.08]) run(-0.9 * P, -0.35 * P, 1.97 + dy, R - 0.1, 0.012, 0x14171b);
    }
    // airlocks: curved-roof, sealed tunnels with an inner and an outer hatch
    this.locks = [this.makeLock('AIRLOCK 1', 0), this.makeLock('AIRLOCK 2', Math.PI)];
    const w = (l: Lock, u: number, v: number) => [u * l.ca - v * l.sa, u * l.sa + v * l.ca];
    for (const l of this.locks) {
      const hatch = (door: Door, u: number, nm: string, ok: () => string): Item => {
        const [x, z] = w(l, u, 0);
        return { x, z, reach: 1.6, text: () => `[E] ${door.open ? 'CLOSE' : 'OPEN'} ${nm} HATCH`, run: () => { if (door.open) { door.open = false; return `${nm} HATCH SEALED`; } if (this.lockHeld[this.locks.indexOf(l)]) return 'AIRLOCK IN USE BY CREW'; const e = ok(); if (e) return e; door.open = true; return `${nm} HATCH OPEN`; } };
      };
      this.items.push(
        hatch(l.inner, HAB_R, 'INNER', () => (l.outer.open ? 'CLOSE OUTER HATCH FIRST' : l.cyc !== null ? 'AIRLOCK IS CYCLING' : l.p < 99 ? 'PRESSURISE THE AIRLOCK FIRST' : '')),
        hatch(l.outer, HAB_R + TL, 'OUTER', () => (this.lockdown && this.where !== 'SURFACE' ? 'LOCKDOWN: HATCHES SEALED, STAY INSIDE' : l.inner.open ? 'CLOSE INNER HATCH FIRST' : l.cyc !== null ? 'AIRLOCK IS CYCLING' : !this.suitOn ? 'EVA SUIT NOT SEALED' : l.p > 1 ? 'DEPRESSURISE THE AIRLOCK FIRST' : '')),
        { ...(([x, z]) => ({ x, z }))(w(l, HAB_R + TL / 2, 0.75)), reach: 1.3,
          text: () => (l.cyc !== null ? `${l.name} CYCLING  ${l.p.toFixed(0)} kPa` : `[E] ${l.p > 50 ? 'DEPRESSURISE' : 'REPRESSURISE'} ${l.name}`),
          run: () => {
            if (l.cyc !== null) return 'CYCLE IN PROGRESS';
            if (this.lockHeld[this.locks.indexOf(l)]) return 'AIRLOCK IN USE BY CREW';
            if (l.inner.open || l.outer.open) return 'CLOSE BOTH HATCHES BEFORE CYCLING';
            if (this.lockdown && l.p > 50) return 'LOCKDOWN: AIRLOCK WILL NOT CYCLE OUT';
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
    // arched tunnel: straight walls to 1.3 m, then a semicircular roof, with structural ribs along its length
    const archOuter = (hw: number, st: number) => { const sh = new THREE.Shape(); sh.moveTo(-hw, 0); sh.lineTo(hw, 0); sh.lineTo(hw, st); sh.absarc(0, st, hw, 0, P, false); sh.lineTo(-hw, 0); return sh; };
    const archHole = (hw: number, st: number, y0 = 0.04) => { const h = new THREE.Path(); h.moveTo(-hw, y0); h.lineTo(-hw, st); h.absarc(0, st, hw, P, 0, true); h.lineTo(hw, y0); h.lineTo(-hw, y0); return h; };
    const archGeo = (ow: number, iw: number, depth: number) => { const sh = archOuter(ow, 1.3); sh.holes.push(archHole(iw, 1.3)); return new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false, curveSegments: 28 }).translate(0, 0, -depth / 2).rotateY(-P / 2); };
    const tube = new THREE.Mesh(archGeo(0.9, 0.8, TL), hull); tube.position.set(R + TL / 2, 0, 0); tube.castShadow = tube.receiveShadow = true; g.add(tube);
    for (const u of [-0.7, 0, 0.7]) { const rib = new THREE.Mesh(archGeo(0.93, 0.8, 0.07), frameM); rib.position.set(R + TL / 2 + u, 0, 0); rib.castShadow = true; g.add(rib); }
    const pl = new THREE.PointLight(0xfff6ec, 6, 6, 2); pl.position.set(R + TL / 2, 2, 0); g.add(pl);
    const lampStrip = new THREE.Mesh(rbox(0.9, 0.05, 0.14, 0.02), mat(0xf4f7ff, true)); lampStrip.position.set(R + TL / 2, 2.04, 0); g.add(lampStrip);
    box(0.06, 0.5, 0.4, R + TL / 2, 1.3, 0.77, mat(0x6fd3ff, true), g, 0.02);
    const mkDoor = (u: number, dir: number): Door => {
      const HW = 0.68, ST = 1.3;
      // arched frame: outer edge follows the tunnel, inner edge is the arched opening
      const fs = archOuter(0.8, ST), fh = new THREE.Path(); fh.moveTo(-HW, 0.02); fh.lineTo(-HW, ST); fh.absarc(0, ST, HW, P, 0, true); fh.lineTo(HW, 0.02); fh.lineTo(-HW, 0.02); fs.holes.push(fh);
      const fr = new THREE.Mesh(new THREE.ExtrudeGeometry(fs, { depth: 0.16, bevelEnabled: false, curveSegments: 28 }).translate(0, 0, -0.08).rotateY(-P / 2), frameM); fr.position.set(u, 0, 0); fr.castShadow = fr.receiveShadow = true; g.add(fr);
      const pivot = new THREE.Group(); pivot.position.set(u, 0, -HW); g.add(pivot);
      // door leaf: the same arch, with a round window cut clean through it, glazed with thin see-through glass
      const lw = HW - 0.015, sh = new THREE.Shape(); sh.moveTo(-lw, 0.04); sh.lineTo(lw, 0.04); sh.lineTo(lw, ST); sh.absarc(0, ST, lw, 0, P, false); sh.lineTo(-lw, 0.04);
      const hole = new THREE.Path(); hole.absarc(0, 1.5, 0.24, 0, P * 2, true); sh.holes.push(hole);
      const leaf = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.12, bevelEnabled: false, curveSegments: 40 }).translate(0, 0, -0.06).rotateY(-P / 2), doorM);
      leaf.position.set(0, 0, HW); leaf.castShadow = leaf.receiveShadow = true; pivot.add(leaf);
      const glassM = new THREE.MeshPhysicalMaterial({ color: 0xcfe9ff, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide });
      const glass = new THREE.Mesh(new THREE.CircleGeometry(0.24, 40).rotateY(P / 2), glassM); glass.position.set(0, 1.5, HW); pivot.add(glass);
      for (const s of [1, -1]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.035, 10, 40).rotateY(P / 2), frameM); ring.position.set(s * 0.065, 1.5, HW); pivot.add(ring); }
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.035, 12, 28), mat(NASA.red)); wheel.position.set(0.09 * dir, 0.95, HW); wheel.rotation.y = P / 2; pivot.add(wheel);
      const lampM = new THREE.MeshBasicMaterial({ color: 0xff4d4d }); const lamp = new THREE.Mesh(rbox(0.06, 0.12, 0.12, 0.02), lampM); lamp.position.set(u, 1.15, -0.75); g.add(lamp);
      return { open: false, k: 0, pivot, lamp: lampM, dir };
    };
    const inner = mkDoor(R, 1), outer = mkDoor(R + TL, -1);
    const lbl = label(name, 0.5); lbl.position.set(R + TL / 2, 1.75, 0.79); lbl.rotation.y = Math.PI; g.add(lbl);
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
  /** Visual-only door swing for the crew: it never touches the real hatch state, so the airlock interlock and the player's collision stay honest. */
  /** open, or still swinging: counts both the crew's visual swing and a hatch the player left open */
  doorOpen(lock: number, which: 'inner' | 'outer') { const d = this.locks[lock]?.[which]; return !!d && (d.open || !!d.vis || d.k > 0.08); }
  /** the crew seal a hatch the player left open */
  closeReal(lock: number, which: 'inner' | 'outer') { const d = this.locks[lock]?.[which]; if (!d || !d.open) return; d.open = false; d.vis = false; this.toast = 'CREW SEALED THE HATCH YOU LEFT OPEN'; this.toastT = 2.8; }
  playerIn(lock: number) { return this.where === this.locks[lock]?.name; }
  setDoor(lock: number, which: 'inner' | 'outer', open: boolean) { const l = this.locks[lock]; if (l) l[which].vis = open; }
  /** Vehicle-sized obstacle test: the drum and both airlock tunnels. */
  solid(x: number, z: number, r: number): boolean {
    if (Math.hypot(x, z) < HAB_R + 0.4 + r) return true;
    for (const l of this.locks) { const [u, v] = this.local(l, x, z); if (u > HAB_R - 0.5 && u < HAB_R + TL + 0.6 + r && Math.abs(v) < 1.0 + r) return true; }
    return false;
  }

  press() { if (this.best) { this.toast = this.best.run(); this.toastT = 2.8; } }

  update(dt: number, dtSim: number, p: THREE.Vector3, sim: Sim, look?: THREE.Vector3) {
    this.clock += dt;
    // power-aware lighting: slow mains wander, brown-out when the battery is low, red emergency lighting when the bus is dead
    const target = sim.lightK; // 1 with the lights bus powered, dim red emergency light when you switch them off or the bus browns out
    this.powerK += (target - this.powerK) * Math.min(1, dt * 2.5);
    const wander = 1 + 0.012 * Math.sin(this.clock * 3.1) + 0.008 * Math.sin(this.clock * 7.3 + 1);
    const pulse = this.alarm ? 0.6 + 0.4 * Math.sin(this.clock * 6) : 1; // fire / battery alarm: red lights pulsing
    for (const { l, base, color } of this.lights) { l.intensity = base * this.powerK * wander * pulse; l.color.setHex(this.powerK < 0.3 || this.alarm ? 0xff3b2a : color); }
    for (const { m, base } of this.glows) m.emissiveIntensity = base * Math.min(1, this.powerK * 1.1);
    this.stepSuit(dt, sim);
    for (const f of this.fans) f.rotation.x += dt * 16 * this.powerK;
    for (const l of this.locks) {
      for (const d of [l.inner, l.outer]) {
        d.k = Math.min(1, Math.max(0, d.k + (d.open || d.vis ? 1 : -1) * dt * 1.2)); d.pivot.rotation.y = d.dir * d.k * 1.7;
        d.lamp.color.setHex(d.open || d.vis ? 0xffb000 : 0x4fd8ff);
      }
      if (l.cyc !== null) {
        const s = (LOCK_P / (this.lockdown ? CYCLE_S * 0.5 : CYCLE_S)) * dt; // emergency cycle: twice as fast when the hab is locked down l.p = l.cyc > l.p ? Math.min(l.cyc, l.p + s) : Math.max(l.cyc, l.p - s);
        if (l.p === l.cyc) { if (l.cyc === 0) sim.spend(0.12, 0.6); else sim.spend(0.25, 0.4); l.cyc = null; this.toast = `${l.name} ${l.p === 0 ? 'DEPRESSURISED' : 'PRESSURISED'}`; this.toastT = 2.8; }
      }
    }
    this.where = 'SURFACE'; this.exposed = true;
    if (Math.hypot(p.x, p.z) < HAB_R) { this.where = 'HAB'; this.exposed = false; }
    for (const l of this.locks) {
      const [u, v] = this.local(l, p.x, p.z);
      if (u >= HAB_R - 0.05 && u < HAB_R + TL + 0.15 && Math.abs(v) < 0.9) { this.where = l.name; this.exposed = l.p < 50; }
    }
    if (this.shelter) { this.where = 'ROVER CABIN'; this.exposed = false; }
    if (this.suitOn && this.exposed) this.suitHours = Math.max(0, this.suitHours - dtSim / 3600);
    this.toastT -= dt; if (this.toastT <= 0) this.toast = '';
    let best: Item | null = null, bd = 1e9;
    // a prompt appears only for the thing you are standing at AND facing (horizontal gaze within ~55 degrees)
    const lh = look ? Math.hypot(look.x, look.z) : 0;
    for (const i of this.items) {
      const dx = i.x - p.x, dz = i.z - p.z, d = Math.hypot(dx, dz); if (d >= i.reach) continue;
      if (look && lh > 0.2 && d > 0.55 && (dx * look.x + dz * look.z) / (d * lh) < 0.57) continue;
      if (d < bd) { best = i; bd = d; }
    }
    this.best = best; this.prompt = best ? best.text() : '';
  }

  /** 0 = clear portholes, 1 = dust-caked and opaque, from both sides */
  setShutters(k: number) {
    if (Math.abs(k - this.shutterK) < 0.002) return; this.shutterK = k; const m = this.paneM;
    m.opacity = 0.07 + 0.93 * k; m.color.setRGB(1 - 0.5 * k, 1 - 0.56 * k, 1 - 0.65 * k); m.roughness = 0.03 + 0.9 * k; m.depthWrite = k > 0.6;
    const side = k > 0.01 ? THREE.DoubleSide : THREE.FrontSide; if (m.side !== side) { m.side = side; m.needsUpdate = true; }
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
