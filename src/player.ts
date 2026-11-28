import * as THREE from 'three';
import { buildSuit, type SuitParts } from './suit';
import { heightAt } from './terrain';

const P = Math.PI, EYE = 1.7, MAX_PRINTS = 260;

function soleTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128; const g = c.getContext('2d')!;
  g.fillStyle = '#000'; g.beginPath(); g.ellipse(32, 36, 21, 32, 0, 0, P * 2); g.fill(); g.beginPath(); g.ellipse(32, 98, 15, 24, 0, 0, P * 2); g.fill(); g.fillRect(22, 60, 20, 22);
  g.globalCompositeOperation = 'destination-out'; g.lineWidth = 3;
  for (let y = 14; y < 120; y += 9) { g.beginPath(); g.moveTo(14, y); g.lineTo(50, y); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** The player's own body: a hidden figure that casts a real shadow, the held extinguisher and footprints. (The first-person
 * arms and the 3D wrist pad are gone on purpose: clean view, no hands floating beside the camera; comms happen on the console UI.) */
export class Player {
  private body = new THREE.Group();
  private suitBody = buildSuit({ suited: true, shadowOnly: true });
  private crewBody = buildSuit({ suited: false, shadowOnly: true });
  private prints: THREE.InstancedMesh; private nPrints = 0; private foot = 1; private acc = 0;
  private heldExt: THREE.Group; private sprayPts: THREE.Points; private sprayPos = new Float32Array(160 * 3); private sprayVel = new Float32Array(160 * 3); private sprayLife = new Float32Array(160); private sprayOn = false; private sprayI = 0;
  private dummy = new THREE.Object3D(); private lastSuit: boolean | null = null; private lastOutside: boolean | null = null; private phase = 0;

  constructor(scene: THREE.Scene, private camera: THREE.Camera) {
    this.body.add(this.suitBody, this.crewBody); scene.add(this.body);
    // fire extinguisher held in view (no hands: it floats as a clean view-model), and its foam
    this.heldExt = new THREE.Group(); this.heldExt.visible = false; this.heldExt.position.set(0.2, -0.24, -0.46); this.heldExt.rotation.set(0.1, 0.06, 0.05); camera.add(this.heldExt);
    const red = new THREE.MeshStandardMaterial({ color: 0xb03a2e, roughness: 0.4, metalness: 0.3 }), blk = new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.5, metalness: 0.3 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.3, 18), red), head = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.06, 12), blk), noz = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.14, 8).rotateX(P / 2), blk);
    head.position.y = 0.18; noz.position.set(0, 0.2, -0.08); this.heldExt.add(body, head, noz);
    this.sprayPts = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(this.sprayPos, 3)), new THREE.PointsMaterial({ color: 0xf2f5f8, size: 0.1, transparent: true, opacity: 0.7, depthWrite: false }));
    this.sprayPts.frustumCulled = false; this.sprayPos.fill(-999); scene.add(this.sprayPts);
    // footprints
    const mat = new THREE.MeshStandardMaterial({ map: soleTexture(), color: 0x1d1c1a, roughness: 1, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.prints = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.13, 0.3).rotateX(-P / 2), mat, MAX_PRINTS); this.prints.count = 0; this.prints.frustumCulled = false; scene.add(this.prints);
  }

  setHeld(h: 'extinguisher' | null) { this.heldExt.visible = h === 'extinguisher'; }
  setSpray(on: boolean) { this.sprayOn = on; }
  private stepSpray(dt: number) {
    const N = 160, fwd = new THREE.Vector3(), o = new THREE.Vector3(); this.camera.getWorldDirection(fwd); this.camera.getWorldPosition(o);
    if (this.sprayOn) {
      const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize(); o.addScaledVector(fwd, 0.62).addScaledVector(right, 0.2).y -= 0.12;
      for (let k = 0; k < 6; k++) { const i = this.sprayI++ % N; this.sprayPos.set([o.x, o.y, o.z], i * 3); this.sprayVel.set([fwd.x * (3.2 + Math.random() * 1.6) + (Math.random() - 0.5) * 0.9, fwd.y * 3.4 + (Math.random() - 0.5) * 0.9, fwd.z * (3.2 + Math.random() * 1.6) + (Math.random() - 0.5) * 0.9], i * 3); this.sprayLife[i] = 0.7 + Math.random() * 0.4; }
    }
    for (let i = 0; i < N; i++) {
      if (this.sprayLife[i] <= 0) continue; this.sprayLife[i] -= dt;
      if (this.sprayLife[i] <= 0) { this.sprayPos.set([0, -999, 0], i * 3); continue; }
      for (let a = 0; a < 3; a++) { this.sprayPos[i * 3 + a] += this.sprayVel[i * 3 + a] * dt; this.sprayVel[i * 3 + a] *= 1 - 2.4 * dt; } this.sprayVel[i * 3 + 1] -= 0.8 * dt;
    }
    this.sprayPts.geometry.attributes.position.needsUpdate = true;
  }

  /** kept for API compatibility: the 3D wrist pad went away with the arms */
  setPad(_lines: string[], _live: boolean) { /* no 3D wrist pad anymore: comms render in the console UI */ }

  update(dt: number, pos: THREE.Vector3, yaw: number, vel: number, onGround: boolean, suitOn: boolean, outside: boolean) {
    if (suitOn !== this.lastSuit) {
      this.lastSuit = suitOn;
      this.suitBody.visible = suitOn; this.crewBody.visible = !suitOn;
    }
    // the body exists to cast the player's shadow: inside the pressure hull that shadow can never be seen (the shell
    // already shades the interior), so drop its cast there and save its depth-pass draw calls
    if (outside !== this.lastOutside) {
      this.lastOutside = outside;
      for (const b of [this.suitBody, this.crewBody]) b.traverse((o: any) => { if (o.isMesh) o.castShadow = outside; });
    }
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    this.body.position.set(pos.x - fx * 0.14, pos.y - EYE, pos.z - fz * 0.14); this.body.rotation.y = yaw;
    const k = onGround ? Math.min(1, vel / 1.2) : 0.35; this.phase += dt * vel * 4.4;
    const s = Math.sin(this.phase) * 0.55 * k, u = (suitOn ? this.suitBody : this.crewBody).userData as SuitParts;
    u.legL.rotation.x = s; u.legR.rotation.x = -s; u.armL.rotation.x = -s * 0.7; u.armR.rotation.x = s * 0.7;
    this.stepSpray(dt);
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
