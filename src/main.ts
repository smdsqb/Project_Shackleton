import * as THREE from 'three';
import { heightAt, isSunlit, rand, loadTerrain, getSite } from './terrain';
import { buildExterior, propBlocked } from './exterior';
import { bodyDir, loadEphemeris } from './ephemeris';
import { Sim, SIM } from './sim';
import { Hab, WALL_H, CAP_H } from './hab';
import { Comms, type Link } from './comms';
import { Rover } from './rover';

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

  const gy = heightAt(0, 0);
  hab = new Hab(scene, gy);
  hab.onComms = openComms;
  dishPos.set(0, gy + WALL_H + CAP_H + 0.9, 0);
  arrayPos.set(14, heightAt(14, 6) + 12, 6);
  buildExterior(scene, heightAt, arrayPos);
  // LSR-1 Lunar Surface Rover: parked on the sintered pad, just off Airlock 1's outer hatch,
  // so the EVA traverse from the hab door to the rover door is short.
  rover = new Rover(scene, heightAt, 9.5, 4.2, sim);
  camera.position.y = heightAt(camera.position.x, camera.position.z) + EYE;
}

// ---------- sim ----------
const sim = new Sim();
let hab: Hab | null = null;
let rover: Rover | null = null;
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
  if (SIM.commsAlwaysOn) return { up: true, reason: '' };
  // When the player is in the rover, the relay path is LSR-1 UHF -> Hab dish -> Earth.
  // The Hab side of that chain must already be up, or there is no link at all.
  if (rover?.inRover) {
    if (rover.batteryKwh <= 0.05) return { up: false, reason: 'LSR-1 BATTERY DEPLETED.' };
    if (!rover.hasHabLink) return { up: false, reason: 'NO UHF LINE OF SIGHT TO THE HAB DISH.' + (rover.distHab < 250 ? '' : ' ROVER HAS DRIVEN BEYOND RELAY RANGE.') };
    if (!(sim.batteryKwh > 0 || sim.genKw >= SIM.loadKw)) return { up: false, reason: 'HAB COMMS RACK HAS NO POWER.' };
    if (!earthVisible) return { up: false, reason: (earthEl > 0.003 ? 'EARTH IS MASKED BY TERRAIN FROM THE HAB.' : 'EARTH IS BELOW THE LUNAR HORIZON.') + nextAos() };
    return { up: true, reason: '' };
  }
  if (!(sim.batteryKwh > 0 || sim.genKw >= SIM.loadKw)) return { up: false, reason: 'THE COMMS RACK HAS NO POWER.' };
  if (!earthVisible) return { up: false, reason: (earthEl > 0.003 ? 'EARTH IS MASKED BY TERRAIN.' : 'EARTH IS BELOW THE LUNAR HORIZON.') + nextAos() };
  return { up: true, reason: '' };
}
function telemetry() {
  const o2Days = sim.o2Kg / (SIM.crew * SIM.o2KgPerCrewDay);
  const base = {
    missionDay: MISSION_DAY0 + Math.floor((simMs - startMs) / 86400000), simTime: new Date(simMs).toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    batteryPct: (sim.batteryKwh / SIM.batteryCapKwh) * 100, genKw: sim.genKw, loadKw: SIM.loadKw, sunlit: sim.sunlit, o2Kg: sim.o2Kg, o2Days, co2: sim.co2,
    doseMsv: sim.doseMsv, doseRateMsvDay: SIM.surfaceDoseMsvPerDay * SIM.habShield * sim.radMult, flare, crew: SIM.crew,
    location: hab?.where ?? '', suit: hab?.suitState ?? '', earthElDeg: earthEl * 57.2958,
  };
  if (rover?.inRover) {
    // LSR-1 telemetry is sent through the Hab relay. CAPCOM should see the rover fields.
    return {
      ...base,
      location: `LSR-1 · ${rover.where}`,
      suit: 'EVA · SEALED',
      roverSpeed: rover.speed,
      roverOdometer: rover.odometer,
      roverBatteryPct: rover.batteryPct,
      roverDistHab: rover.distHab,
      roverArm: rover.armStage,
      roverCabinKpa: rover.lockP,
      relayPath: 'LSR-1 UHF -> HAB DISH -> EARTH',
    };
  }
  return base;
}
const comms = new Comms({
  telemetry, link, now: () => new Date(simMs), delayS: () => SIM.commsDelayS,
  onClose: () => { renderer.domElement.requestPointerLock(); },
});

// ---------- controls ----------
let yaw = -Math.PI / 2, pitch = 0, vy = 0, onGround = true, locked = false;
const keys = new Set<string>();
const intro = document.getElementById('intro')!, enter = document.getElementById('enter') as HTMLButtonElement;
enter.addEventListener('click', () => { renderer.domElement.requestPointerLock(); intro.classList.add('leaving'); });
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
  if (!locked && !comms.isOpen) { enter.textContent = 'RESUME'; intro.classList.remove('leaving'); keys.clear(); }
});
renderer.domElement.addEventListener('click', () => { if (!locked && !comms.isOpen && intro.classList.contains('leaving')) renderer.domElement.requestPointerLock(); });
function openComms() { keys.clear(); document.exitPointerLock(); comms.open(); }
addEventListener('mousemove', (e) => { if (!locked) return; yaw -= e.movementX * 0.0022; pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * 0.0022)); });
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (!locked) return;
  if (e.code === 'KeyE') {
    // If the player is in the rover, E always exits. Otherwise, prefer the rover door prompt
    // when the player is near it (so they don't have to fight the hab prompt), else fall back to the hab.
    if (rover?.inRover) rover.press();
    else if (rover && rover.prompt && !rover.busy) rover.press();
    else hab?.press();
  } else if (e.code === 'KeyR' && rover?.inRover) {
    rover.toggleArm();
  } else if (e.code === 'KeyF' && rover?.inRover && !comms.isOpen) {
    // Open the comms terminal from the rover cockpit. The link() and telemetry() above already
    // report rover-mode data while inRover is true, so the terminal behaves as a rover relay.
    openComms();
  }
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ---------- HUD ----------
const taskEl = document.getElementById('task')!, taskLbl = taskEl.querySelector('.lbl')!, taskBar = taskEl.querySelector('i') as HTMLElement, visorEl = document.getElementById('visor')!;
const hud = document.getElementById('hud')!, promptEl = document.getElementById('prompt')!, toastEl = document.getElementById('toast')!;
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
    row('COMMS DELAY', `${SIM.commsDelayS.toFixed(2)} s one-way`) +
    row('EARTH LINK', SIM.commsAlwaysOn ? 'ONLINE · 24x7 TEST MODE' : link().up ? 'ACQUIRED' : 'LOS', link().up ? 'ok' : 'bad') +
    row('EARTH IN VIEW', earthVisible ? `YES · EL ${(earthEl * 57.2958).toFixed(1)}°` : 'NO · LINE OF SIGHT BLOCKED', earthVisible ? 'ok' : 'warn') +
    (rover?.inRover ? rover.status().map(([k, v, c]) => row(k, v, c)).join('') : '') +
    (hab ? hab.status().map(([k, v, c]) => row(k, v, c)).join('') : '');
}

// ---------- loop ----------
const clock = new THREE.Clock();
let hudT = 0, litT = 0;
const fwd = new THREE.Vector3(), rgt = new THREE.Vector3(), mv = new THREE.Vector3(), sd = new THREE.Vector3();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  simMs += dt * SIM.timeRate * 1000;
  sim.step(dt * SIM.timeRate);
  if (hab) {
    hab.update(dt, dt * SIM.timeRate, camera.position, sim);
    visorEl.classList.toggle('on', hab.suitOn);
  }
  if (rover) {
    // The rover needs the sun direction for its solar array, the player position for proximity prompts,
    // and the key set + mouse-look yaw for driving. While the player is in the rover, WASD drives the rover
    // and the camera is locked to the cockpit, so we DON'T run the walking block below in that case.
    rover.update(dt, dt * SIM.timeRate, camera.position, sim, keys, yaw, sd);
    promptEl.textContent = rover.inRover ? rover.prompt : (rover.prompt || hab?.prompt || '');
    promptEl.style.display = promptEl.textContent && locked ? 'block' : 'none';
    const toast = rover.inRover ? rover.toast : (rover.toast || hab?.toast || '');
    toastEl.textContent = toast; toastEl.style.display = toast ? 'block' : 'none';
    const busy = rover.inRover ? rover.busy : (rover.busy || hab?.busy || false);
    taskEl.style.display = busy ? 'block' : 'none';
    if (busy) { const lbl = rover.inRover ? rover.taskLabel : (rover.taskLabel || hab?.taskLabel || ''); const prog = rover.inRover ? rover.taskProgress : (rover.taskProgress || hab?.taskProgress || 0);
      taskLbl.textContent = lbl; taskBar.style.width = (prog * 100).toFixed(1) + '%'; }
    if (rover.inRover) {
      // place the camera at the cockpit each frame, oriented along the rover heading + the player's mouse-look yaw
      const cockpit = new THREE.Vector3(); rover.cockpitCameraPosition(cockpit);
      camera.position.copy(cockpit);
      // mouse-look yaw is the player's view direction inside the cockpit; rover.heading is the drive direction.
      // We add them so the player can look around within the cockpit freely while driving forward.
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
    } else {
      // when the player is not in the rover, the hab code path runs and may also be showing a prompt
      if (hab) {
        promptEl.textContent = rover.prompt || hab.prompt;
        toastEl.textContent = rover.toast || hab.toast;
        taskEl.style.display = (rover.busy || hab.busy) ? 'block' : 'none';
        if (rover.busy || hab.busy) { taskLbl.textContent = rover.taskLabel || hab.taskLabel; taskBar.style.width = ((rover.taskProgress || hab.taskProgress || 0) * 100).toFixed(1) + '%'; }
        visorEl.classList.toggle('on', hab.suitOn);
      }
    }
  } else if (hab) {
    hab.update(dt, dt * SIM.timeRate, camera.position, sim);
    promptEl.textContent = hab.prompt; promptEl.style.display = hab.prompt && locked ? 'block' : 'none';
    toastEl.textContent = hab.toast; toastEl.style.display = hab.toast ? 'block' : 'none';
    taskEl.style.display = hab.busy ? 'block' : 'none';
    if (hab.busy) { taskLbl.textContent = hab.taskLabel; taskBar.style.width = (hab.taskProgress * 100).toFixed(1) + '%'; }
    visorEl.classList.toggle('on', hab.suitOn);
  }
  const date = new Date(simMs), s = bodyDir('sun', date), e = bodyDir('earth', date);
  sunLive = s.live; sd.set(s.x, s.y, s.z); earthDir.set(e.x, e.y, e.z); earthEl = e.el;
  const inside = hab ? hab.inHab(camera.position.x, camera.position.z) : false;
  ambK += ((inside || (rover?.inRover ?? false) ? 0.1 : 0.35) - ambK) * Math.min(1, dt * 3); amb.intensity = ambK;

  // walking movement is skipped while the player is in the rover (the rover drives instead)
  if (locked && !hab?.busy && !rover?.busy && !(rover?.inRover)) {
    const speed = keys.has('ShiftLeft') ? 6 : 3;
    fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw)); rgt.set(Math.cos(yaw), 0, -Math.sin(yaw)); mv.set(0, 0, 0);
    if (keys.has('KeyW')) mv.add(fwd); if (keys.has('KeyS')) mv.sub(fwd);
    if (keys.has('KeyD')) mv.add(rgt); if (keys.has('KeyA')) mv.sub(rgt);
    if (mv.lengthSq() > 0) mv.normalize().multiplyScalar(speed * dt);
    const nx = Math.max(-280, Math.min(280, camera.position.x + mv.x)), nz = Math.max(-280, Math.min(280, camera.position.z + mv.z));
    const blk = (x: number, z: number) => (hab ? hab.blocked(x, z) : false) || propBlocked(x, z) || (rover ? rover.blocked(x, z) : false);
    if (!blk(nx, camera.position.z)) camera.position.x = nx;
    if (!blk(camera.position.x, nz)) camera.position.z = nz;
    if (keys.has('Space') && onGround && !(hab && hab.inHab(camera.position.x, camera.position.z))) { vy = 2.6; onGround = false; }
  }
  if (!(rover?.inRover)) {
    vy -= G * dt; camera.position.y += vy * dt;
    const floor = heightAt(camera.position.x, camera.position.z) + EYE;
    if (camera.position.y <= floor) { camera.position.y = floor; vy = 0; onGround = true; }
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
  }

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
