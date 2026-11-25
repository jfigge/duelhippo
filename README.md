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

## Scoreboards

**One player:** a single high-score board for everyone, kept on the match
server. Open it with **SCORES** on the title or game-over card.
- Players sign it with three letters, A to Z. That's all, to leave little
  room for rude words; the server checks it too.
- Behind the initials is a random player id, made the first time the game
  runs and never shown. Each id has one row, its best score, so two players
  who both pick "ACE" stay separate, and a new best replaces only your own.
- The board shows the top ten and where you stand worldwide.
- A score that can't be sent (offline, or no initials yet) waits on the
  device and goes with the next try.
- A build without `NET_URL` has no board; the local best score still works.

**Team games:** every group of players has its own board, which lives only
on their devices.
- Players type a name (up to 12 characters) on the Team game screen.
- The board belongs to the group: it's named by a hash of each player's id
  hash, so the same friends meeting again see their board, and a different
  line-up (three of the four, say) sees a different one. Raw ids never leave
  the device, so a friend can't post to the one-player board as you.
- Dogfights rank by the best single score; Bomb the flag and Endless
  enemies by the best team's total.
- Each player keeps a copy. As the group gathers in the lobby, everyone
  sends theirs and keeps them all merged, so a lost copy comes back.

## Team games

**Team game** on the title screen links up to nine copies of the game over
the internet: any mix of iPhone, desktop app and browser. There is no host:
every player connects to every other.

- **Making a room:** one player makes a room and gets a four-letter code;
  up to eight friends type it in. Whoever made it organises (if they leave,
  the next player in takes over).
- **Teams:** the organiser picks a layout: 4×2, 3×3, 3×2, 2×4, 2×3, 2×2,
  or 2 to 8 solo players. Players tap a team to join it. Every team has its
  own airfield, round a ring; team games are all Free flight.
- **Friendly fire:** off by default. Off, teammates' rounds and collisions
  can't hurt you, and your team can't bomb its own flag.
- **Games:**
  - **Dogfight:** three planes each. A team is out when all its players
    are; the last team flying wins.
  - **Bomb the flag:** each team has a flag beside its airfield. Planes are
    unlimited while your flag stands; when it falls your team is out. The
    last flag standing wins.
  - **Endless enemies:** every player's machine flies one magenta flyer,
    which comes back a few seconds after it's shot down. Shooting them
    scores for your team. Out of planes, you fly on as a ghost: you can't
    shoot or be hurt, but you can bomb the magenta town for points. It ends
    when every player is out of planes; the team with the most points wins.
- **Speed:** a match runs at the organiser's game speed, and it can't be
  paused.
- **One-player games** are unchanged.

### How it connects
`src/server/` is a small Cloudflare Worker. It seats up to nine players in a
room and passes the WebRTC handshake between every pair. After that the
games talk directly, peer to peer, and the server does nothing.

If a pair's direct connection fails within 7 seconds (some carrier networks
and strict NATs block it), that pair's traffic goes through the server
instead: one copy up from the sender, fanned out to every relayed player.
The lobby shows how each player is reached: "3 DIRECT · 1 VIA SERVER".

**Cost:** it runs on Cloudflare's free Workers plan. That plan allows 100,000
requests a day, and the server counts 20 relayed messages as one request.
- A fully direct match uses a few dozen requests, even with nine players.
- Each player whose link is relayed costs about 3,600 requests per hour.

So the free plan covers a lot of play before it would cost anything. If it
ever runs out, relayed matches fail until the next day; direct ones are
unaffected.

### Setting it up
1. Create a free Cloudflare account. Then run `npx wrangler login` in
   `src/server` (after `make server-install`) and sign in.
2. Run `make server-deploy`. It prints an address like
   `https://duelhippo-net.<you>.workers.dev`.
3. Put `NET_URL=wss://duelhippo-net.<you>.workers.dev` in `dev.env`, and set
   the same value as the repository variable `NET_URL` so CI builds include
   it. A build without `NET_URL` shows team games as unavailable.
4. Optional: add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as
   repository secrets. `.github/workflows/server.yml` then redeploys the
   server whenever `src/server` changes.

With `NET_URL` set, `make web`, `make debug` and `make ios-live` play
through the deployed server as well. To work on the server itself, run
`make server` in a second terminal and start the game with an empty
`NET_URL` (`make web NET_URL=`); it then uses the local server on port 8787.
Open the game two or more times (browser tabs, or the browser and
`make debug`) to play yourself. Add `?relay` to the address to force the server relay.

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

## Icons

Every icon comes from one drawing, `src/icons/duelhippo.svg`: the Hippo
family mark in Duel Hippo's green (`#279B2B`), with a propeller on its snout.
`make icons` redraws the rest of them from it:

- the macOS icon, on the standard grid with a transparent margin;
- the Windows `.ico` and the Linux set;
- the iPhone app icon (full bleed, with no alpha channel) and its launch
  screen;
- the web favicon and `apple-touch-icon`.

hippoherd's `scripts/make-marks.mjs` copies the drawing, so edit it here first
and then rerun that script there.

## CI and releases

`.github/workflows/ci.yml` runs on every push to `main` and on every pull
request. It runs the tests (including the equivalence suite), lint, the format
check and the web build, and it compiles the iPhone app for the simulator.

To release, run `make release VERSION=x.y.z` on a clean, up-to-date `main`.
1. It checks that the version is above the current one and that the tag is
   new.
2. It asks you to confirm.
3. It runs the tests and lint.
4. It bumps `src/package.json` in a "Release vX" commit, tags it, and pushes
   the commit and the tag together.
5. It watches the Release workflow until it finishes.

If anything fails before the push, nothing is pushed.

`.github/workflows/release.yml` does a whole release from that one tag:

| Job | Result |
|---|---|
| `build` and `release` | macOS, Windows and Linux installers, published as a GitHub Release (0.x releases are pre-releases). hippoherd.com's download buttons read them. |
| `web` | The web build is pushed into jfigge/hippoherd, which redeploys [hippoherd.com/duelhippo/](https://hippoherd.com/duelhippo/). |

Running the workflow from the Actions tab builds everything but publishes
nothing. Use it to check a build before you spend a tag.

The iPhone app (`make ios`, `make ios-phone`) still builds, but it isn't being
released. The release workflow ignores it, and so does the hippoherd page.

### Repository secrets
`release.yml` lists them; the names are the ones the sibling apps use. Each
is optional: anything whose secrets are missing is skipped with a notice.

- **Mac signing and notarization:** `CSC_LINK` and `CSC_KEY_PASSWORD`, plus
  `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`. Without them
  the Mac download is unsigned, and macOS won't open it for most people.
- **`HIPPOHERD_TOKEN`:** a fine-grained token with read and write access to
  the contents of jfigge/hippoherd only, used by the `web` job.
- **Repository variable `NET_URL`:** the team-game server, built into every
  release.

### By hand
- `make dist-mac`, `make dist-win` and `make dist-linux` build the installers
  into `dist/`. The Mac build is signed and notarized when `release.env` has
  the credentials.
- `make site` copies the web build into a hippoherd checkout (`HIPPOHERD=`,
  by default `../hippoherd`). Commit and push it there.

hippoherd generates the page about the game at `/duelhippo/about/` from its
`content/hippos.mjs`.

## Layout

```
Makefile            every entry point
.github/workflows/  ci.yml (every push), release.yml (every tag)
features/           requirements and the gameplay prototype (reference only)
src/
  package.json      all dependencies, and electron-builder's config
  vite.config.mjs   web/ → www/
  capacitor.config.json
  icons/            duelhippo.svg, the one drawing every icon is made from
  web/              the game: index.html, styles/, scripts/
    scripts/        world, flight, ai, weapons, audio, hud, input, camera, …
    scripts/net/    team games: link (WebRTC mesh + relay), lobby, match, teams, protocol
    scripts/tests/  the equivalence harness and suites
  app/              Electron main process and preload
  ios/              the Xcode project (Capacitor), ExportOptions.plist
  server/           the team-game match server (Cloudflare Worker, own package.json)
  tools/            dev-electron.mjs (make debug), make-icons.mjs,
                    asc-submit.mjs (App Store review), license-header.mjs
```

## Licence

GPL-3.0-or-later. See [LICENSE](LICENSE).
