// The dust storm outside, visualised as ramping fog and a dimmed world only: no dust particles, no dust films.
// (The storm itself stays a gameplay event; the scene just loses visibility while it lasts.)
import * as THREE from 'three';

export class Storm {
  level = 0; private fogK = 0;
  constructor(private scene: THREE.Scene) {}
  /** target: 0..1 storm strength; outside: is the camera outside the pressure hull / rover */
  update(dt: number, _cam: THREE.Vector3, target: number, outside: boolean) {
    this.level += (target - this.level) * Math.min(1, dt * 0.6);   // the storm builds over a few seconds
    const k = this.level < 0.003 ? 0 : this.level; this.fogK += ((outside ? 1 : 0) - this.fogK) * Math.min(1, dt * 3);
    if (k === 0) { if (this.scene.fog) this.scene.fog = null; return; }
    const dens = 0.048 * k * this.fogK;
    if (!(this.scene.fog instanceof THREE.FogExp2)) this.scene.fog = new THREE.FogExp2(0x8a7d6c, 0);
    (this.scene.fog as THREE.FogExp2).density = dens; (this.scene.fog as THREE.FogExp2).color.setHex(0x8a7d6c);
  }
}
