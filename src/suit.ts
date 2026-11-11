import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { NASA, meatball, flagTexture, wornMat } from './livery';

const P = Math.PI;
const rb = (w: number, h: number, d: number, r = 0.02) => new RoundedBoxGeometry(w, h, d, 3, Math.max(0.002, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)));
const cap = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 8, 16);
export type SuitParts = { legL: THREE.Group; legR: THREE.Group; armL: THREE.Group; armR: THREE.Group };

/**
 * A human-proportioned figure, feet on y = 0, facing -z, about 1.9 m tall in the suit.
 * suited: white EVA suit with bellows joints, hard upper torso, life-support backpack and a gold-visored helmet.
 * not suited: a crew member in a blue coverall. shadowOnly draws nothing but still casts a shadow (the player's own body).
 */
export function buildSuit(opts: { suited: boolean; shadowOnly?: boolean }): THREE.Group {
  const { suited, shadowOnly } = opts;
  const m = (c: number, rough = 0.7, metal = 0.03) => wornMat(c, rough >= 0.75 ? 'fabric' : 'paint', { rough, metal: 0.03, repeat: 1 });
  // no two suits age the same: each one picks up a different amount of regolith grey (EVA suits famously
  // turn dingy grey-brown after a few sorties; only a fresh one is white)
  const dusty = (c: number) => new THREE.Color(c).lerp(new THREE.Color(0x8f887c), suited ? 0.18 + Math.random() * 0.26 : 0.04 + Math.random() * 0.08);
  const fabric = m(dusty(suited ? 0xd9d7d2 : NASA.blue).getHex(), 0.85), hard = m(dusty(0xd8d9db).getHex(), 0.5, 0.05), joint = m(dusty(0x8d939b).getHex(), 0.8, 0.05), dark = m(0x23272d, 0.6, 0.1);
  const glove = m(dusty(suited ? 0xc9ccce : 0xb98563).getHex(), 0.85), boot = m(0x3b4048, 0.85), red = m(0xc8452c, 0.65), skin = m(0xb98563, 0.8);
  const root = new THREE.Group();
  const mesh = (g: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, mat); o.position.set(x, y, z); parent.add(o); return o; };
  const ring = (r: number, t: number) => new THREE.TorusGeometry(r, t, 8, 22).rotateX(P / 2);

  const leg = (sx: number) => {
    const g = new THREE.Group(); g.position.set(sx * 0.1, 0.98, 0); root.add(g);
    mesh(cap(0.092, 0.26), fabric, g, 0, -0.2, 0); mesh(ring(0.088, 0.02), joint, g, 0, -0.43, 0); mesh(cap(0.074, 0.28), fabric, g, 0, -0.64, 0);
    mesh(ring(0.072, 0.016), joint, g, 0, -0.84, 0); mesh(rb(0.115, 0.1, 0.27, 0.04), boot, g, 0, -0.9, -0.05);
    if (suited) mesh(ring(0.098, 0.011), red, g, 0, -0.1, 0);
    return g;
  };
  const arm = (sx: number) => {
    const g = new THREE.Group(); g.position.set(sx * 0.25, 1.48, 0); g.rotation.z = -sx * 0.07; root.add(g);
    mesh(new THREE.SphereGeometry(0.075, 16, 12), suited ? joint : fabric, g);
    mesh(cap(0.058, 0.18), fabric, g, sx * 0.02, -0.17, 0); mesh(ring(0.056, 0.016), joint, g, sx * 0.02, -0.32, 0);
    mesh(cap(0.05, 0.2), fabric, g, sx * 0.02, -0.48, 0); mesh(ring(0.052, 0.016), suited ? joint : fabric, g, sx * 0.02, -0.62, 0);
    const hand = mesh(new THREE.SphereGeometry(0.058, 14, 10), glove, g, sx * 0.02, -0.7, -0.005); hand.scale.set(0.85, 1.3, 0.75);
    mesh(cap(0.016, 0.05), glove, g, sx * 0.02 - sx * 0.05, -0.68, -0.025);
    if (suited) mesh(ring(0.062, 0.011), red, g, sx * 0.02, -0.1, 0);
    return g;
  };
  const legL = leg(-1), legR = leg(1), armL = arm(-1), armR = arm(1);
  mesh(rb(0.34, 0.16, 0.22, 0.06), suited ? joint : fabric, root, 0, 1.0, 0);
  const hut = mesh(cap(0.16, 0.22), suited ? hard : fabric, root, 0, 1.3, 0); hut.scale.set(1.3, 1, 0.85);
  if (suited) {
    mesh(ring(0.1, 0.025), joint, root, 0, 1.6, 0);
    mesh(new THREE.SphereGeometry(0.1, 16, 12), skin, root, 0, 1.74, 0);
    mesh(new THREE.SphereGeometry(0.17, 28, 20), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.02, transparent: true, opacity: 0.13, depthWrite: false }), root, 0, 1.75, 0);
    // gold sun-visor: a coated reflective shell that picks up the environment, with faint arc scratches
    mesh(new THREE.SphereGeometry(0.176, 32, 20, (3 * P) / 2 - 1.0, 2.0, 0.55, 1.75), new THREE.MeshPhysicalMaterial({ color: 0xc79a3c, roughness: 0.18, metalness: 0.9, transparent: true, opacity: 0.94, side: THREE.DoubleSide, clearcoat: 0.6, clearcoatRoughness: 0.25 }), root, 0, 1.75, 0);
    mesh(ring(0.14, 0.02), hard, root, 0, 1.63, 0);
    mesh(rb(0.4, 0.56, 0.2, 0.06), hard, root, 0, 1.34, 0.2); mesh(rb(0.3, 0.1, 0.12, 0.03), joint, root, 0, 1.02, 0.2);
    mesh(cap(0.02, 0.12), dark, root, 0.14, 1.68, 0.22);
    mesh(rb(0.2, 0.11, 0.06, 0.02), dark, root, 0, 1.36, -0.15);
    for (let i = 0; i < 3; i++) mesh(new THREE.BoxGeometry(0.025, 0.02, 0.01), new THREE.MeshStandardMaterial({ color: i === 2 ? 0xffb000 : 0x2f9d58, emissive: i === 2 ? 0xffb000 : 0x2f9d58, emissiveIntensity: 1.2 }), root, -0.05 + i * 0.05, 1.36, -0.182);
    if (!shadowOnly) {
      const ball = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.09), new THREE.MeshBasicMaterial({ map: meatball(), transparent: true })); ball.position.set(-0.13, 1.44, -0.178); ball.rotation.y = P; root.add(ball);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.065), new THREE.MeshBasicMaterial({ map: flagTexture() })); flag.position.set(0.3, 1.38, -0.045); flag.rotation.y = -P / 2; flag.rotation.z = 0.07; root.add(flag);
    }
  } else {
    mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 12), skin, root, 0, 1.62, 0);
    mesh(new THREE.SphereGeometry(0.105, 18, 14), skin, root, 0, 1.73, 0);
  }
  root.userData = { legL, legR, armL, armR } satisfies SuitParts;
  const ghost = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  root.traverse((o) => {
    const mm = o as THREE.Mesh; if (!mm.isMesh) return;
    if (shadowOnly) { mm.material = ghost; mm.castShadow = true; mm.receiveShadow = false; }
    else { const tr = (mm.material as THREE.Material).transparent; mm.castShadow = !tr; mm.receiveShadow = !tr; }
  });
  return root;
}
