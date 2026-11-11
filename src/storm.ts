// The dust storm outside: ramping fog, dust streaming past, a dimmed Sun. Lunar dust storms are electrostatic, not wind,
// but a crew standing in one sees the same thing: the world dissolves into a brown haze a few metres away.
import * as THREE from 'three';

const N = 4200, BOX = 70;
export class Storm {
  level = 0; private pts: THREE.Points; private pos = new Float32Array(N * 3); private vel = new Float32Array(N * 3); private fogK = 0;
  constructor(private scene: THREE.Scene) {
    for (let i = 0; i < N; i++) { this.pos[i * 3] = (Math.random() - 0.5) * BOX; this.pos[i * 3 + 1] = Math.random() * 14; this.pos[i * 3 + 2] = (Math.random() - 0.5) * BOX; this.vel[i * 3] = 2.5 + Math.random() * 3; this.vel[i * 3 + 1] = (Math.random() - 0.5) * 0.4; this.vel[i * 3 + 2] = (Math.random() - 0.5) * 1.6; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xc2ad8c, size: 0.85, transparent: true, opacity: 0.8, depthWrite: false, fog: false }));
    this.pts.frustumCulled = false; this.pts.visible = false; scene.add(this.pts);
  }
  /** target: 0..1 storm strength; outside: is the camera outside the pressure hull / rover */
  update(dt: number, cam: THREE.Vector3, target: number, outside: boolean) {
    this.level += (target - this.level) * Math.min(1, dt * 0.6);   // the storm builds over a few seconds
    const k = this.level < 0.003 ? 0 : this.level; this.fogK += ((outside ? 1 : 0) - this.fogK) * Math.min(1, dt * 3);
    if (k === 0) { if (this.scene.fog) this.scene.fog = null; this.pts.visible = false; return; }
    const dens = 0.048 * k * this.fogK;
    if (!(this.scene.fog instanceof THREE.FogExp2)) this.scene.fog = new THREE.FogExp2(0x8a7d6c, 0);
    (this.scene.fog as THREE.FogExp2).density = dens; (this.scene.fog as THREE.FogExp2).color.setHex(0x8a7d6c);
    this.pts.visible = outside; if (!outside) return;
    (this.pts.material as THREE.PointsMaterial).opacity = 0.8 * k;
    for (let i = 0; i < N; i++) {
      const j = i * 3; this.pos[j] += this.vel[j] * dt * (0.5 + k); this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      for (const a of [0, 2]) { const c = a === 0 ? cam.x : cam.z; let d = this.pos[j + a] - c; if (d > BOX / 2) d -= BOX; else if (d < -BOX / 2) d += BOX; this.pos[j + a] = c + d; }
      if (this.pos[j + 1] > 14) this.pos[j + 1] = 0; else if (this.pos[j + 1] < 0) this.pos[j + 1] = 14;
    }
    (this.pts.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.pts.position.set(0, cam.y - 1.7, 0);
  }
}
