# Project Shackleton

A first-person, realism-focused 3D lunar outpost simulator set on the rim of Shackleton crater, built for the 2026 NASA Space Apps Challenge (Junior Astronaut Mission Trainer).

## Draft 1

- First-person walk on low-gravity terrain, with a real-time shadowed low sun.
- Coupled simulation core: solar power (terrain shadowing decides if the array is lit), battery, oxygen, CO2 scrubbing, crew radiation dose, comms delay.
- Solar flare data from NASA DONKI through a Vercel function, raising the radiation dose rate.

## Known placeholders

Terrain is procedural, the Sun position is an approximation, the Earth is a plain sphere, and simulation constants are rough. Real LRO terrain, a real ephemeris and tuned constants come next.

## Deployment

Hosted on Vercel from the main branch. Set the NASA_API_KEY environment variable in the Vercel project settings (a demo key is used otherwise).
