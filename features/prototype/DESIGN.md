# Duel Hippo — gameplay prototype & design notes

A 3D biplane dogfighter derived from Sopwith (BMB Compuscience, 1984). Part of the Hippo family.
This folder is a **playable gameplay prototype**, not the app framework. The framework (Makefile
`debug` / `ios` / `web`, Electron shell, phone shell) is being built separately; port `src/` into it.

## Files
| Path | What it is |
|---|---|
| `src/index.html` | Page shell: HUD, title/pause/game-over overlays, touch controls. `<!--BLOCK-->` markers are build-time inline points. |
| `src/style.css` | All styling. CGA palette: cyan `#55ffff` (player), magenta `#ff55ff` (enemy), yellow `#ffff55` (targets/fuel). Fonts: Press Start 2P (titles), VT323 (readouts). |
| `src/game.js` | The whole game: world, flight model, AI, weapons, 8-bit audio, HUD, input. Uses three.js **r128 as a global** (`THREE`). No bundler. |
| `scripts/build.mjs` | `dist/index.html`: one offline file with three.js + fonts inlined (good for Electron/webview). `dist/web.html`: three.js from cdnjs, fonts from Google. |
| `scripts/playtest.mjs`, `scripts/landtest.mjs` | Headless Chrome (Playwright) smoke tests: takeoff, flight, bombs, landing/service, crash. |

Porting to current three.js: the prototype only uses core APIs (BufferGeometry, InstancedMesh, Lambert/Basic materials, Fog). Swap the global for `import * as THREE from 'three'` and it should mostly carry over; check `Color.lerp` and geometry constructors.

## Modes (one flight model)
- **Classic**: Sopwith-style side lane. The plane is locked to z = 0. Orientation is an angle `th` in the XY plane plus a roll `ph` of 0 or π (the flip). Pitch is relative to the plane, so when inverted "pull up" turns the other way, as in the original. A perspective side camera at +z gives parallax off trees, clouds and hangars placed at different depths. **Don't use an orthographic camera.** The strip ground map at the bottom mirrors the original's.
- **Free flight**: full quaternion orientation. Pitch, roll and rudder; bank angle drives a coordinated turn (`right.y` → yaw about world up). Chase cam, with a cockpit view on C. Radar top right.

## World (laid out along +X so both modes share it)
`home runway x=0` → hippos (x≈520, 1050, 1720) → enemy town (`TDEF`: depots, factories, hangars, HQ at x 850–3450) → `enemy runway x=2850`.
The flat play area is centred on x=1400; hills rise past 2700 from centre. Classic lane bounds: x −700 to 3600.
Hippos replace the original's oxen. Hitting one by shooting or bombing costs −50 and it wanders off. Flying into one crashes you.

## Rules & numbers
- Flight: stall 32 m/s, top level speed ≈ 88 m/s (24 m/s² thrust, v² drag), gravity along the nose (dives speed you up, climbs slow you down). Lift falls off below stall and with bank. Below stall the nose drops.
- **Landing**: on a runway with sink < 6.5 m/s, wings level (|right.y| < 0.26), not nose-down, upright, and (free mode) lined up with the runway. Otherwise you crash.
- **Service**: on the home runway, speed < 3 and throttle idle → refuel 22%/s, ammo +90/s, a bomb every 0.9 s, repair 25%/s.
- Fuel 100 burns at (0.12 + throttle) × 0.42 per second (≈ 3.5 min at full power). Empty means you glide.
- Guns: 300 rounds, 0.075 s cadence, alternating muzzles, bullet speed = plane speed + 420. Bombs: 6, whistle until impact, blast radius = target radius + 12.
- Enemies: 3 hits, turn rate 0.7 rad/s rising with wave and kills, fire in bursts of 8 inside 420 m and ~10° of their nose. They patrol over their airfield while you're on the ground. Count = min(5, 2 + kills/4 + wave).
- Damage: 6 per enemy hit. Smoke above 45%; at 100% the engine dies and the controls go mushy.
- Scoring: enemy plane 100, depot 100, hangar 150, factory 200, HQ 250, whole town +1000 (it rebuilds after 30 s and the wave goes up). 3 planes per game. Best score is kept in localStorage.

## 8-bit audio (Web Audio, synthesized, no asset files)
- Engine: two square oscillators an octave apart, amplitude-gated by a square LFO (the putt-putt). Pitch, LFO rate, filter and volume rise with throttle and speed. Quiet by default (gain 0.03 → ~0.13).
- Guns: square blip 1250→230 Hz + noise tick. Enemy guns: same, attenuated by distance.
- Bomb: square whistle 1500→330 Hz over the computed fall time, cut off on impact.
- Explosions: sample-and-hold, 4-bit-quantised noise through a closing low-pass plus a low square thump. Small for planes, big for buildings and crashes.
- Audio starts on the first click (autoplay rules). M mutes.

## Input
Keyboard: W/S throttle · ↓/↑ pull/push (I inverts) · Space guns · B bomb · Classic ←/→ flip (turn around on the ground when stopped) · Free ←/→ roll, A/D rudder · C camera · P pause · F fullscreen · H help.
Touch: virtual stick (left), throttle slider, FIRE / BOMB / FLIP buttons, CAM and pause. Safe-area insets respected. Landscape is recommended.

## Open ideas
Two-player duel (split lane or networked; the name begs for it) · birds and flak · weather/wind · daily-challenge seeds · gamepad support · an original name/logo check before store release ("Sopwith" stays out of the product name).
