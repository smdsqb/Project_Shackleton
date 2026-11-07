# Project Shackleton

A first-person, realism-focused 3D lunar outpost simulator set on the rim of Shackleton crater, built for the 2026 NASA Space Apps Challenge (Junior Astronaut Mission Trainer).

## Draft 1

- First-person walk on low-gravity terrain, with a real-time shadowed low sun.
- Coupled simulation core: solar power (terrain shadowing decides if the array is lit), battery, oxygen, CO2 scrubbing, crew radiation dose, comms delay.
- Solar flare data from NASA's CCMC DONKI service through a Vercel function, raising the radiation dose rate. Space weather data courtesy of NASA CCMC (DONKI).

## Known placeholders

Without a baked tile the terrain is procedural, the Earth is a plain sphere, and simulation constants are rough.

## Real terrain (LRO LOLA)

The sim loads `public/terrain/shackleton.{json,bin}` when present and falls back to procedural terrain otherwise. Bake a tile from a LOLA south-polar DEM (PDS Geosciences node) with `node scripts/bake-terrain.mjs` (run it with no arguments for usage; you need the raster size, m/px and the site's pixel from the product's .LBL). The tile is a 1024 px int16 crop (about 2 MB) centred on the Hab site; metre-scale craters and roughness are layered on top of the DEM.

## Deployment

Hosted on Vercel from the main branch. Set the NASA_API_KEY environment variable in the Vercel project settings (a demo key is used otherwise).

## The Hab

A rigid, painted-aluminium surface habitat: radiused drum and dome (~92 m2 floor) with panel seams, a gold thermal-blanket skirt, portholes, curved-roof airlocks with interlocked hatches, racks for the oxygenator, atmospheric regulator and water reclaimer, and quarters for a crew of five. Interior is soft-edged and NASA-branded (blue band, plates, meatball). Outside: sintered pad, dish, solar array, tanks, batteries, radiator, flag. The meatball and worm are stylised canvas recreations; swap in official art from the NASA Brand Center before release. Airlock timings and costs are design placeholders.
