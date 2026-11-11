// Dev-only rover model viewer: the game's renderer/lighting rig with none of the terrain, hab or simulation,
// so the model can be inspected (and screenshotted) fast. Not referenced by the game; safe to delete.
import * as THREE from 'three';
import { buildRoverModel } from './roverModel';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.36;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x030409);

// same procedural lunar environment lighting as main.ts: regolith bounce, hard sun glare, faint earthglow
{
  const env = new THREE.Scene();
  const ground = new THREE.Mesh(new THREE.SphereGeometry(100, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x565149, side: THREE.BackSide }));
  env.add(ground);
  const sunBlob = new THREE.Mesh(new THREE.SphereGeometry(4, 16, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  sunBlob.position.set(38, 55, 22); env.add(sunBlob);
  const halo = new THREE.Mesh(new THREE.SphereGeometry(11, 16, 8), new THREE.MeshBasicMaterial({ color: 0x3f3f4d }));
  halo.position.copy(sunBlob.position); env.add(halo);
  const earthGlow = new THREE.Mesh(new THREE.SphereGeometry(9, 16, 8), new THREE.MeshBasicMaterial({ color: 0x1c2f4d }));
  earthGlow.position.set(-55, 18, -30); env.add(earthGlow);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(env, 0.04).texture;
  scene.environmentIntensity = 0.4;
}

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 3000);
scene.add(camera);
scene.add(new THREE.AmbientLight(0x39485c, 0.19));
const sun = new THREE.DirectionalLight(0xfff4e6, 4.0);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 200 });
sun.shadow.bias = -0.0004;
sun.position.set(38, 55, 22);
scene.add(sun, sun.target);

// a simple regolith floor so shadows and dust read
{
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d')!, n = document.createElement('canvas');
  for (const [s, a] of [[16, 1], [64, 0.6], [256, 0.35]] as const) {
    n.width = n.height = s;
    const ng = n.getContext('2d')!, id = ng.createImageData(s, s);
    for (let i = 0; i < s * s; i++) { const v = 90 + Math.random() * 165; id.data.set([v, v, v, 255], i * 4); }
    ng.putImageData(id, 0, 0); g.globalAlpha = a; g.drawImage(n, 0, 0, 512, 512);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(24, 24); t.colorSpace = THREE.SRGBColorSpace;
  const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x8f8880, map: t, roughness: 1 }));
  floor.receiveShadow = true; scene.add(floor);
}

const model = buildRoverModel();
scene.add(model.root);
model.cabLight.intensity = 14;   // interior lamp on so the cab reads from inside

const VIEWS: Record<string, [number[], number[]]> = {
  front3q: [[15, 4.8, 10.5], [0, 1.7, 0]],
  side: [[0.4, 3.4, 14], [0, 1.9, 0]],
  rear3q: [[-13.5, 4.6, 9.5], [0, 1.7, 0]],
  top: [[0.8, 17, 2.5], [0.4, 0, 0]],
  frontlow: [[10.5, 1.7, 6.5], [2.2, 1.5, 0]],
  wheel: [[8.6, 1.5, 3.9], [6.6, 0.9, 1.9]],
  decal: [[3.2, 2.15, 3.4], [3.15, 2.12, 0]],
  intdash: [[2.2, 2.75, 0.15], [4.7, 2.15, -0.25]],
  intback: [[4.1, 2.5, 0.85], [2.0, 2.0, -0.55]],
  intdoor: [[3.6, 2.6, 0.9], [1.9, 1.9, -1.35]],
};
const view = new URLSearchParams(location.search).get('view') ?? 'front3q';
const [pos, tgt] = VIEWS[view] ?? VIEWS.front3q;
camera.position.set(pos[0], pos[1], pos[2]);
camera.lookAt(tgt[0], tgt[1], tgt[2]);

let frames = 0;
(function loop() {
  requestAnimationFrame(loop);
  renderer.render(scene, camera);
  frames++;
  if (frames === 8) (window as unknown as Record<string, unknown>).__ready = true;
})();
