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
  intstar: [[3.85, 2.52, -0.55], [2.3, 2.3, 1.45]],   // seated at the wheel, looking across the cab at the starboard wall
  nose: [[9.6, 2.6, 0], [5.2, 2.1, 0]],               // straight-on close-up of the nose band and its glass
  nosestar: [[9.2, 2.5, 2.6], [5.0, 2.0, 0.9]],       // nose band from the starboard three-quarter, close up
  drv3q: [[10.5, 3.4, -6.5], [4.2, 2.3, 0.3]],        // driver-side front three-quarter, like the bug report screenshot
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

// dev-only ray probe: ?ray=0.62,0.55 casts through that NDC point and prints every mesh hit with its
// distance and material, so a pane that reads as opaque can be traced to whatever is blocking it.
const rayQ = new URLSearchParams(location.search).get('ray');
if (rayQ) {
  if (rayQ === 'scan') {
    // ?ray=scan&row=0.25: sweep a row of NDC x from -0.5..0.5, print the first hit at each step
    const row = Number(new URLSearchParams(location.search).get('row') ?? 0.25);
    setTimeout(() => {
      const rc = new THREE.Raycaster(), out: string[] = [];
      for (let ux = -0.5; ux <= 0.5001; ux += 0.05) {
        rc.setFromCamera(new THREE.Vector2(ux, row), camera);
        const h = rc.intersectObjects(scene.children, true)[0];
        if (!h) { out.push(`${ux.toFixed(2)}: SKY`); continue; }
        const m = h.object as THREE.Mesh;
        const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial & { color: THREE.Color };
        out.push(`${ux.toFixed(2)}: ${m.geometry.type.slice(0, 6)} #${mat.color?.getHexString?.() ?? '??'} op${mat.opacity} @(${h.point.x.toFixed(1)},${h.point.y.toFixed(1)},${h.point.z.toFixed(1)}) d${h.distance.toFixed(1)}`);
      }
      (window as unknown as Record<string, unknown>).__scan = out;
      console.log('SCAN:\n' + out.join('\n'));
    }, 300);
  } else {
  const glassList: string[] = [];
  model.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshPhysicalMaterial;
    if (mat.type === 'MeshPhysicalMaterial' && mat.transparent) {
      m.geometry.computeBoundingBox();
      const c = m.geometry.boundingBox!.getCenter(new THREE.Vector3()).applyMatrix4(m.matrixWorld);
      glassList.push(`phys op=${mat.opacity} c=(${c.x.toFixed(2)},${c.y.toFixed(2)},${c.z.toFixed(2)})`);
    }
  });
  console.log('GLASS MESHES:', glassList.join(' | '));
  (window as unknown as Record<string, unknown>).__glass = glassList;
  // list every opaque ShapeGeometry panel with its world bounding box: finds a panel drawn over a pane
  const panelList: string[] = [];
  model.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.geometry.type !== 'ShapeGeometry') return;
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
    if (mat.transparent) return;
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox!;
    const c = bb.getCenter(new THREE.Vector3()).applyMatrix4(m.matrixWorld);
    const size = bb.getSize(new THREE.Vector3());
    panelList.push(`${mat.color.getHexString()} nTri=${(m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3} c=(${c.x.toFixed(2)},${c.y.toFixed(2)},${c.z.toFixed(2)}) size=(${size.x.toFixed(2)},${size.y.toFixed(2)},${size.z.toFixed(2)})`);
  });
  console.log('PANELS:', panelList.join(' | '));
  (window as unknown as Record<string, unknown>).__panels = panelList;
  // triangulation check per panel: does earcut honour every hole? (a dropped hole = an opaque filled pane)
  {
    const res: string[] = [];
    model.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || m.geometry.type !== 'ShapeGeometry') return;
      const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
      if (mat.transparent) return;
      const g = m.geometry, pos = g.attributes.position, idx = g.index;
      // count connected components of the triangulation that do NOT touch the outer boundary:
      // simpler proxy — report triangles whose bbox is fully inside (a filled hole shows as a big inner patch)
      res.push(`${mat.color.getHexString()} tris=${(idx ? idx.count : pos.count) / 3} verts=${pos.count}`);
    });
    console.log('TRI:', res.join(' | '));
    (window as unknown as Record<string, unknown>).__tri = res;
  }
  const soloQ = new URLSearchParams(location.search).get('solo');
  if (soloQ || new URLSearchParams(location.search).get('wire')) {
    const wire = !!new URLSearchParams(location.search).get('wire');
    const keep = (soloQ ?? '').split(',');
    const kill: THREE.Object3D[] = [], show: THREE.Mesh[] = [];
    model.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry) return;
      const g = m.geometry.type, mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
      const col = mat.color?.getHexString?.() ?? '';
      if (keep.length && (keep.includes(g) || keep.includes(col))) show.push(m);
      else if (keep.length) kill.push(o);
      if (wire && (g === 'ShapeGeometry' || g === 'BufferGeometry')) { const mm = Array.isArray(m.material) ? m.material[0] : m.material; (mm as THREE.MeshStandardMaterial).wireframe = true; }
    });
    for (const o of kill) o.parent?.remove(o);
  }
  const [ux, uy] = rayQ.split(',').map(Number);
  setTimeout(() => {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(ux, uy), camera);
    const hits = rc.intersectObjects(scene.children, true);
    const out = hits.slice(0, 12).map((h) => {
      const m = h.object as THREE.Mesh;
      const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial & { color: THREE.Color };
      const chain: string[] = []; let o: THREE.Object3D | null = h.object;
      while (o && o.type !== 'Scene') { chain.push(o.constructor.name); o = o.parent; }
      return `${m.geometry.type} color=#${mat.color?.getHexString?.() ?? '??'} op=${mat.opacity} at(${h.point.x.toFixed(1)},${h.point.y.toFixed(1)},${h.point.z.toFixed(1)}) ${chain.join('<')} d=${h.distance.toFixed(2)}`;
    });
    (window as unknown as Record<string, unknown>).__ray = out;
    console.log('RAY HITS:', out.join(' | '));
  }, 300);
  }
}
