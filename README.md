# Second floor walkthrough (Vite + TypeScript + Three.js + Rapier)

A local, first-person walkthrough of the proposed finished second floor. The layout is provisional (see `../project/reports/`); it is not an as-built survey.

## Run

Requires Node 20+ (tested with Node 24.15, npm 11.12).

```bash
npm install
npm run dev          # copies ../project/exports → public/assets, then http://localhost:5173
npm run build        # type-check + production bundle in dist/
npm run preview      # serve dist/ at http://localhost:4173
npm test             # unit tests: door state machine + coordinate contract
npm run validate-glb # Khronos glTF-Validator on ../project/exports/second_floor.glb
```

`npm run sync-assets` copies only these files from `../project/exports`: `second_floor.glb`, `rooms.json`, `doors.json`, `colliders.json`, `lights.json` and `scene-metadata.json`. Construction photos and video, `.blend` files and reports are never bundled.

## Controls

| Desktop | Touch |
|---|---|
| Click **Enter home**, then WASD or arrows to walk, mouse to look (Shift = faster) | Left thumb stick: walk. Drag on the right half: look |
| **E** or click: open or close the door you face (about 2 m reach) | Round **Open/Close** button appears near a door |
| **M** rooms · **R** back to the landing · **N** day/evening · **O** overview (orbit, ceilings hidden) · **Esc** release the mouse | Toolbar buttons |

A door will not close or open through you. It stops and shows "Door blocked — step back". Press again once you are clear and it continues. If you are still in the way, it moves back instead.

## Where things come from (single source of truth)

`project/config/active_dimensions.json` drives the Blender builders (`project/scripts/*.py`). The builders produce the `.blend` file, and `export_web.py` writes the GLB and all runtime JSON from that same scene. The website has no hand-kept coordinates.

- Coordinates are metres, +Y up: three = (planX, z, planY) × 0.0254. The D01 hinge is checked at (0, 0, 4.953).
- Each door node chain is `DOOR_BASE__Dxx` (closed orientation) → `DOOR_HINGE__Dxx` (rotation about local Y from 0 to `openAngleRad`) → `LEAF__Dxx` / `HANDLE__Dxx_*`.
- Physics: static cuboids (walls with real openings, frames, parapets, furniture, invisible navigation bounds at the stair head and above parapets) and floor cuboids, including the +0.05 m bath thresholds. Each door leaf has its own kinematic cuboid that follows its hinge every 1/60 s step. Closed leaves are never part of the static colliders.
- Player: 0.25 m radius, 1.70 m capsule, eye at 1.60 m, 1.4 m/s, autostep 0.08 m, snap-to-ground, gravity, fixed step with delta clamping.

## Developer hooks

- `?debug`: FPS, draw calls, position, door states. The **`** key toggles the overlay; **C** toggles collider wireframes.
- `?nomerge`: disable static mesh merging.
- `?autostart&pose=x,z,yawDeg,pitchDeg&doors=D02,D03&mode=evening&inspect`: jump straight to a view (used by `scripts/capture.sh`).
- `window.__sf` in the console: `state()`, `teleport()`, `walk(vx, vz, s)`, `toggleDoor(id)`, `tick(n)`. `tests/browser-routes.js` uses these to run 24 route and door checks in the live page.

## Versions (locked in package-lock.json)

three 0.186.1 · @dimforge/rapier3d-compat 0.21.0 · vite 8.3.1 · typescript 5.9.3 · vitest 5.0.2 · gltf-validator 2.0.0-dev.3.10

## Credits

- Furniture, plants, vases and frames: [Poly Haven](https://polyhaven.com) (CC0).
- Split AC unit: "Air conditioner" by Poly by Google, [CC-BY 3.0](https://creativecommons.org/licenses/by/3.0/), via [poly.pizza](https://poly.pizza/m/5KohLH0xc8d) (modified: scaled, texture cleaned, new material).
- Sofa, coffee table, jhoomer, TV feature wall, console, TV, rug, paintings: the owner's own LIVINGroom project (custom-made).
- Architecture, doors (including the carved balcony doors), fans, lamps, beds, sanitaryware and showers: procedural, made for this project.
