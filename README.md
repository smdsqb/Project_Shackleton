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
- Clock: one fixed rate (600x, so 14 days take about 35 minutes) that eases to 60x on its own during a decision card or an EVA. No player-controlled time warp. Keys: M tablet, P array, 1-3 decide, H ask Houston, E interact. Food production is deliberately left out of this version.
- Training tempo: events are far more frequent than in reality. `SIM.commsAlwaysOn` keeps the Earth link up regardless of line of sight; set it to `false` for the strict rules.

### Crises (17 types, about 30 per mission) and what they force you to do

Every crisis stays open until the crew acts on it, and the open ones get worse. At most three are ever open at once.

- **Dust storm (lockdown):** electrostatic dust (the Moon has no wind). Fog and drifting dust build outside, the Hab portholes go opaque, hatches seal from the inside, walking drops to a slow pace with no sprint or jump, and the tablet opens so eyes go to the systems. Everyone outside is called in.
- **Meteoroid swarm (lockdown), moonquake** (camera shake, hidden damage you must inspect for), **battery thermal runaway, electrical fire, water line rupture, coolant pump failure, solar radio blackout, crew injury, array string fault, pressure sensor alarm** (real leak or bad sensor? verify first), plus dust cloud, solar storm, hull breach, scrubber, oxygenator and antenna faults.
- **Shelter / lockdown recall:** pressing "enter storm shelter" on the tablet, choosing SHELTER NOW, or any lockdown makes every crew member (including the sleeper and whoever is on EVA) drop what they are doing and run back to the hab. The duty roster freezes until the all-clear, and anyone still outside takes the full dose. If you are outside, a repeating alarm and a flashing banner tell you to get in, and hatches never lock you out from the surface.
- Airlocks: crew use the nearer airlock one at a time (a mutex), a hatch never opens while its partner is open (including one the player left open, which the crew will seal after a few seconds), and the player cannot cycle or open an airlock a crew member is using. A crew member caught inside an airlock when the order comes goes back the way they came. Crew that get pinned against an obstacle (such as a parked rover) squeeze past it instead of staying stranded.
- Emergencies pull the crew off their current task; you can also stop a task from the tablet (progress is lost).
- Keys: **Tab closes the comms desk and the radio pad** (Esc is only pause).

## Real terrain (LRO LOLA)

The sim loads `public/terrain/shackleton.{json,bin}` when present and falls back to procedural terrain otherwise. The tile is baked from `LDEM_875S_5M` (5 m/px, 87.5 S to the pole) by `scripts/bake-terrain.mjs`, which reads everything it needs from the product's `.LBL`, detects the raster's axis orientation from the data, picks the best-lit spot on Shackleton's rim, and rotates the tile into the simulator's frame (+x east, +z south) so the Horizons Sun and Earth directions line up with the terrain shadows.

To bake with no local tools: GitHub, Actions tab, "Bake LOLA terrain", Run workflow. It downloads the 1.7 GB raster on GitHub's servers and opens a pull request with the tile; a hillshade `preview.png` is attached to the run. The tile reports its own latitude/longitude, which the ephemeris function uses for the Sun/Earth tracks.

## Earth comms

Walk to the COMMS / OPS console in the Hab and press E. Commands: UPDATE, STATUS, HEALTH, WEATHER [city], SPACEWX, NEWS, POLITICS, or just talk. Replies take the real round-trip light delay, and need power and Earth above the horizon (checked against the terrain). The `api/comms` function fetches real headlines (BBC, NPR), weather (Open-Meteo) and the Kp index (NOAA SWPC), then has Groq write the operator's reply from those facts. Set `GROQ_API_KEY` in the Vercel project settings (optionally `GROQ_MODEL`). Without a key the console still answers with plain data-driven replies.

## Lunar rover

A six-wheel pressurised rover (modelled on the white faceted rover in the reference images) is parked on the pad. Prompts only appear for the thing you are standing at **and facing**: look at the port door to enter or exit, at the seat to drive, at the rear rack for the radio, at the lockers for repair kits.

**Driving** (W/S throttle and brake, A/D steer, Space brake, X parking brake, L lamps, R radio):
- Lunar gravity means weak traction: the rover starts slowly, stops over several metres, and understeers at speed. Hard cornering slides the wheels and wears the tyres.
- Each wheel is on a spring and damper and follows the ground, including boulders (shared layout with the rendered rocks). Small rocks are bumps, large ones stop you, big drops launch the body and can hurt the suspension. The cabin pitches, rolls and shakes with the terrain.
- Speed limits follow slope, side slope, boulder fields and damage; an overspeed alarm sounds and hill-descent control brakes automatically (which heats the brakes; hot brakes fade). Look-ahead warnings call out steep inclines and descents, drop-offs, side slopes, boulder fields and impassable boulders on the HUD and the dash.
- Braking is traction-limited (ABS), uses regenerative braking when the battery has room, and the parking brake holds on slopes.

**Damage and repair:** hard impacts, collisions, overspeed braking and sliding damage wheels, brakes, panels, windscreen, headlamps and the comms dish, with visible dents, windscreen cracks, a crumpled bumper, flat or out-of-round wheels, sparks, coolant venting and glowing brake rotors. A damaged dish shortens the UHF range. Below 60 % a part is flagged for repair: exit the rover, face the damaged part and press E (uses one of three repair kits; restock from the Hab spares locker inside the rover when parked within 13 m of the Hab).

**Radio:** UHF to the Hab needs line of sight and a live dish. At the rover radio (or C while inside) `HAB <message>` talks to the Hab; everything else goes to Houston relayed through the Hab. At the Hab console `ROVER <message>` calls the rover. **Tab** closes any radio (Escape no longer does).

Rover mass, battery and speed figures are design placeholders.

## Deployment

Hosted on Vercel from the main branch. Set `GROQ_API_KEY` for the comms operator and, optionally, `NASA_API_KEY` (a demo key is used otherwise) in the Vercel project settings.

## The Hab

A rigid, painted-aluminium surface habitat: radiused drum and dome (~155 m2 floor) with panel seams, a gold thermal-blanket skirt, portholes, curved-roof airlocks with interlocked hatches, racks for the oxygenator, atmospheric regulator and water reclaimer, and quarters for a crew of five. Interior is soft-edged and NASA-branded (blue band, plates, meatball). Outside: sintered pad, dish, solar array, tanks, batteries, radiator, flag. The meatball and worm are stylised canvas recreations; swap in official art from the NASA Brand Center before release. Airlock timings and costs are design placeholders.

## Radio and voices

Press C to call Houston. Static comes up, a female link-manager voice brings the link up, then you chat through the wrist pad and Houston answers in a male voice. The Hab comms desk gives the same conversation as text only.
Houston's brain and both voices use the GROQ_API_KEY environment variable on Vercel. Optional overrides: GROQ_TTS_FEMALE, GROQ_TTS_MALE, GROQ_TTS_MODEL. If the voice service is unavailable the browser's built-in voices are used.

### Voices

The radio voices come from /api/tts, which tries the providers you have keys for, best first: ElevenLabs (ELEVENLABS_API_KEY), Runway (RUNWAYML_API_SECRET), OpenAI (OPENAI_API_KEY), then Groq (GROQ_API_KEY). Force an order with TTS_ORDER, for example "elevenlabs,openai,groq". Voice choices have environment overrides (ELEVENLABS_VOICE_MALE, ELEVENLABS_VOICE_FEMALE, RUNWAY_VOICE_MALE, RUNWAY_VOICE_FEMALE, OPENAI_VOICE_MALE, OPENAI_VOICE_FEMALE). If every provider fails the browser's built-in voices are used.

## Crew (branch `crew-bots`)

Four NPC astronauts (OKAFOR, WHITAKER, ZHAO, MENDOZA) share the hab with the player-commander. `src/crew.ts` builds each one
procedurally (varied height, build, skin tone, hair, eye colour; NASA polo, meatball/flag/name-tape patches indoors, white EVA suit
with PLSS, gold visor and stripes outside) and runs a duty scheduler:

- one asleep in a bunk (curtain draws back), one at a porthole, one on comms/racks/lab, one on EVA, always
- shift change every ~2.5-3.5 min (`CREW_CFG`): sleeper -> window -> comms -> EVA -> sleeper; the new sleeper is in bed before the old one wakes
- task pools per role: stargaze / photo / journal / coffee / stretch; software update / radio check / rack check / lab; moonwalk / sample collection / panel dusting / equipment inspection
- airlock transits (outbound lock 1, inbound lock 2) with suit-up swap; natural gait, lunar lope on EVA, blinking, saccades, breathing, glances at the player
- bots do not interact with each other or the player yet; each task owns its own spot
