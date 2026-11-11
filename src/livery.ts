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

/** One painted aluminium panel (seams + rivets), tiled rx by ry times. */
export function panelTexture(base: string, seam: string, rx: number, ry: number) {
  const c = cv(256, 256), g = c.getContext('2d')!;
  g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, 'rgba(255,255,255,.10)'); gr.addColorStop(1, 'rgba(0,0,0,.07)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = seam; g.lineWidth = 5; g.strokeRect(0, 0, 256, 256);
  { const r = seeded(31), vg = g.createRadialGradient(128, 128, 60, 128, 128, 190); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.07)'); g.fillStyle = vg; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 260; i++) { g.fillStyle = i % 2 ? 'rgba(0,0,0,.05)' : 'rgba(255,255,255,.05)'; g.fillRect(r() * 254, r() * 254, 1 + r() * 2, 1 + r() * 2); } }
  g.fillStyle = seam;
  for (const [x, y] of [[14, 14], [242, 14], [14, 242], [242, 242], [128, 14], [128, 242]]) { g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); }
  const t = finish(c, true); t.repeat.set(rx, ry); return t;
}

/** Floor / pad tiles, n tiles across the unit UV range. */
export function tileTexture(base: string, seam: string, n: number) {
  const c = cv(128, 128), g = c.getContext('2d')!;
  g.fillStyle = base; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = seam; g.lineWidth = 4; g.strokeRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(0,0,0,.05)';
  for (let i = 0; i < 160; i++) g.fillRect(Math.random() * 126, Math.random() * 126, 2, 2);
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

/** The NASA "meatball": blue disc, stars, white orbit, red vector, white lettering. */
export function meatball() {
  const c = cv(1024, 1024), g = c.getContext('2d')!, r = seeded(42); g.scale(2, 2);
  g.beginPath(); g.arc(256, 256, 250, 0, Math.PI * 2); g.fillStyle = NASA.blueCss; g.fill(); g.save(); g.clip();
  for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(255,255,255,${0.5 + r() * 0.5})`; g.beginPath(); g.arc(r() * 512, r() * 512, 1 + r() * 2.2, 0, 7); g.fill(); }
  g.fillStyle = NASA.redCss; g.beginPath(); g.moveTo(40, 360); g.bezierCurveTo(150, 335, 330, 235, 480, 120); g.bezierCurveTo(370, 240, 280, 320, 175, 400); g.closePath(); g.fill();
  g.save(); g.translate(256, 256); g.rotate(-0.42); g.strokeStyle = '#fff'; g.lineWidth = 7; g.beginPath(); g.ellipse(0, 0, 330, 105, 0, 0, 7); g.stroke(); g.restore();
  g.fillStyle = '#fff'; g.font = '900 120px Helvetica, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('NASA', 256, 262);
  g.restore();
  return finish(c);
}

/** The "worm" wordmark: red, no crossbar on the As. */
export function worm() {
  const c = cv(2048, 680), g = c.getContext('2d')!; g.scale(2, 2);
  g.fillStyle = NASA.redCss; g.font = '900 250px Arial Black, Helvetica, Arial, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left';
  let x = 20; for (const ch of 'N\u039BS\u039B') { g.fillText(ch, x, 175); x += g.measureText(ch).width + 14; }
  return finish(c);
}

/** Equipment plate: light panel, NASA-blue lettering, blue/red edge tabs. */
export function plateTexture(text: string) {
  const c = cv(1024, 192), g = c.getContext('2d')!; g.scale(2, 2);
  g.fillStyle = '#f3f5f7'; g.fillRect(0, 0, 512, 96);
  g.fillStyle = NASA.blueCss; g.fillRect(0, 0, 18, 96); g.fillStyle = NASA.redCss; g.fillRect(18, 0, 6, 96);
  g.strokeStyle = NASA.blueCss; g.lineWidth = 3; g.strokeRect(1.5, 1.5, 509, 93);
  g.fillStyle = NASA.blueCss; g.font = 'bold 38px Helvetica, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 270, 50);
  return finish(c);
}

export function flagTexture() {
  const c = cv(988, 520), g = c.getContext('2d')!; g.scale(2, 2);
  for (let i = 0; i < 13; i++) { g.fillStyle = i % 2 ? '#fff' : '#b22234'; g.fillRect(0, (i * 260) / 13, 494, 260 / 13 + 1); }
  g.fillStyle = '#3c3b6e'; g.fillRect(0, 0, 198, 140);
  g.fillStyle = '#fff';
  for (let row = 0; row < 9; row++) for (let col = 0; col < (row % 2 ? 5 : 6); col++) { g.beginPath(); g.arc((row % 2 ? 33 : 16) + col * 33, 12 + row * 15, 3.2, 0, 7); g.fill(); }
  return finish(c);
}

/** Solar-cell grid for the array. */
export function cellTexture(cols: number, rows: number) {
  const c = cv(128, 128), g = c.getContext('2d')!;
  g.fillStyle = '#10204a'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#9aa7c2'; g.lineWidth = 3; g.strokeRect(1, 1, 126, 126);
  g.lineWidth = 1; g.strokeStyle = 'rgba(154,167,194,.5)'; for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32, 128); g.stroke(); }
  const t = finish(c, true); t.repeat.set(cols, rows); return t;
}

/** Fine neutral grain, used as a roughness and bump map so surfaces stop looking like flat plastic. */
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
