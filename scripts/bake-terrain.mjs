
#!/usr/bin/env node

// Bake the LOLA 5 m south-polar DEM into:
//   public/terrain/shackleton.bin
//   public/terrain/shackleton.json
//
// Usage:
// node scripts/bake-terrain.mjs \
//   --lbl data/LDEM_875S_5M.LBL \
//   --img data/LDEM_875S_5M.IMG \
//   --size 2048 --pick 0 --preview preview.png

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// --------------------------------------------------
// ARGUMENTS
// --------------------------------------------------

const args = {};

for (let i = 0; i < process.argv.length; i++) {
  const key = process.argv[i];

  if (!key.startsWith('--')) continue;

  const name = key.slice(2);
  const next = process.argv[i + 1];

  if (!next || next.startsWith('--')) {
    args[name] = 'true';
  } else {
    args[name] = next;
    i++;
  }
}

if (!args.lbl || !args.img) {
  throw new Error(
    'Missing arguments: --lbl and --img are required.'
  );
}

const SIZE = Number(args.size ?? 2048);
const PICK = Number(args.pick ?? 0);

if (!Number.isInteger(SIZE) || SIZE < 64 || SIZE > 8192) {
  throw new Error('Tile size must be an integer between 64 and 8192.');
}

if (!Number.isInteger(PICK) || PICK < 0) {
  throw new Error('--pick must be a non-negative integer.');
}

// --------------------------------------------------
// READ LABEL
// --------------------------------------------------

const lbl = fs.readFileSync(args.lbl, 'utf8');

function labelValue(key) {
  const re = new RegExp(
    '^\\s*' + key + '\\s*=\\s*([-+0-9.eE]+)',
    'mi'
  );

  const match = lbl.match(re);

  if (!match) {
    throw new Error(`Missing ${key} in LOLA label.`);
  }

  const value = Number(match[1]);

  if (!Number.isFinite(value)) {
    throw new Error(`Invalid ${key} in LOLA label.`);
  }

  return value;
}

const W = labelValue('LINE_SAMPLES');
const H = labelValue('LINES');
const DNSCALE = labelValue('SCALING_FACTOR');
const RES = labelValue('MAP_SCALE');

const C0 = labelValue('SAMPLE_PROJECTION_OFFSET');
const R0 = labelValue('LINE_PROJECTION_OFFSET');

const RM = labelValue('A_AXIS_RADIUS') * 1000;

const SAMPLE_BITS = labelValue('SAMPLE_BITS');

if (SAMPLE_BITS !== 16) {
  throw new Error(`Expected 16-bit samples, got ${SAMPLE_BITS}.`);
}

if (!/SAMPLE_TYPE\s*=\s*LSB_INTEGER/i.test(lbl)) {
  throw new Error('Expected little-endian signed integer samples.');
}

if (W <= 0 || H <= 0 || RES <= 0 || DNSCALE <= 0 || RM <= 0) {
  throw new Error('Invalid dimensions or projection parameters.');
}

const EXPECTED_BYTES = W * H * 2;

console.log('LOLA DEM information:');
console.log(`  Dimensions: ${W} x ${H}`);
console.log(`  Resolution: ${RES} m/px`);
console.log(`  DN scale: ${DNSCALE}`);
console.log(`  Moon radius: ${RM / 1000} km`);
console.log(`  Expected raster size: ${EXPECTED_BYTES} bytes`);

// --------------------------------------------------
// OPEN RASTER
// --------------------------------------------------

const fd = fs.openSync(args.img, 'r');
const fileSize = fs.fstatSync(fd).size;

// Support detached PDS image pointers when supplied.
let DATA_OFFSET = 0;

const pointer = lbl.match(/^\s*\^IMAGE\s*=\s*(.+)$/mi);

if (pointer) {
  const value = pointer[1].trim();

  const tuple = value.match(/\(\s*"?[^",]+?"?\s*,\s*(\d+)\s*\)/);

  if (tuple) {
    const record = Number(tuple[1]);
    const recordBytes = labelValue('RECORD_BYTES');
    DATA_OFFSET = (record - 1) * recordBytes;
  } else if (/^\d+$/.test(value)) {
    const record = Number(value);
    const recordBytes = labelValue('RECORD_BYTES');
    DATA_OFFSET = (record - 1) * recordBytes;
  }
}

if (DATA_OFFSET + EXPECTED_BYTES > fileSize) {
  throw new Error(
    `Raster is too small. Expected ${EXPECTED_BYTES} bytes ` +
    `at offset ${DATA_OFFSET}, found ${fileSize} bytes.`
  );
}

console.log(`  Raster offset: ${DATA_OFFSET}`);

// --------------------------------------------------
// FAST RANDOM ACCESS WITH ROW CACHE
// --------------------------------------------------

const CACHE_LIMIT = 128;
const rowCache = new Map();

const rowBuffer = Buffer.alloc(W * 2);

function getRow(row) {
  if (row < 0 || row >= H) return null;

  if (rowCache.has(row)) {
    const value = rowCache.get(row);

    // Refresh LRU position.
    rowCache.delete(row);
    rowCache.set(row, value);

    return value;
  }

  const buffer = Buffer.alloc(W * 2);

  let bytesRead = 0;

  while (bytesRead < buffer.length) {
    const n = fs.readSync(
      fd,
      buffer,
      bytesRead,
      buffer.length - bytesRead,
      DATA_OFFSET + row * W * 2 + bytesRead
    );

    if (n === 0) {
      throw new Error(`Unexpected end of raster at row ${row}.`);
    }

    bytesRead += n;
  }

  rowCache.set(row, buffer);

  if (rowCache.size > CACHE_LIMIT) {
    rowCache.delete(rowCache.keys().next().value);
  }

  return buffer;
}

const D2R = Math.PI / 180;

function rawHeight(c, r) {
  if (
    c < 0 || r < 0 ||
    c >= W || r >= H ||
    !Number.isFinite(c) ||
    !Number.isFinite(r)
  ) {
    return NaN;
  }

  const row = getRow(r);
  const dn = row.readInt16LE(c * 2);

  // LOLA no-data / invalid elevation protection.
  if (dn <= -32000 || dn >= 32000) {
    return NaN;
  }

  const height = dn * DNSCALE;

  if (!Number.isFinite(height) || Math.abs(height) > 20000) {
    return NaN;
  }

  return height;
}

function h(c, r) {
  return rawHeight(Math.round(c), Math.round(r));
}

// --------------------------------------------------
// POLAR STEREOGRAPHIC PROJECTION
// --------------------------------------------------

const rhoOf = lat =>
  2 * RM * Math.tan(((90 + lat) * D2R) / 2);

const variants = [];

for (const swap of [0, 1]) {
  for (const sx of [1, -1]) {
    for (const sy of [1, -1]) {
      variants.push({
        swap,
        sx,
        sy,

        fwd(lat, lon) {
          const p = rhoOf(lat);
          const l = lon * D2R;

          let X = p * Math.sin(l);
          let Y = p * Math.cos(l);

          if (swap) [X, Y] = [Y, X];

          return [
            C0 + (sx * X) / RES,
            R0 + (sy * Y) / RES
          ];
        },

        inv(c, r) {
          let X = sx * (c - C0) * RES;
          let Y = sy * (r - R0) * RES;

          if (swap) [X, Y] = [Y, X];

          const rho = Math.hypot(X, Y);

          const lat =
            -90 + (2 * Math.atan(rho / (2 * RM))) / D2R;

          const lon =
            ((Math.atan2(X, Y) / D2R) % 360 + 360) % 360;

          return [lat, lon];
        }
      });
    }
  }
}

// --------------------------------------------------
// SHACKLETON CRATER DETECTION
// --------------------------------------------------

const SHACKLETON = {
  lat: -89.9,
  lon: 129.78
};

function mean(values) {
  if (!values.length) return NaN;

  return values.reduce((a, b) => a + b, 0) / values.length;
}

function craterFit(cx, cy) {
  const crest = [];
  const radii = [];

  for (let k = 0; k < 72; k++) {
    const t = (k / 72) * Math.PI * 2;

    let best = -Infinity;
    let bestRadius = 0;

    for (let radius = 8000; radius <= 13000; radius += 100) {
      const c = Math.round(cx + Math.cos(t) * radius / RES);
      const r = Math.round(cy + Math.sin(t) * radius / RES);

      const value = h(c, r);

      if (Number.isFinite(value) && value > best) {
        best = value;
        bestRadius = radius;
      }
    }

    if (Number.isFinite(best) && bestRadius > 0) {
      crest.push({
        t,
        h: best,
        r: bestRadius
      });

      radii.push(bestRadius);
    }
  }

  if (crest.length < 48) {
    return {
      score: -Infinity,
      depth: 0,
      sd: Infinity,
      crest
    };
  }

  let floorSum = 0;
  let floorCount = 0;

  for (let radius = 0; radius <= 3000; radius += 150) {
    for (let k = 0; k < 8; k++) {
      const t = (k / 8) * Math.PI * 2;

      const value = h(
        Math.round(cx + Math.cos(t) * radius / RES),
        Math.round(cy + Math.sin(t) * radius / RES)
      );

      if (Number.isFinite(value)) {
        floorSum += value;
        floorCount++;
      }
    }
  }

  if (!floorCount) {
    return {
      score: -Infinity,
      depth: 0,
      sd: Infinity,
      crest
    };
  }

  const averageRadius = mean(radii);

  const sd = Math.sqrt(
    mean(radii.map(r => (r - averageRadius) ** 2))
  );

  const depth =
    mean(crest.map(p => p.h)) - floorSum / floorCount;

  return {
    score: depth / (0.5 + sd / 1000),
    depth,
    sd,
    crest
  };
}

console.log('\nTesting raster orientations...');

const fits = variants.map((variant, i) => {
  const [cx, cy] = variant.fwd(
    SHACKLETON.lat,
    SHACKLETON.lon
  );

  const result = craterFit(cx, cy);

  console.log(
    `  Orientation ${i}: ` +
    `depth ${result.depth.toFixed(0)} m, ` +
    `radius variation ${result.sd.toFixed(0)} m, ` +
    `score ${result.score.toFixed(2)}`
  );

  return {
    i,
    cx,
    cy,
    ...result
  };
});

let orientation;

if (args.variant !== undefined) {
  orientation = Number(args.variant);

  if (
    !Number.isInteger(orientation) ||
    orientation < 0 ||
    orientation >= variants.length
  ) {
    throw new Error('--variant must be between 0 and 7.');
  }
} else {
  const ranked = [...fits].sort(
    (a, b) => b.score - a.score
  );

  const best = ranked[0];
  const second = ranked[1];

  console.log(
    `\nBest orientation: ${best.i} ` +
    `(score ${best.score.toFixed(2)})`
  );

  if (
    !Number.isFinite(best.score) ||
    !(best.score > 1.3 * second.score) ||
    !(best.depth > 1500)
  ) {
    throw new Error(
      'Raster orientation is ambiguous. ' +
      'Inspect the orientation scores before selecting --variant.'
    );
  }

  orientation = best.i;
}

const V = variants[orientation];
const fit = fits[orientation];

console.log(`Using orientation ${orientation}.`);

// --------------------------------------------------
// ILLUMINATION / HORIZON SCAN
// --------------------------------------------------

const SUN_R = 0.27 * D2R;
const TILT = 1.54 * D2R;
const MAST = 12;

function litFraction(c, r) {
  const base = h(c, r);

  if (!Number.isFinite(base)) return 0;

  const observerHeight = base + MAST;
  const horizon = [];

  for (let k = 0; k < 72; k++) {
    const t = (k / 72) * Math.PI * 2;

    const dx = Math.cos(t);
    const dy = Math.sin(t);

    let best = -Math.PI / 2;

    for (
      let d = 10;
      d < 6000;
      d *= 1.07
    ) {
      const value = h(
        Math.round(c + dx * d / RES),
        Math.round(r + dy * d / RES)
      );

      if (!Number.isFinite(value)) continue;

      const angle = Math.atan2(
        value - observerHeight - d * d / (2 * RM),
        d
      );

      best = Math.max(best, angle);
    }

    horizon.push(best);
  }

  let lit = 0;
  let total = 0;

  for (let k = 0; k < 72; k++) {
    for (let s = 0; s < 12; s++) {
      total++;

      const sunAngle =
        TILT * Math.sin((s / 12) * Math.PI * 2) + SUN_R;

      if (sunAngle > horizon[k]) {
        lit++;
      }
    }
  }

  return lit / total;
}

// --------------------------------------------------
// SELECT RIM SITE
// --------------------------------------------------

console.log('\nScanning Shackleton rim...');

const candidates = [];

for (const cr of fit.crest) {
  let bestC = 0;
  let bestR = 0;
  let bestH = -Infinity;

  for (
    let d = cr.r - 150;
    d <= cr.r + 150;
    d += RES
  ) {
    const c = fit.cx + Math.cos(cr.t) * d / RES;
    const r = fit.cy + Math.sin(cr.t) * d / RES;

    const value = h(c, r);

    if (Number.isFinite(value) && value > bestH) {
      bestH = value;
      bestC = c;
      bestR = r;
    }
  }

  if (!Number.isFinite(bestH)) continue;

  candidates.push({
    c: bestC,
    r: bestR,
    elev: bestH,
    lit: litFraction(bestC, bestR)
  });
}

if (!candidates.length) {
  throw new Error('No valid rim sites found.');
}

candidates.sort((a, b) => b.lit - a.lit);

console.log('\nRim site candidates:');

candidates.slice(0, 6).forEach((site, i) => {
  const [lat, lon] = V.inv(site.c, site.r);

  console.log(
    `  #${i}: ${(site.lit * 100).toFixed(1)}% sunlight, ` +
    `${site.elev.toFixed(0)} m elevation, ` +
    `${lat.toFixed(3)}, ${lon.toFixed(2)}E`
  );
});

if (PICK >= candidates.length) {
  throw new Error(
    `Pick ${PICK} is invalid. ` +
    `Only ${candidates.length} sites were found.`
  );
}

const site = candidates[PICK];
const [siteLat, siteLon] = V.inv(site.c, site.r);

// --------------------------------------------------
// LOCAL EAST / SOUTH COORDINATES
// --------------------------------------------------

function normalize(v) {
  const length = Math.hypot(v[0], v[1]);

  if (!length) {
    throw new Error('Invalid local coordinate direction.');
  }

  return [v[0] / length, v[1] / length];
}

const p0 = V.fwd(siteLat, siteLon);
const pe = V.fwd(siteLat, siteLon + 0.001);
const pn = V.fwd(siteLat + 0.0005, siteLon);

const east = normalize([
  pe[0] - p0[0],
  pe[1] - p0[1]
]);

const north = normalize([
  pn[0] - p0[0],
  pn[1] - p0[1]
]);

// A rotated square needs a diagonal-sized source region.
const half = Math.ceil(SIZE * Math.SQRT1_2 / 2 + 4);

const rc = Math.round(site.c);
const rr = Math.round(site.r);

const x0 = rc - half;
const y0 = rr - half;

const span = half * 2 + 1;

if (
  x0 < 0 || y0 < 0 ||
  x0 + span > W ||
  y0 + span > H
) {
  throw new Error('Requested tile extends outside the DEM.');
}

// --------------------------------------------------
// LOAD LOCAL REGION
// --------------------------------------------------

console.log(
  `\nLoading local DEM region: ${span} x ${span} pixels...`
);

const region = new Float32Array(span * span);
const regionBuffer = Buffer.alloc(span * 2);

for (let j = 0; j < span; j++) {
  let bytesRead = 0;

  while (bytesRead < regionBuffer.length) {
    const n = fs.readSync(
      fd,
      regionBuffer,
      bytesRead,
      regionBuffer.length - bytesRead,
      DATA_OFFSET + ((y0 + j) * W + x0) * 2 + bytesRead
    );

    if (!n) {
      throw new Error(`Unexpected EOF at source row ${j}.`);
    }

    bytesRead += n;
  }

  for (let i = 0; i < span; i++) {
    const dn = regionBuffer.readInt16LE(i * 2);

    const value =
      dn <= -32000 || dn >= 32000
        ? NaN
        : dn * DNSCALE;

    region[j * span + i] = value;
  }
}

// --------------------------------------------------
// BILINEAR INTERPOLATION
// --------------------------------------------------

function bilinear(c, r) {
  const fx = c - x0;
  const fy = r - y0;

  const i = Math.floor(fx);
  const j = Math.floor(fy);

  if (
    i < 0 || j < 0 ||
    i >= span - 1 ||
    j >= span - 1
  ) {
    return NaN;
  }

  const u = fx - i;
  const v = fy - j;

  const A = region[j * span + i];
  const B = region[j * span + i + 1];
  const C = region[(j + 1) * span + i];
  const D = region[(j + 1) * span + i + 1];

  if (![A, B, C, D].every(Number.isFinite)) {
    const valid = [A, B, C, D].filter(Number.isFinite);
    return valid.length ? mean(valid) : NaN;
  }

  return (
    A +
    u * (B - A) +
    v * (C - A + u * (A - B - C + D))
  );
}

// --------------------------------------------------
// BAKE OUTPUT TILE
// --------------------------------------------------

console.log(`\nBaking ${SIZE} x ${SIZE} terrain tile...`);

const STEP = 0.5;

const output = new Int16Array(SIZE * SIZE);
const grid = new Float32Array(SIZE * SIZE);

const h0 = bilinear(site.c, site.r);

if (!Number.isFinite(h0)) {
  throw new Error('Could not determine site elevation.');
}

let previous = 0;
let low = Infinity;
let high = -Infinity;
let voids = 0;

for (let j = 0; j < SIZE; j++) {
  for (let i = 0; i < SIZE; i++) {
    const eastMetres =
      (i + 0.5 - SIZE / 2) * RES;

    const northMetres =
      -(j + 0.5 - SIZE / 2) * RES;

    const c =
      site.c +
      (eastMetres * east[0] + northMetres * north[0]) / RES;

    const r =
      site.r +
      (eastMetres * east[1] + northMetres * north[1]) / RES;

    let value = bilinear(c, r);

    if (!Number.isFinite(value)) {
      value = previous;
      voids++;
    } else {
      value -= h0;
      previous = value;
    }

    const index = j * SIZE + i;

    grid[index] = value;

    low = Math.min(low, value);
    high = Math.max(high, value);

    output[index] = Math.max(
      -32768,
      Math.min(32767, Math.round(value / STEP))
    );
  }

  if ((j + 1) % 256 === 0 || j === SIZE - 1) {
    console.log(
      `  Progress: ${j + 1}/${SIZE} rows ` +
      `(${((j + 1) / SIZE * 100).toFixed(1)}%)`
    );
  }
}

// --------------------------------------------------
// METADATA
// --------------------------------------------------

const craterVector = [
  fit.cx - site.c,
  fit.cy - site.r
];

const craterEast =
  craterVector[0] * east[0] +
  craterVector[1] * east[1];

const craterNorth =
  craterVector[0] * north[0] +
  craterVector[1] * north[1];

const craterDistance =
  Math.hypot(craterEast, craterNorth) * RES;

const metadata = {
  n: SIZE,
  res: RES,
  scale: STEP,

  source: path.basename(args.img),

  siteElevationM: h0,
  reliefM: [low, high],

  lat: siteLat,
  lon: siteLon,

  litFraction: site.lit,

  craterDir: {
    x: craterEast / Math.hypot(craterEast, craterNorth),
    z: -craterNorth / Math.hypot(craterEast, craterNorth)
  },

  craterDistM: craterDistance,

  orientation
};

// --------------------------------------------------
// WRITE OUTPUT FILES
// --------------------------------------------------

const outputDir = path.resolve('public/terrain');

fs.mkdirSync(outputDir, { recursive: true });

const binPath = path.join(outputDir, 'shackleton.bin');
const jsonPath = path.join(outputDir, 'shackleton.json');

console.log('\nWriting terrain files...');

fs.writeFileSync(
  binPath,
  Buffer.from(
    output.buffer,
    output.byteOffset,
    output.byteLength
  )
);

fs.writeFileSync(
  jsonPath,
  JSON.stringify(metadata, null, 2) + '\n'
);

// Verify files really exist and have expected sizes.
const binStat = fs.statSync(binPath);
const jsonStat = fs.statSync(jsonPath);

if (binStat.size !== SIZE * SIZE * 2) {
  throw new Error(
    `Binary output size mismatch: ${binStat.size} bytes.`
  );
}

if (jsonStat.size === 0) {
  throw new Error('JSON metadata file is empty.');
}

console.log('\nSUCCESS: Terrain files generated.');

console.log(`  Binary: ${binPath}`);
console.log(`  Binary size: ${binStat.size} bytes`);
console.log(`  Metadata: ${jsonPath}`);
console.log(`  Metadata size: ${jsonStat.size} bytes`);

console.log(
  `  Site: ${siteLat.toFixed(4)}, ${siteLon.toFixed(4)}`
);

console.log(
  `  Sunlight: ${(site.lit * 100).toFixed(1)}%`
);

console.log(
  `  Relief: ${low.toFixed(1)} to ${high.toFixed(1)} m`
);

console.log(`  Invalid pixels: ${voids}`);

// --------------------------------------------------
// OPTIONAL PNG PREVIEW
// --------------------------------------------------

if (args.preview) {
  console.log('\nGenerating hillshade preview...');

  const divisor = SIZE > 1024 ? 2 : 1;
  const previewSize = Math.floor(SIZE / divisor);

  const pixels = new Uint8Array(
    previewSize * previewSize
  );

  for (let j = 1; j < previewSize - 1; j++) {
    for (let i = 1; i < previewSize - 1; i++) {
      const g = (x, y) =>
        grid[y * divisor * SIZE + x * divisor];

      const dx =
        (g(i + 1, j) - g(i - 1, j)) /
        (2 * RES * divisor);

      const dy =
        (g(i, j + 1) - g(i, j - 1)) /
        (2 * RES * divisor);

      const shade =
        150 +
        220 * (-dx * 0.7 + dy * 0.7) /
        Math.sqrt(1 + dx * dx + dy * dy);

      pixels[j * previewSize + i] = Math.max(
        0,
        Math.min(255, Math.round(shade))
      );
    }
  }

  // Minimal valid grayscale PNG encoder.
  const crcTable = Array.from(
    { length: 256 },
    (_, n) => {
      let c = n;

      for (let k = 0; k < 8; k++) {
        c = c & 1
          ? 0xedb88320 ^ (c >>> 1)
          : c >>> 1;
      }

      return c >>> 0;
    }
  );

  function crc32(buffer) {
    let c = 0xffffffff;

    for (const byte of buffer) {
      c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
    }

    return (c ^ 0xffffffff) >>> 0;
  }

  function pngChunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);

    const body = Buffer.concat([
      Buffer.from(type),
      data
    ]);

    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(body));

    return Buffer.concat([
      length,
      body,
      checksum
    ]);
  }

  const raw = Buffer.alloc(
    (previewSize + 1) * previewSize
  );

  for (let y = 0; y < previewSize; y++) {
    raw[y * (previewSize + 1)] = 0;

    Buffer.from(
      pixels.buffer,
      y * previewSize,
      previewSize
    ).copy(
      raw,
      y * (previewSize + 1) + 1
    );
  }

  const ihdr = Buffer.alloc(13);

  ihdr.writeUInt32BE(previewSize, 0);
  ihdr.writeUInt32BE(previewSize, 4);

  ihdr[8] = 8;
  ihdr[9] = 0;

  const png = Buffer.concat([
    Buffer.from([
      137, 80, 78, 71, 13, 10, 26, 10
    ]),

    pngChunk('IHDR', ihdr),

    pngChunk('IDAT', zlib.deflateSync(raw)),

    pngChunk('IEND', Buffer.alloc(0))
  ]);

  fs.writeFileSync(args.preview, png);

  console.log(
    `Preview written: ${path.resolve(args.preview)}`
  );
}

// --------------------------------------------------
// CLEANUP
// --------------------------------------------------

fs.closeSync(fd);

console.log('\nTerrain bake completed successfully.');
