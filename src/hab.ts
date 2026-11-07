import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Sim } from './sim';
import { NASA, panelTexture, tileTexture, crinkleTexture, meatball, worm, plateTexture, flagTexture } from './livery';

// The Hab: a rigid, painted-aluminium surface habitat (drum + dome, ~92 m2 of floor) with a thermal-blanket skirt,
// two airlocks with interlocked hatches, lab racks, oxygenator, atmospheric regulator and water reclaimer, and
// quarters for a crew of five. Footprint and fittings follow the original layout; airlock timings and costs are
// design placeholders. Every edge is radiused, every surface carries NASA livery.
export const HAB_R = 5.41, WALL_H = 2.2, CAP_H = 1.4;
const TL = 2.2, R_IN = 4.4, PR = 0.3, LOCK_P = 101.3, EVA_H = 8, CYCLE_S = 14;
type Door = { open: boolean; k: number; pivot: THREE.Group; lamp: THREE.MeshBasicMaterial; dir: number };
type Lock = { name: string; ang: number; ca: number; sa: number; p: number; cyc: number | null; inner: Door; outer: Door };
type Item = { x: number; z: number; reach: number; text: () => string; run: () => string };

const mat = (c: number, glow = false, rough = 0.55, metal = 0.1) =>
  new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal, ...(glow ? { emissive: c, emissiveIntensity: 1.2 } : {}) });
const rbox = (w: number, h: number, d: number, r = 0.04) => new RoundedBoxGeometry(w, h, d, 3, Math.max(0.002, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)));
function label(text: string, w = 1.3) {
  return new THREE.Mesh(new THREE.PlaneGeometry(w, (w * 96) / 512), new THREE.MeshBasicMaterial({ map: plateTexture(text) }));
}

export class Hab {
  prompt = ''; toast = ''; suitOn = false; suitHours = EVA_H; exposed = false; where = 'HAB';
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
    const gap = 0.15, arc = P - 2 * gap, starts = [P / 2 + gap, (3 * P) / 2 + gap];
    const shellM = new THREE.MeshStandardMaterial({ map: panelTexture('#f2f4f6', '#a9b1ba', 13, 2), roughness: 0.42, metalness: 0.2 });
    const liningM = new THREE.MeshStandardMaterial({ map: panelTexture('#e9edf0', '#c5cbd2', 13, 2), roughness: 0.75, metalness: 0.03, side: THREE.BackSide });
    const domeM = new THREE.MeshStandardMaterial({ map: panelTexture('#f2f4f6', '#a9b1ba', 28, 3), roughness: 0.42, metalness: 0.2 });
    const ceilM = new THREE.MeshStandardMaterial({ map: panelTexture('#eef1f4', '#cdd3da', 28, 3), roughness: 0.8, metalness: 0.02, side: THREE.BackSide });
    const gold = new THREE.MeshStandardMaterial({ color: NASA.gold, roughness: 0.32, metalness: 0.85, bumpMap: crinkleTexture(16, 1), bumpScale: 2 });
    const bandM = new THREE.MeshStandardMaterial({ color: NASA.blue, roughness: 0.6, side: THREE.BackSide });
    const kickM = new THREE.MeshStandardMaterial({ color: NASA.graphite, roughness: 0.7, side: THREE.BackSide });
    const trimM = mat(0xc9ced6, false, 0.35, 0.45);
    for (const s of starts) {
      mesh(new THREE.CylinderGeometry(R, R, WALL_H, 72, 1, true, s, arc), shellM, 0, WALL_H / 2, 0, this.root, true);
      mesh(new THREE.CylinderGeometry(R - 0.06, R - 0.06, WALL_H, 72, 1, true, s, arc), liningM, 0, WALL_H / 2, 0);
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
    mesh(new THREE.TorusGeometry(3, 0.06, 12, 64).rotateX(P / 2), mat(0xf4f7ff, true), 0, 3.28, 0);
    for (const [x, z] of [[-2, -1.8], [2, -1.8], [-2, 1.8], [2, 1.8]]) { const l = new THREE.PointLight(0xfff6ec, 16, 14, 2); l.position.set(x, 3, z); this.root.add(l); }

    // ---- portholes, decals, livery ----
    const trim2 = mat(0xb9bfc8, false, 0.3, 0.6), glassM = new THREE.MeshStandardMaterial({ color: 0x0a1522, roughness: 0.05, metalness: 0.6, emissive: 0x050a12 });
    const porthole = (psi: number, y: number, inside: boolean) => {
      for (const out of inside ? [true, false] : [true]) {
        const g = new THREE.Group(), r = out ? R + 0.02 : R - 0.085, s = out ? 1 : -1;
        g.position.set(r * Math.cos(psi), y, r * Math.sin(psi)); g.rotation.y = -psi; this.root.add(g);
        g.add(new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.045, 12, 40).rotateY(P / 2), trim2));
        const gl = new THREE.Mesh(new THREE.CircleGeometry(0.29, 40).rotateY((s * P) / 2), glassM); gl.position.x = s * 0.005; g.add(gl);
      }
    };
    for (const psi of [0.34 * P, -0.34 * P, 0.68 * P, -0.68 * P]) porthole(psi, 1.45, false);
    porthole(-0.3 * P, 1.65, true);
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
      const g = new THREE.Group(), r = o.r ?? 4.9, d = o.d ?? 0.8, y0f = o.y ?? 0;
      g.position.set(r * Math.cos(th), 0, r * Math.sin(th)); g.rotation.y = -th; this.root.add(g);
      mesh(rbox(d, o.h, o.w, 0.07), mat(o.color, o.glow), 0, y0f + o.h / 2, 0, g);
      if (o.accent !== null && o.h >= 0.9) mesh(rbox(d + 0.012, 0.07, o.w + 0.012, 0.03), mat(o.accent ?? NASA.blue), 0, y0f + o.h * 0.72, 0, g);
      if (o.badge) { const b = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), new THREE.MeshBasicMaterial({ map: ball, transparent: true })); b.position.set(-d / 2 - 0.012, y0f + o.h * 0.4, 0); b.rotation.y = -P / 2; g.add(b); }
      if (o.text) { const l = label(o.text); l.position.set(-d / 2 - 0.02, y0f + o.h + 0.22, 0); l.rotation.y = -P / 2; g.add(l); }
      return g;
    };
    const rack = 0xe9edf1;
    fit(-0.48 * P, { w: 1.1, h: 1.9, color: rack, text: 'OXYGENATOR', badge: true }); fit(-0.62 * P, { w: 1.1, h: 1.9, color: rack, text: 'ATMOS. REGULATOR', badge: true });
    fit(-0.76 * P, { w: 1.1, h: 1.9, color: rack, text: 'WATER RECLAIMER', badge: true }); fit(-0.9 * P, { w: 2.0, h: 0.9, color: NASA.graphite, text: 'COMMS / OPS', accent: NASA.red });
    fit(-0.3 * P, { w: 2.0, h: 0.95, color: 0xdfe3e8, text: 'GALLEY' }); fit(0.9 * P, { w: 1.4, h: 1.4, color: 0xf6f7f9, text: 'MEDICAL', accent: NASA.red });
    for (const th of [0.28 * P, 0.5 * P, 0.72 * P]) {
      fit(th, { w: 2.0, h: 0.5, y: 0.25, d: 0.95, color: 0xc4ceda, accent: null }); fit(th, { w: 2.0, h: 0.5, y: 1.3, d: 0.95, color: 0xc4ceda, accent: null });
      fit(th, { w: 2.0, h: 1.9, d: 0.04, r: 4.35, color: 0x2c5aa0, accent: null });
    }
    fit(0.5 * P, { w: 1.0, h: 0.05, y: 2.3, d: 0.1, color: 0x4a5668, text: 'CREW QUARTERS  x5', accent: null });
    // suit rack (five suits) beside Airlock 1
    const rackTh = -0.13 * P, rg = fit(rackTh, { w: 2.3, h: 2.0, d: 0.15, r: 5.2, color: 0x59626d, text: 'EVA SUITS', accent: NASA.red });
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Group(); s.position.set(-0.3, 0, (i - 2) * 0.44); rg.add(s);
      mesh(new THREE.CapsuleGeometry(0.17, 0.8, 8, 16), mat(0xf6f6f6), 0, 1.0, 0, s); mesh(new THREE.SphereGeometry(0.16, 20, 16), mat(0xe6edf5), 0, 1.65, 0, s);
      const v = mesh(new THREE.SphereGeometry(0.12, 16, 12), mat(0x1a2330, false, 0.1, 0.7), -0.09, 1.66, 0, s); v.scale.set(0.6, 0.85, 1);
      mesh(rbox(0.05, 0.12, 0.22, 0.02), mat(NASA.red), -0.16, 1.2, 0, s);
    }
    // centre of the floor: three lab tables and the galley table with five stools
    for (const x of [-2, 0, 2]) {
      mesh(rbox(1.6, 0.06, 0.8, 0.03), mat(0xeef1f4, false, 0.35), x, 0.9, -1.6); mesh(rbox(0.2, 0.87, 0.6, 0.05), mat(0x7a838f), x, 0.45, -1.6);
      const m = mesh(rbox(0.45, 0.3, 0.04, 0.02), mat(0x6fd3ff, true), x, 1.1, -1.8); m.rotation.x = -0.25;
      this.circles.push({ x, z: -1.6, r: 0.75 });
    }
    mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.05, 48), mat(0xeef1f4, false, 0.35), 0, 0.75, 1.9);
    mesh(new THREE.TorusGeometry(0.85, 0.025, 10, 48).rotateX(P / 2), mat(NASA.blue), 0, 0.75, 1.9);
    mesh(new THREE.CylinderGeometry(0.1, 0.2, 0.72, 16), mat(0x7a838f), 0, 0.38, 1.9);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * 2 * P, sx = 1.15 * Math.cos(a), sz = 1.9 + 1.15 * Math.sin(a);
      mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.36, 10), mat(0x7a838f), sx, 0.2, sz);
      const seat = mesh(new THREE.SphereGeometry(0.24, 20, 14), mat(0x2c5aa0, false, 0.85), sx, 0.45, sz); seat.scale.y = 0.4;
    }
    this.circles.push({ x: 0, z: 1.9, r: 1.25 });

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
    const rx = 5.0 * Math.cos(rackTh), rz = 5.0 * Math.sin(rackTh);
    this.items.push({ x: rx * 0.85, z: rz * 0.85, reach: 1.9, text: () => (this.suitOn ? '[E] DOFF EVA SUIT AND RECHARGE' : '[E] DON EVA SUIT'),
      run: () => { if (this.exposed) return 'RETURN TO THE HAB FIRST'; this.suitOn = !this.suitOn; if (!this.suitOn) this.suitHours = EVA_H; return this.suitOn ? 'EVA SUIT SEALED' : 'EVA SUIT STOWED, CONSUMABLES RECHARGED'; } });
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
      box(0.12, 2.0, 1.4, 0, 1.0, 0.7, doorM, pivot, 0.06);
      for (const s of [1, -1]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 10, 28).rotateY(P / 2), frameM); ring.position.set(s * 0.065, 1.5, 0.7); pivot.add(ring);
        const gl = new THREE.Mesh(new THREE.CircleGeometry(0.19, 28).rotateY((s * P) / 2), new THREE.MeshStandardMaterial({ color: 0x0a1522, roughness: 0.05, metalness: 0.6 })); gl.position.set(s * 0.066, 1.5, 0.7); pivot.add(gl);
      }
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.035, 12, 28), mat(NASA.red)); wheel.position.set(0.09 * dir, 0.95, 0.7); wheel.rotation.y = P / 2; pivot.add(wheel);
      const lampM = new THREE.MeshBasicMaterial({ color: 0xff4d4d }); const lamp = new THREE.Mesh(rbox(0.06, 0.12, 0.12, 0.02), lampM); lamp.position.set(u, 2.3, -0.75); g.add(lamp);
      return { open: false, k: 0, pivot, lamp: lampM, dir };
    };
    const inner = mkDoor(R, 1), outer = mkDoor(R + TL, -1);
    const lbl = label(name, 1.0); lbl.position.set(R + TL / 2, 2.45, 0); lbl.rotation.y = 0; g.add(lbl);
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

  status(): [string, string, string][] {
    const rows: [string, string, string][] = [
      ['LOCATION', this.where, this.exposed ? 'bad' : 'ok'],
      ['EVA SUIT', this.suitOn ? `SEALED · ${this.suitHours.toFixed(1)} h O2` : 'ON RACK', this.suitOn && this.suitHours < 1.5 ? 'bad' : 'ok'],
    ];
    for (const l of this.locks) {
      const st = l.cyc !== null ? (l.cyc === 0 ? 'DEPRESSURISING' : 'REPRESSURISING') : l.inner.open ? 'INNER OPEN' : l.outer.open ? 'OUTER OPEN' : 'SEALED';
      rows.push([l.name, `${l.p.toFixed(0)} kPa · ${st}`, l.cyc !== null || l.outer.open ? 'warn' : 'ok']);
    }
    return rows;
  }
}
