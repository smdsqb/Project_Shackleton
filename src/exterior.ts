import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { NASA, panelTexture, tileTexture, cellTexture, flagTexture, plateTexture } from './livery';
import { WALL_H, CAP_H } from './hab';

// Outpost exterior: sintered-regolith landing pad, high-gain dish, the solar array (same geometry and position as
// before, so terrain shadowing still decides whether it is lit), propellant/O2 tanks, battery bank, radiator and flag.
const circles: { x: number; z: number; r: number }[] = [];
export const propBlocked = (x: number, z: number) => circles.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + 0.3);

const rbox = (w: number, h: number, d: number, r = 0.05) => new RoundedBoxGeometry(w, h, d, 3, Math.max(0.002, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)));
// three.js makes Object3D.position read-only, so it cannot be set through Object.assign.
const asg = (m: THREE.Mesh, o: { position: THREE.Vector3 }) => (m.position.copy(o.position), m);
const mat = (c: number, rough = 0.5, metal = 0.2) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal });

export function buildExterior(scene: THREE.Scene, heightAt: (x: number, z: number) => number, arrayPos: THREE.Vector3) {
  const y0 = heightAt(0, 0);
  const put = (o: THREE.Object3D, x: number, y: number, z: number, shadow = true) => {
    o.position.set(x, y, z); o.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = shadow; c.receiveShadow = true; } }); scene.add(o); return o;
  };
  const white = new THREE.MeshStandardMaterial({ map: panelTexture('#f2f4f6', '#a9b1ba', 2, 2), roughness: 0.42, metalness: 0.2 });
  const blue = mat(NASA.blue, 0.5, 0.2), steel = mat(0xb9bfc8, 0.35, 0.6);

  // landing / work pad
  const pad = new THREE.Mesh(new THREE.CircleGeometry(14, 72).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tileTexture('#8f8c88', '#77746f', 14), roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  pad.position.set(0, y0 + 0.025, 0); pad.receiveShadow = true; scene.add(pad);
  const ringM = new THREE.Mesh(new THREE.RingGeometry(13.6, 13.8, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xe6e9ed, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  ringM.position.set(0, y0 + 0.03, 0); scene.add(ringM);

  // high-gain dish on the dome apex
  const dish = new THREE.Group();
  dish.add(asg(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.9, 16), steel), { position: new THREE.Vector3(0, 0.45, 0) }));
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.75, 40, 14, 0, Math.PI * 2, 0, 0.6), new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.35, metalness: 0.3, side: THREE.DoubleSide }));
  bowl.scale.y = 0.55; bowl.position.set(0, 1.15, 0); bowl.rotation.x = -0.9; dish.add(bowl);
  const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.06, 0.3, 12), steel); feed.position.set(0, 1.6, 0.45); feed.rotation.x = -0.9; dish.add(feed);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 12), new THREE.MeshBasicMaterial({ color: 0xff4d4d })); beacon.position.set(0, 0.92, 0); dish.add(beacon);
  put(dish, 0, y0 + WALL_H + CAP_H - 0.05, 0);

  // solar array: tall mast, two cell wings in aluminium frames (positions match the shading test point)
  const ax = arrayPos.x, az = arrayPos.z, gy = heightAt(ax, az);
  put(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 24, 20), white), ax, gy + 11, az);
  put(new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 0.5, 28), white), ax, gy + 0.25, az);
  put(new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.05, 8, 24).rotateX(Math.PI / 2), blue), ax, gy + 3, az);
  const cells = new THREE.MeshStandardMaterial({ map: cellTexture(20, 20), roughness: 0.25, metalness: 0.5 });
  for (const dy of [5, -5]) {
    put(new THREE.Mesh(new THREE.BoxGeometry(0.15, 10, 10), cells), ax, arrayPos.y + dy, az);
    for (const s of [1, -1]) {
      put(new THREE.Mesh(rbox(0.22, 0.14, 10.3, 0.05), steel), ax, arrayPos.y + dy + s * 5.07, az);
      put(new THREE.Mesh(rbox(0.22, 10.3, 0.14, 0.05), steel), ax, arrayPos.y + dy, az + s * 5.07);
    }
  }
  put(new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 12), new THREE.MeshBasicMaterial({ color: 0xff4d4d })), ax, gy + 24.2, az, false);

  // O2 / propellant tanks on cradles
  const tankM = new THREE.MeshStandardMaterial({ map: panelTexture('#f4f6f8', '#b6bdc5', 6, 2), roughness: 0.35, metalness: 0.35 });
  for (const [x, z] of [[-10, 8], [-10, 11]] as const) {
    const t = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.8, 3, 10, 28), tankM); body.rotation.z = Math.PI / 2; body.position.y = 1.2; t.add(body);
    for (const bx of [-1, 1]) { const band = new THREE.Mesh(new THREE.TorusGeometry(0.805, 0.05, 10, 32).rotateY(Math.PI / 2), blue); band.position.set(bx * 1.1, 1.2, 0); t.add(band); }
    for (const cx of [-1.2, 1.2]) { const cr = new THREE.Mesh(rbox(0.3, 0.45, 1.5, 0.08), steel); cr.position.set(cx, 0.22, 0); t.add(cr); }
    put(t, x, heightAt(x, z) + 0.03, z); circles.push({ x: x - 1.3, z, r: 1.0 }, { x: x + 1.3, z, r: 1.0 }, { x, z, r: 1.0 });
  }

  // battery bank
  for (let i = 0; i < 4; i++) {
    const u = new THREE.Group();
    u.add(asg(new THREE.Mesh(rbox(1.2, 1.6, 0.9, 0.12), white), { position: new THREE.Vector3(0, 0.8, 0) }));
    u.add(asg(new THREE.Mesh(rbox(1.22, 0.1, 0.92, 0.04), blue), { position: new THREE.Vector3(0, 1.45, 0) }));
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.17), new THREE.MeshBasicMaterial({ map: plateTexture('BATTERY ' + (i + 1)) })); pl.position.set(0, 1.1, 0.455); u.add(pl);
    const x = 8 + i * 1.5, z = -9; put(u, x, heightAt(x, z) + 0.03, z); circles.push({ x, z, r: 0.75 });
  }

  // thermal radiator: two panels on a stand
  const rad = new THREE.Group();
  for (const s of [-1, 1]) {
    rad.add(asg(new THREE.Mesh(rbox(0.1, 2.2, 3.5, 0.04), new THREE.MeshStandardMaterial({ map: panelTexture('#f7f8fa', '#c9cfd6', 7, 4), roughness: 0.4, metalness: 0.15 })), { position: new THREE.Vector3(0, 1.8, s * 1.9) }));
    rad.add(asg(new THREE.Mesh(rbox(0.16, 1.0, 0.16, 0.04), steel), { position: new THREE.Vector3(0, 0.5, s * 1.9) }));
  }
  rad.add(asg(new THREE.Mesh(rbox(0.4, 0.12, 4.4, 0.04), steel), { position: new THREE.Vector3(0, 0.95, 0) }));
  put(rad, -7, heightAt(-7, -11) + 0.03, -11); circles.push({ x: -7, z: -12.9, r: 1.2 }, { x: -7, z: -9.1, r: 1.2 });

  // flag on the Moon (stiffened with a horizontal rod)
  const fl = new THREE.Group();
  fl.add(asg(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.6, 10), steel), { position: new THREE.Vector3(0, 1.3, 0) }));
  fl.add(asg(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.3, 8).rotateZ(Math.PI / 2), steel), { position: new THREE.Vector3(0.65, 2.45, 0) }));
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.63), new THREE.MeshStandardMaterial({ map: flagTexture(), side: THREE.DoubleSide, roughness: 0.9 }));
  cloth.position.set(0.65, 2.12, 0); fl.add(cloth);
  put(fl, 8.5, heightAt(8.5, 7.5) + 0.03, 7.5); circles.push({ x: 8.5, z: 7.5, r: 0.2 });

  // pad edge marker lights
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2, x = 13.7 * Math.cos(a), z = 13.7 * Math.sin(a);
    put(new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), new THREE.MeshBasicMaterial({ color: i % 3 === 0 ? 0xff4d4d : 0xffe9c4 })), x, heightAt(x, z) + 0.12, z, false);
  }
}
