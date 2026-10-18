# Mansoura Taxi · 0.2.2

A playable 3D browser game set on mapped streets around Al-Mashaya, Al-Gomhouria and Mansoura University. Drive an original burgundy-and-cream Verna LC-inspired taxi, carry up to four unrelated passengers, and negotiate a back seat full of opinions. The Egyptian Arabic black comedy is fictional, informed by documented taxi complaints.

## Play locally

Requires Node.js 22+ and a modern browser with WebGL 2 and hardware acceleration.

```sh
node scripts/serve.mjs
```

Open **http://127.0.0.1:8000**. No JavaScript dependency installation is needed. Three.js and rendering helpers are vendored. Google Fonts are optional; installed fonts provide a fallback. Serve over HTTP because the game uses modules and a local JSON map.

## What is playable

- **Free roam:** explore the mapped street network and choose a connected road destination on the city map.
- **Taxi shift:** ask the destination, accept, haggle, refuse, or discuss sharing the current route. Stop beside an accepted request and press **E** to board.
- **Shared fares:** up to four riders can be onboard, each with a destination, agreed price, patience and separate payment. New requests continue while seats remain. Arrive at a rider's own marker and press **E** while stopped to finish that journey.
- **Consequences:** surprise pooling, detours, damage, repeated refusals and aggressive haggling can cost patience, reputation or payment. A rider can walk away from negotiations or request an unpaid early exit. Keeping an agreement can earn a tip. Prices are game currency, not real taxi tariffs.
- **Original Egyptian Arabic dialogue:** fictional complaints, negotiations, grocery bags, luggage and grumpy-driver observations. Anonymous posts provide inspiration rather than copied dialogue or claims about every driver.
- **After hours:** night lighting, warm windows and working headlights.
- **Garage:** an original Verna LC-inspired sedan with three paint schemes, including local burgundy and cream.
- Driving, reversing, braking, traffic, collision damage, repair/recovery, three cameras, minimap, synthesized engine/horn and touch controls.
- Earnings, completed rides and paint persist in this browser's local storage. Pausing freezes driving and fare time.
- Settings for time of day, traffic density, sound and lighter graphics.

## Controls

| Input | Action |
| --- | --- |
| WASD / arrow keys | Drive and reverse |
| Space | Brake / handbrake |
| E | Board / drop off while stopped in the marker |
| F | Ask “رايح فين؟” |
| 1 | Accept the request |
| 2 | Haggle for a higher fare |
| 3 | Refuse the destination: “مش رايح” |
| 4 | Discuss the shared route before accepting |
| Shift | Extra acceleration |
| C | Cycle chase, high chase and bonnet cameras |
| H | Horn, after enabling sound |
| M | City map / free-roam destination |
| R | Recover and repair the taxi |
| Escape | Pause / resume |

Phones and tablets have steering and pedal buttons, an **E** passenger button and tappable fare choices. Sound starts after the player enables it. There is no recorded radio music or copied game audio.

## Geographic accuracy and sources

The street network, mapped building footprints and Nile geometry come from a bounded OpenStreetMap extract. Geographic coordinates are retained in a local meter projection. Routing uses shared map junctions and one-way directions rather than an invented rectangular grid. Buildings with missing heights, road widths, facades, storefronts and supplementary frontage massing are explicitly inferred. This is not a photographic replica or a claim of GTA V production quality.

The visual acceptance target is an individual reconstruction of the actual buildings, including their facade layout, shopfronts, entrances, balconies, rooflines and street furniture. The existing procedural city does **not** satisfy that target. [assets/building-references.json](assets/building-references.json) records location-matched references, observed features and unresolved details for custom reconstructions. `photo-referenced` means the model uses identified photographs; it does not mean measured or identical. `survey-verified` is reserved for complete dated coverage, measured dimensions and an independent comparison. No visual similarity percentage has been established.

Run `npm.cmd run audit:buildings` to produce an inventory in `artifacts/building-coverage.json`. It separates mapped and invented frontage, sourced and inferred heights, individually referenced buildings, and unverified coverage. The first five structures nearest the current start are inferred frontage; public images inspected so far do not supply complete current facade coverage of this stretch. A street-by-street recording with overlapping views, locations and capture dates, plus dimensional checks, is still needed for the requested match.

[assets/mansoura-map.json](assets/mansoura-map.json) contains the derived database, source query and provenance. It is licensed under ODbL 1.0, with [OpenStreetMap attribution](assets/OSM-ATTRIBUTION.txt) displayed in the game. Original source data is retained in [data/source/mansoura-osm-source.json](data/source/mansoura-osm-source.json). See [RESEARCH.md](RESEARCH.md) for dates, inference limits, photo and footage references, and complaint sources. The linked street videos have not all been frame-analyzed or incorporated as assets.

To regenerate the normalized map from the retained source:

```sh
python -m pip install -r scripts/requirements.txt
python scripts/acquire_mansoura.py
```

The acquisition script reuses the retained cache. Its source contains the bounded Overpass query used for acquisition. No Google imagery, third-party game code, meshes, photographs, footage, textures or Rockstar assets are bundled. Three.js is MIT licensed; its license is in `vendor/THREE-LICENSE.txt`. Barlow and Noto Sans Arabic are supplied through Google Fonts under the SIL Open Font License.

## Validate and build

```sh
node --test tests/*.test.mjs
node scripts/build.mjs
```

The build copies the static game, vendored renderer and assets into `dist/`. `npm.cmd test` and `npm.cmd run build` also work on Windows where PowerShell blocks `npm.ps1`.

The Node tests cover driving/collision behavior, road routing, geographic construction and the fare engine. Fare tests exercise three simultaneous riders with individual destinations/payments, the four-seat limit, continuing requests, negotiation, sharing disclosures, patience, early exits and duplicate-payment prevention. These simulation tests do not establish visual quality or hardware performance.

`scripts/qa-browser.mjs` provides a separate Chromium/WebGL smoke pass and desktop/mobile screenshots. It requires an installed Playwright module through `TAXI_QA_MODULE` and its browser cache through `PLAYWRIGHT_BROWSERS_PATH`; run it against the local server. When present, results and screenshots are written to `artifacts/`. A physical-device play-through remains useful for handling, touch reach and performance.

`scripts/qa-audit.mjs` adds saved-paint reloads, held mobile pedals, pause/input recovery, odometer preservation, short landscape and small portrait hit testing, plus frame-time samples for both graphics modes. The frame samples describe the test browser, not all devices.

`scripts/qa-building-models.mjs` renders each cataloged custom structure from its recorded review camera. It writes comparison screenshots and a browser report to `artifacts/`. Review those screenshots against the linked reference photographs; passing this rendering check does not certify visual accuracy.

The 0.2.1 audit fixes camera/building clipping, recovery inside conflicting source footprints, abrupt boost release, persistent traffic queues, and passenger stop selection based on straight-line distance. Fare changes also preserve shared quotes when haggling, keep due drop-offs ahead of new pickups, and allow an impatient rider to leave at the next safe stop.

## Project structure

- `index.html`, `style.css`: cinematic menu, fare choices, passenger status, Arabic dialogue, HUD and panels.
- `game.js`: scene/controller integration, cameras, UI, controls, sound and saved progress.
- `fares.js`: pure multi-passenger fare simulation and fictional dialogue; no rendering dependency.
- `world.js`: scene construction from mapped geographic data and procedural visual details.
- `driving.js`: vehicle physics and ambient traffic.
- `assets/verna-model.js`: original Verna LC-inspired mesh and passenger visuals.
- `assets/reference-buildings.js`, `assets/law-gate.js`, `assets/building-references.json`: individually referenced administration building and Law Gate 3 models, source links and unresolved details. The mapped gate canopy's generic apartment mass is replaced; the source footprint is retained.
- `navigation.js`: road graph projection and routing.
- `rendering.js`, `assets/geometry-batching.js`: render helpers and geometry batching.
- `assets/mansoura-map.json`, `data/source/`: derived map and retained source.
- `tests/`, `scripts/`: simulation checks, map acquisition/normalization, local server and packaging.

The static hosting manifest is `.openai/hosting.json`.
