import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Sim } from './sim';
import { NASA, panelTexture, tileTexture, cellTexture, crinkleTexture, meatball, plateTexture } from './livery';

// LSR-1 "SHACKLETON" — Lunar Surface Rover
// A six-wheel pressurized-cabin rover modeled on the NASA concept imagery: a white, multi-faceted cabin
// with angular glazed windows, six yellow-hubbed off-road wheels on a rocker-bogie style undercarriage,
// a deployable solar array on the roof, a high-gain dish plus UHF whip antennas, LED floods and headlights,
// a black 6-DOF robotic arm on the starboard side, a rear airlock with a docking collar, and a cockpit the
// player can drive from. While inside, comms route LSR-1 → Hab dish → Earth (DSN). The Hab Earth link is
// still required: if the Hab has no power or Earth is below the horizon, the rover relay is dead too.
// Airlock timings, motor constants and arm geometry are design placeholders.

const P = Math.PI;
const W = 2.4;          // cabin width (across the wheels)
const L = 3.2;          // cabin length (front to rear)
const CABIN_H = 1.9;    // cabin height at the crown
const SKIRT_H = 0.55;   // gold MLI skirt depth below the cabin
const WHEEL_R = 0.52;   // wheel radius (off-road, ~1.04 m diameter — between LRV and SEV)
const WHEEL_W = 0.34;   // wheel width
const TRACK = 2.1;      // wheel separation across the chassis
const WB_F = 1.0;       // front axle distance ahead of cabin centre
const WB_M = 0.0;       // middle axle at cabin centre
const WB_R = -1.1;      // rear axle behind cabin centre
const BATT_KWH = 12, BATT0 = BATT_KWH * 0.93, LOAD_KW = 1.4, ARRAY_KW = 0.72;
const O2_KG = 1.4, O2_USE_KGPH = 0.08;            // cabin O2 reserve and crew draw
const SPEED_MAX = 3.0, ACCEL = 1.3, TURN = 0.85;   // m/s, m/s^2, rad/s
const CABIN_P_KPA = 70;                             // rover cabin pressure (lower than the hab — design choice)
const LOCK_P = 101.3, CYCLE_S = 7;                  // rover airlock cycle to 101.3 kPa in ~7 s
const ENTER_S = 6, EXIT_S = 5;                      // ingress / egress sequence length
const HAB_PAD_R = 60;                               // UHF line-of-sight reach back to the Hab dish, in metres
const ARM_REACH = 1.8;

const ENTER_STAGES = ['CONFIRMING EVA SUIT SEAL', 'OPENING ROVER OUTER HATCH', 'CYCLING ROVER AIRLOCK TO 70 KPA', 'STEPPING THROUGH — INNER HATCH OPEN', 'SEALING INNER HATCH', 'CABIN PRESSURISING'];
const EXIT_STAGES  = ['CONFIRMING EVA SUIT SEAL', 'CABIN AIR BACK TO AIRLOCK', 'OPENING INNER HATCH', 'STEPPING OUT — OUTER HATCH OPEN', 'SEALING OUTER HATCH'];
const ARM_STAGES   = ['STOWED', 'DEPLOYING', 'AT READY', 'EXTENDING', 'SAMPLING', 'STOWING'];

const rbox = (w: number, h: number, d: number, r = 0.04) => new RoundedBoxGeometry(w, h, d, 3, Math.max(0.002, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)));
const mat = (c: number, glow = false, rough = 0.55, metal = 0.1) =>
  new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal, ...(glow ? { emissive: c, emissiveIntensity: 1.4 } : {}) });
const label = (text: string, w = 0.55) =>
  new THREE.Mesh(new THREE.PlaneGeometry(w, (w * 96) / 512), new THREE.MeshBasicMaterial({ map: plateTexture(text) }));

/** Alpha mask for a faceted cabin wall: opaque everywhere except where the angular window is cut through. */
function facetWindowAlpha(cuts: { x0: number; y0: number; x1: number; y1: number; dx: number; dy: number }[]) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, 1024, 512);
  g.fillStyle = '#000';
  // each cut is a pentagon-like facet: a wide lower edge, a narrower upper edge, bevelled sides
  for (const k of cuts) {
    const cx = (k.x0 + k.x1) / 2, halfW = (k.x1 - k.x0) / 2, topW = halfW * k.dx, halfH = (k.y1 - k.y0) / 2, topH = halfH * k.dy;
    g.beginPath();
    g.moveTo(cx - halfW, k.y0);                 // bottom-left
    g.lineTo(cx + halfW, k.y0);                 // bottom-right
    g.lineTo(cx + topW, k.y0 + halfH + topH);   // upper-right (narrower)
    g.lineTo(cx - topW, k.y0 + halfH + topH);   // upper-left
    g.closePath(); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; return t;
}

type Door = { open: boolean; k: number; pivot: THREE.Group; lamp: THREE.MeshBasicMaterial; dir: number };
type Item = { x: number; z: number; reach: number; text: () => string; run: () => string };

export class Rover {
  inRover = false;
  prompt = ''; toast = ''; where = 'PAD';
  taskLabel = ''; taskProgress = 0;
  suitState: 'rack' | 'on' = 'on'; // the rover always expects the player in an EVA suit
  get suitOn() { return this.suitState === 'on'; }
  get busy() { return this.entering || this.exiting; }

  // physical state
  batteryKwh = BATT0;
  o2Kg = O2_KG;
  genKw = 0;
  loadKw = LOAD_KW;
  speed = 0;             // signed m/s, +forward
  odometer = 0;
  heading = 0;           // radians, rover yaw (matches main.ts convention: yaw rotates around Y)
  distHab = 0;
  armStage: 0 | 1 | 2 | 3 | 4 | 5 = 0;
  armLabel = ARM_STAGES[0];
  hasHabLink = true;
  private wheelSpin = 0;        // accumulated wheel rotation for rolling visual
  private steerVis = 0;         // visual steering angle for the front wheels
  private enterT = 0; private exitT = 0; private stage = -1;
  private entering = false; private exiting = false;
  private doorState: Door;
  lockP = CABIN_P_KPA;  // rover airlock current pressure (read by main.ts for telemetry)
  private lockCyc: number | null = null;
  private toastT = 0;
  private clock = 0;

  private root = new THREE.Group();
  private wheels: THREE.Mesh[] = [];
  private steerPivots: THREE.Group[] = [];
  private arm: THREE.Group[] = [];           // base, shoulder, elbow, wrist, tool
  private armTargetT = 0;                    // 0..1 along the deploy arc
  private armT = 0;
  private antennas: { spin: number; obj: THREE.Object3D }[] = [];
  private lamps: { l: THREE.PointLight | THREE.SpotLight; base: number; warm: number }[] = [];
  private glows: { m: THREE.MeshStandardMaterial; base: number }[] = [];
  private driveLight!: THREE.MeshStandardMaterial;
  private hudScreens: { mat: THREE.MeshBasicMaterial; draw: () => string[] }[] = [];
  private items: Item[] = [];
  private best: Item | null = null;
  private parkingSpot: THREE.Vector3;
  private cockpitPos = new THREE.Vector3();
  private doorPos = new THREE.Vector3();

  constructor(scene: THREE.Scene, private heightAt: (x: number, z: number) => number, x: number, z: number, private sim: Sim) {
    this.parkingSpot = new THREE.Vector3(x, heightAt(x, z), z);
    this.root.position.copy(this.parkingSpot);
    this.root.rotation.y = 0;          // rover faces +X by default
    scene.add(this.root);

    // ---- materials, reused everywhere on the body ----
    const white = new THREE.MeshStandardMaterial({ map: panelTexture('#f1f4f7', '#a9b1ba', 4, 2), roughness: 0.42, metalness: 0.22 });
    const whiteRoof = new THREE.MeshStandardMaterial({ map: panelTexture('#eef1f5', '#b3bac3', 6, 3), roughness: 0.4, metalness: 0.22 });
    const gold = new THREE.MeshStandardMaterial({ color: NASA.gold, roughness: 0.32, metalness: 0.85, bumpMap: crinkleTexture(14, 1), bumpScale: 1.4 });
    const frameM = mat(NASA.graphite, false, 0.4, 0.55);
    const steelM = mat(0xb9bfc8, false, 0.3, 0.7);
    const darkM = mat(0x20262e, false, 0.4, 0.6);
    const yellowM = mat(0xf6c61e, false, 0.4, 0.3);    // yellow hubs, matches the imagery
    const rubberM = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95, metalness: 0 });
    const glassM = new THREE.MeshPhysicalMaterial({ color: 0xcfe9ff, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide });

    // helper for placing a mesh in rover-local space
    const mesh = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = this.root, shadow = true) => {
      const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = shadow; o.receiveShadow = true; parent.add(o); return o;
    };
    const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, m: THREE.Material, p: THREE.Object3D = this.root, r = 0.05) =>
      mesh(rbox(sx, sy, sz, r), m, x, y, z, p);

    // ------------------------------------------------------------------
    // CHASSIS: rocker-bogie inspired dark steel frame between the wheels
    // ------------------------------------------------------------------
    const chassisY = WHEEL_R + 0.05;
    box(L + 0.5, 0.18, 0.32, 0, chassisY + 0.05, TRACK / 2 - 0.05, frameM);    // starboard side rail
    box(L + 0.5, 0.18, 0.32, 0, chassisY + 0.05, -(TRACK / 2 - 0.05), frameM); // port side rail
    box(0.32, 0.18, TRACK, -WB_R + 0.4, chassisY + 0.05, 0, frameM);            // rear cross-tube
    box(0.32, 0.18, TRACK, WB_F + 0.2, chassisY + 0.05, 0, frameM);             // front cross-tube
    box(0.32, 0.18, TRACK, 0, chassisY + 0.05, 0, frameM);                      // middle cross-tube
    // bogie links (the diagonal arms the wheels hang from) — purely visual but make the suspension legible
    for (const sg of [-1, 1]) {
      for (const [u0, u1] of [[WB_F - 0.2, WB_R + 0.2], [WB_F - 0.2, WB_M], [WB_M, WB_R + 0.2]] as const) {
        const len = Math.hypot(u1 - u0, 0), ang = Math.atan2(0, u1 - u0);
        const bogie = mesh(new THREE.CylinderGeometry(0.045, 0.045, len, 10).rotateZ(P / 2), steelM, (u0 + u1) / 2, chassisY - 0.05, sg * (TRACK / 2 - 0.1));
        bogie.rotation.y = ang;
      }
    }

    // ------------------------------------------------------------------
    // WHEELS: six off-road wheels, dark rubber with chunky tread and bright yellow hubs
    // ------------------------------------------------------------------
    const treadTex = (() => {
      const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d')!;
      g.fillStyle = '#161616'; g.fillRect(0, 0, 256, 128);
      g.fillStyle = '#000';
      for (let i = 0; i < 24; i++) { const x = i * (256 / 24); g.fillRect(x, 8, 6, 112); g.fillRect(x + 12, 18, 3, 92); }
      g.strokeStyle = '#2a2a2a'; g.lineWidth = 4; g.strokeRect(0, 4, 256, 120);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
    })();
    const tireM = new THREE.MeshStandardMaterial({ map: treadTex, color: 0x2a2a2a, roughness: 0.95, metalness: 0 });
    const hubM = mat(0xf6c61e, false, 0.4, 0.5);
    const mkWheel = (u: number, side: number, steer: boolean) => {
      const pivot = new THREE.Group(); pivot.position.set(u, chassisY, side * TRACK / 2); this.root.add(pivot);
      const w = new THREE.Group();
      // tire: a cylinder oriented along X (the axle direction is local Z, so rotate)
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, WHEEL_W, 32, 1), tireM);
      tire.rotation.z = P / 2; tire.castShadow = tire.receiveShadow = true; w.add(tire);
      // tread chevrons on the sidewall faces — a thin disc with raised chevrons gives the off-road look
      for (const s of [1, -1]) {
        const cap = new THREE.Mesh(new THREE.CircleGeometry(WHEEL_R - 0.04, 32), new THREE.MeshStandardMaterial({ color: 0x202020, roughness: 0.9 }));
        cap.rotation.y = s * P / 2; cap.position.x = s * WHEEL_W / 2; w.add(cap);
      }
      // yellow hub disc on the outside
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, WHEEL_W + 0.02, 24), hubM); hub.rotation.z = P / 2; w.add(hub);
      // six lug bolts on the hub, also yellow — visible in the imagery
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * P * 2, lug = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, WHEEL_W + 0.04, 8), hubM); lug.rotation.z = P / 2;
        lug.position.set(0, Math.cos(a) * 0.12, Math.sin(a) * 0.12); w.add(lug);
      }
      // inner spokes (steel) between hub and rim
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * P * 2 + 0.3, spoke = new THREE.Mesh(new THREE.BoxGeometry(WHEEL_W * 0.6, 0.04, 0.04), steelM);
        spoke.position.set(0, Math.cos(a) * (WHEEL_R - 0.18), Math.sin(a) * (WHEEL_R - 0.18)); spoke.rotation.x = a; w.add(spoke);
      }
      if (steer) { this.steerPivots.push(pivot); pivot.add(w); }
      else { this.root.add(w); w.position.set(u, chassisY, side * TRACK / 2); }
      // remember the tire mesh so we can spin it for rolling animation
      this.wheels.push(tire);
      tire.userData.steer = steer; tire.userData.side = side;
      return tire;
    };
    // 3 axles × 2 wheels = 6 wheels, with steering only on the front and rear axle (the middle is fixed, like a bogie)
    for (const side of [-1, 1]) {
      mkWheel(WB_F, side, true); mkWheel(WB_M, side, false); mkWheel(WB_R, side, true);
    }

    // ------------------------------------------------------------------
    // CABIN: white faceted pressurised drum, multi-sided, with a gold MLI skirt
    // Built as a hexagonal prism with beveled upper and lower edges, so the windows can be cut as facets
    // ------------------------------------------------------------------
    const F = 6;                       // facets around the cabin (hexagonal)
    const cabinY = chassisY + 0.18;
    const cabinW = W, cabinL = L, cabinH = CABIN_H;
    const facetArc = (2 * P) / F;
    // Build the wall as a set of N facet panels (flat segments at constant angle), each with its own window cut
    const cabinShell = new THREE.Group(); cabinShell.position.set(0, cabinY, 0); this.root.add(cabinShell);
    // we'll make windows only on the front-faceting panels: facet indices that face +X (yaw=0)
    const facetCentre = (i: number) => -P / 2 + i * facetArc + facetArc / 2; // start at -90° so the +X facing facet is centred at 0
    // For a hexagon the front-facing facet is the one whose centre angle is closest to 0.
    const frontFacet = (() => { let best = 0, bd = 1e9; for (let i = 0; i < F; i++) { const d = Math.abs(Math.cos(facetCentre(i)) - 1); if (d < bd) { bd = d; best = i; } } return best; })();
    for (let i = 0; i < F; i++) {
      const ang = facetCentre(i), cx = Math.cos(ang), cz = Math.sin(ang);
      // a flat panel that sits at radius cabinW/2 along (cx, cz)
      const fw = cabinW * Math.sin(facetArc / 2) * 2 * 0.96; // chord length
      const panelW = new THREE.MeshStandardMaterial({ map: panelTexture('#f1f4f7', '#a9b1ba', 2, 1), roughness: 0.42, metalness: 0.22 });
      // cut an angular facet window on the front-facing panels (front + the two adjacent facets)
      const isFront = Math.abs(((i - frontFacet + F + F / 2) % F) - F / 2) <= 1 && cx > 0.3;
      if (isFront) {
        const alpha = facetWindowAlpha([{ x0: 0.18, y0: 0.04, x1: 0.82, y1: 0.62, dx: 0.78, dy: 0.92 }]);
        panelW.alphaMap = alpha; panelW.alphaTest = 0.5; panelW.transparent = true;
      }
      const panel = mesh(new THREE.PlaneGeometry(fw, cabinH), panelW, 0, cabinH / 2, 0, cabinShell, false);
      panel.position.set(cx * (cabinW / 2), cabinH / 2, cz * (cabinW / 2));
      panel.lookAt(panel.position.clone().add(new THREE.Vector3(cx, 0, cz)));
      // bevel trim top and bottom of each facet — thin extruded bars
      box(fw, 0.06, 0.06, cx * (cabinW / 2), cabinH + 0.03, cz * (cabinW / 2), steelM, cabinShell, 0.02);
      box(fw, 0.06, 0.06, cx * (cabinW / 2), 0.03, cz * (cabinW / 2), steelM, cabinShell, 0.02);
      // corner pillars between adjacent facets
      if (i === 0) {
        for (let k = 0; k <= F; k++) {
          const a2 = facetCentre(k % F), r = cabinW / 2 + 0.02;
          box(0.07, cabinH, 0.07, Math.cos(a2) * r, cabinH / 2, Math.sin(a2) * r, steelM, cabinShell, 0.02);
        }
      }
      // gold MLI skirt panels (lower ~0.4m of the cabin) on every facet
      const skirt = mesh(new THREE.PlaneGeometry(fw, SKIRT_H), gold, 0, SKIRT_H / 2, 0, cabinShell, true);
      skirt.position.set(cx * (cabinW / 2 + 0.005), SKIRT_H / 2, cz * (cabinW / 2 + 0.005));
      skirt.lookAt(skirt.position.clone().add(new THREE.Vector3(cx, 0, cz)));
      // glaze the windows: thin glass panes inset slightly from the wall
      if (isFront) {
        const gAng = ang, gr = cabinW / 2 - 0.04;
        const winGlass = mesh(new THREE.PlaneGeometry(fw * 0.6, cabinH * 0.5), glassM, 0, cabinH * 0.55, 0, cabinShell, false);
        winGlass.position.set(Math.cos(gAng) * gr, cabinH * 0.55, Math.sin(gAng) * gr);
        winGlass.lookAt(winGlass.position.clone().add(new THREE.Vector3(Math.cos(gAng), 0, Math.sin(gAng))));
        // a heavy metal window frame on top of the glaze, pentagonal silhouette
        const frameM2 = mat(0x8a929c, false, 0.3, 0.7);
        const fShape = new THREE.Shape();
        const hwf = fw * 0.32, hhf = cabinH * 0.28;
        fShape.moveTo(-hwf, -hhf); fShape.lineTo(hwf, -hhf);
        fShape.lineTo(hwf * 0.78, hhf); fShape.lineTo(-hwf * 0.78, hhf); fShape.closePath();
        const fg = new THREE.Mesh(new THREE.ExtrudeGeometry(fShape, { depth: 0.06, bevelEnabled: false }).translate(0, 0, -0.03), frameM2);
        fg.position.set(Math.cos(gAng) * (cabinW / 2 + 0.015), cabinH * 0.55, Math.sin(gAng) * (cabinW / 2 + 0.015));
        fg.lookAt(fg.position.clone().add(new THREE.Vector3(Math.cos(gAng), 0, Math.sin(gAng))));
        cabinShell.add(fg);
      }
      // NASA livery: meatball on the side facets facing +Z and -Z
      if (Math.abs(cz) > 0.6) {
        const ball = meatball();
        const dec = mesh(new THREE.PlaneGeometry(0.55, 0.55), new THREE.MeshBasicMaterial({ map: ball, transparent: true }),
          cx * (cabinW / 2 + 0.012), cabinH * 0.78, cz * (cabinW / 2 + 0.012), cabinShell, false);
        dec.lookAt(dec.position.clone().add(new THREE.Vector3(cx, 0, cz)));
        // wordmark plate below the meatball
        const plate = label('LSR-1  SHACKLETON', 0.7);
        plate.position.set(cx * (cabinW / 2 + 0.013), cabinH * 0.36, cz * (cabinW / 2 + 0.013));
        plate.lookAt(plate.position.clone().add(new THREE.Vector3(cx, 0, cz)));
        cabinShell.add(plate);
      }
    }
    // cabin roof: a low faceted dome (six triangular facets meeting at a hub)
    const roof = new THREE.Group(); roof.position.set(0, cabinY + cabinH, 0); this.root.add(roof);
    for (let i = 0; i < F; i++) {
      const a0 = facetCentre(i) - facetArc / 2, a1 = facetCentre(i) + facetArc / 2;
      const va = new THREE.Vector3(Math.cos(a0) * (cabinW / 2), 0, Math.sin(a0) * (cabinW / 2));
      const vb = new THREE.Vector3(Math.cos(a1) * (cabinW / 2), 0, Math.sin(a1) * (cabinW / 2));
      const vc = new THREE.Vector3(0, 0.35, 0);
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array([va.x, va.y, va.z, vb.x, vb.y, vb.z, vc.x, vc.y, vc.z]), 3));
      geom.computeVertexNormals();
      mesh(geom, whiteRoof, 0, 0, 0, roof, true);
    }
    // crown hub
    box(0.32, 0.18, 0.32, 0, 0.42, 0, steelM, roof, 0.06);

    // ------------------------------------------------------------------
    // REAR AIRLOCK + DOCKING COLLAR (entry hatch on the -X face of the cabin)
    // ------------------------------------------------------------------
    const lock = new THREE.Group(); lock.position.set(-(cabinL / 2 + 0.18), cabinY + 0.4, 0); this.root.add(lock);
    // docking tunnel: short cylinder hanging off the back of the cabin
    const tunnelM = new THREE.MeshStandardMaterial({ map: panelTexture('#e9edf0', '#b3bac3', 4, 1), roughness: 0.5, metalness: 0.3 });
    mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.5, 24, 1, true).rotateZ(P / 2), tunnelM, -0.25, 0, 0, lock, true);
    // docking collar ring (the lip the hab airlock would meet if docked)
    mesh(new THREE.TorusGeometry(0.55, 0.07, 12, 32).rotateY(P / 2), steelM, -0.5, 0, 0, lock, true);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * P * 2; mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.16, 8), yellowM, -0.55, Math.cos(a) * 0.5, Math.sin(a) * 0.5, lock, true); }
    // outer hatch (a door that swings up like a liftgate, for EVA ingress)
    const doorPivot = new THREE.Group(); doorPivot.position.set(-0.55, 1.05, 0); doorPivot.rotation.y = P / 2; lock.add(doorPivot);
    const doorShape = new THREE.Shape();
    const dw = 0.45, dh = 0.85, rr = 0.06;
    doorShape.moveTo(-dw + rr, -dh); doorShape.lineTo(dw - rr, -dh); doorShape.quadraticCurveTo(dw, -dh, dw, -dh + rr);
    doorShape.lineTo(dw, dh - rr); doorShape.quadraticCurveTo(dw, dh, dw - rr, dh); doorShape.lineTo(-dw + rr, dh);
    doorShape.quadraticCurveTo(-dw, dh, -dw, dh - rr); doorShape.lineTo(-dw, -dh + rr); doorShape.quadraticCurveTo(-dw, -dh, -dw + rr, -dh);
    const doorLeaf = mesh(new THREE.ExtrudeGeometry(doorShape, { depth: 0.06, bevelEnabled: false }).translate(0, 0, -0.03), mat(0xdfe3e8, false, 0.4, 0.3), 0, 0, 0, doorPivot, true);
    void doorLeaf;
    // small round window in the hatch
    mesh(new THREE.CircleGeometry(0.18, 24), glassM, 0, 0.55, 0.03, doorPivot, false);
    mesh(new THREE.TorusGeometry(0.19, 0.03, 8, 24), steelM, 0, 0.55, 0.03, doorPivot, false);
    // red hatch wheel
    mesh(new THREE.TorusGeometry(0.13, 0.025, 8, 20), mat(NASA.red), 0.06, -0.4, 0.03, doorPivot, false);
    // seal status lamp
    const doorLampM = new THREE.MeshBasicMaterial({ color: 0x4fd8ff });
    mesh(rbox(0.07, 0.13, 0.07, 0.02), doorLampM, -0.5, 1.1, 0.4, lock, false);
    this.doorState = { open: false, k: 0, pivot: doorPivot, lamp: doorLampM, dir: -1 };
    // AIRLOCK 1 plate
    const alPlate = label('AIRLOCK  LSR-1', 0.5); alPlate.position.set(-0.5, -0.45, 0.45); alPlate.rotation.y = P; lock.add(alPlate);

    // ------------------------------------------------------------------
    // SOLAR ARRAY: two deployable wings on the roof, hinged from a central mast
    // ------------------------------------------------------------------
    const solar = new THREE.Group(); solar.position.set(0, cabinY + cabinH + 0.45, 0); this.root.add(solar);
    mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.4, 12), steelM, 0, 0.2, 0, solar, true);
    const cells = new THREE.MeshStandardMaterial({ map: cellTexture(8, 4), roughness: 0.25, metalness: 0.5 });
    for (const s of [-1, 1]) {
      const wing = new THREE.Group(); wing.position.set(0, 0.36, s * 0.18); wing.rotation.x = s * -0.08; solar.add(wing);
      mesh(new THREE.BoxGeometry(1.7, 0.04, 0.8), cells, 0, 0.04, 0, wing, true);
      for (const e of [-1, 1]) mesh(rbox(0.06, 0.07, 0.85, 0.02), steelM, 0, 0.04, e * 0.42, wing, true);
      for (const e of [-1, 1]) mesh(rbox(0.06, 0.07, 1.75, 0.02), steelM, e * 0.85, 0.04, 0, wing, true);
      // hinge
      mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.18, 10).rotateZ(P / 2), steelM, 0, 0.04, -s * 0.12, wing, true);
    }

    // ------------------------------------------------------------------
    // HIGH-GAIN DISH + WHIP ANTENNAS + COMMS MAST
    // ------------------------------------------------------------------
    const comms = new THREE.Group(); comms.position.set(0.7, cabinY + cabinH + 0.4, -0.5); this.root.add(comms);
    mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.5, 12), steelM, 0, 0.25, 0, comms, true);
    const dish = mesh(new THREE.SphereGeometry(0.32, 28, 12, 0, P * 2, 0, 0.55), new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.35, metalness: 0.3, side: THREE.DoubleSide }), 0, 0.5, 0, comms, true);
    dish.scale.y = 0.5; dish.rotation.x = -0.7;
    mesh(new THREE.CylinderGeometry(0.02, 0.04, 0.18, 8), steelM, 0, 0.65, 0.18, comms, true).rotation.x = -0.7;
    mesh(new THREE.SphereGeometry(0.04, 8, 8), mat(0xff4d4d, true), 0, 0.45, 0, comms, false);
    // two UHF whip antennas (thin fiberglass rods with red beacons), animated with a slow sway
    for (const [x, z, h, wob] of [[-0.6, 0.5, 0.9, 0.5], [0.5, -0.55, 1.1, 0.7]] as const) {
      const whip = new THREE.Group(); whip.position.set(x, cabinY + cabinH + 0.1, z); this.root.add(whip);
      mesh(new THREE.CylinderGeometry(0.01, 0.015, h, 8), mat(0x20262e, false, 0.5, 0.3), 0, h / 2, 0, whip, false);
      mesh(new THREE.SphereGeometry(0.025, 8, 8), mat(0xff4d4d, true), 0, h, 0, whip, false);
      this.antennas.push({ spin: wob, obj: whip });
    }
    // GPS-style patch antenna: small flat box on the roof
    box(0.18, 0.04, 0.18, -0.5, cabinY + cabinH + 0.42, 0.4, mat(0x39485c), this.root, 0.02);

    // ------------------------------------------------------------------
    // LED FLOOD LIGHTS + HEADLIGHTS (white strips and accent spots on the front)
    // ------------------------------------------------------------------
    const floodM = mat(0xfff6ec, true);
    box(1.6, 0.06, 0.06, cabinL / 2 + 0.02, cabinY + cabinH * 0.78, 0, floodM, this.root, 0.02);    // top strip
    box(1.6, 0.04, 0.06, cabinL / 2 + 0.02, cabinY + cabinH * 0.22, 0, mat(0xffe9c4, true), this.root, 0.02); // lower amber strip
    // two headlight pods flanking the front bumper
    for (const s of [-1, 1]) {
      const pod = box(0.22, 0.22, 0.12, cabinL / 2 + 0.06, cabinY + 0.18, s * 0.7, steelM, this.root, 0.04);
      void pod;
      mesh(new THREE.CircleGeometry(0.09, 20), mat(0xffffff, true), cabinL / 2 + 0.13, cabinY + 0.18, s * 0.7, this.root, false);
      const sl = new THREE.SpotLight(0xfff6ec, 18, 18, 0.5, 0.5, 1.5); sl.position.set(cabinL / 2 + 0.13, cabinY + 0.18, s * 0.7);
      sl.target.position.set(cabinL / 2 + 6, 0, s * 1.6); this.root.add(sl); this.root.add(sl.target);
      this.lamps.push({ l: sl, base: 18, warm: 0 });
    }
    // cabin interior point light (so the cockpit is not pitch black at night)
    const cabinLight = new THREE.PointLight(0xe4ecff, 8, 6, 2); cabinLight.position.set(0, cabinY + cabinH * 0.7, 0); this.root.add(cabinLight);
    this.lamps.push({ l: cabinLight, base: 8, warm: 0 });
    this.glows.push({ m: floodM, base: 1.4 });

    // ------------------------------------------------------------------
    // ROBOTIC ARM: black 6-DOF articulated arm on the starboard side, deployed on a shoulder block
    // ------------------------------------------------------------------
    const armRoot = new THREE.Group(); armRoot.position.set(0.4, cabinY + cabinH * 0.55, TRACK / 2 + 0.05); this.root.add(armRoot);
    // shoulder base
    box(0.22, 0.22, 0.18, 0, 0, 0, darkM, armRoot, 0.04);
    const shoulder = new THREE.Group(); shoulder.position.set(0, 0.1, 0.06); armRoot.add(shoulder); this.arm.push(shoulder);
    // upper arm (steel-grey link)
    box(0.12, 0.85, 0.16, 0, 0.45, 0, darkM, shoulder, 0.03);
    // shoulder pivot cap
    mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.2, 16).rotateZ(P / 2), yellowM, 0, 0.1, 0, shoulder, true);
    // elbow
    const elbow = new THREE.Group(); elbow.position.set(0, 0.85, 0); shoulder.add(elbow); this.arm.push(elbow);
    box(0.1, 0.7, 0.14, 0, 0.35, 0, darkM, elbow, 0.03);
    mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.16, 14).rotateZ(P / 2), yellowM, 0, 0, 0, elbow, true);
    // wrist
    const wrist = new THREE.Group(); wrist.position.set(0, 0.7, 0); elbow.add(wrist); this.arm.push(wrist);
    box(0.09, 0.32, 0.12, 0, 0.16, 0, darkM, wrist, 0.03);
    // tool end-effector: a sample-coring drill bit + scoop
    const tool = new THREE.Group(); tool.position.set(0, 0.32, 0); wrist.add(tool); this.arm.push(tool);
    mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.18, 12), mat(0xb9bfc8, false, 0.3, 0.7), 0, 0.09, 0, tool, true);
    mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.16, 10), mat(0xfc3d21, false, 0.4, 0.3), 0, 0.28, 0, tool, true);
    // scoop bucket
    mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.12, 12, 1, true, 0, P), mat(0x39485c), 0.12, 0.32, 0, tool, true).rotation.z = P / 2;
    // store the armrest: default pose (stowed close to the body) and the target pose (extended outward)
    this.armT = 0; this.armTargetT = 0;

    // ------------------------------------------------------------------
    // UNDERCARRIAGE: batteries, drive motors, sample cache box on the back
    // ------------------------------------------------------------------
    for (const s of [-1, 1]) for (const u of [WB_F, WB_M, WB_R]) {
      box(0.18, 0.18, 0.18, u, chassisY - 0.18, s * (TRACK / 2 - 0.18), mat(0x39485c, false, 0.4, 0.5), this.root, 0.03);
    }
    // battery packs (two rectangular boxes under the cabin floor)
    for (const s of [-1, 1]) {
      box(0.6, 0.22, 0.45, -0.6, chassisY + 0.05, s * 0.5, mat(0x2a3038, false, 0.5, 0.4), this.root, 0.04);
      mesh(new THREE.PlaneGeometry(0.45, 0.13), new THREE.MeshBasicMaterial({ map: plateTexture(s > 0 ? 'BATT-A' : 'BATT-B') }), -0.6, chassisY + 0.16, s * 0.5 + 0.226, this.root, false).rotation.y = P / 2;
    }
    // sample cache box on the rear deck
    box(0.6, 0.4, 0.6, -(cabinL / 2 + 0.4), cabinY + 0.2, 0, mat(0xb9bfc8, false, 0.4, 0.6), this.root, 0.05);
    mesh(new THREE.PlaneGeometry(0.4, 0.13), new THREE.MeshBasicMaterial({ map: plateTexture('SAMPLE CACHE') }), -(cabinL / 2 + 0.4), cabinY + 0.36, 0.301, this.root, false);

    // ------------------------------------------------------------------
    // INTERIOR COCKPIT: driver's seat + console with two live screens, visible when inside
    // The camera will sit just behind the seat looking forward through the front facet windows
    // ------------------------------------------------------------------
    const interiorY = cabinY + 0.05;
    // console
    const console = box(0.9, 0.5, 1.4, cabinL / 2 - 0.5, interiorY + 0.55, 0, mat(0x20262e, false, 0.5, 0.4), this.root, 0.05);
    void console;
    // steering yoke
    mesh(new THREE.TorusGeometry(0.13, 0.025, 12, 28), mat(0x39485c), cabinL / 2 - 0.5, interiorY + 0.95, 0, this.root, false).rotation.x = -0.3;
    mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.18, 10), steelM, cabinL / 2 - 0.5, interiorY + 0.85, 0, this.root, false);
    // two driver screens — drawn into a canvas so we can show live rover telemetry
    const mkScreen = (w: number, h: number, draw: () => string[]) => {
      const c = document.createElement('canvas'); c.width = 256; c.height = 160; const g = c.getContext('2d')!;
      const m = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c) });
      const scr = mesh(new THREE.PlaneGeometry(w, h), m, cabinL / 2 - 0.55, interiorY + 0.6, 0, this.root, false);
      scr.material = m; void scr;
      this.hudScreens.push({ mat: m, draw });
      return scr;
    };
    mkScreen(0.36, 0.22, () => [
      `SPD ${(this.speed * 3.6).toFixed(1)} KMH`,
      `ODO ${this.odometer.toFixed(1)} M`,
      `BAT ${(this.batteryPct).toFixed(0)}%`,
      `MOT ${(Math.abs(this.speed) > 0.05 ? (LOAD_KW + Math.abs(this.speed) * 1.4) : 0.6).toFixed(2)}KW`,
    ]);
    mkScreen(0.36, 0.22, () => [
      `HAB ${this.distHab.toFixed(0)}M`,
      `LINK ${this.hasHabLink ? 'UHF OK' : 'UHF LOS'}`,
      `O2 ${this.o2Kg.toFixed(2)}KG`,
      `ARM ${ARM_STAGES[this.armStage]}`,
    ]);
    // driver's seat (back + base + headrest)
    box(0.55, 0.65, 0.5, cabinL / 2 - 1.2, interiorY + 0.45, 0, mat(0x2c5aa0, false, 0.6), this.root, 0.05);
    box(0.5, 0.1, 0.5, cabinL / 2 - 1.2, interiorY + 0.18, 0, mat(0x2c5aa0, false, 0.6), this.root, 0.04);
    mesh(new THREE.SphereGeometry(0.15, 14, 10), mat(0x2c5aa0, false, 0.85), cabinL / 2 - 1.2, interiorY + 0.95, 0, this.root, false);
    // cockpit camera position (just behind the seat, at driver eye height)
    this.cockpitPos.set(cabinL / 2 - 0.85, interiorY + 1.05, 0);
    // door walk-out point (in world space, behind the docking collar)
    this.doorPos.set(this.parkingSpot.x - (cabinL / 2 + 1.0), 0, this.parkingSpot.z);

    // ------------------------------------------------------------------
    // INTERACTION ITEMS: the door handle and the in-cabin comms console
    // ------------------------------------------------------------------
    // Door handle is in world coordinates because the player walks up to it from outside
    const doorWX = this.parkingSpot.x - (cabinL / 2 + 0.7), doorWZ = this.parkingSpot.z;
    this.items.push({
      x: doorWX, z: doorWZ, reach: 1.7,
      text: () => this.inRover ? '' : (this.busy ? '' : `[E] ENTER LSR-1`),
      run: () => this.startEnter(),
    });
  }

  /** Battery percentage, 0..100. */
  get batteryPct() { return (this.batteryKwh / BATT_KWH) * 100; }
  /** True if the rover can drive (battery + not busy + cabin pressure nominal). */
  get drivable() { return this.batteryKwh > 0.05 && !this.busy && this.lockP > 60; }

  /** Called from main.ts when the player presses E while the rover prompt is the active one. */
  press() {
    if (this.busy) return;
    if (this.inRover) {
      // pressing E in the cockpit begins the exit sequence
      this.startExit();
      return;
    }
    if (this.best) { this.toast = this.best.run(); this.toastT = 2.8; }
  }

  /** Open the rover's own comms terminal — relayed via the Hab to Earth. */
  openComms() { return this.hasHabLink; }

  /** Begin the EVA ingress sequence; refuses if the suit isn't sealed or the airlock is mid-cycle. */
  private startEnter(): string {
    if (this.busy) return 'AIRLOCK BUSY';
    if (!this.suitOn) return 'EVA SUIT NOT SEALED';
    if (this.lockCyc !== null) return 'AIRLOCK CYCLING';
    this.entering = true; this.enterT = 0; this.stage = -1;
    return 'INGRESS SEQUENCE BEGUN';
  }

  private startExit(): string {
    if (this.busy) return 'AIRLOCK BUSY';
    if (!this.suitOn) return 'EVA SUIT NOT SEALED';
    if (this.lockCyc !== null) return 'AIRLOCK CYCLING';
    this.exiting = true; this.exitT = 0; this.stage = -1;
    return 'EGRESS SEQUENCE BEGUN';
  }

  /** Cycle the rover airlock pressure between cabin (~70 kPa) and vacuum. */
  private cycleLock(toVac: boolean) {
    if (this.lockCyc !== null) return;
    this.lockCyc = toVac ? 0 : CABIN_P_KPA;
  }

  /** Returns true if the player's XY position is inside the rover body (used to block walking through). */
  blocked(x: number, z: number): boolean {
    // transform world (x,z) into rover-local space
    const dx = x - this.parkingSpot.x, dz = z - this.parkingSpot.z;
    const lx = dx * Math.cos(-this.heading) - dz * Math.sin(-this.heading);
    const lz = dx * Math.sin(-this.heading) + dz * Math.cos(-this.heading);
    // a box slightly larger than the cabin + wheels
    return Math.abs(lx) < (cabinLPath()) / 2 + 0.4 && Math.abs(lz) < (W + 0.4) / 2 + WHEEL_W / 2;
  }

  /** Returns true if the player is at the cockpit (used by main.ts to switch movement to drive mode). */
  inCockpit(p: THREE.Vector3): boolean { return this.inRover; }

  /** Place the camera at the cockpit, oriented along the rover heading + mouse-look yaw. */
  cockpitCameraPosition(target: THREE.Vector3) {
    // cockpit-local coords
    const cx = this.cockpitPos.x, cy = this.cockpitPos.y, cz = this.cockpitPos.z;
    const ch = Math.cos(this.heading), sh = Math.sin(this.heading);
    target.set(this.parkingSpot.x + cx * ch + cz * sh, this.parkingSpot.y + cy, this.parkingSpot.z + cx * sh - cz * ch);
  }

  /** Where the player should stand after disembarking (world space, just behind the docking collar). */
  exitPosition(target: THREE.Vector3) {
    const ch = Math.cos(this.heading), sh = Math.sin(this.heading);
    const lx = -(cabinLPath()) / 2 - 1.0, lz = 0;
    target.set(this.parkingSpot.x + lx * ch + lz * sh, 0, this.parkingSpot.z + lx * sh - lz * ch);
  }

  status(): [string, string, string][] {
    const rows: [string, string, string][] = [
      ['ROVER', this.inRover ? 'LSR-1 · DRIVING' : 'LSR-1 · PARKED', this.inRover ? 'ok' : 'warn'],
      ['LSR BATTERY', `${this.batteryPct.toFixed(0)} % · ${this.batteryKwh.toFixed(2)} kWh`, this.batteryPct < 20 ? 'bad' : this.batteryPct < 50 ? 'warn' : 'ok'],
      ['LSR SPEED', `${(this.speed * 3.6).toFixed(1)} km/h`, 'ok'],
      ['LSR ODOMETER', `${this.odometer.toFixed(1)} m`, 'ok'],
      ['LSR CABIN', `${this.lockP.toFixed(0)} kPa · O2 ${this.o2Kg.toFixed(2)} kg`, this.lockP < 50 ? 'bad' : 'ok'],
      ['LSR SOLAR', `${this.genKw.toFixed(2)} kW / ${LOAD_KW.toFixed(2)} kW`, this.genKw < LOAD_KW ? 'warn' : 'ok'],
      ['LSR ARM', ARM_STAGES[this.armStage], this.armStage === 4 ? 'ok' : this.armStage === 0 ? 'warn' : 'ok'],
      ['LSR → HAB', this.hasHabLink ? `UHF · ${this.distHab.toFixed(0)} m` : 'NO LINE OF SIGHT', this.hasHabLink ? 'ok' : 'bad'],
      ['LSR AIRLOCK', this.doorState.open ? 'HATCH OPEN' : 'HATCH CLOSED', this.doorState.open ? 'warn' : 'ok'],
    ];
    return rows;
  }

  /** Step the rover's own simulation: power, oxygen, drive physics, wheel + arm animation, light state. */
  update(dt: number, dtSim: number, p: THREE.Vector3, sim: Sim, keys: Set<string>, mouseLookYaw: number, sunDir: THREE.Vector3) {
    this.clock += dt;
    void sim;

    // distance to hab (the hab is at world origin in main.ts)
    this.distHab = Math.hypot(this.parkingSpot.x - 0, this.parkingSpot.z - 0);
    // UHF link: only true while on the pad / within line-of-sight reach to the Hab dish.
    // Real check is "is the Hab above the local horizon", but for now we use a soft radius: if the rover
    // is within HAB_PAD_R of the Hab, treat the link as up; otherwise mark it as lost. (The Hab Earth link
    // is still independently checked by main.ts's link() before the message is allowed to leave.)
    this.hasHabLink = this.distHab < HAB_PAD_R;

    // power: solar trickle from the roof array, scaled by sun direction (panel normal is +Y in rover space).
    const upDot = Math.max(0, sunDir.y);              // sun above the local horizon
    this.genKw = ARRAY_KW * upDot;
    const motKw = Math.abs(this.speed) > 0.05 ? LOAD_KW + Math.abs(this.speed) * 1.4 : 0.6;
    this.loadKw = motKw;
    this.batteryKwh = Math.min(BATT_KWH, Math.max(0, this.batteryKwh + (this.genKw - this.loadKw) * dtSim / 3600));
    // cabin O2 draw (only when pressurised)
    if (this.lockP > 50) this.o2Kg = Math.max(0, this.o2Kg - O2_USE_KGPH * dtSim / 3600);

    // drive physics: only when the player is in the cockpit and not mid-airlock
    if (this.inRover && !this.busy) {
      const hasPower = this.batteryKwh > 0.01;
      const throttle = (keys.has('KeyW') ? 1 : 0) + (keys.has('KeyS') ? -1 : 0);
      const steer = (keys.has('KeyA') ? 1 : 0) + (keys.has('KeyD') ? -1 : 0);
      if (hasPower) {
        // accelerate toward throttle, with a soft cap at SPEED_MAX
        this.speed += throttle * ACCEL * dt;
        this.speed = Math.max(-SPEED_MAX * 0.5, Math.min(SPEED_MAX, this.speed));
        if (throttle === 0) {
          // coast-down friction
          this.speed *= Math.max(0, 1 - dt * 0.8);
          if (Math.abs(this.speed) < 0.01) this.speed = 0;
        }
        // steering: turn rate proportional to speed sign and steer input
        this.heading += steer * TURN * dt * (this.speed >= 0 ? 1 : -1);
      } else {
        this.speed *= 0.5;
      }
      // commit motion: integrate along heading
      const nx = this.parkingSpot.x + Math.cos(this.heading) * this.speed * dt;
      const nz = this.parkingSpot.z + Math.sin(this.heading) * this.speed * dt;
      // keep the rover inside a generous square around the hab so it can't wander off the world
      const lim = 250;
      if (Math.abs(nx) < lim && Math.abs(nz) < lim) {
        this.odometer += Math.abs(this.speed) * dt;
        this.parkingSpot.x = nx; this.parkingSpot.z = nz;
      } else {
        this.speed = 0;
      }
      // follow terrain
      this.parkingSpot.y = this.heightAt(this.parkingSpot.x, this.parkingSpot.z);
      this.root.position.copy(this.parkingSpot);
      this.root.rotation.y = this.heading;

      // robotic arm: R toggles stowed/deployed
      // (handled in press() / keydown; here we just animate the joints toward this.armTargetT)
      const tgt = this.armTargetT;
      this.armT += (tgt - this.armT) * Math.min(1, dt * 1.4);
      if (this.arm.length >= 4) {
        // shoulder swings the upper arm outward
        this.arm[0].rotation.z = -0.15 - this.armT * 0.7;
        // elbow bends the forearm forward
        this.arm[1].rotation.z = -0.2 - this.armT * 0.6;
        // wrist droops the tool toward the ground for sampling
        this.arm[2].rotation.z = -0.1 - this.armT * 0.9;
        // tool spin during sampling
        if (this.armStage === 4) this.arm[3].rotation.x += dt * 6;
      }
    } else if (!this.inRover) {
      // parked: gently settle to terrain height
      const ty = this.heightAt(this.parkingSpot.x, this.parkingSpot.z);
      this.parkingSpot.y += (ty - this.parkingSpot.y) * Math.min(1, dt * 4);
      this.root.position.copy(this.parkingSpot);
      this.root.rotation.y = this.heading;
      this.speed *= 0.6;
    }

    // wheel rolling animation: spin the tires proportional to speed
    const spin = (this.speed / WHEEL_R) * dt;
    this.wheelSpin += spin;
    for (let i = 0; i < this.wheels.length; i++) {
      const w = this.wheels[i];
      w.rotation.x = this.wheelSpin;
      if (w.userData.steer) {
        // front + rear steer pivots: visualise the steering input
        const sp = this.steerPivots.find((p) => p.children.length > 0 && p.children[0] === w.parent);
        void sp;
      }
    }
    // steering visual: smoothly track a target angle from the A/D inputs
    const steerTarget = this.inRover && !this.busy ? ((keys.has('KeyA') ? 1 : 0) + (keys.has('KeyD') ? -1 : 0)) * 0.3 : 0;
    this.steerVis += (steerTarget - this.steerVis) * Math.min(1, dt * 6);
    for (const p of this.steerPivots) p.rotation.y = this.steerVis;

    // antennas sway
    for (const a of this.antennas) a.obj.rotation.z = Math.sin(this.clock * a.spin * 2) * 0.05;

    // door + airlock cycle
    const d = this.doorState;
    d.k = Math.min(1, Math.max(0, d.k + (d.open ? 1 : -1) * dt * 0.9));
    d.pivot.rotation.z = d.dir * d.k * 1.2;
    d.lamp.color.setHex(d.open ? 0xffb000 : 0x4fd8ff);

    if (this.lockCyc !== null) {
      const s = (LOCK_P / CYCLE_S) * dt;
      this.lockP = this.lockCyc > this.lockP ? Math.min(this.lockCyc, this.lockP + s) : Math.max(this.lockCyc, this.lockP - s);
      if (this.lockP === this.lockCyc) {
        this.lockCyc = null;
        this.toast = `LSR AIRLOCK ${this.lockP === 0 ? 'DEPRESSURISED' : 'PRESSURISED'}`;
        this.toastT = 2.4;
      }
    }

    // ingress / egress sequence (drives the airlock + camera teleport + door state machine)
    if (this.entering) {
      this.enterT += dt;
      const f = Math.min(1, this.enterT / ENTER_S);
      this.taskProgress = f;
      const st = Math.min(ENTER_STAGES.length - 1, Math.floor(f * ENTER_STAGES.length));
      this.taskLabel = `INGRESS · ${ENTER_STAGES[st]}`;
      if (st !== this.stage) {
        this.stage = st;
        if (st === 1) { this.doorState.open = true; }
        if (st === 2) { this.cycleLock(false); }
        if (st === 3 && this.lockP > 60) { /* inner hatch implicitly opens */ }
        if (st === 4) { this.doorState.open = false; }
        if (st === 5) { this.cycleLock(false); }
      }
      if (f >= 1) {
        this.entering = false;
        this.inRover = true;
        this.where = 'LSR-1 COCKPIT';
        this.speed = 0;
        this.taskLabel = ''; this.taskProgress = 0;
        this.toast = 'LSR-1 CABIN PRESSURISED · COCKPIT ACTIVE'; this.toastT = 3.0;
      }
    }
    if (this.exiting) {
      this.exitT += dt;
      const f = Math.min(1, this.exitT / EXIT_S);
      this.taskProgress = f;
      const st = Math.min(EXIT_STAGES.length - 1, Math.floor(f * EXIT_STAGES.length));
      this.taskLabel = `EGRESS · ${EXIT_STAGES[st]}`;
      if (st !== this.stage) {
        this.stage = st;
        if (st === 1) { this.cycleLock(true); }
        if (st === 2) { this.doorState.open = true; }
        if (st === 3) { this.inRover = false; this.where = 'SURFACE'; }
        if (st === 4) { this.doorState.open = false; this.cycleLock(false); }
      }
      if (f >= 1) {
        this.exiting = false;
        this.taskLabel = ''; this.taskProgress = 0;
        this.toast = 'LSR-1 AIRLOCK SEALED · STAY SAFE OUT THERE'; this.toastT = 3.0;
      }
    }

    // power-aware lighting: dim and redden when the rover battery is low
    const battF = this.batteryKwh / BATT_KWH;
    const lit = battF > 0.02 ? Math.min(1, 0.5 + battF) : 0.05;
    for (const { l, base } of this.lamps) {
      l.intensity = base * lit * (1 + 0.02 * Math.sin(this.clock * 7));
      if (battF < 0.1) (l as THREE.PointLight).color?.setHex(0xff3b2a);
    }
    for (const { m, base } of this.glows) m.emissiveIntensity = base * Math.min(1, lit);

    // refresh the cockpit screens (~5 Hz is plenty for telemetry)
    if (Math.floor(this.clock * 5) !== Math.floor((this.clock - dt) * 5)) {
      for (const s of this.hudScreens) {
        const tex = s.mat.map as THREE.CanvasTexture;
        const c = tex.image as HTMLCanvasElement; const g = c.getContext('2d')!;
        g.fillStyle = '#04141c'; g.fillRect(0, 0, c.width, c.height);
        g.fillStyle = '#4fd8ff'; g.font = '14px monospace';
        const lines = s.draw();
        for (let i = 0; i < lines.length; i++) g.fillText(lines[i], 8, 22 + i * 18);
        g.strokeStyle = 'rgba(79,216,255,.5)'; g.strokeRect(2, 2, c.width - 4, c.height - 4);
        tex.needsUpdate = true;
      }
    }

    // proximity prompt: only when player is outside and walking toward the door
    if (!this.inRover && !this.busy) {
      let best: Item | null = null, bd = 1e9;
      for (const it of this.items) {
        const d = Math.hypot(p.x - it.x, p.z - it.z);
        if (d < it.reach && d < bd) { best = it; bd = d; }
      }
      this.best = best;
      this.prompt = best ? best.text() : '';
    } else {
      this.prompt = this.inRover && !this.busy ? '[E] EXIT LSR-1   ·   R TOGGLE ARM   ·   F COMMS' : '';
    }

    this.toastT -= dt; if (this.toastT <= 0) this.toast = '';
  }

  /** Toggle the robotic arm between STOWED and AT READY. */
  toggleArm() {
    if (!this.inRover || this.busy) return;
    if (this.armStage === 0) { this.armStage = 2; this.armTargetT = 1; this.toast = 'ARM AT READY'; }
    else if (this.armStage === 2) { this.armStage = 4; this.toast = 'ARM SAMPLING'; }
    else if (this.armStage === 4) { this.armStage = 1; this.armTargetT = 0.7; this.toast = 'ARM STOWING'; }
    else { this.armStage = 0; this.armTargetT = 0; this.toast = 'ARM STOWED'; }
    this.toastT = 1.6;
  }
}

// cabin length used for collision math (kept in a function so the constant is the single source of truth)
function cabinLPath() { return L + 0.6; }
