import * as THREE from 'three';
import { heightAt, isSunlit } from './terrain';
import { sunDirection } from './sun';
import { Sim, SIM } from './sim';

const MISSION_DAY0 = 214;
const EYE = 1.7, G = 1.62;

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 20000);
camera.position.set(0, heightAt(0, 20) + EYE, 20);
scene.add(camera);

scene.add(new THREE.AmbientLight(0x223344, 0.12));
const sun = new THREE.DirectionalLight(0xfff4e6, 3.2);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -150, right: 150, top: 150, bottom: -150, near: 1, far: 800 });
sun.shadow.bias = -0.0004;
scene.add(sun, sun.target);
const lamp = new THREE.SpotLight(0xffffff, 40, 45, 0.6, 0.5);
lamp.position.set(0, 0, 0); lamp.target.position.set(0, 0, -1);
camera.add(lamp, lamp.target);

const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(13.9, 16, 16), new THREE.MeshBasicMaterial({ color: 0xffffff }));
scene.add(sunDisc);
const earth = new THREE.Mesh(new THREE.SphereGeometry(40, 32, 32), new THREE.MeshBasicMaterial({ color: 0x3a78c8 }));
earth.position.set(2200 * Math.sin(0.7), 2200 * Math.tan(0.07), -2200 * Math.cos(0.7)); // placeholder position
scene.add(earth);
const starPos = new Float32Array(3000 * 3);
for (let i = 0; i < 3000; i++) {
  const v = new THREE.Vector3().randomDirection().multiplyScalar(9000);
  starPos.set([v.x, Math.abs(v.y), v.z], i * 3);
}
const starGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(starPos, 3));
scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false })));

// terrain
const N = 300, SIZE = 900;
const tg = new THREE.PlaneGeometry(SIZE, SIZE, N, N).rotateX(-Math.PI / 2);
const pos = tg.attributes.position;
const col = new Float32Array(pos.count * 3);
for (let i = 0; i < pos.count; i++) {
  pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  const t = 0.46 + Math.random() * 0.1;
  col.set([t, t * 0.97, t * 0.93], i * 3);
}
tg.setAttribute('color', new THREE.BufferAttribute(col, 3));
tg.computeVertexNormals();
const terrain = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
terrain.receiveShadow = true;
scene.add(terrain);

// outpost
const metal = new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.55, metalness: 0.4 });
const panelMat = new THREE.MeshStandardMaterial({ color: 0x14224a, roughness: 0.3, metalness: 0.6 });
function add(m: THREE.Mesh, x: number, y: number, z: number) { m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; scene.add(m); return m; }
const gy = heightAt(0, 0);
for (const z of [-6, 6]) {
  const hab = add(new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 12, 24), metal), 0, gy + 3.1, z);
  hab.rotation.z = Math.PI / 2;
  add(new THREE.Mesh(new THREE.SphereGeometry(3, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), metal), 6, gy + 3.1, z).rotation.z = -Math.PI / 2;
}
add(new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.5, 8), metal), 0, gy + 1.5, 0);
const arrayPos = new THREE.Vector3(14, heightAt(14, 6) + 12, 6);
add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 24, 8), metal), 14, heightAt(14, 6) + 11, 6);
add(new THREE.Mesh(new THREE.BoxGeometry(0.15, 10, 10), panelMat), 14, arrayPos.y + 5, 6);
add(new THREE.Mesh(new THREE.BoxGeometry(0.15, 10, 10), panelMat), 14, arrayPos.y - 5, 6);

// ---------- sim + data ----------
const sim = new Sim();
let accel = 600;
let simMs = Date.now();
const startMs = simMs;
fetch('/api/space-weather').then((r) => r.json()).then((d) => sim.setFlareClass(d.strongest ?? null)).catch(() => {});

// ---------- controls ----------
let yaw = 0, pitch = 0, vy = 0, onGround = true, locked = false;
const keys = new Set<string>();
const start = document.getElementById('start')!;
start.addEventListener('click', () => renderer.domElement.requestPointerLock());
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === renderer.domElement; start.style.display = locked ? 'none' : 'flex'; });
addEventListener('mousemove', (e) => { if (!locked) return; yaw -= e.movementX * 0.0022; pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * 0.0022)); });
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'BracketRight') accel = Math.min(86400, accel * 2);
  if (e.code === 'BracketLeft') accel = Math.max(60, accel / 2);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ---------- HUD ----------
const hud = document.getElementById('hud')!;
const cls = (v: boolean, bad = false) => (v ? (bad ? 'bad' : 'warn') : 'ok');
function row(k: string, v: string, c = 'ok') { return `<div class="row"><span class="k">${k}</span><span class="${c}">${v}</span></div>`; }
function drawHud(sd: ReturnType<typeof sunDirection>) {
  const day = MISSION_DAY0 + Math.floor((simMs - startMs) / 86400000);
  const o2Days = sim.o2Kg / (SIM.crew * SIM.o2KgPerCrewDay);
  hud.innerHTML = `<h1>PROJECT SHACKLETON</h1>` +
    row('MISSION DAY', String(day)) + row('TIME RATE', `x${accel}`) +
    row('SUN EL / AZ', `${(sd.el * 57.2958).toFixed(2)}° / ${((sd.az * 57.2958) % 360).toFixed(0)}°`) +
    row('ARRAY', sim.sunlit ? 'SUNLIT' : 'SHADOW', sim.sunlit ? 'ok' : 'bad') +
    row('POWER GEN / LOAD', `${sim.genKw.toFixed(1)} / ${SIM.loadKw.toFixed(1)} kW`, cls(sim.genKw < SIM.loadKw)) +
    row('BATTERY', `${((sim.batteryKwh / SIM.batteryCapKwh) * 100).toFixed(1)} %`, cls(sim.batteryKwh < SIM.batteryCapKwh * 0.25, sim.batteryKwh <= 0)) +
    row('O2 RESERVE', `${sim.o2Kg.toFixed(0)} kg · ${o2Days.toFixed(0)} d`, cls(o2Days < 60, o2Days < 15)) +
    row('CO2', `${sim.co2.toFixed(2)} mmHg`, cls(sim.co2 > 3, sim.co2 > 6)) +
    row('CREW DOSE', `${sim.doseMsv.toFixed(3)} mSv`, cls(sim.radMult > 1)) +
    row('COMMS DELAY', `${SIM.commsDelayS.toFixed(2)} s one-way`);
}

// ---------- loop ----------
const clock = new THREE.Clock();
let hudT = 0, litT = 0;
const fwd = new THREE.Vector3(), rgt = new THREE.Vector3();
let sd = sunDirection(new Date(simMs));
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  simMs += dt * accel * 1000;
  sd = sunDirection(new Date(simMs));
  sim.step(dt * accel);

  if (locked) {
    const speed = keys.has('ShiftLeft') ? 6 : 3;
    fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw)); rgt.set(Math.cos(yaw), 0, -Math.sin(yaw));
    const mv = new THREE.Vector3();
    if (keys.has('KeyW')) mv.add(fwd); if (keys.has('KeyS')) mv.sub(fwd);
    if (keys.has('KeyD')) mv.add(rgt); if (keys.has('KeyA')) mv.sub(rgt);
    if (mv.lengthSq() > 0) mv.normalize().multiplyScalar(speed * dt);
    camera.position.x = Math.max(-420, Math.min(420, camera.position.x + mv.x));
    camera.position.z = Math.max(-420, Math.min(420, camera.position.z + mv.z));
    if (keys.has('Space') && onGround) { vy = 2.6; onGround = false; }
  }
  vy -= G * dt;
  camera.position.y += vy * dt;
  const floor = heightAt(camera.position.x, camera.position.z) + EYE;
  if (camera.position.y <= floor) { camera.position.y = floor; vy = 0; onGround = true; }
  camera.rotation.set(pitch, yaw, 0, 'YXZ');

  sun.position.copy(camera.position).addScaledVector(new THREE.Vector3(sd.x, sd.y, sd.z), 300);
  sun.target.position.copy(camera.position);
  sunDisc.position.copy(camera.position).addScaledVector(new THREE.Vector3(sd.x, sd.y, sd.z), 3000);

  litT += dt; hudT += dt;
  if (litT > 0.25) { litT = 0; sim.sunlit = isSunlit(arrayPos, sd); }
  if (hudT > 0.25) { hudT = 0; drawHud(sd); }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
