import * as THREE from 'three';
import { heightAt, isSunlit, rand, loadTerrain, getSite } from './terrain';
import { buildExterior, propBlocked } from './exterior';
import { bodyDir, loadEphemeris } from './ephemeris';
import { Sim, SIM } from './sim';
import { Hab, WALL_H, CAP_H } from './hab';
import { Player } from './player';
import { Comms, type Link } from './comms';
import { Director } from './events';
import { UI, WARPS, ensureAudio } from './ui';

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
camera.position.set(-1.5, heightAt(0, 0) + EYE, 0.5);
scene.add(camera);
const amb = new THREE.AmbientLight(0x39485c, 0.35); // earthshine and regolith bounce; dropped inside the hab so interior light is not flat
scene.add(amb);
let ambK = 0.35;
const sun = new THREE.DirectionalLight(0xfff4e6, 3.2);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -150, right: 150, top: 150, bottom: -150, near: 1, far: 1400 });
sun.shadow.bias = -0.0004;
scene.add(sun, sun.target);
const lamp = new THREE.SpotLight(0xffffff, 40, 45, 0.6, 0.5);
lamp.castShadow = true; lamp.shadow.mapSize.set(1024, 1024); lamp.shadow.bias = -0.0005; lamp.visible = false; // helmet lamp: on only outside, in the suit
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
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(175, 175); t.anisotropy = renderer.capabilities.getMaxAnisotropy(); t.colorSpace = THREE.SRGBColorSpace;
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

  const gy = heightAt(0, 0);
  hab = new Hab(scene, gy);
  hab.onComms = openComms;
  hab.shelterLabel = () => (sim.cmdSheltered ? '[E] LEAVE THE STORM SHELTER' : sim.spe ? '[E] TAKE COVER IN THE STORM SHELTER' : '[E] STORM SHELTER');
  hab.shelterToggle = () => { sim.cmdSheltered = !sim.cmdSheltered; return sim.cmdSheltered ? 'YOU ARE IN THE STORM SHELTER' : 'YOU LEFT THE STORM SHELTER'; };
  dishPos.set(0, gy + WALL_H + CAP_H + 0.9, 0);
  arrayPos.set(14, heightAt(14, 6) + 12, 6);
  buildExterior(scene, heightAt, arrayPos);
  camera.position.y = heightAt(camera.position.x, camera.position.z) + EYE;
  // ULTRA by default. Add ?quality=high to the address to drop the interior light shadows if the frame rate suffers.
  if (/[?&]quality=high\b/.test(location.search)) scene.traverse((o) => { if ((o as THREE.PointLight).isPointLight) o.castShadow = false; });
}

// ---------- sim ----------
const sim = new Sim();
const dir = new Director(sim);
let hab: Hab | null = null;
let warp = 60, started = false;
const player = new Player(scene, camera);
let simMs = Date.now();
const startMs = simMs;
let flare = 'NONE', sunLive = false;
const earthDir = new THREE.Vector3(1, 0, 0); let earthEl = 0.07, earthVisible = true;
const dishPos = new THREE.Vector3();

function nextAos(): string {
  const now = simMs;
  for (let i = 1; i <= 1440; i++) { const e = bodyDir('earth', new Date(now + i * 1800000)); if (!e.live) return ''; if (e.el > 0.003) return ` NEXT ACQUISITION IN ABOUT ${Math.max(1, Math.round((i * 0.5)))} H (SIM TIME).`; }
  return '';
}
function link(): Link {
  if (!sim.antennaOk) return { up: false, reason: 'THE ANTENNA GIMBAL IS JAMMED. NO LINK UNTIL IT IS REPAIRED.' };
  if (SIM.commsAlwaysOn) return { up: true, reason: '' };
  if (!(sim.batteryKwh > 0 || sim.genKw >= sim.loadKw)) return { up: false, reason: 'THE COMMS RACK HAS NO POWER.' };
  if (!earthVisible) return { up: false, reason: (earthEl > 0.003 ? 'EARTH IS MASKED BY TERRAIN.' : 'EARTH IS BELOW THE LUNAR HORIZON.') + nextAos() };
  return { up: true, reason: '' };
}
function telemetry() {
  const o2Days = sim.o2Days;
  return {
    missionDay: MISSION_DAY0 + Math.floor(sim.t / 24), simTime: new Date(simMs).toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    batteryPct: (sim.batteryKwh / SIM.batteryCapKwh) * 100, genKw: sim.genKw, loadKw: sim.loadKw, sunlit: sim.sunlit, o2Kg: sim.o2Kg, o2Days, co2: sim.co2,
    doseMsv: sim.doseMsv, doseRateMsvDay: sim.doseRateMsvH * 24, flare, crew: SIM.crew, alerts: sim.alerts().map((a) => a.text).join('; '), pressureKpa: sim.pressureKpa, tempC: sim.tempC, health: sim.health, ppO2: sim.ppO2,
    location: hab?.where ?? '', suit: hab?.suitState ?? '', suitHours: hab?.suitHours ?? 0, earthElDeg: earthEl * 57.2958,
  };
}
const comms = new Comms({
  telemetry, link, now: () => new Date(simMs), delayS: () => SIM.commsDelayS,
  onClose: () => { renderer.domElement.requestPointerLock(); },
  onPad: (open, lines, live) => player.setPad(lines, live && open),
});

// ---------- controls ----------
let yaw = -Math.PI / 2, pitch = 0, vy = 0, onGround = true, locked = false;
const keys = new Set<string>();
const intro = document.getElementById('intro')!, enter = document.getElementById('enter') as HTMLButtonElement;
enter.addEventListener('click', () => { started = true; ensureAudio(); renderer.domElement.requestPointerLock(); intro.classList.add('leaving'); });
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
  if (!locked && comms.padOpen) comms.closePad();
  if (!locked && !comms.isOpen && !ui.isTabletOpen) { enter.textContent = 'RESUME'; intro.classList.remove('leaving'); keys.clear(); }
});
renderer.domElement.addEventListener('click', () => { if (!locked && !comms.isOpen && !ui.isTabletOpen && intro.classList.contains('leaving')) renderer.domElement.requestPointerLock(); });
function openComms() { keys.clear(); document.exitPointerLock(); comms.open(); }
addEventListener('mousemove', (e) => { if (!locked) return; yaw -= e.movementX * 0.0022; pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * 0.0022)); });
addEventListener('keydown', (e) => {
  if (comms.isOpen) return;
  ensureAudio();
  const dg = e.code.startsWith('Digit') ? +e.code.slice(5) : 0;
  if (dir.active && dg >= 1 && dg <= dir.active.choices.length) { dir.resolve(dg - 1); return; }
  if (dir.active && e.code === 'KeyH') { ui.ask(); return; }
  if (ui.isTabletOpen) { if (e.code === 'KeyM' || e.code === 'Escape') ui.close(); return; }
  keys.add(e.code);
  if (!locked) return;
  if (e.code === 'KeyE') hab?.press();
  else if (e.code === 'KeyC' && !e.repeat) void comms.togglePad();
  else if (e.code === 'KeyM') { keys.clear(); document.exitPointerLock(); ui.open(); }
  else if (e.code === 'KeyT') setWarp(WARPS[(WARPS.indexOf(warp) + 1) % WARPS.length]);
  else if (e.code === 'KeyP') sim.setArray(sim.arrayMode === 'deployed' ? 'retracted' : 'deployed');
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ---------- HUD ----------
const taskEl = document.getElementById('task')!, taskLbl = taskEl.querySelector('.lbl')!, taskBar = taskEl.querySelector('i') as HTMLElement, visorEl = document.getElementById('visor')!;
const hud = document.getElementById('hud')!, promptEl = document.getElementById('prompt')!, toastEl = document.getElementById('toast')!;
const cls = (v: boolean, bad = false) => (v ? (bad ? 'bad' : 'warn') : 'ok');
const row = (k: string, v: string, c = 'ok') => `<div class="row"><span class="k">${k}</span><span class="${c}">${v}</span></div>`;
const ui = new UI({
  sim, dir, getWarp: () => warp, setWarp: (w) => setWarp(w), openComms: () => openComms(), clockText: () => new Date(simMs).toISOString().slice(0, 16).replace('T', ' ') + ' UTC', flare: () => flare,
  onTabletClose: () => { renderer.domElement.requestPointerLock(); },
});
function setWarp(w: number) { warp = w; }
function effWarp() { const slow = dir.active || hab?.busy || hab?.suitOn || sim.cmdExposed; return Math.min(warp, slow ? 60 : 3600); }
function drawHud(az: number, el: number) {
  const day = MISSION_DAY0 + Math.floor(sim.t / 24), o2Days = sim.o2Days, b = (sim.batteryKwh / SIM.batteryCapKwh) * 100;
  hud.innerHTML = `<h1>PROJECT SHACKLETON</h1>` +
    row('SIM CLOCK', new Date(simMs).toISOString().slice(0, 16).replace('T', ' ') + ' UTC') + row('MISSION DAY', `${day} · ${(sim.t / 24).toFixed(1)} / ${SIM.missionDays}`) + row('TIME WARP', `${effWarp()}x${effWarp() < warp ? ' (limited)' : ''}`, effWarp() > 60 ? 'warn' : 'ok') +
    row('SUN EL / AZ', `${(el * 57.2958).toFixed(2)}° / ${(az * 57.2958).toFixed(0)}°`) +
    row('SUN DATA', sunLive ? 'JPL HORIZONS' : 'APPROXIMATE', sunLive ? 'ok' : 'warn') +
    row('ARRAY', sim.sunlit ? 'SUNLIT' : 'SHADOW', sim.sunlit ? 'ok' : 'bad') +
    row('POWER GEN / LOAD', `${sim.genKw.toFixed(1)} / ${sim.loadKw.toFixed(1)} kW`, cls(sim.genKw < sim.loadKw)) +
    row('BATTERY', `${b.toFixed(1)} %`, cls(b < 25, b < 10)) +
    row('CABIN', `O2 ${sim.ppO2.toFixed(1)} kPa · ${sim.pressureKpa.toFixed(0)} kPa · ${sim.tempC.toFixed(0)} C`, cls(sim.ppO2 < 19.5 || sim.pressureKpa < 95, sim.ppO2 < 17)) +
    row('O2 TANK', `${sim.o2Kg.toFixed(0)} kg · ${o2Days > 900 ? 'steady' : o2Days.toFixed(0) + ' d'}`, cls(o2Days < 40, o2Days < 15)) +
    row('CO2', `${sim.co2.toFixed(2)} mmHg`, cls(sim.co2 > 4, sim.co2 > 6)) +
    row('CREW HEALTH', `${sim.health.toFixed(0)} %`, cls(sim.health < 75, sim.health < 40)) +
    row('CREW DOSE', `${sim.doseMsv.toFixed(2)} mSv · you ${sim.cmdDoseMsv.toFixed(2)}`, cls(sim.doseMsv > 125, sim.doseMsv > 250)) +
    row('FLARES (3 D)', flare, cls(sim.radMult > 1)) +
    row('COMMS DELAY', `${SIM.commsDelayS.toFixed(2)} s one-way`) +
    row('RADIO', comms.padOpen ? 'OPEN · TAB TO CLOSE' : 'PRESS C TO CALL HOUSTON') +
    row('EARTH LINK', SIM.commsAlwaysOn ? 'ONLINE · 24x7 TEST MODE' : link().up ? 'ACQUIRED' : 'LOS', link().up ? 'ok' : 'bad') +
    row('EARTH IN VIEW', earthVisible ? `YES · EL ${(earthEl * 57.2958).toFixed(1)}°` : 'NO · LINE OF SIGHT BLOCKED', earthVisible ? 'ok' : 'warn') +
    (hab ? hab.status().map(([k, v, c]) => row(k, v, c)).join('') : '');
}

// ---------- loop ----------
const clock = new THREE.Clock();
let hudT = 0, litT = 0, bobT = 0;
const fwd = new THREE.Vector3(), rgt = new THREE.Vector3(), mv = new THREE.Vector3(), sd = new THREE.Vector3();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const running = started && (locked || comms.isOpen || ui.isTabletOpen), w = effWarp(), dtSim = running ? dt * w : 0;
  simMs += dtSim * 1000; sim.cmdExposed = hab?.exposed ?? false;
  sim.step(dtSim); dir.frame(dtSim / 3600, running ? dt : 0); ui.frame(dt);
  if (hab) {
    hab.update(dt, Math.min(dtSim, dt * 60), camera.position, sim);
    promptEl.textContent = hab.prompt; promptEl.style.display = hab.prompt && locked ? 'block' : 'none';
    toastEl.textContent = hab.toast; toastEl.style.display = hab.toast ? 'block' : 'none';
    taskEl.style.display = hab.busy ? 'block' : 'none';
    if (hab.busy) { taskLbl.textContent = hab.taskLabel; taskBar.style.width = (hab.taskProgress * 100).toFixed(1) + '%'; }
    visorEl.classList.toggle('on', hab.suitOn);
  }
  const date = new Date(simMs), s = bodyDir('sun', date), e = bodyDir('earth', date);
  sunLive = s.live; sd.set(s.x, s.y, s.z); earthDir.set(e.x, e.y, e.z); earthEl = e.el;
  const inside = hab ? hab.inHab(camera.position.x, camera.position.z) : false;
  ambK += ((inside ? 0.1 : 0.35) - ambK) * Math.min(1, dt * 3); amb.intensity = ambK;

  const px0 = camera.position.x, pz0 = camera.position.z;
  if (locked && !hab?.busy) {
    const base = hab?.exposed ? 1.7 : 1.4, speed = keys.has('ShiftLeft') ? base * 1.9 : base;   // a person in a suit does not sprint
    fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw)); rgt.set(Math.cos(yaw), 0, -Math.sin(yaw)); mv.set(0, 0, 0);
    if (keys.has('KeyW')) mv.add(fwd); if (keys.has('KeyS')) mv.sub(fwd);
    if (keys.has('KeyD')) mv.add(rgt); if (keys.has('KeyA')) mv.sub(rgt);
    if (mv.lengthSq() > 0) mv.normalize().multiplyScalar(speed * dt);
    const nx = Math.max(-280, Math.min(280, camera.position.x + mv.x)), nz = Math.max(-280, Math.min(280, camera.position.z + mv.z));
    const blk = (x: number, z: number) => (hab ? hab.blocked(x, z) : false) || propBlocked(x, z);
    if (!blk(nx, camera.position.z)) camera.position.x = nx;
    if (!blk(camera.position.x, nz)) camera.position.z = nz;
    if (keys.has('Space') && onGround && !(hab && hab.inHab(camera.position.x, camera.position.z))) { vy = 2.2; onGround = false; }
  }
  vy -= G * dt; camera.position.y += vy * dt;
  const floor = heightAt(camera.position.x, camera.position.z) + EYE;
  if (camera.position.y <= floor) { camera.position.y = floor; vy = 0; onGround = true; }
  const vel = Math.hypot(camera.position.x - px0, camera.position.z - pz0) / Math.max(dt, 1e-4);
  bobT += vel * dt * 2.1; const bk = onGround ? Math.min(1, vel / 1.2) : 0;
  camera.rotation.set(pitch + Math.sin(bobT * 2) * 0.0045 * bk, yaw, Math.sin(bobT) * 0.0035 * bk, 'YXZ');
  lamp.visible = !!hab && hab.exposed && hab.suitOn;
  player.update(dt, camera.position, yaw, vel, onGround, !!hab?.suitOn, comms.padOpen, !!hab?.exposed);

  sun.position.copy(camera.position).addScaledVector(sd, 600);
  sun.target.position.copy(camera.position);
  sunDisc.position.copy(camera.position).addScaledVector(sd, 3000);
  earth.position.copy(camera.position).add(new THREE.Vector3(e.x, e.y, e.z).multiplyScalar(3000));

  litT += dt; hudT += dt;
  if (litT > 0.25) { litT = 0; sim.sunlit = isSunlit(arrayPos, sd); earthVisible = earthEl > 0.003 && isSunlit(dishPos, earthDir); }
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
  const dFl = log('NASA CCMC DONKI · SOLAR FLARE ACTIVITY');
  const dDem = log('LRO LOLA · TERRAIN MODEL');
  const dTer = log('BUILDING TERRAIN MESH');
  const pDem = loadTerrain().then((st) => dDem(st, st.startsWith('LOLA') ? 'ok' : 'warn'));
  const pEph = pDem.then(() => loadEphemeris(getSite())).then((ok) => dEph(ok ? 'LIVE' : 'FALLBACK', ok ? 'ok' : 'warn'));
  const pFl = fetch('/api/space-weather', { signal: AbortSignal.timeout(15000) }).then((r) => r.json()).then((d) => {
    if (d.error) throw new Error(d.error);
    flare = d.strongest ?? 'NONE'; sim.setFlareClass(d.strongest ?? null); dFl(flare === 'NONE' ? 'QUIET' : 'ACTIVE ' + flare, 'ok');
  }).catch(() => dFl('OFFLINE', 'warn'));
  await pDem;
  await new Promise((r) => setTimeout(r, 60));
  try { buildWorld(); dTer('READY', 'ok'); } catch (err) { console.error(err); dTer('FAILED', 'warn'); const li = document.createElement('li'); li.textContent = String((err as Error)?.message ?? err).slice(0, 90); li.style.color = '#ff4d4d'; bootEl.append(li); return; }
  await Promise.all([pEph, pFl]);
  enter.disabled = false; enter.textContent = 'ENTER THE OUTPOST';
  frame();
})();
