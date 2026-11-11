import * as THREE from 'three';

// NASA-style livery, generated on canvas so the build needs no binary assets. The meatball and worm are stylised
// recreations for the simulator; swap in the official art (nasa.gov/nasa-brand-center) before any public release.
export const NASA = { blue: 0x0b3d91, blueCss: '#0b3d91', red: 0xfc3d21, redCss: '#fc3d21', white: 0xeef1f4, grey: 0x7f8791, graphite: 0x4a525d, gold: 0xc8a03c };

const cv = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const finish = (c: HTMLCanvasElement, repeat = false) => {
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
};
const seeded = (seed: number) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

/** Seamless drawing: stamp the same feature at every 3x3 wrap-around offset, so the tile shows no seam. */
function wrap9(g: CanvasRenderingContext2D, S: number, fn: (ox: number, oy: number) => void) {
  for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) fn(dx * S, dy * S);
}
/** Stacked value noise, painted at several octaves; each octave is periodic so the tile shows no seam. */
function noiseLayers(g: CanvasRenderingContext2D, S: number, r: () => number, octs: [number, number][]) {
  for (const [cells, alpha] of octs) {
    const grid = new Float32Array(cells * cells);
    for (let i = 0; i < cells * cells; i++) grid[i] = r();
    const tmp = cv(S, S), tg = tmp.getContext('2d')!, id = tg.createImageData(S, S);
    const at = (x: number, y: number) => grid[(((y % cells) + cells) % cells) * cells + (((x % cells) + cells) % cells)];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const fx = (x * cells) / S, fy = (y * cells) / S, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty); // smoothstep interpolation
      const v = (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
      const b = (v * 255) | 0, i = (y * S + x) * 4;
      id.data[i] = id.data[i + 1] = id.data[i + 2] = b; id.data[i + 3] = 255;
    }
    tg.putImageData(id, 0, 0);
    g.globalAlpha = alpha; g.drawImage(tmp, 0, 0); g.globalAlpha = 1;
  }
}

/** One painted aluminium panel (seams + rivets), tiled rx by ry times.
 *  1024 px with layered grunge: brushed streaks, multi-octave value noise, grime settled into the seams,
 *  domed rivets with their own highlight and shadow, faint drips and scuffs. Everything wraps seamlessly.
 *  `grime` scales the lived-in filth: 1 = exterior duty, ~0.4 for pressurised interiors that get wiped down. */
export function panelTexture(base: string, seam: string, rx: number, ry: number, grime = 1) {
  const S = 1024, c = cv(S, S), g = c.getContext('2d')!, r = seeded(31);
  g.fillStyle = base; g.fillRect(0, 0, S, S);
  // brushed-metal grain: many faint horizontal strokes
  for (let i = 0; i < 900; i++) {
    const y = r() * S, x = r() * S, w = 30 + r() * 190, a = 0.012 + r() * 0.035;
    g.strokeStyle = r() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(30,34,40,${a})`;
    g.lineWidth = 0.6 + r() * 1.4;
    wrap9(g, S, (ox, oy) => { g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + w, y + oy); g.stroke(); });
  }
  // broad tonal variation (paint is never perfectly even)
  noiseLayers(g, S, r, [[3, 0.05], [7, 0.05], [16, 0.07], [48, 0.06]]);
  // subtle vertical gravity drips from the rivet rows
  for (let i = 0; i < 24; i++) {
    const x = 20 + r() * (S - 40), y = r() * S * 0.5, w = 2 + r() * 5, h = 60 + r() * 260, a = (0.03 + r() * 0.05) * grime;
    g.strokeStyle = `rgba(52,48,44,${a})`; g.lineWidth = w;
    wrap9(g, S, (ox, oy) => { g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + (r() - 0.5) * 8, y + oy + h); g.stroke(); });
  }
  // grime that settles along the seam lines (a soft dark band on every edge)
  for (const [m, a] of [[10, 0.16 * grime], [26, 0.07 * grime]] as const) {
    g.strokeStyle = `rgba(38,36,33,${a})`; g.lineWidth = m;
    g.strokeRect(-m / 2, -m / 2, S + m, S + m);
  }
  // the crisp seam itself: a groove with a bright reflection line just inside it
  g.strokeStyle = seam; g.lineWidth = 4; g.strokeRect(0, 0, S, S);
  g.strokeStyle = 'rgba(255,255,255,0.13)'; g.lineWidth = 1.4; g.strokeRect(4, 4, S - 8, S - 8);
  // rivet line just inside the border, alternating with mid-edge fasteners: domed, with a real highlight and shadow so they read at 3 m
  const rivet = (x: number, y: number, rr = 6.4) => {
    wrap9(g, S, (ox, oy) => {
      const rg = g.createRadialGradient(x + ox - rr * 0.35, y + oy - rr * 0.35, rr * 0.12, x + ox, y + oy, rr);
      rg.addColorStop(0, 'rgba(255,255,255,0.8)'); rg.addColorStop(0.5, 'rgba(196,193,186,0.4)'); rg.addColorStop(0.85, 'rgba(28,30,34,0.55)'); rg.addColorStop(1, 'rgba(60,58,54,0.1)');
      g.fillStyle = rg; g.beginPath(); g.arc(x + ox, y + oy, rr, 0, 7); g.fill();
      g.fillStyle = 'rgba(18,20,24,0.6)'; g.beginPath(); g.arc(x + ox + rr * 0.18, y + oy + rr * 0.3, rr * 0.36, 0, 7); g.fill();
    });
  };
  const step = S / 8;
  for (let i = 0; i < 8; i++) {
    rivet(28 + i * step + step / 2, 28); rivet(28 + i * step + step / 2, S - 28);
    rivet(28, 28 + i * step + step / 2); rivet(S - 28, 28 + i * step + step / 2);
  }
  // scattered dents of dust and finger smudges
  for (let i = 0; i < 40; i++) {
    const x = r() * S, y = r() * S, rr = 8 + r() * 34, a = (0.02 + r() * 0.05) * grime;
    g.fillStyle = `rgba(64,60,55,${a})`;
    wrap9(g, S, (ox, oy) => { g.beginPath(); g.arc(x + ox, y + oy, rr, 0, 7); g.fill(); });
  }
  const t = finish(c, true); t.repeat.set(rx, ry); return t;
}

/** Floor / pad tiles, n tiles across the unit UV range. Seamless edge grime and fastener wear. */
export function tileTexture(base: string, seam: string, n: number) {
  const S = 512, c = cv(S, S), g = c.getContext('2d')!, r = seeded(19);
  g.fillStyle = base; g.fillRect(0, 0, S, S);
  noiseLayers(g, S, r, [[2, 0.06], [6, 0.06], [14, 0.06]]);
  g.strokeStyle = seam; g.lineWidth = 4; g.strokeRect(0, 0, S, S);
  g.strokeStyle = 'rgba(255,255,255,0.10)'; g.lineWidth = 1.2; g.strokeRect(3, 3, S - 6, S - 6);
  for (let i = 0; i < 90; i++) {
    const x = r() * S, y = r() * S, a = 0.03 + r() * 0.06, w = 2 + r() * 2;
    g.fillStyle = r() > 0.55 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    wrap9(g, S, (ox, oy) => g.fillRect(x + ox, y + oy, w, w));
  }
  const t = finish(c, true); t.repeat.set(n, n); return t;
}

/** Crinkled thermal-blanket (MLI) relief, used as a bump map on gold foil. */
export function crinkleTexture(rx: number, ry: number) {
  const c = cv(256, 256), g = c.getContext('2d')!, r = seeded(7);
  g.fillStyle = '#808080'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 700; i++) {
    const v = 60 + Math.floor(r() * 140); g.strokeStyle = `rgba(${v},${v},${v},.55)`; g.lineWidth = 1 + r() * 3;
    g.beginPath(); const x = r() * 256, y = r() * 256; g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 60, y + (r() - 0.5) * 60); g.stroke();
  }
  const t = finish(c, true); t.repeat.set(rx, ry); t.colorSpace = THREE.NoColorSpace; return t;
}

/** The NASA "meatball": blue disc, stars, white orbit, red vector, white lettering — printed, then aged by
 *  the same dust that covers everything else (no decal stays showroom-clean on the Moon). */
export function meatball() {
  const c = cv(1024, 1024), g = c.getContext('2d')!, r = seeded(42); g.scale(2, 2);
  g.beginPath(); g.arc(256, 256, 250, 0, Math.PI * 2); g.fillStyle = NASA.blueCss; g.fill(); g.save(); g.clip();
  for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(255,255,255,${0.5 + r() * 0.5})`; g.beginPath(); g.arc(r() * 512, r() * 512, 1 + r() * 2.2, 0, 7); g.fill(); }
  g.fillStyle = NASA.redCss; g.beginPath(); g.moveTo(40, 360); g.bezierCurveTo(150, 335, 330, 235, 480, 120); g.bezierCurveTo(370, 240, 280, 320, 175, 400); g.closePath(); g.fill();
  g.save(); g.translate(256, 256); g.rotate(-0.42); g.strokeStyle = '#fff'; g.lineWidth = 7; g.beginPath(); g.ellipse(0, 0, 330, 105, 0, 0, 7); g.stroke(); g.restore();
  g.fillStyle = '#fff'; g.font = '900 120px Helvetica, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('NASA', 256, 262);
  g.restore();
  ageDecal(g, 512, 512, r);
  return finish(c);
}

/** Dust, sun-fade and scuffs laid over a finished decal canvas (w x h logical units), so no sticker in the scene
 *  reads as freshly screen-printed. Shared by the meatball, worm, plates and flags. */
function ageDecal(g: CanvasRenderingContext2D, w: number, h: number, r: () => number) {
  const dust = (a: number) => `rgba(118,112,102,${a})`;
  for (let i = 0; i < w * h * 0.012; i++) { g.fillStyle = dust(0.06 + r() * 0.22); g.beginPath(); g.arc(r() * w, r() * h, 0.4 + r() * 1.8, 0, 7); g.fill(); }
  for (let i = 0; i < 6; i++) {   // faint dust drifts with a direction, like something brushed past
    const x = r() * w, y = r() * h;
    g.strokeStyle = dust(0.05 + r() * 0.1); g.lineWidth = 2 + r() * 6;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * w * 0.5, y + (r() - 0.5) * h * 0.4); g.stroke();
  }
  g.fillStyle = 'rgba(96,88,74,0.055)'; g.fillRect(0, 0, w, h);   // overall sun-fade and dust film
}

/** The "worm" wordmark: red, no crossbar on the As — then aged. */
export function worm() {
  const c = cv(2048, 680), g = c.getContext('2d')!; g.scale(2, 2);
  g.fillStyle = NASA.redCss; g.font = '900 250px Arial Black, Helvetica, Arial, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left';
  let x = 20; for (const ch of 'N\u039BS\u039B') { g.fillText(ch, x, 175); x += g.measureText(ch).width + 14; }
  ageDecal(g, 1024, 340, seeded(88));
  return finish(c);
}

/** Equipment plate: light panel, NASA-blue lettering, blue/red edge tabs — aged like the rest. */
export function plateTexture(text: string) {
  const c = cv(1024, 192), g = c.getContext('2d')!; g.scale(2, 2);
  g.fillStyle = '#eceff0'; g.fillRect(0, 0, 512, 96);
  g.fillStyle = NASA.blueCss; g.fillRect(0, 0, 18, 96); g.fillStyle = NASA.redCss; g.fillRect(18, 0, 6, 96);
  g.strokeStyle = NASA.blueCss; g.lineWidth = 3; g.strokeRect(1.5, 1.5, 509, 93);
  g.fillStyle = NASA.blueCss; g.font = 'bold 38px Helvetica, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 270, 50);
  ageDecal(g, 512, 96, seeded(text.length * 7 + 3));
  return finish(c);
}

export function flagTexture() {
  const c = cv(988, 520), g = c.getContext('2d')!; g.scale(2, 2);
  for (let i = 0; i < 13; i++) { g.fillStyle = i % 2 ? '#f0efe9' : '#a53444'; g.fillRect(0, (i * 260) / 13, 494, 260 / 13 + 1); }   // sun-faded cloth, not dyed-in-yesterday synthetic
  g.fillStyle = '#3c3b6e'; g.fillRect(0, 0, 198, 140);
  g.fillStyle = '#f0efe9';
  for (let row = 0; row < 9; row++) for (let col = 0; col < (row % 2 ? 5 : 6); col++) { g.beginPath(); g.arc((row % 2 ? 33 : 16) + col * 33, 12 + row * 15, 3.2, 0, 7); g.fill(); }
  ageDecal(g, 494, 260, seeded(23));
  return finish(c);
}

/** Solar-cell grid for the array: per-cell tint jitter, hairline busbars, dust speckle and corner accumulation
 *  (dust on the glass is a real power-loss problem, and it kills the "flat sticker" read). */
export function cellTexture(cols: number, rows: number) {
  const c = cv(128, 128), g = c.getContext('2d')!, r = seeded(71);
  g.fillStyle = '#0c1a3a'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#8fa0b6'; g.lineWidth = 3; g.strokeRect(1, 1, 126, 126);
  g.lineWidth = 1; g.strokeStyle = 'rgba(143,160,182,.5)';
  for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32, 128); g.stroke(); g.beginPath(); g.moveTo(0, i * 32); g.lineTo(128, i * 32); g.stroke(); }
  // per-cell tint: no two cells exactly the same blue
  for (let cy = 0; cy < 4; cy++) for (let cx = 0; cx < 4; cx++) {
    const v = Math.floor(r() * 14) - 7;
    g.fillStyle = `rgba(${18 + v},${30 + v},${62 + v},0.55)`; g.fillRect(cx * 32 + 2, cy * 32 + 2, 28, 28);
  }
  // dust speckle and faint streaks where dust has slid down the glass
  for (let i = 0; i < 130; i++) { g.fillStyle = `rgba(112,106,96,${0.08 + r() * 0.2})`; g.beginPath(); g.arc(r() * 128, r() * 128, 0.4 + r() * 1.3, 0, 7); g.fill(); }
  for (let i = 0; i < 6; i++) { g.strokeStyle = `rgba(112,106,96,${0.06 + r() * 0.1})`; g.lineWidth = 1 + r() * 2; const x = r() * 128; g.beginPath(); g.moveTo(x, r() * 40); g.lineTo(x + (r() - 0.5) * 8, 128); g.stroke(); }
  const t = finish(c, true); t.repeat.set(cols, rows); return t;
}

/** Paint per-vertex dust onto a geometry: a warm-grey film that thickens toward the ground (nothing stays clean
 *  at height zero on the Moon) with a hash mottle so it never reads as a smooth gradient. Returns the geometry,
 *  ready for a material with vertexColors: true. */
export function dustGradient(geo: THREE.BufferGeometry, o: { y0?: number; y1?: number; max?: number; hash?: number } = {}): THREE.BufferGeometry {
  const p = geo.attributes.position;
  const y0 = o.y0 ?? 0, y1 = o.y1 ?? 2.2, max = o.max ?? 0.45, hseed = o.hash ?? 1;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const t = Math.min(1, Math.max(0, (y1 - y) / (y1 - y0)));
    const x = p.getX(i), z = p.getZ(i);
    const hv = Math.sin(x * 12.9898 * hseed + y * 78.233 + z * 37.719) * 43758.5453, n = hv - Math.floor(hv);
    const f = t * (0.55 + 0.45 * n) * max;   // dust fraction at this vertex
    const k = 1 - f;
    col[i * 3] = k; col[i * 3 + 1] = k * (1 - 0.05 * f); col[i * 3 + 2] = k * (1 - 0.13 * f);   // warm grey, never clean-dark
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}
/** Aged pad ring paint: off-white with wear-through gaps, dust film and streaks. */
export function ringTexture() {
  const c = cv(512, 64), g = c.getContext('2d')!, r = seeded(51);
  g.fillStyle = '#d8d4c9'; g.fillRect(0, 0, 512, 64);
  for (let i = 0; i < 60; i++) {   // paint worn through to the slab in patches
    const x = r() * 512, w = 4 + r() * 26;
    g.fillStyle = `rgba(120,114,106,${0.25 + r() * 0.45})`; g.fillRect(x, 0, w, 64);
  }
  for (let i = 0; i < 40; i++) { g.strokeStyle = `rgba(96,90,82,${0.08 + r() * 0.2})`; g.lineWidth = 1 + r() * 3; const y = r() * 64; g.beginPath(); g.moveTo(r() * 512, y); g.lineTo(r() * 512, y + (r() - 0.5) * 8); g.stroke(); }
  const t = finish(c, true); t.repeat.set(8, 1); return t;
}

/** Lander blast stain: a soft, off-centre radial scorch with streaks blown outward. */
export function scorchTexture() {
  const c = cv(256, 256), g = c.getContext('2d')!, r = seeded(64);
  const gr = g.createRadialGradient(128, 128, 8, 128, 128, 120);
  gr.addColorStop(0, 'rgba(28,25,22,0.55)'); gr.addColorStop(0.45, 'rgba(38,34,30,0.28)'); gr.addColorStop(1, 'rgba(48,44,38,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 36; i++) {   // streaks blown outward from the centre, like ejecta rays
    const a = r() * Math.PI * 2, r0 = 30 + r() * 30, r1 = r0 + 30 + r() * 70;
    g.strokeStyle = `rgba(30,27,24,${0.1 + r() * 0.2})`; g.lineWidth = 1 + r() * 4;
    g.beginPath(); g.moveTo(128 + Math.cos(a) * r0, 128 + Math.sin(a) * r0); g.lineTo(128 + Math.cos(a) * r1, 128 + Math.sin(a) * r1); g.stroke();
  }
  return finish(c);
}

/** Gold MLI foil: an albedo where every crease has its own bright ridge and dark valley, a matching bump, and a
 *  shared metal roughness so the blanket reads as crumpled metal film instead of a flat gold paint. */
const foilCache = new Map<string, { map: THREE.CanvasTexture; bump: THREE.CanvasTexture }>();
export function goldFoil(rx = 1, ry = 1) {
  const key = `${rx},${ry}`;
  const hit = foilCache.get(key);
  if (hit) return hit;
  const S = 256, a = cv(S, S), b = cv(S, S), ga = a.getContext('2d')!, gb = b.getContext('2d')!, r = seeded(7);
  ga.fillStyle = '#b8902f'; ga.fillRect(0, 0, S, S);
  gb.fillStyle = '#808080'; gb.fillRect(0, 0, S, S);
  for (let i = 0; i < 850; i++) {
    const x = r() * S, y = r() * S, ang = r() * Math.PI, len = 6 + r() * 52, w = 1 + r() * 3;
    const dx = Math.cos(ang) * len, dy = Math.sin(ang) * len, v = Math.floor(r() * 130 - 65);
    ga.strokeStyle = `rgba(${186 + v},${144 + v},${47 + Math.floor(v * 0.6)},0.6)`; ga.lineWidth = w;
    gb.strokeStyle = `rgba(${128 + v},${128 + v},${128 + v},0.75)`; gb.lineWidth = w;
    for (const g of [ga, gb]) wrap9(g, S, (ox, oy) => { g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + dx, y + oy + dy); g.stroke(); });
  }
  // sharp glints on a few ridge tops, and soot-darkened hollows
  for (let i = 0; i < 90; i++) {
    const x = r() * S, y = r() * S, len = 3 + r() * 16, jy = (r() - 0.5) * 6;
    ga.strokeStyle = `rgba(255,236,170,${0.25 + r() * 0.35})`; ga.lineWidth = 0.8;
    wrap9(ga, S, (ox, oy) => { ga.beginPath(); ga.moveTo(x + ox, y + oy); ga.lineTo(x + ox + len, y + oy + jy); ga.stroke(); });
    const x2 = r() * S, y2 = r() * S, jy2 = (r() - 0.5) * 6;
    ga.strokeStyle = `rgba(46,36,20,${0.1 + r() * 0.2})`; ga.lineWidth = 1 + r() * 2;
    wrap9(ga, S, (ox, oy) => { ga.beginPath(); ga.moveTo(x2 + ox, y2 + oy); ga.lineTo(x2 + ox + len, y2 + oy + jy2); ga.stroke(); });
  }
  const map = finish(a, true); map.repeat.set(rx, ry);
  const bump = finish(b, true); bump.colorSpace = THREE.NoColorSpace; bump.repeat.set(rx, ry);
  const set = { map, bump };
  foilCache.set(key, set);
  return set;
}

/** Contact dust: a soft warm-grey blob with mottled edges — stamped under wheels, tank cradles and props so
 *  everything visibly *sits* in the regolith instead of floating on a clean slab. */
export function groundDustTexture() {
  const S = 256, c = cv(S, S), g = c.getContext('2d')!, r = seeded(97);
  const gr = g.createRadialGradient(S / 2, S / 2, 6, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(52,48,43,0.5)'); gr.addColorStop(0.55, 'rgba(74,69,62,0.3)'); gr.addColorStop(1, 'rgba(96,90,80,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 260; i++) {   // mottled, kicked-up edges
    const a = r() * Math.PI * 2, rad = S * (0.18 + r() * 0.3);
    g.fillStyle = `rgba(70,64,56,${0.08 + r() * 0.22})`;
    g.beginPath(); g.arc(S / 2 + Math.cos(a) * rad, S / 2 + Math.sin(a) * rad, 1 + r() * 4, 0, 7); g.fill();
  }
  for (let i = 0; i < 26; i++) {   // speckle spray around the rim
    const a = r() * Math.PI * 2, rad = S * (0.32 + r() * 0.16);
    g.fillStyle = `rgba(88,82,72,${0.1 + r() * 0.2})`;
    g.beginPath(); g.arc(S / 2 + Math.cos(a) * rad, S / 2 + Math.sin(a) * rad, 0.6 + r() * 1.6, 0, 7); g.fill();
  }
  return finish(c);
}

let grainT: THREE.CanvasTexture | null = null;
export function grainTexture() {
  if (grainT) return grainT;
  const c = cv(256, 256), g = c.getContext('2d')!, r = seeded(11), id = g.createImageData(256, 256);
  for (let i = 0; i < 256 * 256; i++) { const v = 205 + Math.floor(r() * 50); id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
  g.putImageData(id, 0, 0);
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(${r() > 0.5 ? 255 : 120},${r() > 0.5 ? 255 : 120},${r() > 0.5 ? 255 : 120},.05)`; g.beginPath(); g.arc(r() * 256, r() * 256, 8 + r() * 30, 0, 7); g.fill(); }
  grainT = new THREE.CanvasTexture(c); grainT.wrapS = grainT.wrapT = THREE.RepeatWrapping; grainT.colorSpace = THREE.NoColorSpace; grainT.anisotropy = 4; return grainT;
}

/** Non-slip composite decking: 2 x 2 tiles per image (0.6 m each), seams, studs, screws, scuffs, with a matching bump map. One image repeats every 1.2 m. */
export function floorTextures(repeat: number) {
  const S = 1024, map = cv(S, S), bump = cv(S, S), g = map.getContext('2d')!, b = bump.getContext('2d')!, r = seeded(5);
  b.fillStyle = '#808080'; b.fillRect(0, 0, S, S);
  for (let ty = 0; ty < 2; ty++) for (let tx = 0; tx < 2; tx++) {
    const v = 112 + Math.floor(r() * 5); g.fillStyle = `rgb(${v},${v + 2},${v + 6})`; g.fillRect(tx * 512, ty * 512, 512, 512);   // tiles differ by about 2 percent, not enough to read as a mismatch
  }
  const id = g.getImageData(0, 0, S, S);
  for (let i = 0; i < S * S; i++) { const n = (r() - 0.5) * 14; id.data[i * 4] += n; id.data[i * 4 + 1] += n; id.data[i * 4 + 2] += n; }
  g.putImageData(id, 0, 0);
  for (let y = 10; y < S; y += 16) for (let x = 10 + ((y / 16) % 2) * 8; x < S; x += 16) { g.fillStyle = 'rgba(0,0,0,.16)'; g.fillRect(x, y, 3, 3); b.fillStyle = '#b0b0b0'; b.fillRect(x, y, 3, 3); }   // anti-slip studs
  for (let i = 0; i < 70; i++) { g.strokeStyle = r() > 0.5 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.07)'; g.lineWidth = 1 + r() * 2; g.beginPath(); const x = r() * S, y = r() * S; g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 90, y + (r() - 0.5) * 90); g.stroke(); }
  for (const k of [0, 512]) {
    g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(k - 2, 0, 5, S); g.fillRect(0, k - 2, S, 5); g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(k + 3, 0, 1, S); g.fillRect(0, k + 3, S, 1);
    b.fillStyle = '#303030'; b.fillRect(k - 2, 0, 5, S); b.fillRect(0, k - 2, S, 5);
  }
  for (const [x, y] of [[0, 0], [512, 0], [0, 512], [512, 512], [256, 0], [256, 512], [0, 256], [512, 256]]) for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { const px = (x + dx * 14 + S) % S, py = (y + dy * 14 + S) % S; g.fillStyle = 'rgba(30,32,36,.7)'; g.beginPath(); g.arc(px, py, 4, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,255,.25)'; g.beginPath(); g.arc(px - 1, py - 1, 1.3, 0, 7); g.fill(); }
  const m = finish(map, true), bm = finish(bump, true); bm.colorSpace = THREE.NoColorSpace; m.repeat.set(repeat, repeat); bm.repeat.set(repeat, repeat);
  return { map: m, bump: bm };
}

// ---------- wear system: every object gets patchy roughness, scuffs and grime ----------
// A single uniform roughness value is the number-one "plastic toy" tell: real hardware is shinier where hands
// and sleeves rub it, duller where dust settles, and repainted in mismatched lots. These presets paint an albedo
// mottle, a roughness map (the important one) and a bump grain on canvas; `wornMat` tints them with any base
// colour, so one small texture set serves the whole outpost instead of clone-stamped flat materials.
export type WearPreset = 'paint' | 'metal' | 'plastic' | 'rubber' | 'fabric';

type WearSet = { map: THREE.CanvasTexture; rough: THREE.CanvasTexture; bump: THREE.CanvasTexture; avgRough: number };
const wearCache = new Map<string, WearSet>();

const PRESET_ROUGH: Record<WearPreset, [number, number]> = {
  // [base roughness, variation amplitude] per preset
  paint: [0.62, 0.24], metal: [0.42, 0.2], plastic: [0.66, 0.18], rubber: [0.93, 0.06], fabric: [0.95, 0.07],
};

export function wearTextures(preset: WearPreset, rep = 1): WearSet {
  const bucket = rep <= 1 ? 1 : rep <= 2 ? 2 : 4;
  const key = preset + bucket;
  const hit = wearCache.get(key);
  if (hit) return hit;
  const S = preset === 'paint' || preset === 'metal' ? 512 : 256, r = seeded(bucket * 977 + preset.length * 131);
  const map = cv(S, S), rough = cv(S, S), bump = cv(S, S);
  const g = map.getContext('2d')!, rg = rough.getContext('2d')!, bg = bump.getContext('2d')!;
  const [base, amp] = PRESET_ROUGH[preset];

  // albedo: near-white so it tints freely; tonal mottle only (±12%), the realism lives in the roughness map
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
  noiseLayers(g, S, r, [[2, 0.09], [5, 0.09], [11, 0.1], [29, 0.07]]);

  // roughness: base grey, then the wear story — dull dust patches, shiny rub marks, fingerprint smudges
  rg.fillStyle = `rgb(${(base * 255) | 0},${(base * 255) | 0},${(base * 255) | 0})`; rg.fillRect(0, 0, S, S);
  const tint = (ctx: CanvasRenderingContext2D, alpha: number, light: boolean) => {
    const v = light ? 255 : 0;
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha})`;
  };
  // broad dull/shiny patches (dust drifts vs. rubbed-clean areas)
  for (let i = 0; i < 34; i++) {
    const x = r() * S, y = r() * S, rr = 14 + r() * 62, light = r() > 0.45;
    tint(rg, 0.07 + r() * 0.13, light);
    wrap9(rg, S, (ox, oy) => { rg.beginPath(); rg.arc(x + ox, y + oy, rr, 0, 7); rg.fill(); });
  }
  // fine noise so the roughness breaks up under close inspection
  noiseLayers(rg, S, r, [[6, 0.06], [17, 0.06], [43, 0.05]]);

  // scuffs and scratches: brighter (shinier) thin streaks in the rough map, faint groove in the bump,
  // and a barely-lighter streak in the albedo where the surface is worn through
  const nScr = preset === 'rubber' ? 14 : preset === 'fabric' ? 8 : 52;
  for (let i = 0; i < nScr; i++) {
    const x = r() * S, y = r() * S, len = 18 + r() * 120, ang = r() * Math.PI, w = 0.7 + r() * 2.1;
    const dx = Math.cos(ang) * len, dy = Math.sin(ang) * len;
    const a = 0.16 + r() * 0.3;
    rg.strokeStyle = `rgba(255,255,255,${a})`; rg.lineWidth = w;
    g.strokeStyle = `rgba(255,255,255,${a * 0.16})`;
    bg.strokeStyle = `rgba(255,255,255,${a * 0.5})`; bg.lineWidth = Math.max(1, w * 0.7);
    wrap9(rg, S, (ox, oy) => { rg.beginPath(); rg.moveTo(x + ox, y + oy); rg.lineTo(x + ox + dx, y + oy + dy); rg.stroke(); });
    wrap9(g, S, (ox, oy) => { g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + dx, y + oy + dy); g.stroke(); });
    wrap9(bg, S, (ox, oy) => { bg.beginPath(); bg.moveTo(x + ox, y + oy); bg.lineTo(x + ox + dx, y + oy + dy); bg.stroke(); });
  }

  // grime: soft dark blotches (higher roughness, slightly darker albedo) — grease, dust clumps, water stains
  const nGrime = preset === 'metal' || preset === 'plastic' ? 40 : 26;
  for (let i = 0; i < nGrime; i++) {
    const x = r() * S, y = r() * S, rr = 6 + r() * 28, a = 0.09 + r() * 0.15;
    rg.strokeStyle = `rgba(0,0,0,${a * 1.3})`; rg.lineWidth = 2 + r() * 5;
    g.fillStyle = `rgba(46,42,38,${a * 0.6})`;
    wrap9(rg, S, (ox, oy) => { rg.beginPath(); rg.arc(x + ox, y + oy, rr, 0, 7); rg.stroke(); });
    wrap9(g, S, (ox, oy) => { g.beginPath(); g.arc(x + ox, y + oy, rr * 0.8, 0, 7); g.fill(); });
  }

  // per-preset character
  if (preset === 'fabric') {
    // weave: faint horizontal and vertical threads in albedo + bump, crease sheen lines in rough
    for (let y = 0; y < S; y += 2) { g.fillStyle = `rgba(0,0,0,${0.02 + (y % 4 === 0 ? 0.02 : 0)})`; g.fillRect(0, y, S, 1); bg.fillStyle = 'rgba(200,200,200,0.25)'; bg.fillRect(0, y, S, 1); }
    for (let x = 0; x < S; x += 3) { bg.fillStyle = 'rgba(90,90,90,0.2)'; bg.fillRect(x, 0, 1, S); }
    for (let i = 0; i < 14; i++) { const x = r() * S; rg.strokeStyle = `rgba(255,255,255,${0.08 + r() * 0.1})`; rg.lineWidth = 3 + r() * 7; wrap9(rg, S, (ox, oy) => { rg.beginPath(); rg.moveTo(x + ox, oy); rg.lineTo(x + ox + (r() - 0.5) * 40, oy + S); rg.stroke(); }); }
  }
  if (preset === 'metal') {
    // machining: faint brushed streaks, and oil-fingerprint smudges (duller, darker)
    for (let i = 0; i < 240; i++) { const y = r() * S, x = r() * S, w = 12 + r() * 60, a = 0.02 + r() * 0.05; bg.strokeStyle = `rgba(${r() > 0.5 ? 220 : 60},${r() > 0.5 ? 220 : 60},${r() > 0.5 ? 220 : 60},${a})`; bg.lineWidth = 0.8; bg.beginPath(); bg.moveTo(x, y); bg.lineTo(x + w, y); bg.stroke(); }
    for (let i = 0; i < 10; i++) { const x = r() * S, y = r() * S, rr = 5 + r() * 13; rg.fillStyle = `rgba(0,0,0,${0.1 + r() * 0.16})`; g.fillStyle = 'rgba(40,36,30,0.05)'; wrap9(rg, S, (ox, oy) => { rg.beginPath(); rg.arc(x + ox, y + oy, rr, 0, 7); rg.fill(); }); wrap9(g, S, (ox, oy) => { g.beginPath(); g.arc(x + ox, y + oy, rr, 0, 7); g.fill(); }); }
  }
  if (preset === 'rubber') {
    for (let i = 0; i < 900; i++) { const x = r() * S, y = r() * S; g.fillStyle = `rgba(255,255,255,${r() * 0.05})`; g.fillRect(x, y, 1.5, 1.5); bg.fillStyle = `rgba(${r() > 0.5 ? 210 : 70},${r() > 0.5 ? 210 : 70},${r() > 0.5 ? 210 : 70},${r() * 0.3})`; bg.fillRect(x, y, 2, 2); }
  }
  if (preset === 'plastic') {
    // gloss wear where hands touch: shinier soft patches, plus mould-line speckle in the bump
    for (let i = 0; i < 12; i++) { const x = r() * S, y = r() * S, rr = 10 + r() * 30; rg.fillStyle = `rgba(255,255,255,${0.12 + r() * 0.18})`; wrap9(rg, S, (ox, oy) => { rg.beginPath(); rg.arc(x + ox, y + oy, rr, 0, 7); rg.fill(); }); }
  }

  // bump base + fine grain everywhere
  bg.fillStyle = 'rgba(128,128,128,0.55)'; bg.fillRect(0, 0, S, S);
  const id = bg.getImageData(0, 0, S, S);
  for (let i = 0; i < S * S; i++) { const n = (r() - 0.5) * 46; id.data[i * 4] += n; id.data[i * 4 + 1] += n; id.data[i * 4 + 2] += n; }
  bg.putImageData(id, 0, 0);

  const t = (c: HTMLCanvasElement, srgb: boolean) => {
    const tx = new THREE.CanvasTexture(c); tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.repeat.set(bucket, bucket); tx.anisotropy = 4;
    tx.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; return tx;
  };
  const set: WearSet = { map: t(map, true), rough: t(rough, false), bump: t(bump, false), avgRough: base + amp * 0.1 };
  wearCache.set(key, set);
  return set;
}

export type WornOpts = { rough?: number; metal?: number; repeat?: number; jitter?: boolean; seed?: number; extra?: THREE.MeshStandardMaterialParameters };

/** A worn MeshStandardMaterial: patchy roughness, scuffs and grime, dielectric paint (metalness ~ 0 unless asked).
 *  Pass `extra.map` to keep a bespoke albedo (panel grids etc.) — the wear then applies through roughness and bump. */
export function wornMat(color: number, preset: WearPreset = 'paint', o: WornOpts = {}): THREE.MeshStandardMaterial {
  const w = wearTextures(preset, o.repeat ?? 1);
  const metal = o.metal ?? (preset === 'metal' ? 0.85 : preset === 'paint' ? 0.04 : 0.02);
  const albedo = (o.extra?.map as THREE.Texture | undefined) ?? w.map;   // a bespoke albedo (panel grids etc.) wins over the wear mottle
  const params: THREE.MeshStandardMaterialParameters = {
    color, metalness: metal,
    map: albedo,
    roughnessMap: w.rough, bumpMap: w.bump,
    bumpScale: preset === 'fabric' ? 0.6 : preset === 'metal' ? 0.3 : 0.55,
    ...o.extra,
  };
  params.map = albedo;   // if extra carried a map it is the same albedo; the wear mottle never overrides it
  const m = new THREE.MeshStandardMaterial(params);
  // caller roughness becomes a multiplier around the preset's average
  const k = (o.rough ?? w.avgRough) / w.avgRough;
  m.roughness = Math.max(0.05, Math.min(1.6, k));
  if (o.jitter !== false) {   // no two objects share an exact tint: clone-stamped sameness reads as manufactured toys
    m.color.offsetHSL((Math.random() - 0.5) * 0.02, -(0.04 + Math.random() * 0.09), (Math.random() - 0.5) * 0.05);
  }
  return m;
}
