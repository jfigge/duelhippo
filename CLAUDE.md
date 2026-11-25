# Duel Hippo: notes for Claude

## What this is
A three.js biplane game. One web codebase (`src/web`) is bundled by Vite into
`src/www`, and three shells run that bundle:

- Electron (`src/app`)
- the browser
- iOS through Capacitor (`src/ios`)

Every entry point is in the Makefile:

- `make debug`, `make web` and `make ios` run the game.
- `make test`, `make lint` and `make fmt-check` are the checks.

## features/ belongs to the user
`features/` holds the requirements and `features/prototype/`, the playable
prototype this game was ported from. Never edit anything there.

The prototype is the reference implementation. `src/web/scripts/tests/harness.js`
loads it as shipped (three.js r128 as a global) and runs it next to the port.

## The invariant: gameplay matches the prototype
Until the requirements say otherwise, behaviour and numbers stay identical to
`features/prototype/src/game.js`. The equivalence suites
(`src/web/scripts/tests/equivalence-*.test.js`) enforce this frame by frame
with a seeded `Math.random`. If you change gameplay deliberately, the suite
will fail. Say so, and agree with the user how to re-baseline it. Do not
loosen the tolerance to make it pass.

The port adds four things the prototype lacks. None of them changes
keyboard gameplay at full speed, which is what the equivalence suites run:

- **Game speed.** `opt.speed` scales `dt` in `frame()`, after the 50 ms cap.
  The HUD and title screen keep real time. It is tested in
  `speed-and-pause.test.js`.
- **Pause on hide.** A full-screen transition hides the page for about
  half a second on macOS. If the game started the transition (`toggleFull`),
  the hide is ignored. If something else started it, the pause is taken back
  when the page is visible again within `FULLSCREEN_BLINK_MS`.
- **Auto-level.** Once the touch stick has been steering (`touch.flying`)
  and is let go, `updPlayer` eases the plane back to straight and level
  flight at the `LEVEL` rates in `constants.js`. Any steering key hands
  control back to the keyboard and turns it off. It is never on in keyboard
  play: `isTouch` is no guide, since touch-screen laptops and jsdom both
  report it. It is tested in `auto-level.test.js`.
- **Enemy rounds.** These are drawn pointing the way they fly. In the
  prototype, `fire()` aliased `tv` and aimed the mesh wrongly; only the
  drawing changed.

Rules that follow from this:

- **Shared scratch objects.** `tv`, `tv2`, `tq` and `tm` in `util.js` are one
  shared set, as they were in the prototype. Some call sites rely on the
  aliasing.
- **Statement order.** The order of steps in `update()` and `frame()` in
  `game.js` is the prototype's. Keep it.
- **Import order.** World construction draws on `Math.random` in a fixed
  order. Keep `world.js` free of top-level imports from the game modules so it
  still evaluates first.
- **Camera.** The camera is always perspective. DESIGN.md rules out
  orthographic.
- **r128 look.** Colour management is off, output is linear, and light
  intensities are multiplied by π. `scene.js` explains why.

## Layout and modules
`src/web/scripts/` contains these modules:

- `world`: terrain, airfields, town, hippos
- `flight`: the player
- `ai`: the enemies
- `weapons`: guns and bombs
- `audio`
- `hud`
- `msg`: message banner
- `input`
- `camera`
- `effects`
- `scene`
- `state`
- `constants`
- `util`
- `game`: flow, update and boot
- `main`: the browser entry point
- `platform`: shell detection

The simulation modules post messages through `msg.js`, not `hud.js`. This
keeps the import graph shallow. `input.js` drives the game through handlers
passed to `bindInput()`, so it imports nothing it controls.

- Only `game.js` (`boot`) and `main.js` touch the renderer. Everything else
  runs headless under Node with jsdom.
- Shell differences belong in `platform.js`, `src/app/` and `src/ios/`, never
  in game code.
- `src/app/main.js` serves `www/` over `app://duelhippo/`, not `file://`.
- The preload exposes `window.duelhippo` and nothing else.

## Conventions
- **License header.** Every first-party JS, MJS and CSS file under `src/app`,
  `src/web` and `src/tools` starts with the GPL header. `make test` checks it
  and `make license-headers` stamps it.
- **Formatting.** ESLint flat config, plus Prettier at its defaults. Run both
  from `src/`.
- **Comments.** Explain why, not what. Credit numbers to DESIGN.md rather than
  re-deriving them.
- **Tests.** Use `node --test`. Electron tests go in `src/app/tests`
  (CommonJS). Game tests go in `src/web/scripts/tests` (ESM).
