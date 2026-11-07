# Project Shackleton

A first-person, realism-focused 3D lunar outpost simulator set on the rim of Shackleton crater, built for the 2026 NASA Space Apps Challenge (Junior Astronaut Mission Trainer).

## Draft 1

- First-person walk on low-gravity terrain, with a real-time shadowed low sun.
- Coupled simulation core: solar power (terrain shadowing decides if the array is lit), battery, oxygen, CO2 scrubbing, crew radiation dose, comms delay.
- Solar flare data from NASA's CCMC DONKI service through a Vercel function, raising the radiation dose rate. Space weather data courtesy of NASA CCMC (DONKI).

## Known placeholders

Terrain is procedural, the Sun position is an approximation, the Earth is a plain sphere, and simulation constants are rough. Real LRO terrain, a real ephemeris and tuned constants come next.

## Deployment

Hosted on Vercel from the main branch. Set the NASA_API_KEY environment variable in the Vercel project settings (a demo key is used otherwise).

## The Hab

Modelled on the Hab from The Martian: a canvas drum and dome (~92 m2 floor), two airlocks with interlocked hatches, lab tables, oxygenator, atmospheric regulator and water reclaimer, quarters for a crew of five. Airlock timings and costs are design placeholders.
