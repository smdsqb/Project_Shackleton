# Project Shackleton

A first-person, realism-focused 3D lunar outpost simulator set on the rim of Shackleton crater, built for the 2026 NASA Space Apps Challenge (Junior Astronaut Mission Trainer).

## Draft 1

- First-person walk on low-gravity terrain, with a real-time shadowed low sun.
- Coupled simulation core: solar power (terrain shadowing decides if the array is lit), battery, oxygen, CO2 scrubbing, crew radiation dose, comms delay.
- Solar flare data from NASA's CCMC DONKI service through a Vercel function, raising the radiation dose rate. Space weather data courtesy of NASA CCMC (DONKI).

## Known placeholders

Without a baked tile the terrain is procedural, the Earth is a plain sphere, and simulation constants are rough.

## The game: Junior Astronaut Mission Trainer

Keep 5 crew alive at Shackleton for 14 days. The sim (`src/sim.ts`) couples power, life support, radiation and crew health; `src/events.ts` runs the emergencies; `src/ui.ts` is the crew tablet, decision card and debrief.

- **Power budget:** 100 m2 array, 240 kWh battery, seven switchable loads with a shed order. Deploy, tilt or retract the array (P).
- **Life support:** O2 tank + electrolysis (about 10 kWh per kg), CO2 scrubber and LiOH backup, water recycling, leaks, cabin heat.
- **Radiation:** 1.3 mSv/day background, regolith cover, storm shelter, solar particle events weighted by the real NASA DONKI flare class. Limits: 250 mSv (30 days), 600 mSv (career).
- **Communication delay:** you can ask Houston (H) during an emergency, but the answer takes the round-trip light time plus the flight director's poll, and an antenna fault removes the option entirely.
- **Decisions:** timed events with 3 options each. Every option costs something. Doing nothing applies the default. The first event is always the dust cloud.
- Keys: M tablet, T time warp (1x / 60x / 600x / 3600x, auto-limited during emergencies or EVA), P array, 1-3 decide, H ask Houston, E interact. Food production is deliberately left out of this version.
- Training tempo: events are far more frequent than in reality. `SIM.commsAlwaysOn` keeps the Earth link up regardless of line of sight; set it to `false` for the strict rules.

## Real terrain (LRO LOLA)

The sim loads `public/terrain/shackleton.{json,bin}` when present and falls back to procedural terrain otherwise. The tile is baked from `LDEM_875S_5M` (5 m/px, 87.5 S to the pole) by `scripts/bake-terrain.mjs`, which reads everything it needs from the product's `.LBL`, detects the raster's axis orientation from the data, picks the best-lit spot on Shackleton's rim, and rotates the tile into the simulator's frame (+x east, +z south) so the Horizons Sun and Earth directions line up with the terrain shadows.

To bake with no local tools: GitHub, Actions tab, "Bake LOLA terrain", Run workflow. It downloads the 1.7 GB raster on GitHub's servers and opens a pull request with the tile; a hillshade `preview.png` is attached to the run. The tile reports its own latitude/longitude, which the ephemeris function uses for the Sun/Earth tracks.

## Earth comms

Walk to the COMMS / OPS console in the Hab and press E. Commands: UPDATE, STATUS, HEALTH, WEATHER [city], SPACEWX, NEWS, POLITICS, or just talk. Replies take the real round-trip light delay, and need power and Earth above the horizon (checked against the terrain). The `api/comms` function fetches real headlines (BBC, NPR), weather (Open-Meteo) and the Kp index (NOAA SWPC), then has Groq write the operator's reply from those facts. Set `GROQ_API_KEY` in the Vercel project settings (optionally `GROQ_MODEL`). Without a key the console still answers with plain data-driven replies.

## Deployment

Hosted on Vercel from the main branch. Set `GROQ_API_KEY` for the comms operator and, optionally, `NASA_API_KEY` (a demo key is used otherwise) in the Vercel project settings.

## The Hab

A rigid, painted-aluminium surface habitat: radiused drum and dome (~155 m2 floor) with panel seams, a gold thermal-blanket skirt, portholes, curved-roof airlocks with interlocked hatches, racks for the oxygenator, atmospheric regulator and water reclaimer, and quarters for a crew of five. Interior is soft-edged and NASA-branded (blue band, plates, meatball). Outside: sintered pad, dish, solar array, tanks, batteries, radiator, flag. The meatball and worm are stylised canvas recreations; swap in official art from the NASA Brand Center before release. Airlock timings and costs are design placeholders.
