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

The port adds these things the prototype lacks. Apart from the enemy-turn
fix, which the suites' copy of the prototype gets too, none of them changes
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
- **Team games** (`scripts/net/`, `remote.js`, `src/server/`): up to nine
  players, hostless, all Free flight. Every hook in the simulation modules is
  guarded by `net.on` from `net/bus.js`. When it is false, which is every
  one-player game, the code paths and the order of `Math.random` calls are
  the prototype's. Keep it that way: a new hook goes behind the guard, and
  must not add or reorder random draws on the one-player path.
  - **Mesh.** Every pair connects directly (`net/link.js`), with a per-pair
    server relay as the fallback. The lobby's organiser is the lowest seat in
    the room; it owns the setup (layout, mode, friendly fire, roster) and
    nothing else.
  - **Authority.** Each machine flies its own plane and decides when that
    plane is hit or has crashed (the victim names the shooter's seat). The
    bomber's machine decides building hits, sent as damage amounts so they
    add up. In Endless enemies each machine flies the flyer at its seat.
  - **Ending.** Every machine decides the end itself from the same events
    (outs, leaves, flags). Endless enemies waits for everyone's `fin` before
    naming a winner, since state updates can lag a kill.
  - **What travels.** Other machines re-fire shots and bombs only for show.
    The message list is in `net/protocol.js`.
  - **Tests.** `net-dogfight`, `net-flag` and `net-endless` play matches
    against scripted players (`tests/fake-server.js`), and `server/tests`
    covers the room rules.
- **Plane types** (`PLANES` in `constants.js`, `missiles.js`): four planes,
  picked with 1–4 while stopped on the home runway (`pickPlane`). The Kite,
  index 0 and the default, is the prototype's plane, its numbers the
  prototype's literals. The others' traits (torque, snap stalls and spins,
  tighter landings, homing missiles) run only behind a field the Kite has as
  zero or null. Keep it that way: a Kite game must stay the prototype's.
  Tested in `planes`, `spin` and `missiles`.
- **Maps** (`maps.js`, `maps/*.js`). The Countryside is the prototype's
  world and the default; Classic and the obstacle course always use it.
  The other nine are built on first use from their own seeded generator,
  never `Math.random`, and plug into `land` in `world.js`: towers, decks,
  mountains and floating islands count as ground in `groundY(x, z, y)` (y
  is the height asked about, for overhangs), so everything that meets the
  ground meets them. `land.tick` (weather, flak, moving targets) runs last
  in `update()`; `land.power` scales thrust. Storm and Night raid reuse the
  Countryside's own world (`country: true`). While the
  Countryside is up every `land` hook is null (or 1, or the prototype's
  value), so `HOME`, `EB` and the scene are the prototype's. A team game's
  map is the organiser's (`setup.map`). Maps are earned by the best
  one-player score (`UNLOCK` in `constants.js`, `mapOpen` in `state.js`),
  on the title and for an organiser alike. Tested in `maps.test.js` and
  `maps-unlock.test.js`.
- **Obstacle course** (`course.js`). Thirty rings over the Countryside, laid
  out from a seeded generator, flown in order against the clock, at three
  levels (each its own course, the rings closer and the turns tighter),
  each opened by finishing the one before. A level's time limit is twice a
  perfect run (straight ring to ring at the Kite's top speed). No enemies, no
  town, fuel kept full. Its scores go to its own table in localStorage,
  never to the best score that opens maps. Tested in `course.test.js`.
- **Enemy turns** (Free flight). In the prototype the flyers never turned:
  `des` in `updEnemy` aliased `tv`, which the turn overwrote with the
  flyer's own heading. The port gives `des` its own vector, and the
  harness makes the same one-line fix to the prototype's source as it
  loads it (`PROTO_FIXES` in `tests/harness.js`; `features/` is never
  edited), so the equivalence suites still compare frame by frame. Any
  future deliberate fix to the prototype's behaviour goes there too.
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
- `maps`: switching between maps, the City and the Sea, and the kit the
  others (`maps/*.js`, one module each) are built with
- `course`: the obstacle course
- `flight`: the player
- `ai`: the enemies
- `weapons`: guns and bombs
- `missiles`: the missile lock, launch and flight
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
- `remote`: the other players' planes, drawn from their updates
- `scores`: the player's id, initials and match name; the one-player board's
  client; the team-game group boards and their merge
- `scoreboard`: the scoreboards on screen
- `sha256`: a synchronous SHA-256 (Web Crypto's is async, and missing
  outside secure contexts)
- `net/`: team games — `bus` (shared state, imports nothing), `link` (the
  mesh), `lobby`, `match`, `protocol`, `teams` (layouts, colours, airfield
  ring; pure), `config`
- `game`: flow, update and boot
- `main`: the browser entry point
- `about`: the About card, after Rest Hippo's and Chip Hippo's; the title's
  About button and the desktop menu open it, and it pauses a game under it.
  The sponsor link is left off on iOS (App Store Guideline 3.1.1)
- `updates`: the desktop app's update notes and its Updates button; bound
  from `main.js`, never `game.js`, and inert without the preload's bridge
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

## Icons, releases and the website
- **Icons.** `src/icons/duelhippo.svg` is the drawing of record. Every icon is
  rasterised from it by `make icons`: Mac, Windows, Linux, the iOS app icon,
  the launch screen and the favicons. Never hand-edit the PNGs.
  - hippoherd's `scripts/make-marks.mjs` copies the motif character for
    character, so a change here has to be copied there too.
  - The colour `#279B2B` also appears in hippoherd's `content/hippos.mjs`.
- **Releases.** Pushing a tag `v<version>` that matches `src/package.json`
  runs `.github/workflows/release.yml`. It builds the desktop installers,
  publishes the GitHub Release, and pushes the web build to hippoherd. Each
  of those is gated on its own secrets and variables.
  - `make release VERSION=x.y.z` is how a release is cut: it checks, asks,
    tests, bumps, tags, pushes and watches. Tag by hand only to retry one.
  - The released products are the desktop apps (macOS, Windows, Linux) and
    the web version.
  - The iPhone app still builds (`make ios`, and `ios-archive`, `ios-upload`
    and `tools/asc-submit.mjs` for the App Store), but it isn't released and
    must not be mentioned on the website.
  - Keep the installer names in a form hippoherd's `classify()` understands.
    That is why the NSIS installer's name contains "Setup": without it,
    hippoherd reads the `.exe` as a portable build.
  - A workflow-dispatch run must never publish anything.
  - Run `actionlint` on workflow changes. A YAML parser alone missed a
    duplicated `on:` once, and GitHub rejected the whole file.
- **Auto-update** (desktop only). `src/app/updater.js` wraps
  electron-updater, as in Rest Hippo and Volt Hippo. It reads the feed that
  each GitHub Release carries (`latest*.yml`, the `.blockmap`s, and the
  macOS `.zip`, which the updater installs there), so release.yml must keep
  uploading them. A downloaded update installs when the game quits, or when
  the player clicks Restart; it never restarts by itself. The automatic
  check is off until the player turns it on from the title screen, and Help ▸
  Check for Updates… always works. While the version is 0.x, releases are
  pre-releases, so the updater follows pre-releases (`prereleaseAllowed`);
  from 1.0 it takes stable releases only. On macOS, updates need the signed
  build. Tested in `app/tests/updater.test.js` and `updates.test.js`.
- **The website.** `make site` copies `src/www` into
  `../hippoherd/website/duelhippo/`. It leaves `about/` alone, because
  hippoherd generates that page.

## The match server
`src/server/` is a Cloudflare Worker with its own `package.json`, because
wrangler is large and the game builds don't need it.
- `room.js` holds the rules and is tested under Node.
- `board.js` holds the one-player scoreboard's rules and SQL. The `Board`
  Durable Object (one, named "solo") runs it on its SQLite storage; the tests
  run it on `node:sqlite`. It is the only thing the server stores.
- Player ids are secrets of a sort: the server never returns them, and the
  team-game protocol carries only their hashes.
- Rooms seat up to nine. The server reads only a message's envelope: `sig`
  goes to one seat, `g` fans out to the seats named (or all others).
- `worker.js` wires those rules to a Durable Object that uses the WebSocket
  Hibernation API, which keeps it on the free plan.
- The server never reads game messages; it forwards them.
- Keep the protocol version (`PROTO` in `net/protocol.js`) in step. Bump it
  whenever messages change shape, so that mismatched builds refuse to play
  rather than misbehave.

## Scoreboards and the one-player path
`scores.js` must never call `Math.random`: ids and match ids come from
`crypto`, so a one-player game's random draws stay the prototype's. The
one-player hooks (`soloOver` on game over, a quiet `flushSolo` at boot) do
nothing to the simulation.

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
