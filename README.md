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

## Two player

**Two player** on the title screen pairs two copies of the game over the
internet: any mix of iPhone, desktop app and browser.

- **Hosting:** one player picks **Duel** or **Co-op** and **Classic** or
  **Free flight**, then gets a four-letter room code.
- **Joining:** the other player types the code in. The host presses START and
  both games count down together.
- **Duel:** each player has a runway and a town. Points come from shooting the
  other plane down and bombing the other town. There are no AI flyers.
- **Co-op:** both players take off from the home runway against the magenta
  flyers and their town.
- **Speed:** a match runs at the host's game speed, and it can't be paused.
- **One-player games** are unchanged.

### How it connects
`src/server/` is a small Cloudflare Worker. It has one job: put two players in
a room and pass the WebRTC handshake between them. After that the games talk
directly, peer to peer, and the server does nothing.

If a direct connection fails within 7 seconds (some carrier networks and
strict NATs block it), the game traffic goes through the server instead. The
two-player screen shows which happened: "DIRECT LINK" or "VIA SERVER".

**Cost:** it runs on Cloudflare's free Workers plan. That plan allows 100,000
requests a day, and the server counts 20 relayed messages as one request.
- A direct match uses a few dozen messages in total.
- A relayed match uses about 2,000 requests per hour.

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
   it. A build without `NET_URL` shows two-player as unavailable.
4. Optional: add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as
   repository secrets. `.github/workflows/server.yml` then redeploys the
   server whenever `src/server` changes.

With `NET_URL` set, `make web`, `make debug` and `make ios-live` play
through the deployed server as well. To work on the server itself, run
`make server` in a second terminal and start the game with an empty
`NET_URL` (`make web NET_URL=`); it then uses the local server on port 8787.
Open the game twice (two browser tabs, or the browser and `make debug`) to
play yourself. Add `?relay` to the address to force the server relay.

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

`.github/workflows/release.yml` does a whole release from one tag. Set
`version` in `src/package.json`, commit, then push `v<version>`. The workflow
then:

| Job | Result |
|---|---|
| `build` and `release` | macOS, Windows and Linux installers, published as a GitHub Release (0.x releases are pre-releases). hippoherd.com's download buttons read them. |
| `web` | The web build is pushed into jfigge/hippoherd, which redeploys [hippoherd.com/duelhippo/](https://hippoherd.com/duelhippo/). |
| `ios` | The iPhone app is archived and uploaded to App Store Connect, where it appears in TestFlight. |
| `app-store` | The upload is submitted for App Store review (`tools/asc-submit.mjs`). |

Running the workflow from the Actions tab builds and signs everything but
publishes nothing. Use that to check the setup before you spend a tag.

### One-time setup
1. **Create the app in App Store Connect.** Go to My Apps → + → New App and
   use bundle id `com.duelhippo.app`. This can't be done through the API.
   Before the first review, fill in the listing: description, screenshots,
   privacy answers, age rating and a support URL. The submit step stops with
   Apple's list of anything that is missing.
2. **Add the repository secrets.** The names are the ones the sibling apps use;
   `release.yml` lists them all.
   - `CSC_LINK` and `CSC_KEY_PASSWORD`, plus `APPLE_ID`,
     `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`, sign and notarize the
     Mac download.
   - `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` and `APPLE_API_KEY_BASE64` are the
     App Store Connect API key, used to upload and submit.
   - `APPLE_DIST_CSC_LINK` and `APPLE_DIST_CSC_KEY_PASSWORD` are an Apple
     Distribution `.p12`. They're optional if the API key has the Admin role.
   - `HIPPOHERD_TOKEN` is a fine-grained token with read and write access to
     the contents of jfigge/hippoherd only.
3. **Set the repository variables.**
   - `APP_STORE_ENABLED=true` turns on uploads.
   - `APP_STORE_SUBMIT=true` also submits each upload for review.
   - `APP_STORE_RELEASE=MANUAL` holds an approved version until you release it.
     The default publishes it as soon as Apple approves it.

A channel with no secrets is skipped with a notice, so the desktop releases
work before any of the App Store setup is done.

### By hand
- `make dist-mac`, `make dist-win` and `make dist-linux` build the installers
  into `dist/`. The Mac build is signed and notarized when `release.env` has
  the credentials.
- `make ios-upload` archives the iPhone app and uploads it, using your Xcode
  account. To submit that build for review, run
  `make ios-submit BUILD_NUMBER_SUBMIT=<n>`; it needs the API key variables.
- `make site` copies the web build into a hippoherd checkout (`HIPPOHERD=`,
  by default `../hippoherd`). Commit and push it there.

hippoherd generates the page about the game at `/duelhippo/about/` from its
`content/hippos.mjs`. When the game is on the App Store, replace
`APP_STORE_SOON` there with `APP_STORE("<listing url>")`.

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
    scripts/net/    two player: link (WebRTC + relay), lobby, match, protocol
    scripts/tests/  the equivalence harness and suites
  app/              Electron main process and preload
  ios/              the Xcode project (Capacitor), ExportOptions.plist
  server/           the two-player match server (Cloudflare Worker, own package.json)
  tools/            dev-electron.mjs (make debug), make-icons.mjs,
                    asc-submit.mjs (App Store review), license-header.mjs
```

## Licence

GPL-3.0-or-later. See [LICENSE](LICENSE).
