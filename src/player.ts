import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { buildSuit, type SuitParts } from './suit';
import { heightAt } from './terrain';
import { NASA } from './livery';

const P = Math.PI, EYE = 1.7, MAX_PRINTS = 260;
const rb = (w: number, h: number, d: number, r = 0.01) => new RoundedBoxGeometry(w, h, d, 3, Math.max(0.002, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)));

function soleTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128; const g = c.getContext('2d')!;
  g.fillStyle = '#000'; g.beginPath(); g.ellipse(32, 36, 21, 32, 0, 0, P * 2); g.fill(); g.beginPath(); g.ellipse(32, 98, 15, 24, 0, 0, P * 2); g.fill(); g.fillRect(22, 60, 20, 22);
  g.globalCompositeOperation = 'destination-out'; g.lineWidth = 3;
  for (let y = 14; y < 120; y += 9) { g.beginPath(); g.moveTo(14, y); g.lineTo(50, y); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** The player's own body: a hidden figure that casts a real shadow, first-person arms, a wrist comms pad and footprints. */
export class Player {
  private body = new THREE.Group();
  private suitBody = buildSuit({ suited: true, shadowOnly: true });
  private crewBody = buildSuit({ suited: false, shadowOnly: true });
  private armL = new THREE.Group(); private armR = new THREE.Group();
  private sleeveM = new THREE.MeshStandardMaterial({ color: NASA.blue, roughness: 0.85 });
  private handM = new THREE.MeshStandardMaterial({ color: 0xb98563, roughness: 0.8 });
  private cuffM = new THREE.MeshStandardMaterial({ color: 0x9aa1ab, roughness: 0.7, metalness: 0.2 });
  private padParts: THREE.Object3D[] = []; private padTex: THREE.CanvasTexture; private padCtx: CanvasRenderingContext2D;
  private cuffs: THREE.Object3D[] = [];
  private prints: THREE.InstancedMesh; private nPrints = 0; private foot = 1; private acc = 0;
  private dummy = new THREE.Object3D(); private lastSuit: boolean | null = null; private padK = 0; private phase = 0;

  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    this.body.add(this.suitBody, this.crewBody); scene.add(this.body);
    const arm = (sx: number) => {
      const g = new THREE.Group();
      const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.3, 8, 16).rotateX(P / 2), this.sleeveM); sleeve.position.z = -0.15;
      const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.057, 0.014, 8, 20), this.cuffM); cuff.position.z = -0.33; this.cuffs.push(cuff);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), this.handM); hand.scale.set(0.95, 0.75, 1.5); hand.position.z = -0.42;
      const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.016, 0.05, 6, 10).rotateX(P / 2), this.handM); thumb.position.set(-sx * 0.05, 0.0, -0.4); thumb.rotation.y = sx * 0.3;
      g.add(sleeve, cuff, hand, thumb); return g;
    };
    this.armL = arm(-1); this.armR = arm(1);
    // wrist pad on the left forearm
    const c = document.createElement('canvas'); c.width = 256; c.height = 192; this.padCtx = c.getContext('2d')!;
    this.padTex = new THREE.CanvasTexture(c); this.padTex.colorSpace = THREE.SRGBColorSpace;
    const bezel = new THREE.Mesh(rb(0.11, 0.016, 0.14, 0.006), new THREE.MeshStandardMaterial({ color: 0x20252b, roughness: 0.4, metalness: 0.4 })); bezel.position.set(0, 0.064, -0.2);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.092, 0.12).rotateX(-P / 2), new THREE.MeshBasicMaterial({ map: this.padTex })); screen.position.set(0, 0.0725, -0.2);
    this.armL.add(bezel, screen); this.padParts.push(bezel, screen);
    this.setPad(['SUIT COMMS', 'STANDBY', 'PRESS C'], false);
    camera.add(this.armL, this.armR);
    // footprints
    const mat = new THREE.MeshStandardMaterial({ map: soleTexture(), color: 0x1d1c1a, roughness: 1, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.prints = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.13, 0.3).rotateX(-P / 2), mat, MAX_PRINTS); this.prints.count = 0; this.prints.frustumCulled = false; scene.add(this.prints);
  }

  /** Redraw the wrist pad screen. */
  setPad(lines: string[], live: boolean) {
    const g = this.padCtx; g.fillStyle = '#04141c'; g.fillRect(0, 0, 256, 192); g.strokeStyle = live ? '#4fd8ff' : '#2a4a58'; g.lineWidth = 4; g.strokeRect(4, 4, 248, 184);
    g.fillStyle = live ? '#4fd8ff' : '#5f8190'; g.font = 'bold 22px monospace'; g.textBaseline = 'top';
    lines.slice(0, 5).forEach((t, i) => { g.fillStyle = i === 0 ? (live ? '#4fd8ff' : '#5f8190') : '#d7dde5'; g.font = (i === 0 ? 'bold 22px' : '19px') + ' monospace'; g.fillText(t.slice(0, 17), 14, 14 + i * 34); });
    this.padTex.needsUpdate = true;
  }

  update(dt: number, pos: THREE.Vector3, yaw: number, vel: number, onGround: boolean, suitOn: boolean, padOpen: boolean, outside: boolean) {
    if (suitOn !== this.lastSuit) {
      this.lastSuit = suitOn;
      this.sleeveM.color.setHex(suitOn ? 0xf0f1f3 : NASA.blue); this.handM.color.setHex(suitOn ? 0xd5d9de : 0xb98563);
      this.cuffs.forEach((o) => (o.visible = suitOn)); this.padParts.forEach((o) => (o.visible = suitOn));
      this.suitBody.visible = suitOn; this.crewBody.visible = !suitOn;
    }
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    this.body.position.set(pos.x - fx * 0.14, pos.y - EYE, pos.z - fz * 0.14); this.body.rotation.y = yaw;
    const k = onGround ? Math.min(1, vel / 1.2) : 0.35; this.phase += dt * vel * 4.4;
    const s = Math.sin(this.phase) * 0.55 * k, u = (suitOn ? this.suitBody : this.crewBody).userData as SuitParts;
    u.legL.rotation.x = s; u.legR.rotation.x = -s; u.armL.rotation.x = -s * 0.7; u.armR.rotation.x = s * 0.7;
    this.padK += ((padOpen && suitOn ? 1 : 0) - this.padK) * Math.min(1, dt * 6);
    const sw = Math.sin(this.phase) * 0.012 * k, kk = this.padK;
    this.armR.position.set(0.24, -0.27 + sw, -0.12); this.armR.rotation.set(0.12, -0.28, 0);
    this.armL.position.set(-0.24 + 0.07 * kk, -0.27 + 0.1 * kk - sw, -0.12 + 0.02 * kk); this.armL.rotation.set(0.12 + 0.83 * kk, 0.28 - 0.18 * kk, 0);
    if (outside && onGround && vel > 0.2 && Math.hypot(pos.x, pos.z) > 10.5) { this.acc += vel * dt; if (this.acc > 0.75) { this.acc = 0; this.stamp(pos, yaw); } }
  }

  private stamp(p: THREE.Vector3, yaw: number) {
    this.foot *= -1;
    const x = p.x + Math.cos(yaw) * 0.1 * this.foot, z = p.z - Math.sin(yaw) * 0.1 * this.foot, h = heightAt(x, z), e = 0.35;
    const n = new THREE.Vector3(heightAt(x - e, z) - heightAt(x + e, z), 2 * e, heightAt(x, z - e) - heightAt(x, z + e)).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    this.dummy.position.set(x, h + 0.012, z);
    this.dummy.quaternion.setFromUnitVectors(up, n).multiply(new THREE.Quaternion().setFromAxisAngle(up, yaw));
    this.dummy.scale.set(1, 1, 1); this.dummy.updateMatrix();
    this.prints.setMatrixAt(this.nPrints % MAX_PRINTS, this.dummy.matrix); this.nPrints++;
    this.prints.count = Math.min(this.nPrints, MAX_PRINTS); this.prints.instanceMatrix.needsUpdate = true;
  }
}
