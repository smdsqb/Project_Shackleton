// Bake the LOLA 5 m south-polar DEM into:
//   public/terrain/shackleton.bin
//   public/terrain/shackleton.json
//
// Usage:
// node scripts/bake-terrain.mjs \
//   --lbl data/LDEM_875S_5M.LBL \
//   --img data/LDEM_875S_5M.IMG \
//   --size 2048 --pick 0 --preview preview.png
//
// Optional:
//   --variant 1   Override the default raster orientation (0-7)
//
// --pick chooses a rim-site candidate.
// --variant chooses the raster orientation.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// --------------------------------------------------
// ARGUMENTS
// --------------------------------------------------

const args = {};

for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];

  if (!key.startsWith('--')) {
    continue;
  }

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
  throw new Error('Both --lbl and --img are required.');
}

const SIZE = Number(args.size ?? 2048);
const PICK = Number(args.pick ?? 0);

if (!Number.isInteger(SIZE) || SIZE < 64 || SIZE > 8192) {
  throw new Error('--size must be an integer between 64 and 8192.');
}

if (!Number.isInteger(PICK) || PICK < 0) {
  throw new Error('--pick must be a non-negative integer.');
}

// --------------------------------------------------
// READ PDS LABEL
// --------------------------------------------------

const lbl = fs.readFileSync(args.lbl, 'utf8');

function labelValue(key) {
  const re = new RegExp(
    '^\\s*' + key + '\\s*=\\s*([-+0-9.eE]+)',
    'mi'
  );

  const match = lbl.match(re);

  if (!match) {
    throw new Error(`Missing ${key} in PDS label.`);
  }

  const value = Number(match[1]);

  if (!Number.isFinite(value)) {
    throw new Error(`Invalid ${key} in PDS label.`);
  }

  return value;
}

function optionalLabelValue(key, fallback = null) {
  try {
    return labelValue(key);
  } catch {
    return fallback;
  }
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
  throw new Error(`Expected 16-bit samples; found ${SAMPLE_BITS}.`);
}

if (!/SAMPLE_TYPE\s*=\s*LSB_INTEGER/i.test(lbl)) {
  throw new Error('Expected SAMPLE_TYPE = LSB_INTEGER.');
}

if (
  !Number.isInteger(W) ||
  !Number.isInteger(H) ||
  W <= 0 ||
  H <= 0 ||
  RES <= 0 ||
  DNSCALE <= 0 ||
  RM <= 0
) {
  throw new Error('Invalid DEM dimensions or projection parameters.');
}

const EXPECTED_BYTES = W * H * 2;

console.log('\nLOLA DEM information:');
console.log(`  Dimensions: ${W} x ${H}`);
console.log(`  Resolution: ${RES} m/px`);
console.log(`  DN scale: ${DNSCALE}`);
console.log(`  Moon radius: ${RM / 1000} km`);
console.log(`  Expected raster size: ${EXPECTED_BYTES} bytes`);

// --------------------------------------------------
// OPEN RASTER AND DETERMINE DATA OFFSET
// --------------------------------------------------

const fd = fs.openSync(args.img, 'r');

try {
  const fileSize = fs.fstatSync(fd).size;

  let DATA_OFFSET = 0;

  const pointer = lbl.match(/^\s*\^IMAGE\s*=\s*(.+)$/mi);

  if (pointer) {
    const value = pointer[1].trim();

    const tuple = value.match(
      /\(\s*"?[^",]+?"?\s*,\s*(\d+)\s*\)/
    );

    let record = null;

    if (tuple) {
      record = Number(tuple[1]);
    } else if (/^\d+$/.test(value)) {
      record = Number(value);
    }

    if (record !== null) {
      const recordBytes = optionalLabelValue('RECORD_BYTES');

      if (!recordBytes || recordBytes <= 0) {
        throw new Error(
          'PDS image pointer uses a record number, ' +
          'but RECORD_BYTES is missing or invalid.'
        );
      }

      DATA_OFFSET = (record - 1) * recordBytes;
    }
  }

  if (
    !Number.isSafeInteger(DATA_OFFSET) ||
    DATA_OFFSET < 0 ||
    DATA_OFFSET + EXPECTED_BYTES > fileSize
  ) {
    throw new Error(
      `Raster size/offset mismatch. Expected ${EXPECTED_BYTES} ` +
      `bytes at offset ${DATA_OFFSET}; file has ${fileSize} bytes.`
    );
  }

  console.log(`  Raster offset: ${DATA_OFFSET}`);

  // --------------------------------------------------
  // FAST RANDOM ACCESS WITH ROW CACHE
  // --------------------------------------------------

  const CACHE_LIMIT = 128;
  const rowCache = new Map();

  function getRow(row) {
    if (
      !Number.isInteger(row) ||
      row < 0 ||
      row >= H
    ) {
      return null;
    }

    if (rowCache.has(row)) {
      const cached = rowCache.get(row);

      // Refresh least-recently-used position.
      rowCache.delete(row);
      rowCache.set(row, cached);

      return cached;
    }

    const buffer = Buffer.allocUnsafe(W * 2);
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
      !Number.isInteger(c) ||
      !Number.isInteger(r) ||
      c < 0 ||
      r < 0 ||
      c >= W ||
      r >= H
    ) {
      return NaN;
    }

    const row = getRow(r);
    const dn = row.readInt16LE(c * 2);

    // LOLA invalid/no-data protection.
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
            const rho = rhoOf(lat);
            const longitude = lon * D2R;

            let X = rho * Math.sin(longitude);
            let Y = rho * Math.cos(longitude);

            if (swap) {
              [X, Y] = [Y, X];
            }

            return [
              C0 + (sx * X) / RES,
              R0 + (sy * Y) / RES
            ];
          },

          inv(c, r) {
            let X = sx * (c - C0) * RES;
            let Y = sy * (r - R0) * RES;

            if (swap) {
              [X, Y] = [Y, X];
            }

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
    if (!values.length) {
      return NaN;
    }

    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  function craterFit(cx, cy) {
    const crest = [];
    const radii = [];

    for (let k = 0; k < 72; k++) {
      const t = (k / 72) * Math.PI * 2;

      let best = -Infinity;
      let bestRadius = 0;

      for (
        let radius = 8000;
        radius <= 13000;
        radius += 100
      ) {
        const c = Math.round(
          cx + Math.cos(t) * radius / RES
        );

        const r = Math.round(
          cy + Math.sin(t) * radius / RES
        );

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

  // --------------------------------------------------
  // SELECT ORIENTATION
  // --------------------------------------------------

  // The crater is approximately circular. Its shape alone
  // cannot reliably determine the map's geographic rotation.
  //
  // Use the PDS projection interpretation for this dataset.
  // Orientation 1 is the default; --variant can override it.
  //
  // --variant is separate from --pick:
  //   --variant = raster orientation
  //   --pick    = landing-site candidate

  const DEFAULT_ORIENTATION = 1;

  const orientation =
    args.variant === undefined
      ? DEFAULT_ORIENTATION
      : Number(args.variant);

  if (
    !Number.isInteger(orientation) ||
    orientation < 0 ||
    orientation >= variants.length
  ) {
    throw new Error('--variant must be an integer from 0 to 7.');
  }

  const V = variants[orientation];

  console.log('\nSelected raster orientation:');
  console.log(`  Orientation: ${orientation}`);
  console.log(`  Axis swap: ${V.swap}`);
  console.log(`  X direction: ${V.sx}`);
  console.log(`  Y direction: ${V.sy}`);

  const [cx, cy] = V.fwd(
    SHACKLETON.lat,
    SHACKLETON.lon
  );

  console.log('\nChecking Shackleton crater...');

  const fit = craterFit(cx, cy);

  console.log(`  Crater depth: ${fit.depth.toFixed(0)} m`);
  console.log(`  Radius variation: ${fit.sd.toFixed(0)} m`);
  console.log(`  Crater score: ${fit.score.toFixed(2)}`);
  console.log(`  Valid rim samples: ${fit.crest.length}/72`);

  if (
    !Number.isFinite(fit.score) ||
    !Number.isFinite(fit.depth) ||
    fit.crest.length < 48
  ) {
    throw new Error(
      `Shackleton crater could not be reliably detected ` +
      `using orientation ${orientation}. ` +
      'Check the DEM projection metadata and orientation.'
    );
  }

  console.log(`Using orientation ${orientation}.`);

  // --------------------------------------------------
  // ILLUMINATION / HORIZON ESTIMATE
  // --------------------------------------------------

  const SUN_R = 0.27 * D2R;
  const TILT = 1.54 * D2R;
  const MAST = 12;

  function litFraction(c, r) {
    const base = h(Math.round(c), Math.round(r));

    if (!Number.isFinite(base)) {
      return 0;
    }

    const observerHeight = base + MAST;
    const horizon = [];

    for (let k = 0; k < 72; k++) {
      const t = (k / 72) * Math.PI * 2;

      const dx = Math.cos(t);
      const dy = Math.sin(t);

      let best = -Math.PI / 2;

      for (let d = 10; d < 6000; d *= 1.07) {
        const value = h(
          Math.round(c + dx * d / RES),
          Math.round(r + dy * d / RES)
        );

        if (!Number.isFinite(value)) {
          continue;
        }

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

    return total ? lit / total : 0;
  }

  // --------------------------------------------------
  // SELECT RIM SITE
  // --------------------------------------------------

  console.log('\nScanning Shackleton rim...');

  const candidates = [];

  for (const cr of fit.crest) {
    let bestC = NaN;
    let bestR = NaN;
    let bestH = -Infinity;

    for (
      let d = cr.r - 150;
      d <= cr.r + 150;
      d += RES
    ) {
      const c =
        fit.cx + Math.cos(cr.t) * d / RES;

      const r =
        fit.cy + Math.sin(cr.t) * d / RES;

      const value = h(c, r);

      if (Number.isFinite(value) && value > bestH) {
        bestH = value;
        bestC = c;
        bestR = r;
      }
    }

    if (!Number.isFinite(bestH)) {
      continue;
    }

    candidates.push({
      c: bestC,
      r: bestR,
      elev: bestH,
      lit: litFraction(bestC, bestR)
    });
  }

  if (!candidates.length) {
    throw new Error('No valid rim sites were found.');
  }

  candidates.sort((a, b) => b.lit - a.lit);

  console.log('\nRim site candidates:');

  candidates.slice(0, 6).forEach((candidate, i) => {
    const [lat, lon] = V.inv(candidate.c, candidate.r);

    console.log(
      `  #${i}: ${(candidate.lit * 100).toFixed(1)}% estimated ` +
      `illumination, ${candidate.elev.toFixed(0)} m elevation, ` +
      `${lat.toFixed(3)}, ${lon.toFixed(2)}E`
    );
  });

  if (PICK >= candidates.length) {
    throw new Error(
      `Pick ${PICK} is invalid. ` +
      `Only ${candidates.length} candidates were found.`
    );
  }

  const site = candidates[PICK];
  const [siteLat, siteLon] = V.inv(site.c, site.r);

  // --------------------------------------------------
  // LOCAL EAST / NORTH COORDINATES
  // --------------------------------------------------

  function normalize(v) {
    const length = Math.hypot(v[0], v[1]);

    if (!Number.isFinite(length) || length < 1e-12) {
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

  let northRaw = normalize([
    pn[0] - p0[0],
    pn[1] - p0[1]
  ]);

  // Remove any small numerical component parallel to east.
  const dot = east[0] * northRaw[0] + east[1] * northRaw[1];

  northRaw = normalize([
    northRaw[0] - dot * east[0],
    northRaw[1] - dot * east[1]
  ]);

  const north = northRaw;

  // --------------------------------------------------
  // DETERMINE SOURCE REGION
  // --------------------------------------------------

  // A rotated square needs a diagonal-sized source region.
  const half = Math.ceil(SIZE * Math.SQRT1_2 / 2 + 4);

  const rc = Math.round(site.c);
  const rr = Math.round(site.r);

  const x0 = rc - half;
  const y0 = rr - half;

  const span = half * 2 + 1;

  if (
    x0 < 0 ||
    y0 < 0 ||
    x0 + span > W ||
    y0 + span > H
  ) {
    throw new Error(
      'Requested output tile extends outside the source DEM.'
    );
  }

  // --------------------------------------------------
  // LOAD LOCAL DEM REGION
  // --------------------------------------------------

  console.log(
    `\nLoading local DEM region: ${span} x ${span} pixels...`
  );

  const region = new Float32Array(span * span);
  const regionBuffer = Buffer.allocUnsafe(span * 2);

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

      if (n === 0) {
        throw new Error(
          `Unexpected end of raster while loading local row ${j}.`
        );
      }

      bytesRead += n;
    }

    for (let i = 0; i < span; i++) {
      const dn = regionBuffer.readInt16LE(i * 2);

      const value =
        dn <= -32000 || dn >= 32000
          ? NaN
          : dn * DNSCALE;

      region[j * span + i] =
        Number.isFinite(value) && Math.abs(value) <= 20000
          ? value
          : NaN;
    }

    if ((j + 1) % 256 === 0 || j === span - 1) {
      console.log(`  Loaded ${j + 1}/${span} rows`);
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
      i < 0 ||
      j < 0 ||
      i >= span - 1 ||
      j >= span - 1
    ) {
      return NaN;
    }

    const u = fx - i;
    const v = fy - j;

    const values = [
      region[j * span + i],
      region[j * span + i + 1],
      region[(j + 1) * span + i],
      region[(j + 1) * span + i + 1]
    ];

    const weights = [
      (1 - u) * (1 - v),
      u * (1 - v),
      (1 - u) * v,
      u * v
    ];

    let weightedSum = 0;
    let totalWeight = 0;

    for (let k = 0; k < 4; k++) {
      if (Number.isFinite(values[k])) {
        weightedSum += values[k] * weights[k];
        totalWeight += weights[k];
      }
    }

    if (totalWeight <= 1e-12) {
      return NaN;
    }

    return weightedSum / totalWeight;
  }

  // --------------------------------------------------
  // BAKE OUTPUT TILE
  // --------------------------------------------------

  console.log(`\nBaking ${SIZE} x ${SIZE} terrain tile...`);

  const STEP = 0.5;

  // Explicit little-endian signed 16-bit output.
  const output = Buffer.alloc(SIZE * SIZE * 2);
  const grid = new Float32Array(SIZE * SIZE);

  const h0 = bilinear(site.c, site.r);

  if (!Number.isFinite(h0)) {
    throw new Error('Could not determine landing-site elevation.');
  }

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
        (
          eastMetres * east[0] +
          northMetres * north[0]
        ) / RES;

      const r =
        site.r +
        (
          eastMetres * east[1] +
          northMetres * north[1]
        ) / RES;

      let value = bilinear(c, r);

      if (!Number.isFinite(value)) {
        // Do not carry the previous pixel across the row.
        // Use the site elevation as a neutral zero-relief fallback.
        value = h0;
        voids++;
      }

      value -= h0;

      const index = j * SIZE + i;

      grid[index] = value;

      low = Math.min(low, value);
      high = Math.max(high, value);

      const quantized = Math.max(
        -32768,
        Math.min(32767, Math.round(value / STEP))
      );

      output.writeInt16LE(quantized, index * 2);
    }

    if ((j + 1) % 128 === 0 || j === SIZE - 1) {
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

  if (!Number.isFinite(craterDistance) || craterDistance < 1) {
    throw new Error('Invalid crater-to-site distance.');
  }

  const metadata = {
    n: SIZE,
    res: RES,
    scale: STEP,

    source: path.basename(args.img),

    siteElevationM: h0,
    reliefM: [low, high],

    lat: siteLat,
    lon: siteLon,

    // This is an estimate from the script's simplified
    // horizon model, not a mission-grade illumination model.
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

  fs.writeFileSync(binPath, output);

  fs.writeFileSync(
    jsonPath,
    JSON.stringify(metadata, null, 2) + '\n'
  );

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
    `  Estimated illumination: ${(site.lit * 100).toFixed(1)}%`
  );

  console.log(
    `  Relief: ${low.toFixed(1)} to ${high.toFixed(1)} m`
  );

  console.log(`  Invalid/fallback pixels: ${voids}`);

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

    function gridAt(x, y) {
      return grid[
        (y * divisor) * SIZE + x * divisor
      ];
    }

    for (let j = 1; j < previewSize - 1; j++) {
      for (let i = 1; i < previewSize - 1; i++) {
        const dx =
          (gridAt(i + 1, j) - gridAt(i - 1, j)) /
          (2 * RES * divisor);

        const dy =
          (gridAt(i, j + 1) - gridAt(i, j - 1)) /
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

    // Minimal grayscale PNG encoder.
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

      pixels
        .subarray(y * previewSize, (y + 1) * previewSize)
        .copy(
          raw,
          y * (previewSize + 1) + 1
        );
    }

    const ihdr = Buffer.alloc(13);

    ihdr.writeUInt32BE(previewSize, 0);
    ihdr.writeUInt32BE(previewSize, 4);

    ihdr[8] = 8; // bit depth
    ihdr[9] = 0; // grayscale

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

  console.log('\nTerrain bake completed successfully.');

} finally {
  fs.closeSync(fd);
}
