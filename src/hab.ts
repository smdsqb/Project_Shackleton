import * as THREE from 'three';
import type { Sim } from './sim';

// The Hab, after Andy Weir's "The Martian": a canvas drum-and-dome with ~92 m2 of floor, two airlocks, lab tables,
// oxygenator and water reclaimer. Footprint and fittings follow published descriptions; airlock timings and
// resource costs below are design placeholders. Crew of five.
export const HAB_R = 5.41;
const WALL_H = 2.2, CAP_H = 1.4, TL = 2.2, R_IN = 4.4, PR = 0.3, LOCK_P = 101.3, EVA_H = 8, CYCLE_S = 14;
type Door = { open: boolean; k: number; pivot: THREE.Group; lamp: THREE.MeshBasicMaterial; dir: number };
type Lock = { name: string; ang: number; ca: number; sa: number; p: number; cyc: number | null; inner: Door; outer: Door };
type Item = { x: number; z: number; reach: number; text: () => string; run: () => string };

const mat = (c: number, glow = false) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: 0.2, ...(glow ? { emissive: c, emissiveIntensity: 1.4 } : {}) });
function label(text: string, w = 1.3) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(8,12,18,.9)'; g.fillRect(0, 0, 512, 96); g.strokeStyle = '#4fd8ff'; g.lineWidth = 3; g.strokeRect(2, 2, 508, 92);
  g.fillStyle = '#d7dde5'; g.font = '600 38px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, 50);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, (w * 96) / 512), new THREE.MeshBasicMaterial({ map: t }));
}

export class Hab {
  prompt = ''; toast = ''; suitOn = false; suitHours = EVA_H; exposed = false; where = 'HAB';
  private locks: Lock[] = []; private circles: { x: number; z: number; r: number }[] = [];
  private items: Item[] = []; private best: Item | null = null; private toastT = 0;
  private root = new THREE.Group();

  constructor(scene: THREE.Scene, y0: number) {
    this.root.position.y = y0; scene.add(this.root);
    const R = HAB_R, canvas = mat(0xd9d3c4); canvas.side = THREE.DoubleSide;
    const add = (o: THREE.Object3D, p: THREE.Object3D = this.root) => { p.add(o); return o; };
    const mesh = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = this.root, shadow = false) => {
      const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = shadow; o.receiveShadow = true; parent.add(o); return o;
    };
    const gap = 0.15, arc = Math.PI - 2 * gap;
    for (const s of [Math.PI / 2 + gap, (3 * Math.PI) / 2 + gap]) mesh(new THREE.CylinderGeometry(R, R, WALL_H, 48, 1, true, s, arc), canvas, 0, WALL_H / 2, 0, this.root, true);
    const cap = mesh(new THREE.SphereGeometry(R, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2), canvas, 0, WALL_H, 0, this.root, true); cap.scale.y = CAP_H / R;
    const rib = mat(0x8a8f98);
    for (let i = 0; i < 8; i++) { const t = mesh(new THREE.TorusGeometry(R, 0.05, 6, 40, Math.PI), rib, 0, WALL_H, 0); t.scale.y = CAP_H / R; t.rotation.y = (i * Math.PI) / 8; }
    mesh(new THREE.CircleGeometry(R, 48).rotateX(-Math.PI / 2), mat(0x3a3d42), 0, 0.03, 0);
    mesh(new THREE.TorusGeometry(3, 0.05, 8, 48).rotateX(Math.PI / 2), mat(0xfff0dd, true), 0, 3.3, 0);
    for (const [x, z] of [[-2, -1.8], [2, -1.8], [-2, 1.8], [2, 1.8]]) { const l = new THREE.PointLight(0xfff0dd, 16, 14, 2); l.position.set(x, 3, z); this.root.add(l); }

    // wall-mounted fittings, set around the inside of the drum by angle
    const fit = (th: number, o: { w: number; h: number; d?: number; y?: number; color: number; text?: string; glow?: boolean; r?: number }) => {
      const g = new THREE.Group(); const r = o.r ?? 4.9, d = o.d ?? 0.8;
      g.position.set(r * Math.cos(th), 0, r * Math.sin(th)); g.rotation.y = -th; this.root.add(g);
      mesh(new THREE.BoxGeometry(d, o.h, o.w), mat(o.color, o.glow), 0, (o.y ?? 0) + o.h / 2, 0, g);
      if (o.text) { const l = label(o.text); l.position.set(-d / 2 - 0.02, (o.y ?? 0) + o.h + 0.22, 0); l.rotation.y = -Math.PI / 2; g.add(l); }
      return g;
    };
    const P = Math.PI, steel = 0xb8bec8;
    fit(-0.48 * P, { w: 1.1, h: 1.9, color: steel, text: 'OXYGENATOR' }); fit(-0.62 * P, { w: 1.1, h: 1.9, color: steel, text: 'ATMOS. REGULATOR' });
    fit(-0.76 * P, { w: 1.1, h: 1.9, color: steel, text: 'WATER RECLAIMER' }); fit(-0.9 * P, { w: 2.0, h: 0.9, color: 0x2a2f36, text: 'COMMS / OPS', glow: false });
    fit(-0.3 * P, { w: 2.0, h: 0.95, color: 0x9aa3ad, text: 'GALLEY' }); fit(0.9 * P, { w: 1.4, h: 1.4, color: 0xe8e8e8, text: 'MEDICAL' });
    for (const th of [0.28 * P, 0.5 * P, 0.72 * P]) {
      fit(th, { w: 2.0, h: 0.5, y: 0.25, d: 0.95, color: 0x4a5668 }); fit(th, { w: 2.0, h: 0.5, y: 1.3, d: 0.95, color: 0x4a5668 });
      fit(th, { w: 2.0, h: 1.9, d: 0.04, r: 4.35, color: 0x3b4a63 });
    }
    fit(0.5 * P, { w: 1.0, h: 0.05, y: 2.3, d: 0.1, color: 0x4a5668, text: 'CREW QUARTERS  x5' });
    // suit rack (five suits) beside Airlock 1
    const rackTh = -0.13 * P, rg = fit(rackTh, { w: 2.3, h: 2.0, d: 0.15, r: 5.2, color: 0x2a2f36, text: 'EVA SUITS' });
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Group(); s.position.set(-0.3, 0, (i - 2) * 0.44); rg.add(s);
      mesh(new THREE.CapsuleGeometry(0.17, 0.8, 4, 10), mat(0xf2f2f2), 0, 1.0, 0, s); mesh(new THREE.SphereGeometry(0.16, 12, 12), mat(0xdfe8f2), 0, 1.65, 0, s);
    }
    // centre of the floor: three lab tables and the galley table with five stools
    for (const x of [-2, 0, 2]) {
      mesh(new THREE.BoxGeometry(1.6, 0.06, 0.8), mat(0xd7dde5), x, 0.9, -1.6); mesh(new THREE.BoxGeometry(0.2, 0.87, 0.6), mat(0x5a626d), x, 0.45, -1.6);
      const m = mesh(new THREE.BoxGeometry(0.45, 0.3, 0.04), mat(0x4fd8ff, true), x, 1.1, -1.8); m.rotation.x = -0.25;
      this.circles.push({ x, z: -1.6, r: 0.75 });
    }
    mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.05, 24), mat(0xcfd5dc), 0, 0.75, 1.9); mesh(new THREE.CylinderGeometry(0.1, 0.2, 0.72, 12), mat(0x5a626d), 0, 0.38, 1.9);
    for (let i = 0; i < 5; i++) { const a = (i / 5) * 2 * P; mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.45, 12), mat(0x4a5668), 1.15 * Math.cos(a), 0.23, 1.9 + 1.15 * Math.sin(a)); }
    this.circles.push({ x: 0, z: 1.9, r: 1.25 });

    // airlocks: sealed canvas-and-metal tunnels with an inner and an outer hatch
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
    const R = HAB_R, metal = mat(0xb8bec8), dark = mat(0x1d2127);
    const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, m: THREE.Material, p: THREE.Object3D = g) => {
      const o = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; p.add(o); return o;
    };
    box(TL, WALL_H, 0.1, R + TL / 2, WALL_H / 2, -0.85, metal); box(TL, WALL_H, 0.1, R + TL / 2, WALL_H / 2, 0.85, metal);
    box(TL, 0.1, 1.8, R + TL / 2, WALL_H + 0.05, 0, metal); box(TL, 0.04, 1.7, R + TL / 2, 0.04, 0, mat(0x3a3d42));
    const pl = new THREE.PointLight(0xfff0dd, 6, 6, 2); pl.position.set(R + TL / 2, 2, 0); g.add(pl);
    const panel = box(0.06, 0.5, 0.4, R + TL / 2, 1.3, 0.78, mat(0x4fd8ff, true)); panel.rotation.y = 0;
    const mkDoor = (u: number, dir: number): Door => {
      box(0.16, WALL_H, 0.1, u, WALL_H / 2, -0.75, dark); box(0.16, WALL_H, 0.1, u, WALL_H / 2, 0.75, dark); box(0.16, 0.2, 1.6, u, 2.1, 0, dark);
      const pivot = new THREE.Group(); pivot.position.set(u, 0, -0.7); g.add(pivot);
      box(0.12, 2.0, 1.4, 0, 1.0, 0.7, metal, pivot);
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.03, 8, 20), mat(0xc0392b)); wheel.position.set(0.09 * dir, 1.0, 0.7); wheel.rotation.y = Math.PI / 2; pivot.add(wheel);
      const lampM = new THREE.MeshBasicMaterial({ color: 0xff4d4d }); const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.12), lampM); lamp.position.set(u, 2.3, -0.75); g.add(lamp);
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
