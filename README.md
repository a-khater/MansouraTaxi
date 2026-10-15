# Mansoura Taxi

A playable 3D browser driving prototype inspired by Mansoura, Egypt. An original procedural city brings together the Nile promenade, Egyptian midrise streets, Arabic storefronts, a steel bridge, university gates, a stadium, a mosque, a palace and local burgundy-and-cream taxis.

## Play locally

Requires Node.js 22+ and a modern browser with WebGL 2 and hardware acceleration.

```sh
node scripts/serve.mjs
```

Open **http://127.0.0.1:8000**. There is no dependency installation. Rendering code is vendored in `vendor/`; Google Fonts are optional and fall back to installed fonts if unavailable. An HTTP server is needed because the game uses JavaScript modules.

## What is playable

- **Free roam:** explore the city, open the map, and choose a road destination.
- **Taxi shift:** follow the amber route to a passenger, stop in the marker, press **E**, drive to the destination, then stop and press **E** to collect the fare. Time and vehicle condition affect the payout.
- **After hours:** night atmosphere, warm windows and working taxi headlights.
- **Garage:** three paint schemes, including the local burgundy and cream.
- Mixed sedans and microbuses, acceleration, braking, reversing, collision damage, three cameras, repair/recovery, minimap, synthesized engine and horn, and touch controls.
- Earnings, completed rides and paint persist in this browser's local storage. Pausing freezes driving and fare timers.
- Settings include time of day, traffic density, sound and a lightweight graphics mode.

## Controls

| Input | Action |
| --- | --- |
| WASD / arrow keys | Drive and reverse |
| Space | Brake / handbrake |
| E | Pick up / drop off while stopped in a marker |
| Shift | Extra acceleration |
| C | Cycle chase, high chase and bonnet cameras |
| H | Horn (enable sound first) |
| M | City map / choose a destination |
| R | Recover and repair the taxi |
| Escape | Pause / resume |

Phones and tablets have on-screen steering, accelerator, reverse/brake and passenger buttons. Sound starts only after a user enables it. There is no recorded radio music or third-party game audio.

## Validate and build

```sh
node --test tests/*.test.mjs
node scripts/build.mjs
```

The build copies the deployable game into `dist/`. `npm.cmd test` / `npm.cmd run build` also work on Windows where PowerShell blocks `npm.ps1`.

Tests cover movement, steering, braking, reversing, collision damage, traffic density, route connectivity, bridge routing, all landmark routes, street clearance, city construction, and a controller integration run with a completed paid passenger ride. The integration fixture uses actual Three.js geometry/physics with a substituted renderer; it does **not** validate WebGL rendering, visual quality or browser performance. No browser provider was connected during implementation, so a visual and device play-through remains to be performed.

## Scope and references

This is a stylized, compressed interpretation, not an exact reconstruction of Mansoura or GTA V-level production graphics. Road geometry, distances, landmark placements and buildings are original gameplay approximations. Photographs and official references informed the scene; linked footage is a starting point for further research and has not all been frame-analyzed or incorporated.

See [RESEARCH.md](RESEARCH.md) for sources, dated reference notes, footage links, local geography, licensing notes and a future OpenStreetMap import path. No third-party game code, photography, footage, textures or Rockstar assets are included. Three.js is MIT licensed; its license is included in `vendor/THREE-LICENSE.txt`. Barlow and Noto Sans Arabic are supplied by Google Fonts under the SIL Open Font License.

## Project structure

- `index.html`, `style.css`: cinematic menu, HUD, map, garage and settings.
- `game.js`: scene lighting, cameras, fares, controls, sound, UI and saved progress.
- `world.js`: original procedural city and landmarks.
- `driving.js`: taxi model, driving physics and ambient traffic.
- `navigation.js`: street routing and fare calculation.
- `tests/`: dependency-free Node.js tests.
- `scripts/`: local HTTP server and static packaging.

The production manifest is `.openai/hosting.json`. Hosting starts owner-private through Sites.
