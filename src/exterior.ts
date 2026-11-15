import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { NASA, panelTexture, tileTexture, cellTexture, flagTexture, plateTexture, ringTexture, groundDustTexture, wornMat } from './livery';
import { WALL_H, CAP_H } from './hab';

// Outpost exterior: sintered-regolith landing pad, high-gain dish, the solar array (same geometry and position as
// before, so terrain shadowing still decides whether it is lit), propellant/O2 tanks, battery bank, radiator and flag.
const circles: { x: number; z: number; r: number }[] = [];
/** Live list of every exterior obstacle, shared with the crew so EVA walkers steer around the real props. */
export const propCircles = circles;
export const propBlocked = (x: number, z: number) => circles.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + 0.3);
/** Same props, tested with a circle of radius r (for the rover). */
export const propHit = (x: number, z: number, r: number) => circles.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + r);

const rbox = (w: number, h: number, d: number, r = 0.05) => new RoundedBoxGeometry(w, h, d, 3, Math.max(0.002, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)));
// three.js makes Object3D.position read-only, so it cannot be set through Object.assign.
const asg = (m: THREE.Mesh, o: { position: THREE.Vector3 }) => (m.position.copy(o.position), m);
const mat = (c: number, rough = 0.5, metal = 0.2) => wornMat(c, metal >= 0.45 ? 'metal' : 'paint', { rough, metal: metal >= 0.45 ? metal : 0.04, repeat: 2 });

export function buildExterior(scene: THREE.Scene, heightAt: (x: number, z: number) => number, arrayPos: THREE.Vector3) {
  const y0 = heightAt(0, 0);
  const put = (o: THREE.Object3D, x: number, y: number, z: number, shadow = true) => {
    o.position.set(x, y, z); o.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = shadow; c.receiveShadow = true; } }); scene.add(o); return o;
  };
  const white = wornMat(0xffffff, 'paint', { rough: 0.55, metal: 0.03, repeat: 2, extra: { map: panelTexture('#f2f4f6', '#a9b1ba', 2, 2) } });
  const blue = wornMat(NASA.blue, 'paint', { rough: 0.6, metal: 0.03, repeat: 2 }), steel = mat(0xb9bfc8, 0.45, 0.6);
  // every prop stamps a soft contact shadow where it meets the ground, so nothing floats on a clean slab
  const bermTex = groundDustTexture();
  const berm = (x: number, z: number, w: number, d: number, o = 0.9) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: bermTex, transparent: true, opacity: o, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    m.position.set(x, heightAt(x, z) + 0.032, z); m.renderOrder = 1; scene.add(m);
  };

  // landing / work pad
  const pad = new THREE.Mesh(new THREE.CircleGeometry(14, 72).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tileTexture('#8f8c88', '#77746f', 14), roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  pad.position.set(0, y0 + 0.025, 0); pad.receiveShadow = true; scene.add(pad);
  // the white pad ring: clean painted striping
  const ringM = new THREE.Mesh(new THREE.RingGeometry(13.6, 13.8, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: ringTexture(), transparent: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  ringM.position.set(0, y0 + 0.03, 0); scene.add(ringM);

  // high-gain dish on the dome apex
  const dish = new THREE.Group();
  dish.add(asg(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.9, 16), steel), { position: new THREE.Vector3(0, 0.45, 0) }));
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.75, 40, 14, 0, Math.PI * 2, 0, 0.6), wornMat(0xe8e6df, 'paint', { rough: 0.5, metal: 0.04, repeat: 1, extra: { side: THREE.DoubleSide } }));
  bowl.scale.y = 0.55; bowl.position.set(0, 1.15, 0); bowl.rotation.x = -0.9; dish.add(bowl);
  const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.06, 0.3, 12), steel); feed.position.set(0, 1.6, 0.45); feed.rotation.x = -0.9; dish.add(feed);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 12), new THREE.MeshBasicMaterial({ color: 0xff4d4d })); beacon.position.set(0, 0.92, 0); dish.add(beacon);
  put(dish, 0, y0 + WALL_H + CAP_H - 0.05, 0);

  // solar array: tall mast, two cell wings in aluminium frames (positions match the shading test point)
  const ax = arrayPos.x, az = arrayPos.z, gy = heightAt(ax, az);
  berm(ax, az, 4.2, 4.2, 0.8);
  put(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 24, 20), white), ax, gy + 11, az);
  put(new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 0.5, 28), white), ax, gy + 0.25, az);
  put(new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.05, 8, 24).rotateX(Math.PI / 2), blue), ax, gy + 3, az);
  const cells = new THREE.MeshStandardMaterial({ map: cellTexture(20, 20), roughness: 0.38, metalness: 0.3 });   // glass over silicon, not a glowing sticker
  for (const dy of [5, -5]) {
    put(new THREE.Mesh(new THREE.BoxGeometry(0.15, 10, 10), cells), ax, arrayPos.y + dy, az);
    for (const s of [1, -1]) {
      put(new THREE.Mesh(rbox(0.22, 0.14, 10.3, 0.05), steel), ax, arrayPos.y + dy + s * 5.07, az);
      put(new THREE.Mesh(rbox(0.22, 10.3, 0.14, 0.05), steel), ax, arrayPos.y + dy, az + s * 5.07);
    }
  }
  put(new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 12), new THREE.MeshBasicMaterial({ color: 0xff4d4d })), ax, gy + 24.2, az, false);

  // O2 / propellant tanks on cradles: painted vessels, pipework between them, a stencil plate
  const tankM = wornMat(0xffffff, 'paint', { rough: 0.5, metal: 0.04, repeat: 2, extra: { map: panelTexture('#f4f6f8', '#b6bdc5', 6, 2) } });   // painted vessels, not polished chrome
  for (const [x, z] of [[-10, 8], [-10, 11]] as const) {
    const t = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.8, 3, 10, 28).rotateZ(Math.PI / 2), tankM); body.position.y = 1.2; t.add(body);
    for (const bx of [-1, 1]) { const band = new THREE.Mesh(new THREE.TorusGeometry(0.805, 0.05, 10, 32).rotateY(Math.PI / 2), blue); band.position.set(bx * 1.1, 1.2, 0); t.add(band); }
    for (const cx of [-1.2, 1.2]) { const cr = new THREE.Mesh(rbox(0.3, 0.45, 1.5, 0.08), steel); cr.position.set(cx, 0.22, 0); t.add(cr); }
    put(t, x, heightAt(x, z) + 0.03, z); berm(x, z, 5.6, 4.4, 0.85); circles.push({ x: x - 1.3, z, r: 1.0 }, { x: x + 1.3, z, r: 1.0 }, { x, z, r: 1.0 });
  }
  // cross-over plumbing: a valve block and pipe run joining the two vessels
  {
    const pl = new THREE.Group();
    const pipe = (a: [number, number, number], b: [number, number, number], r = 0.05) => {
      const from = new THREE.Vector3(...a), d = new THREE.Vector3(...b).sub(from), L = d.length();
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, 12), steel); m.position.copy(from).addScaledVector(d, 0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); m.castShadow = true; pl.add(m); return m;
    };
    pipe([-10, 1.2, 8.9], [-10, 1.2, 9.6]); pipe([-10, 1.2, 10.4], [-10, 1.2, 11.1]);
    pipe([-9.3, 1.2, 9.5], [-10.6, 1.2, 9.5], 0.035);
    const vb = new THREE.Mesh(rbox(0.34, 0.3, 0.3, 0.05), steel); vb.position.set(-10, 1.2, 9.5); pl.add(vb);
    for (const s of [-1, 1]) { const vw = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.016, 8, 18), steel); vw.position.set(-10 + s * 0.12, 1.38, 9.5); vw.rotation.x = Math.PI / 2; pl.add(vw); }
    pl.position.y = 0; scene.add(pl);
  }

  // battery bank
  for (let i = 0; i < 4; i++) {
    const u = new THREE.Group();
    u.add(asg(new THREE.Mesh(rbox(1.2, 1.6, 0.9, 0.12), white), { position: new THREE.Vector3(0, 0.8, 0) }));
    u.add(asg(new THREE.Mesh(rbox(1.22, 0.1, 0.92, 0.04), blue), { position: new THREE.Vector3(0, 1.45, 0) }));
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.17), new THREE.MeshBasicMaterial({ map: plateTexture('BATTERY ' + (i + 1)) })); pl.position.set(0, 1.1, 0.455); u.add(pl);
    const x = 8 + i * 1.5, z = -9; put(u, x, heightAt(x, z) + 0.03, z); circles.push({ x, z, r: 0.75 });
    if (i === 0 || i === 3) berm(8 + i * 1.5 + 0.75, z, 4.6, 3.2, 0.75);   // one berm per pair, not per box
  }

  // thermal radiator: two panels on a stand
  const rad = new THREE.Group();
  for (const s of [-1, 1]) {
    rad.add(asg(new THREE.Mesh(rbox(0.1, 2.2, 3.5, 0.04), wornMat(0xffffff, 'paint', { rough: 0.5, metal: 0.03, repeat: 2, extra: { map: panelTexture('#f7f8fa', '#c9cfd6', 7, 4) } })), { position: new THREE.Vector3(0, 1.8, s * 1.9) }));
    rad.add(asg(new THREE.Mesh(rbox(0.16, 1.0, 0.16, 0.04), steel), { position: new THREE.Vector3(0, 0.5, s * 1.9) }));
  }
  rad.add(asg(new THREE.Mesh(rbox(0.4, 0.12, 4.4, 0.04), steel), { position: new THREE.Vector3(0, 0.95, 0) }));
  put(rad, -7, heightAt(-7, -11) + 0.03, -11); berm(-7, -11, 5.2, 7.6, 0.8); circles.push({ x: -7, z: -12.9, r: 1.2 }, { x: -7, z: -9.1, r: 1.2 });

  // flag on the Moon (stiffened with a horizontal rod)
  const fl = new THREE.Group();
  fl.add(asg(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.6, 10), steel), { position: new THREE.Vector3(0, 1.3, 0) }));
  fl.add(asg(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.3, 8).rotateZ(Math.PI / 2), steel), { position: new THREE.Vector3(0.65, 2.45, 0) }));
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.63), wornMat(0xffffff, 'fabric', { rough: 0.9, repeat: 1, extra: { map: flagTexture(), side: THREE.DoubleSide } }));
  cloth.position.set(0.65, 2.12, 0); fl.add(cloth);
  put(fl, 8.5, heightAt(8.5, 7.5) + 0.03, 7.5); berm(8.5, 7.5, 1.6, 1.6, 0.7); circles.push({ x: 8.5, z: 7.5, r: 0.2 });

  // pad edge marker lights
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2, x = 13.7 * Math.cos(a), z = 13.7 * Math.sin(a);
    put(new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), new THREE.MeshBasicMaterial({ color: i % 3 === 0 ? 0xff4d4d : 0xffe9c4 })), x, heightAt(x, z) + 0.12, z, false);
  }
}
