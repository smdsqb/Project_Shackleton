import * as THREE from 'three';
import { heightAt, isSunlit, rand } from './terrain';
import { bodyDir, loadEphemeris } from './ephemeris';
import { Sim, SIM } from './sim';

const MISSION_DAY0 = 214, EYE = 1.7, G = 1.62;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.5;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 30000);
camera.position.set(0, heightAt(0, 20) + EYE, 20);
scene.add(camera);
scene.add(new THREE.AmbientLight(0x39485c, 0.35));
const sun = new THREE.DirectionalLight(0xfff4e6, 3.2);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -150, right: 150, top: 150, bottom: -150, near: 1, far: 1400 });
sun.shadow.bias = -0.0004;
scene.add(sun, sun.target);
const lamp = new THREE.SpotLight(0xffffff, 40, 45, 0.6, 0.5);
lamp.target.position.set(0, 0, -1);
camera.add(lamp, lamp.target);

const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(13.9, 16, 16), new THREE.MeshBasicMaterial({ color: 0xffffff }));
const earth = new THREE.Mesh(new THREE.SphereGeometry(36.5, 48, 48), new THREE.MeshStandardMaterial({ color: 0x6fa8ff, roughness: 1 }));
scene.add(sunDisc, earth);
const starPos = new Float32Array(4000 * 3);
for (let i = 0; i < 4000; i++) { const v = new THREE.Vector3().randomDirection().multiplyScalar(20000); starPos.set([v.x, Math.abs(v.y), v.z], i * 3); }
scene.add(new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(starPos, 3)), new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, sizeAttenuation: false })));

const arrayPos = new THREE.Vector3(14, heightAt(14, 6) + 12, 6);

function regolithTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d')!, n = document.createElement('canvas');
  for (const [s, a] of [[16, 1], [64, 0.6], [256, 0.35]] as const) {
    n.width = n.height = s;
    const ng = n.getContext('2d')!, id = ng.createImageData(s, s);
    for (let i = 0; i < s * s; i++) { const v = 90 + Math.random() * 165; id.data.set([v, v, v, 255], i * 4); }
    ng.putImageData(id, 0, 0); g.globalAlpha = a; g.drawImage(n, 0, 0, 512, 512);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(175, 175); t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function patch(size: number, segs: number, yOff: number, mat: THREE.Material, hole = 0) {
  const g = new THREE.PlaneGeometry(size, size, segs, segs).rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, heightAt(p.getX(i), p.getZ(i)) + yOff);
  if (hole) {
    const idx = g.index!.array, keep: number[] = [];
    for (let i = 0; i < idx.length; i += 3) {
      const cx = (p.getX(idx[i]) + p.getX(idx[i + 1]) + p.getX(idx[i + 2])) / 3, cz = (p.getZ(idx[i]) + p.getZ(idx[i + 1]) + p.getZ(idx[i + 2])) / 3;
      if (Math.abs(cx) > hole || Math.abs(cz) > hole) keep.push(idx[i], idx[i + 1], idx[i + 2]);
    }
    g.setIndex(keep);
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true; scene.add(m);
}

function buildWorld() {
  const tex = regolithTexture();
  patch(700, 600, 0, new THREE.MeshStandardMaterial({ color: 0x9a968f, map: tex, bumpMap: tex, bumpScale: 3, roughness: 1 }));
  patch(8000, 200, -0.6, new THREE.MeshStandardMaterial({ color: 0x4f4c48, roughness: 1 }), 340);

  const rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0x5b5853, roughness: 1 }), 1500);
  const d = new THREE.Object3D(); let n = 0;
  for (let i = 0; i < 1500; i++) {
    const x = (rand(i, 1, 99) - 0.5) * 600, z = (rand(i, 2, 99) - 0.5) * 600;
    if (Math.hypot(x, z) < 22) continue;
    const s = 0.12 + rand(i, 3, 99) ** 3 * 1.7;
    d.position.set(x, heightAt(x, z) + s * 0.25, z);
    d.rotation.set(rand(i, 4, 99) * 6, rand(i, 5, 99) * 6, 0); d.scale.set(s, s * 0.7, s * (0.7 + rand(i, 6, 99) * 0.6));
    d.updateMatrix(); rocks.setMatrixAt(n++, d.matrix);
  }
  rocks.count = n; rocks.castShadow = rocks.receiveShadow = true; scene.add(rocks);

  const metal = new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.55, metalness: 0.4 });
  const panel = new THREE.MeshStandardMaterial({ color: 0x14224a, roughness: 0.3, metalness: 0.6 });
  const add = (m: THREE.Mesh, x: number, y: number, z: number) => { m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; scene.add(m); return m; };
  const gy = heightAt(0, 0);
  for (const z of [-6, 6]) {
    add(new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 12, 24), metal), 0, gy + 3.1, z).rotation.z = Math.PI / 2;
    add(new THREE.Mesh(new THREE.SphereGeometry(3, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), metal), 6, gy + 3.1, z).rotation.z = -Math.PI / 2;
  }
  add(new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.5, 8), metal), 0, gy + 1.5, 0);
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 24, 8), metal), 14, heightAt(14, 6) + 11, 6);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.15, 10, 10), panel), 14, arrayPos.y + 5, 6);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.15, 10, 10), panel), 14, arrayPos.y - 5, 6);
}

// ---------- sim ----------
const sim = new Sim();
let simMs = Date.now();
const startMs = simMs;
let flare = 'NONE', sunLive = false;

// ---------- controls ----------
let yaw = 0, pitch = 0, vy = 0, onGround = true, locked = false;
const keys = new Set<string>();
const intro = document.getElementById('intro')!, enter = document.getElementById('enter') as HTMLButtonElement;
enter.addEventListener('click', () => { renderer.domElement.requestPointerLock(); intro.classList.add('leaving'); });
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
  if (!locked) { enter.textContent = 'RESUME'; intro.classList.remove('leaving'); }
});
addEventListener('mousemove', (e) => { if (!locked) return; yaw -= e.movementX * 0.0022; pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * 0.0022)); });
addEventListener('keydown', (e) => keys.add(e.code));
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ---------- HUD ----------
const hud = document.getElementById('hud')!;
const cls = (v: boolean, bad = false) => (v ? (bad ? 'bad' : 'warn') : 'ok');
const row = (k: string, v: string, c = 'ok') => `<div class="row"><span class="k">${k}</span><span class="${c}">${v}</span></div>`;
function drawHud(az: number, el: number) {
  const day = MISSION_DAY0 + Math.floor((simMs - startMs) / 86400000);
  const o2Days = sim.o2Kg / (SIM.crew * SIM.o2KgPerCrewDay);
  hud.innerHTML = `<h1>PROJECT SHACKLETON</h1>` +
    row('SIM CLOCK', new Date(simMs).toISOString().slice(0, 16).replace('T', ' ') + ' UTC') + row('MISSION DAY', String(day)) +
    row('SUN EL / AZ', `${(el * 57.2958).toFixed(2)}° / ${(az * 57.2958).toFixed(0)}°`) +
    row('SUN DATA', sunLive ? 'JPL HORIZONS' : 'APPROXIMATE', sunLive ? 'ok' : 'warn') +
    row('ARRAY', sim.sunlit ? 'SUNLIT' : 'SHADOW', sim.sunlit ? 'ok' : 'bad') +
    row('POWER GEN / LOAD', `${sim.genKw.toFixed(1)} / ${SIM.loadKw.toFixed(1)} kW`, cls(sim.genKw < SIM.loadKw)) +
    row('BATTERY', `${((sim.batteryKwh / SIM.batteryCapKwh) * 100).toFixed(1)} %`, cls(sim.batteryKwh < SIM.batteryCapKwh * 0.25, sim.batteryKwh <= 0)) +
    row('O2 RESERVE', `${sim.o2Kg.toFixed(0)} kg · ${o2Days.toFixed(0)} d`, cls(o2Days < 60, o2Days < 15)) +
    row('CO2', `${sim.co2.toFixed(2)} mmHg`, cls(sim.co2 > 3, sim.co2 > 6)) +
    row('CREW DOSE', `${sim.doseMsv.toFixed(3)} mSv`, cls(sim.radMult > 1)) +
    row('FLARES (3 D)', flare, cls(sim.radMult > 1)) +
    row('COMMS DELAY', `${SIM.commsDelayS.toFixed(2)} s one-way`);
}

// ---------- loop ----------
const clock = new THREE.Clock();
let hudT = 0, litT = 0;
const fwd = new THREE.Vector3(), rgt = new THREE.Vector3(), mv = new THREE.Vector3(), sd = new THREE.Vector3();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  simMs += dt * SIM.timeRate * 1000;
  sim.step(dt * SIM.timeRate);
  const date = new Date(simMs), s = bodyDir('sun', date), e = bodyDir('earth', date);
  sunLive = s.live; sd.set(s.x, s.y, s.z);

  if (locked) {
    const speed = keys.has('ShiftLeft') ? 6 : 3;
    fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw)); rgt.set(Math.cos(yaw), 0, -Math.sin(yaw)); mv.set(0, 0, 0);
    if (keys.has('KeyW')) mv.add(fwd); if (keys.has('KeyS')) mv.sub(fwd);
    if (keys.has('KeyD')) mv.add(rgt); if (keys.has('KeyA')) mv.sub(rgt);
    if (mv.lengthSq() > 0) mv.normalize().multiplyScalar(speed * dt);
    camera.position.x = Math.max(-280, Math.min(280, camera.position.x + mv.x));
    camera.position.z = Math.max(-280, Math.min(280, camera.position.z + mv.z));
    if (keys.has('Space') && onGround) { vy = 2.6; onGround = false; }
  }
  vy -= G * dt; camera.position.y += vy * dt;
  const floor = heightAt(camera.position.x, camera.position.z) + EYE;
  if (camera.position.y <= floor) { camera.position.y = floor; vy = 0; onGround = true; }
  camera.rotation.set(pitch, yaw, 0, 'YXZ');

  sun.position.copy(camera.position).addScaledVector(sd, 600);
  sun.target.position.copy(camera.position);
  sunDisc.position.copy(camera.position).addScaledVector(sd, 3000);
  earth.position.copy(camera.position).add(new THREE.Vector3(e.x, e.y, e.z).multiplyScalar(3000));

  litT += dt; hudT += dt;
  if (litT > 0.25) { litT = 0; sim.sunlit = isSunlit(arrayPos, sd); }
  if (hudT > 0.25) { hudT = 0; drawHud(s.az, s.el); }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ---------- boot ----------
const bootEl = document.getElementById('boot')!;
function log(text: string) {
  const li = document.createElement('li'); li.textContent = text; li.dataset.s = '...'; bootEl.append(li);
  return (status: string, c: string) => { li.dataset.s = status; li.className = c; };
}
(async () => {
  const dEph = log('JPL HORIZONS · SUN AND EARTH EPHEMERIS');
  const dFl = log('NASA DONKI · SOLAR FLARE ACTIVITY');
  const dTer = log('GENERATING LUNAR TERRAIN');
  const pEph = loadEphemeris().then((ok) => dEph(ok ? 'LIVE' : 'FALLBACK', ok ? 'ok' : 'warn'));
  const pFl = fetch('/api/space-weather', { signal: AbortSignal.timeout(15000) }).then((r) => r.json()).then((d) => {
    if (d.error) throw new Error(d.error);
    flare = d.strongest ?? 'NONE'; sim.setFlareClass(d.strongest ?? null); dFl(flare === 'NONE' ? 'QUIET' : 'ACTIVE ' + flare, 'ok');
  }).catch(() => dFl('OFFLINE', 'warn'));
  await new Promise((r) => setTimeout(r, 60));
  buildWorld(); dTer('READY', 'ok');
  await Promise.all([pEph, pFl]);
  enter.disabled = false; enter.textContent = 'ENTER THE OUTPOST';
  frame();
})();
