// Dev-only hab/exterior viewer: the game's renderer/lighting rig with none of the simulation, so the hab
// interior and the outpost props can be inspected (and screenshotted) fast. Not referenced by the game.
// ?view=in  -> standing inside the hab, looking at the floor/wall junction where grime used to collect
// ?view=out -> outside, looking at the tanks / array / berms
import * as THREE from 'three';
import { Hab } from './hab';
import { buildExterior } from './exterior';

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

{
  const env = new THREE.Scene();
  const ground = new THREE.Mesh(new THREE.SphereGeometry(100, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x565149, side: THREE.BackSide }));
  env.add(ground);
  const sunBlob = new THREE.Mesh(new THREE.SphereGeometry(4, 16, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  sunBlob.position.set(38, 55, 22); env.add(sunBlob);
  const halo = new THREE.Mesh(new THREE.SphereGeometry(11, 16, 8), new THREE.MeshBasicMaterial({ color: 0x3f3f4d }));
  halo.position.copy(sunBlob.position); env.add(halo);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(env, 0.04).texture;
  scene.environmentIntensity = 0.4;
}

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.05, 3000);
scene.add(camera);
scene.add(new THREE.AmbientLight(0x39485c, 0.19));
const sun = new THREE.DirectionalLight(0xfff4e6, 4.0);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 200 });
sun.shadow.bias = -0.0004;
sun.position.set(38, 55, 22);
scene.add(sun, sun.target);

const heightAt = (x: number, z: number) => 0;
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

const hab = new Hab(scene, 0);
buildExterior(scene, heightAt, new THREE.Vector3(14, 6, -2));

const view = new URLSearchParams(location.search).get('view') ?? 'in';
if (view === 'in') {
  camera.position.set(0, 1.55, 0.5);
  camera.lookAt(2.6, 0.35, -2.6);   // floor/wall junction + fittings, where grime used to collect
} else if (view === 'ring') {
  camera.position.set(13.7, 1.6, 6);
  camera.lookAt(-4, 0.1, -12);      // looking along the pad ring edge
} else {
  camera.position.set(4.5, 2.2, 14);
  camera.lookAt(-10, 1.2, 9);       // tanks, berms, pad ring
}

renderer.setAnimationLoop(() => renderer.render(scene, camera));
