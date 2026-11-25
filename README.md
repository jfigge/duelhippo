# Duel Hippo

A 3D biplane dogfighter in the spirit of the 1984 side-scrollers, and part of
the Hippo family. Take off, shoot down the magenta flyers, bomb their town and
get home before the tank runs dry. Leave the hippos alone.

There are two modes on one flight model. **Classic** is a side-on lane with
loops and flips. **Free flight** is full 3D with banking turns and radar. The
design notes are in [`features/prototype/DESIGN.md`](features/prototype/DESIGN.md).

One web game (three.js, bundled by Vite) runs in three shells:

| Shell | Run it | What it is |
|---|---|---|
| Desktop | `make debug` | Electron, loading from the Vite dev server |
| Browser | `make web` | The Vite dev server in your browser |
| iPhone | `make ios` | Capacitor's Xcode project, in the iOS Simulator |

`make` on its own lists every target.

## Prerequisites

- Node 22 or newer.
- For iOS: Xcode with an iPhone simulator installed.
- For iOS on a real phone, run `make ios DEVICE=<udid>`, or put
  `PHONE=<udid>` in `dev.env` and run `make ios-phone`.
  The phone has to be registered once with team `2C564TQ2FY`: run
  `make ios-open` and let Xcode do it.

The first run target installs `src/node_modules` and downloads the Electron
binary. Run `make install` to do this up front.

## Game speed

The game can be slowed to 75%, 50% or 25%. Use `-` and `=` on the keyboard,
or the **SPEED** button on the title screen and in the pause menu (that's the
way on a phone). The setting is remembered between sessions. While it's below
100%, the HUD shows it.

Only game time slows down: flight, enemies, bullets, timers and the chase
camera. Messages and menus keep real time. At 100% the game runs exactly as
the prototype did.

## Auto-level on touch screens

Let go of the stick and the plane flies itself back to straight and level:
it rolls the wings level and then brings the nose to the horizon, gently,
over two or three seconds. In Classic it only levels the nose, and leaves a
flip alone. It doesn't level while the plane is stalling, so the nose can
still drop and gain speed, and it doesn't level once you've been shot down.
A thumb resting on the stick holds the attitude. Keyboard play doesn't
auto-level.

## Working on it

- **`make debug`** starts Vite and Electron together.
  - Saving a file under `src/web/` reloads the game in place.
  - Saving a file under `src/app/` (the main process) restarts Electron.
  - The main-process inspector listens on port 9229.
  - `DEVTOOLS=1` opens DevTools.
  - Quitting the app ends the make.
- **`make web`** runs the same dev server in a browser.
  `WEB_HOST=0.0.0.0` lets you play it from a phone on the LAN.
- **`make ios`** builds the web bundle, syncs it into the Xcode project, then
  builds, installs and launches the app. It installs over the existing copy,
  so the best score survives.
  - `IOS_SIM="iPhone Air"` picks a different simulator.
  - `make ios-live` points the app at the dev server so your edits reload on
    the device.
- **`make test`** runs the unit tests and the **equivalence suite**. That suite
  loads the original prototype (three.js r128) and this port side by side. It
  feeds both the same inputs and requires the simulations to agree frame for
  frame: takeoff, landing, service, crashes, a dogfight, a bombing run.
- **`make build`** makes an unsigned `Duel Hippo.app` in `dist/` to smoke-test
  packaging.

To set your own defaults for these variables, copy `dev.env.example` to
`dev.env`.

## Layout

```
Makefile            every entry point
features/           requirements and the gameplay prototype (reference only)
src/
  package.json      all dependencies, and electron-builder's config
  vite.config.mjs   web/ → www/
  capacitor.config.json
  web/              the game: index.html, styles/, scripts/
    scripts/        world, flight, ai, weapons, audio, hud, input, camera, …
    scripts/tests/  the equivalence harness and suites
  app/              Electron main process and preload
  ios/              the Xcode project (Capacitor)
  tools/            dev-electron.mjs (make debug), license-header.mjs
```

## Licence

GPL-3.0-or-later. See [LICENSE](LICENSE).
