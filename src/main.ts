import { inject } from '@vercel/analytics';
import { Crew, setCrewObstacles } from './crew';
import { CrewTalk } from './crewtalk';
import * as THREE from 'three';
import { heightAt, isSunlit, rand, loadTerrain, getSite } from './terrain';
import { buildExterior, propBlocked, propHit } from './exterior';
import { Rover } from './rover';
import { buildRocks, ROCK_CAP } from './rocks';
import { bodyDir, loadEphemeris } from './ephemeris';
import { Sim, SIM, JOBS, type JobId } from './sim';
import { Hab, WALL_H, CAP_H } from './hab';
import { Player } from './player';
import { Comms, type Link } from './comms';
import { Director } from './events';
import { UI, ensureAudio, beep, rumble, boom, hiss } from './ui';
import { Fx } from './fx';
import { Storm } from './storm';

// Initialize Vercel Web Analytics (production only: the inject script 404s when served by vite dev)
if (import.meta.env.PROD) inject();

const MISSION_DAY0 = 214, EYE = 1.7, G = 1.62;

// ?quality=low: for weak GPUs — no MSAA (fixed at context creation, so it must be chosen up front), 1024 sun shadow
// every third frame, dimmer reflections and a lower render scale. ?quality=ultra (interior cube shadows) lives in hab.ts.
const QLOW = /[?&]quality=low\b/.test(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: !QLOW, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
// a lost WebGL context (heavy GPU load while switching tabs/windows) used to leave the page frozen for good:
// acknowledge the loss and reload cleanly instead of spinning dead frames forever
renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); console.warn('[gl] context lost, reloading the outpost'); window.setTimeout(() => location.reload(), 1500); }, false);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;   // the sun is a point source in vacuum: shadows are hard-edged, not soft studio blobs
renderer.shadowMap.autoUpdate = false;   // shadow maps refresh at half rate (see frame()): the sun barely moves and one frame of latency in a hatch swing is invisible
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.36;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();

// ---------- image-based lighting: a procedural lunar environment (black sky, one hard sun glare, a bright regolith
// floor and a faint earthglow) run through PMREM. Without this, every metal, foil and glass surface in the scene
// renders as flat matte paint; with it, gold foil, steel trim, portholes and windscreens pick up real reflections.
{
  const env = new THREE.Scene();
  // regolith bounce: a big, fairly bright grey floor with a soft hotspot, not a uniform void
  const ground = new THREE.Mesh(
    new THREE.SphereGeometry(100, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x565149, side: THREE.BackSide })
  );
  env.add(ground);
  // the sun: a small intensely bright disc plus a broad faint halo (lunar glare is harsh and unfiltered)
  const sunBlob = new THREE.Mesh(
    new THREE.SphereGeometry(4, 16, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  sunBlob.position.set(38, 55, 22); env.add(sunBlob);
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(11, 16, 8),
    new THREE.MeshBasicMaterial({ color: 0x3f3f4d })
  );
  halo.position.copy(sunBlob.position); env.add(halo);
  // earthshine: a cool dim glow opposite the sun so shadow sides are not dead black
  const earthGlow = new THREE.Mesh(
    new THREE.SphereGeometry(9, 16, 8),
    new THREE.MeshBasicMaterial({ color: 0x1c2f4d })
  );
  earthGlow.position.set(-55, 18, -30); env.add(earthGlow);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(env, 0.04).texture;
  scene.environmentIntensity = QLOW ? 0.15 : 0.4; // reflections without washing the shadow sides milky
}
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 45000);
camera.position.set(-1.5, heightAt(0, 0) + EYE, 0.5);
scene.add(camera);
const amb = new THREE.AmbientLight(0x39485c, 0.19); // earthshine and regolith bounce only: shadow sides stay deep, not milky
scene.add(amb);
let ambK = 0.19;
const sun = new THREE.DirectionalLight(0xfff4e6, 4.0);
sun.castShadow = true;
sun.shadow.mapSize.set(QLOW ? 1024 : 2048, QLOW ? 1024 : 2048);   // 2048 over the ±150 m box still resolves hab and rover edges; 4096 cost 4x the fill for nothing the eye saw
Object.assign(sun.shadow.camera, { left: -150, right: 150, top: 150, bottom: -150, near: 1, far: 1400 });
sun.shadow.bias = -0.0004;
scene.add(sun, sun.target);
const lamp = new THREE.SpotLight(0xffffff, 40, 45, 0.6, 0.5);
lamp.castShadow = !QLOW; lamp.shadow.mapSize.set(1024, 1024); lamp.shadow.camera.far = 30; lamp.shadow.bias = -0.0005; lamp.visible = false; // helmet lamp: on only outside, in the suit; 30 m far plane keeps the rock field out of its depth pass
lamp.target.position.set(0, 0, -1);
camera.add(lamp, lamp.target);

const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(13.9, 16, 16), new THREE.MeshBasicMaterial({ color: 0xffffff }));
const earth = new THREE.Mesh(new THREE.SphereGeometry(36.5, 48, 48), new THREE.MeshStandardMaterial({ color: 0x6fa8ff, roughness: 1 }));
scene.add(sunDisc, earth);
const starPos = new Float32Array(4000 * 3);
for (let i = 0; i < 4000; i++) { const v = new THREE.Vector3().randomDirection().multiplyScalar(20000); starPos.set([v.x, Math.abs(v.y), v.z], i * 3); }
{   // three magnitude classes: the real sky is a handful of bright points over a faint dust of dim ones
  const starGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const mk = (n: number, size: number, opacity: number) => {
    const g = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(starPos.subarray(0, n * 3), 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size, sizeAttenuation: false, transparent: true, opacity, depthWrite: false })));
  };
  void starGeo;
  mk(120, 2.6, 0.95); mk(900, 1.8, 0.75); mk(4000, 1.1, 0.45);
}

const arrayPos = new THREE.Vector3(14, heightAt(14, 6) + 12, 6);

function regolithCanvas() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d')!, n = document.createElement('canvas');
  for (const [s, a] of [[16, 1], [64, 0.6], [256, 0.35]] as const) {
    n.width = n.height = s;
    const ng = n.getContext('2d')!, id = ng.createImageData(s, s);
    for (let i = 0; i < s * s; i++) { const v = 90 + Math.random() * 165; id.data.set([v, v, v, 255], i * 4); }
    ng.putImageData(id, 0, 0); g.globalAlpha = a; g.drawImage(n, 0, 0, 512, 512);
  }
  return c;
}
/** one shared regolith canvas so every tile samples the SAME noise: the whole floor reads as one continuous surface.
 *  aniso scales with the tile: the near floor is seen at grazing angles and needs it, the distant rings do not. */
function regolithTexture(c: HTMLCanvasElement, repeat: number, aniso: number) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); t.anisotropy = Math.min(aniso, renderer.capabilities.getMaxAnisotropy()); t.colorSpace = THREE.SRGBColorSpace;
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
  // one regolith material family for every tile: same colour, same texture, same bump, only the repeat changes with the
  // patch size, so the near tile, the 10 km ring and the 41 km far tile light up as one continuous floor. The tile edges
  // used to read as a lighting mismatch: flat dark untextured rings beside a bright textured tile.
  const regCanvas = regolithCanvas();
  const tileMat = (repeat: number, aniso: number) => {
    const t = regolithTexture(regCanvas, repeat, aniso);
    return new THREE.MeshStandardMaterial({ color: 0x9a968f, map: t, bumpMap: t, bumpScale: 3, roughness: 1 });
  };
  // cell sizes are 2 m / 46 m / 128 m: the LOLA data itself is 5 m/px near and 20 m/px far, so finer tessellation bought
  // nothing but vertex cost. 1.45M triangles of floor became about 0.55M, and the distant rings stopped sampling a
  // 16x-aniso bump map across half the screen.
  patch(700, 352, 0, tileMat(175, 16));   // the near tile: 2 m cells, 4 m texture period
  patch(10240, 224, -0.15, tileMat(2560, 4), 340);   // the 10 km near tile at 46 m cells, same 4 m texture period; only a 15 cm tuck under the near tile so there is no z-fight in the overlap and no visible step at the seam
  patch(41000, 320, -0.35, tileMat(2050, 2), 5100);   // the far tile (about 41 km) at 128 m cells: the whole crater bowl, floor and far wall; coarser 20 m texture period so it does not alias at that distance

  // rocks: shared displaced icosahedra (no two identical), each tinted per instance from grey to dusty brown,
  // with a pitted, mottled rock texture — flat single-colour blobs read as painted balls
  const rockGeo = new THREE.IcosahedronGeometry(1, 1);
  {
    const p = rockGeo.attributes.position, v = new THREE.Vector3(), seen = new Map<string, number>();
    for (let i = 0; i < p.count; i++) {
      v.set(p.getX(i), p.getY(i), p.getZ(i));
      const k = `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
      let j = seen.get(k);
      if (j === undefined) { j = 0.82 + Math.random() * 0.36; seen.set(k, j); }   // same jitter for shared corners so faces stay welded
      v.multiplyScalar(j); p.setXYZ(i, v.x, v.y, v.z);
    }
    rockGeo.computeVertexNormals();
  }
  const rockTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d')!;
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 256);
    for (const [s, a] of [[4, 0.25], [16, 0.2], [64, 0.12]] as const) {
      const n = document.createElement('canvas'); n.width = n.height = s;
      const ng = n.getContext('2d')!, id = ng.createImageData(s, s);
      for (let i = 0; i < s * s; i++) { const v = 110 + Math.random() * 130; id.data.set([v, v * 0.985, v * 0.94, 255], i * 4); }
      ng.putImageData(id, 0, 0); g.globalAlpha = a; g.drawImage(n, 0, 0, 256, 256);
    }
    g.globalAlpha = 1;
    for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(70,66,60,${0.15 + Math.random() * 0.3})`; g.beginPath(); g.arc(Math.random() * 256, Math.random() * 256, 0.5 + Math.random() * 2.5, 0, 7); g.fill(); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  })();
  const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ map: rockTex, roughness: 1, metalness: 0 }), ROCK_CAP);
  const d = new THREE.Object3D(), rc = new THREE.Color(); let n = 0;
  for (const r of buildRocks()) {
    d.position.set(r.x, r.y, r.z); d.rotation.set(r.rx, r.ry, 0); d.scale.set(r.s, r.sy, r.sz); d.updateMatrix();
    rocks.setMatrixAt(n, d.matrix);
    rc.setHSL(0.08 + Math.random() * 0.04, 0.04 + Math.random() * 0.09, 0.3 + Math.random() * 0.16);   // grey to dusty brown, never the same twice
    rocks.setColorAt(n, rc);
    n++;
  }
  rocks.count = n; rocks.castShadow = rocks.receiveShadow = true; scene.add(rocks);

  const gy = heightAt(0, 0);
  hab = new Hab(scene, gy);
  crew = new Crew(scene, heightAt, hab);
  crewTalk = new CrewTalk(crew, camera, {
    houston: (t) => comms.voiceSend(t), world: crewWorld, jobs: crewJobs, startJob: crewStartJob, lastLog: () => sim.log[sim.log.length - 1]?.text ?? '',
    canChat: () => started && locked && !comms.isOpen && !ui.isTabletOpen,
    panelLine: (name, text, me) => comms.crewLog(name, text, me),
    openPanel: (target, mode) => openComms('suit', target, mode),
  });
  crew.jobProbe = () => sim.job?.id ?? null;
  hab.onComms = () => openComms('hab');
  dishPos.set(0, gy + WALL_H + CAP_H + 0.9, 0);
  arrayPos.set(14, heightAt(14, 6) + 12, 6);
  buildExterior(scene, heightAt, arrayPos);
  setCrewObstacles(() => (rover ? [{ x: rover.x, z: rover.z, r: 5.6 }] : []));
  rover = new Rover(scene, (x, z, r) => (hab ? hab.solid(x, z, r) : false) || propHit(x, z, r), () => dishPos);
  rover.onRadio = () => openComms('rover');
  camera.position.y = heightAt(camera.position.x, camera.position.z) + EYE;
  // The interior point-light cube shadow (six depth passes of everything within 14 m, every other frame) is now opt-in
  // from hab.ts with ?quality=ultra: it was the single biggest constant frame cost on weak GPUs.
}

// ---------- sim ----------
const sim = new Sim();
const dir = new Director(sim);
const storm = new Storm(scene);
const fx = new Fx(scene, heightAt, arrayPos, { boom, hiss });
(earth.material as THREE.MeshStandardMaterial).fog = false;
const shakeOff = new THREE.Vector3(); let prevQuake = 0, prevLock = false, recallT = 0;
let hab: Hab | null = null;
let crew: Crew | null = null;
let crewTalk: CrewTalk | null = null;
let rover: Rover | null = null;
let started = false;
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
  if (sim.blackoutLeft > 0) return { up: false, reason: `SOLAR RADIO BURST. BLACKOUT FOR ABOUT ${Math.ceil(sim.blackoutLeft)} MORE HOURS.` };
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
    batteryPct: (sim.batteryKwh / sim.batteryCap) * 100, genKw: sim.genKw, loadKw: sim.loadKw, sunlit: sim.sunlit, o2Kg: sim.o2Kg, o2Days, co2: sim.co2,
    doseMsv: sim.doseMsv, doseRateMsvDay: sim.doseRateMsvH * 24, flare, crew: SIM.crew, alerts: sim.alerts().map((a) => a.text).join('; '), pressureKpa: sim.pressureKpa, tempC: sim.tempC, health: sim.health, ppO2: sim.ppO2,
    location: hab?.where ?? '', suit: hab?.suitState ?? '', suitHours: hab?.suitHours ?? 0, earthElDeg: earthEl * 57.2958,
  };
}
/** the base as the crew know it: status line, plus which repair jobs can start right now (a busy crew can be pulled off a job by an order) */
function crewWorld() {
  const t = telemetry(), bits = [`sol ${t.missionDay}`, `battery ${t.batteryPct.toFixed(0)}%`, `solar ${t.genKw.toFixed(1)} kW against a ${t.loadKw.toFixed(1)} kW load${t.sunlit ? '' : ' (in shadow)'}`, `cabin ${t.pressureKpa.toFixed(0)} kPa and ${t.tempC.toFixed(0)} C`, `O2 ${t.ppO2.toFixed(1)} kPa`, `CO2 ${t.co2.toFixed(1)} mmHg`, `dust on the array ${(sim.dust * 100).toFixed(0)}%`];
  if (t.alerts) bits.push(`alerts: ${t.alerts}`);
  if (sim.job) bits.push(`the repair crew is busy: ${JOBS[sim.job.id].name}, ${sim.job.left.toFixed(1)} h left`);
  return bits.join('; ');
}
const BUSY = 'CREW BUSY WITH ANOTHER TASK';
function crewJobs() { return (Object.keys(JOBS) as JobId[]).map((id) => { const why = sim.canStart(id); return { id, ok: !why || why === BUSY, why: why && why !== BUSY ? why : '' }; }); }
function crewStartJob(id: string) { const why = sim.canStart(id as JobId); if (why && why !== BUSY) return why; return sim.startJob(id as JobId, true); }
const comms = new Comms({
  mic: (target) => { if (target === 'crew') { void crewTalk?.toggleMic('crew'); return; } comms.warmLink(); void crewTalk?.toggleMic('houston'); },
  crewText: (t) => void crewTalk?.converse(t),
  crewAmbient: () => crewTalk?.ambient ?? true, setCrewAmbient: (v) => { if (crewTalk) crewTalk.ambient = v; },
  crewHandsFree: () => crewTalk?.handsFree ?? true, setCrewHandsFree: (v) => { if (crewTalk) crewTalk.handsFree = v; },
  caption: (name, text, me) => crewTalk?.caption(name, text, me),
  telemetry, link, now: () => new Date(simMs), delayS: () => SIM.commsDelayS,
  onClose: () => { renderer.domElement.requestPointerLock(); },
  rover: { telemetry: () => rover?.telemetry(), link: () => rover?.habLink() ?? { up: false, dist: 0, reason: 'THERE IS NO ROVER.' }, occupied: () => !!rover && rover.inside },
});

// ---------- controls ----------
let yaw = -Math.PI / 2, pitch = 0, vy = 0, onGround = true, locked = false;
const keys = new Set<string>();
const intro = document.getElementById('intro')!, enter = document.getElementById('enter') as HTMLButtonElement;
/** show the intro/pause overlay. It is hidden with display:none after the first fade (its star animation keeps the
 *  compositor busy), so bringing it back has to clear that inline style too — otherwise an alt-tab / tab switch that
 *  dropped pointer lock left the game with no RESUME screen at all: "stuck, does not recover". */
const showIntro = () => { intro.style.display = ''; intro.classList.remove('leaving'); };
const hideIntro = () => { intro.classList.add('leaving'); window.setTimeout(() => { if (intro.classList.contains('leaving')) intro.style.display = 'none'; }, 1300); };
enter.addEventListener('click', () => { started = true; ensureAudio(); window.setTimeout(() => void crewTalk?.greet(), 3500); renderer.domElement.requestPointerLock(); hideIntro(); });
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
  if (locked) hideIntro();
  else if (!comms.isOpen && !ui.isTabletOpen) { enter.textContent = 'RESUME'; showIntro(); keys.clear(); }
});
renderer.domElement.addEventListener('click', () => { if (!locked && !comms.isOpen && !ui.isTabletOpen) renderer.domElement.requestPointerLock(); });
// browsers rate-limit re-locking right after an exit (e.g. closing the comms console with Tab): when the automatic
// relock is refused, fall back to the pause screen instead of leaving an unlocked game with no way back in
document.addEventListener('pointerlockerror', () => { if (!locked && !comms.isOpen && !ui.isTabletOpen) { enter.textContent = 'RESUME'; showIntro(); } });
function openComms(mode: 'hab' | 'rover' | 'suit' = 'suit', target: 'houston' | 'crew' = 'houston', commMode: 'voice' | 'text' = 'voice') { keys.clear(); document.exitPointerLock(); comms.open(mode, target, mode === 'hab' && target === 'houston' ? 'text' : commMode); }
addEventListener('mousemove', (e) => { if (!locked) return; yaw -= e.movementX * 0.0022; pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * 0.0022)); });
addEventListener('keydown', (e) => {
  if (e.code === 'Tab') e.preventDefault();   // Tab closes comms; never let it move browser focus mid-game
  ensureAudio();
  // the mic keys keep working while the comms console is open, and a recording always answers ESC first
  if (crewTalk?.recording) {
    if (e.code === 'Escape') { crewTalk.cancel(); return; }
    if ((e.code === 'KeyV' || e.code === 'KeyB') && !e.repeat) { void crewTalk.toggleMic(e.code === 'KeyV' ? 'crew' : 'houston'); return; }
  }
  if (comms.isOpen) {
    if (e.code === 'Escape' || e.code === 'Tab') { comms.close(); return; }
    if (!e.repeat && (e.code === 'KeyB' || e.code === 'KeyV')) { if (e.code === 'KeyB') comms.warmLink(); void crewTalk?.toggleMic(e.code === 'KeyB' ? 'houston' : 'crew'); return; }
    return;
  }
  const dg = e.code.startsWith('Digit') ? +e.code.slice(5) : 0;
  if (dir.active && dg >= 1 && dg <= dir.active.choices.length) { dir.resolve(dg - 1); return; }
  if (dir.active && e.code === 'KeyH') { ui.ask(); return; }
  if (e.code === 'KeyH' && !e.repeat) { helpEl.classList.toggle('on'); return; }   // key help: what every key does, one panel
  if (e.code === 'Escape' && helpEl.classList.contains('on')) helpEl.classList.remove('on');
  if (ui.isTabletOpen) { if (e.code === 'KeyM' || e.code === 'Escape') ui.close(); return; }
  keys.add(e.code);
  if (e.code === 'Escape' && crewTalk?.recording) crewTalk.cancel();
  if (!locked) return;
  if (e.code === 'KeyV' && !e.repeat) { void crewTalk?.toggleMic(); return; }
  if (e.code === 'KeyT' && !e.repeat) { e.preventDefault(); openComms('suit', 'crew', 'text'); return; }   // the comms console on the crew text channel
  if (e.code === 'KeyB' && !e.repeat) { comms.warmLink(); void crewTalk?.toggleMic('houston'); return; }   // the mic opens at once; the Earth link warms up in parallel
  if (e.code === 'KeyE') { if (rover?.hasPrompt) rover.press(); else hab?.press(); }
  if (e.code === 'KeyF' && locked && !e.repeat) hab?.press2();
  else if (e.code === 'KeyL' && rover?.inside) rover.toggleLights();
  else if (e.code === 'KeyX' && rover?.mode === 'driving') rover.toggleParkBrake();
  else if (e.code === 'KeyR' && rover?.mode === 'driving') rover.onRadio?.();
  else if (e.code === 'KeyC' && !e.repeat) { if (rover?.inside) rover.onRadio?.(); else comms.toggle(); }   // the comms console: Houston or Crew, then Voice or Text
  else if (e.code === 'KeyM') { keys.clear(); document.exitPointerLock(); ui.open(); }
  else if (e.code === 'KeyP') sim.setArray(sim.arrayMode === 'deployed' ? 'retracted' : 'deployed');
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ---------- HUD ----------
const taskEl = document.getElementById('task')!, taskLbl = taskEl.querySelector('.lbl')!, taskBar = taskEl.querySelector('i') as HTMLElement, visorEl = document.getElementById('visor')!;
const promptEl = document.getElementById('prompt')!, toastEl = document.getElementById('toast')!;
const helpEl = document.getElementById('help')!;
const lookDir = new THREE.Vector3();
const wrapPi = (a: number) => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
const ui = new UI({
  sim, dir, openComms: () => openComms(), clockText: () => new Date(simMs).toISOString().slice(0, 16).replace('T', ' ') + ' UTC', flare: () => flare,
  onTabletClose: () => { renderer.domElement.requestPointerLock(); },
});
// one fixed clock; it eases to 60x by itself while a decision card is open or someone is on EVA, so nothing outruns the player
function clockRate() { const slow = dir.active || hab?.busy || hab?.suitOn || sim.cmdExposed || rover?.inside || rover?.busy; return slow ? 60 : SIM.timeRate; }


// ---------- loop ----------
const clock = new THREE.Clock();
let litT = 0, bobT = 0, frameN = 0;
// adaptive resolution: the render scale floats between 0.6 and the device cap, so a weak GPU sheds pixels instead of
// frames. 0.6 was 0.75: on a machine 3x over budget, shedding 44% of the pixels still left it 2x over; 0.6 sheds 64%.
const prCap = renderer.getPixelRatio();
let pr = Math.min(prCap, QLOW ? 0.75 : 1), msAvg = 16, prWall = 0;   // start low on purpose: a weak GPU gets its first seconds smooth, a strong one climbs to its cap
const fwd = new THREE.Vector3(), rgt = new THREE.Vector3(), mv = new THREE.Vector3(), sd = new THREE.Vector3();
// dev-only diagnostic hook (renderer.info / render scale / test teleports; never ships to production)
if (import.meta.env.DEV) (window as any).__diag = {
  info: () => ({ ...renderer.info.render, programs: renderer.info.programs?.length, ...renderer.info.memory }),
  pr: () => pr,
  lights: () => {
    let pl = 0, sl = 0, dl = 0, cast = 0;
    scene.traverseVisible((o: any) => { if (o.isLight) { if (o.isPointLight) { pl++; if (o.castShadow) cast++; } else if (o.isSpotLight) sl++; else if (o.isDirectionalLight) dl++; } });
    return { point: pl, spot: sl, dir: dl, pointShadow: cast };
  },
  scene: () => {
    let meshes = 0, mats = new Set<any>(), tris = 0, casts = 0;
    scene.traverseVisible((o: any) => { if (o.isMesh || o.isPoints || o.isLine) { meshes++; mats.add(o.material); casts += o.castShadow ? 1 : 0; const g = o.geometry; if (g && o.isMesh) tris += (g.index ? g.index.count : g.attributes.position.count) / 3 * ((o as any).count ?? 1); } });
    return { meshes, materials: mats.size, tris: Math.round(tris), shadowCasters: casts };
  },
  tele: (x: number, z: number, yawTo = -Math.PI / 2, pitchTo = 0) => { camera.position.set(x, heightAt(x, z) + EYE, z); yaw = yawTo; pitch = pitchTo; vy = 0; },
  cam: () => camera,
  culled: () => {   // replicate three.js frustum culling: what this camera would actually submit this frame
    camera.updateMatrixWorld(); camera.updateProjectionMatrix();
    const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    let calls = 0, tris = 0, casts = 0;
    const bs = new THREE.Sphere();
    scene.traverseVisible((o: any) => {
      if (o.isMesh || o.isPoints || o.isLine) {
        const g = o.geometry;
        if (g) { if (!g.boundingSphere) g.computeBoundingSphere(); bs.copy(g.boundingSphere).applyMatrix4(o.matrixWorld); }
        if (!g || fr.intersectsSphere(bs)) { calls++; if (o.isMesh) tris += (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.count ?? 1); if (o.castShadow) casts++; }
      }
    });
    return { visibleObjects: calls, tris: Math.round(tris), visibleShadowCasters: casts };
  },
  tele: (x: number, z: number, yawTo = -Math.PI / 2, pitchTo = 0) => { camera.position.set(x, heightAt(x, z) + EYE, z); yaw = yawTo; pitch = pitchTo; vy = 0; },
};

// ---------- performance governor ----------
// Sustained slow frames (not a single hitch) trip a lighter render: shadow map halves, depth pass drops to every third
// frame, reflections dim. It reverts on its own after three consecutive fast checks, so a passing load spike does not
// leave the game looking flat for good. MSAA cannot be dropped after context creation — that is ?quality=low's job.
// Every timer here runs on wall-clock time: dt is clamped at 50 ms, and on a machine running 2 fps a dt-based
// timer would need a minute of wall time to tick 2 s. The same fix is applied to the render-scale adjuster.
let perfMode = QLOW, perfWall = 0, perfCool = 0, shadowEvery = QLOW ? 3 : 2;
let wallT = 0, lastWall = performance.now();
function perfNote(text: string) {
  const n = document.createElement('div');
  n.textContent = text;
  n.style.cssText = 'position:fixed;bottom:64px;left:50%;transform:translateX(-50%);z-index:4;padding:7px 16px;font:11px ui-monospace,Menlo,Consolas,monospace;letter-spacing:.2em;color:#aebac9;background:rgba(5,7,10,.8);border:1px solid rgba(79,216,255,.45);border-radius:6px;pointer-events:none;transition:opacity 1s';
  document.body.append(n);
  window.setTimeout(() => { n.style.opacity = '0'; window.setTimeout(() => n.remove(), 1100); }, 5000);
}
function setPerfMode(on: boolean) {
  perfMode = on;
  sun.shadow.mapSize.set(on ? 1024 : 2048, on ? 1024 : 2048);
  if (sun.shadow.map) { sun.shadow.map.dispose(); (sun.shadow as any).map = null; }   // force a re-alloc at the new size
  shadowEvery = on ? 3 : 2;
  lamp.castShadow = !on;
  scene.environmentIntensity = on ? 0.15 : 0.4;
  perfNote(on ? 'PERFORMANCE MODE · LIGHTER SHADOWS AND REFLECTIONS' : 'FULL GRAPHICS RESTORED');
}
/** the frame body. frame() schedules the next tick FIRST and wraps this in try/catch, so no single exception
 *  (a lost GL context, a NaN, anything) can ever stop the loop for good: the game recovers on the next tick. */
function frame() {
  requestAnimationFrame(frame);
  try { stepFrame(); } catch (err) { console.error('[frame]', err); }
}
function stepFrame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const nowWall = performance.now(); wallT += Math.min(nowWall - lastWall, 250); lastWall = nowWall;   // real elapsed time, capped so a hidden tab cannot jump the timers
  frameN++;
  renderer.shadowMap.needsUpdate = frameN % shadowEvery === 0;   // half-rate shadows: the whole depth-pass load (sun + interior cube maps + helmet lamp) costs half
  camera.position.sub(shakeOff); shakeOff.set(0, 0, 0);
  const running = started && (locked || comms.isOpen || ui.isTabletOpen), w = clockRate(), dtSim = running ? dt * w : 0;
  simMs += dtSim * 1000; sim.cmdExposed = hab?.exposed ?? false;
  if (running) sim.quakeS = Math.max(0, sim.quakeS - dt);
  if (sim.quakeS > 0 && prevQuake === 0) rumble(sim.quakeS); prevQuake = sim.quakeS;
  sim.step(dtSim); dir.frame(dtSim / 3600, running ? dt : 0); ui.frame(dt);
  camera.getWorldDirection(lookDir);
  if (hab) {
    hab.shelter = !!rover && rover.inside;
    hab.update(dt, Math.min(dtSim, dt * 60), camera.position, sim, lookDir);
    const alertOn = sim.shelter || !!sim.lockdown;
    crew?.setAlert(alertOn); sim.crewOutside = crew?.outside ?? 0;      // every astronaut hauls back to the hab
    if (running) crew?.update(dt, camera.position);
    crewTalk?.update(dt);
    hab.lockdown = !!sim.lockdown; hab.alarm = sim.fire > 0 || sim.batteryHazard > 0.5;
    const away = hab.exposed || hab.where === 'SURFACE' || hab.where === 'ROVER CABIN';
    if (alertOn && away && running) { recallT -= dt; if (recallT <= 0) { beep('recall'); recallT = 2; } ui.banner('RETURN TO THE HAB NOW'); }
    else if (sim.lockdown) { recallT = 0; ui.banner(`LOCKDOWN · ${sim.lockdown.reason} · HATCHES SEALED`, 'calm'); }
    else if (sim.shelter) { recallT = 0; ui.banner(crew && !crew.allIn ? 'STORM SHELTER · CREW COMING IN' : 'STORM SHELTER · CREW SAFE', 'calm'); }
    else { recallT = 0; ui.banner(null); }
    if (sim.lockdown && !prevLock && locked && !comms.isOpen) { keys.clear(); document.exitPointerLock(); ui.open(); }   // all eyes on the systems
    prevLock = !!sim.lockdown;
    visorEl.classList.toggle('on', hab.suitOn);
  }
  if (rover && hab) {
    const r = rover.update(dt, Math.min(dtSim, dt * 60), { player: camera.position, suitOn: hab.suitOn, keys, sim, hab: dishPos, look: lookDir });
    yaw += r.dHeading;
    if (rover.pendingExit) { camera.position.x = rover.pendingExit.x; camera.position.z = rover.pendingExit.y; camera.position.y = heightAt(camera.position.x, camera.position.z) + EYE; vy = 0; yaw = rover.heading + Math.PI; rover.pendingExit = null; }
  }
  {
    const pr = rover?.prompt || hab?.prompt || '', tt = rover?.toast || hab?.toast || '', busy = !!(rover?.busy || hab?.busy);
    promptEl.textContent = pr; promptEl.style.display = pr && locked ? 'block' : 'none';
    toastEl.textContent = tt; toastEl.style.display = tt ? 'block' : 'none';
    taskEl.style.display = busy ? 'block' : 'none';
    if (busy) { const o = rover?.busy ? rover : hab!; taskLbl.textContent = o.taskLabel; taskBar.style.width = (o.taskProgress * 100).toFixed(1) + '%'; }
  }
  const date = new Date(simMs), s = bodyDir('sun', date), e = bodyDir('earth', date);
  sunLive = s.live; sd.set(s.x, s.y, s.z); earthDir.set(e.x, e.y, e.z); earthEl = e.el;
  const inRover = !!rover && rover.inside, inside = (hab ? hab.inHab(camera.position.x, camera.position.z) : false) || inRover;
  ambK += ((inside ? 0.1 : 0.19) - ambK) * Math.min(1, dt * 3); amb.intensity = ambK;
  storm.update(dt, camera.position, sim.lockdown?.storm ?? (sim.stormWarn ? 0.45 : 0), !inside);
  fx.update(running ? dt : 0, camera.position, sim); hab && (hab.flicker = Math.min(1, fx.shake * 1.1));
  const spR = sim.spe && sim.t >= sim.spe.arrive ? Math.min(1, sim.speRateUnshielded() / 8) : 0; ui.setRad(spR * (inside && sim.shelter ? 0.3 : 1), dt);
  crew?.setSymptom(sim.symptom?.kind ?? null, sim.symptom?.n ?? 0);

  const px0 = camera.position.x, pz0 = camera.position.z;
  { const pu = crew?.takePush(); if (pu && (pu.x || pu.z) && !(hab && hab.blocked(camera.position.x + pu.x, camera.position.z + pu.z)) && !propBlocked(camera.position.x + pu.x, camera.position.z + pu.z)) { camera.position.x += pu.x; camera.position.z += pu.z; } }
  if (locked && !hab?.busy && !rover?.busy && rover?.mode !== 'driving') {
    const lk = !!sim.lockdown, base = (hab?.exposed ? 1.7 : 1.4) * (lk ? 0.6 : 1), speed = keys.has('ShiftLeft') && !lk ? base * 1.9 : base;   // lockdown: walking pace only   // a person in a suit does not sprint
    fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw)); rgt.set(Math.cos(yaw), 0, -Math.sin(yaw)); mv.set(0, 0, 0);
    if (keys.has('KeyW')) mv.add(fwd); if (keys.has('KeyS')) mv.sub(fwd);
    if (keys.has('KeyD')) mv.add(rgt); if (keys.has('KeyA')) mv.sub(rgt);
    if (mv.lengthSq() > 0) mv.normalize().multiplyScalar(speed * dt);
    const nx = Math.max(-280, Math.min(280, camera.position.x + mv.x)), nz = Math.max(-280, Math.min(280, camera.position.z + mv.z));
    if (rover?.mode === 'cabin') rover.walk(mv.x, mv.z);
    else {
      const blk = (x: number, z: number) => (hab ? hab.blocked(x, z) : false) || propBlocked(x, z) || (rover ? rover.blocks(x, z) : false);
      if (!blk(nx, camera.position.z)) camera.position.x = nx;
      if (!blk(camera.position.x, nz)) camera.position.z = nz;
    }
    if (!inRover && !sim.lockdown && keys.has('Space') && onGround && !(hab && hab.inHab(camera.position.x, camera.position.z))) { vy = 2.2; onGround = false; }
  }
  if (inRover && rover) {
    rover.cameraPos(camera.position); vy = 0; onGround = true;
    if (rover.mode === 'driving') { const base = rover.heading - Math.PI / 2; yaw = base + Math.max(-2.2, Math.min(2.2, wrapPi(yaw - base))); pitch = Math.max(-1.0, Math.min(0.9, pitch)); }
  } else {
    vy -= G * dt; camera.position.y += vy * dt;
    const floor = heightAt(camera.position.x, camera.position.z) + EYE;
    if (camera.position.y <= floor) { camera.position.y = floor; vy = 0; onGround = true; }
  }
  const vel = inRover ? 0 : Math.hypot(camera.position.x - px0, camera.position.z - pz0) / Math.max(dt, 1e-4);
  bobT += vel * dt * 2.1; const bk = onGround ? Math.min(1, vel / 1.2) : 0;
  camera.rotation.set(pitch + Math.sin(bobT * 2) * 0.0045 * bk, yaw, Math.sin(bobT) * 0.0035 * bk, 'YXZ');
  if (inRover && rover) {
    camera.quaternion.premultiply(rover.tiltQ); // the cabin pitches and rolls with the terrain
    const sh = rover.shake * (rover.mode === 'driving' ? 1 : 0.5), t = performance.now() / 1000;
    if (sh > 0.001) { camera.rotateX(Math.sin(t * 41) * 0.012 * sh + Math.sin(t * 17.3) * 0.01 * sh); camera.rotateZ(Math.sin(t * 29) * 0.014 * sh); camera.position.y += Math.sin(t * 53) * 0.025 * sh; }
  }
  lamp.visible = !!hab && hab.exposed && hab.suitOn;
  player.setHeld(hab?.held ?? null); player.setSpray(!!hab?.spraying);
  player.update(dt, camera.position, yaw, vel, onGround, !!hab?.suitOn, !!hab?.exposed);

  sun.position.copy(camera.position).addScaledVector(sd, 600);
  sun.target.position.copy(camera.position);
  sunDisc.position.copy(camera.position).addScaledVector(sd, 3000);
  earth.position.copy(camera.position).addScaledVector(earthDir, 3000);

  litT += dt;
  if (started) {   // steer the render scale toward ~50-75 fps; touch the drawing buffer only when the bucket actually changes
    msAvg += (dt * 1000 - msAvg) * Math.min(1, dt * 0.75);
    if (wallT - prWall > 1) {
      prWall = wallT;
      const want = msAvg > 21 ? pr - 0.25 : msAvg < 13.5 ? pr + 0.25 : pr;
      const np = Math.max(0.6, Math.min(prCap, want));
      if (np !== pr) { pr = np; renderer.setPixelRatio(pr); renderer.setSize(innerWidth, innerHeight); }
    }
    if (wallT - perfWall > 2) {
      perfWall = wallT;
      if (!perfMode && msAvg > 30) setPerfMode(true);
      else if (perfMode && !QLOW && msAvg < 13) { if (++perfCool >= 3) { perfCool = 0; setPerfMode(false); } }   // three fast checks in a row before restoring quality
      else perfCool = 0;
    }
  }
  if (litT > 0.25) { litT = 0; sim.sunlit = isSunlit(arrayPos, sd); earthVisible = earthEl > 0.003 && isSunlit(dishPos, earthDir); }
  if (fx.shake > 0.01) { const a = 0.16 * fx.shake; shakeOff.set((Math.random() - 0.5) * a, (Math.random() - 0.5) * a * 0.7, (Math.random() - 0.5) * a); camera.position.add(shakeOff); camera.rotation.x += (Math.random() - 0.5) * 0.035 * fx.shake; camera.rotation.z += (Math.random() - 0.5) * 0.06 * fx.shake; }
  // the intro/pause overlay is fully opaque: rendering a million triangles behind it is pure waste. It still renders
  // during the fade-out (.leaving) and whenever the overlay is down, so nothing ever pops in on screen.
  if (intro.style.display === 'none' || intro.classList.contains('leaving')) renderer.render(scene, camera);
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

  // ---------- GPU budget check ----------
  // MSAA and the other context-level settings are fixed the moment the WebGL context is created: a machine too weak
  // for them can never drop them at runtime — the adaptive scale and the perf governor only shed pixels and shadows.
  // So the only honest cure for a weak GPU is to KNOW before the first frame: render the real scene a dozen times
  // while the boot screen (still opaque) hides it — the render loop is not running yet, so nothing doubles up — and
  // if the median frame is over 33 ms this machine restarts once with ?quality=low, remembered in localStorage.
  // This runs while the ephemeris and space-weather fetches are still in flight, so it costs no extra boot time.
  // ?quality=high in the address bar clears the stored verdict and forces full quality for good.
  {
    const qGiven = /[?&]quality=(low|high|ultra)\b/.exec(location.search)?.[1] ?? null;
    let verdict = qGiven;
    try { if (!verdict) verdict = localStorage.getItem('shack-gpu'); } catch { /* private mode: re-check every boot */ }
    if (qGiven) { try { localStorage.setItem('shack-gpu', qGiven); } catch { /* not stored: this session only */ } }
    if (!verdict) {
      const dG = log('GPU CAPABILITY CHECK');
      const t: number[] = [];
      try { for (let i = 0; i < 12; i++) { const a = performance.now(); renderer.render(scene, camera); t.push(performance.now() - a); } } catch { /* a failed render falls through to the default path */ }
      const mid = t.length > 4 ? [...t.slice(2)].sort((a, b) => a - b)[Math.floor((t.length - 2) / 2)] : 16;   // drop the two compile-heavy warm-up frames, take the median
      verdict = mid > 33 ? 'low' : 'high';
      try { localStorage.setItem('shack-gpu', verdict); } catch { /* not stored: re-check next boot */ }
      dG(verdict === 'low' ? 'WEAK · LIGHT MODE' : 'OK', verdict === 'low' ? 'warn' : 'ok');
    }
    if (verdict === 'low' && !QLOW) {
      // the stored verdict is only meaningful with the light WebGL context, which is created at page load:
      // restart once with ?quality=low (the URL param also keeps the verdict visible and overridable)
      const u = new URL(location.href); u.searchParams.set('quality', 'low');
      await new Promise((r) => setTimeout(r, 600));   // let the verdict on the boot screen be read for a moment
      location.replace(u.href);
      return;   // this page is about to be replaced: never unlock ENTER on it
    }
  }

  await Promise.all([pEph, pFl]);
  enter.disabled = false; enter.textContent = 'ENTER THE OUTPOST';
  frame();
})();
