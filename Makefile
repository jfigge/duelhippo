# ─────────────────────────────────────────────────────────────────────────────
#  Duel Hippo – 3D biplane dogfighter
#  One web game (three.js + Vite) in three shells: Electron, the browser, iOS
#  (Capacitor)
# ─────────────────────────────────────────────────────────────────────────────
#
#   make debug   Electron, on the Vite dev server, hot reload
#   make web     the browser, on the Vite dev server, hot reload
#   make ios     the iOS Simulator (DEVICE=<udid> for a phone)
#
# Everything Node lives in src/ (its own package.json and node_modules), so
# every recipe runs from there. Recipes are POSIX sh and GNU make 3.81, the
# make macOS ships.

WORKSPACE := $(realpath $(dir $(realpath $(firstword $(MAKEFILE_LIST)))))
SRC_DIR   := $(WORKSPACE)/src
WWW_DIR   := $(SRC_DIR)/www
DIST_DIR  := $(WORKSPACE)/dist
DATA_DIR  := $(WORKSPACE)/data

# The tools are called from src/node_modules/.bin directly rather than via
# npx: no package lookup on every call, and no "npm notice run …" lines.
BIN := $(SRC_DIR)/node_modules/.bin

VERSION := $(shell cd "$(SRC_DIR)" && node -p "require('./package.json').version" 2>/dev/null)

# ── Shared dev environment ────────────────────────────────────────────────────
# Copy dev.env.example → dev.env (git-ignored) to change these for every run;
# `make VAR=value` still wins over both.
WEB_PORT ?= 5173
WEB_HOST ?= localhost
INSPECT  ?= 9229
DEVTOOLS ?= 0
# UNLOCK=1 (make debug, make web): every map and course level open, to test
# them without earning them. Dev server only; a built game ignores it.
UNLOCK   ?= 0
IOS_SIM  ?= iPhone 17 Pro
DEVICE   ?=
PHONE    ?=
# Two player: the match server's address. Every build uses it: production
# ones bake it in, and make web / debug / ios-live play through it too. Empty,
# the dev targets use `make server` on SERVER_PORT instead (so `make web
# NET_URL=` tests a server change locally), and a production build offers no
# two-player.
NET_URL     ?=
SERVER_PORT ?= 8787
-include $(WORKSPACE)/dev.env

# ── Release signing ───────────────────────────────────────────────────────────
# The herd's release.env, read the way Rest Hippo's, JsonHippo's and
# hippoherd's Makefiles read it: credentials for SIGNED, notarized installers,
# all optional. With none set, electron-builder emits unsigned artifacts and
# skips notarization. The certificates are the herd's, so a sibling's file
# works as it is:
#
#     make dist-mac RELEASE_ENV=../resthippo/release.env
#
# In CI the same names come from repository secrets (.github/workflows/
# release.yml). Each is exported only when set AND non-empty: an empty
# CSC_LINK reads to electron-builder as "a certificate was given" and fails
# the build with "… not a file".
RELEASE_ENV ?= $(WORKSPACE)/release.env
RELEASE_ENV_VARS := CSC_LINK CSC_KEY_PASSWORD CSC_IDENTITY_AUTO_DISCOVERY \
                    APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID \
                    APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_ISSUER
-include $(RELEASE_ENV)
$(foreach v,$(RELEASE_ENV_VARS),$(if $(strip $(value $(v))),$(eval export $(v)),$(eval unexport $(v))))

# A checkout of jfigge/hippoherd. The game is published at
# hippoherd.com/duelhippo/: `make site` copies the web bundle into its
# website/duelhippo/. hippoherd's own page about the game is generated there,
# at website/duelhippo/about/ (`page` in its content/hippos.mjs), so the copy
# leaves that one directory alone.
HIPPOHERD ?= $(abspath $(WORKSPACE)/../hippoherd)
SITE_DIR  := $(HIPPOHERD)/website/duelhippo

# `make ios` picks the simulator by name unless DEVICE names a phone by udid
# (`make ios-list`).
# Live reload: the simulator reaches this Mac as localhost; a phone needs its
# LAN address.
LIVE_HOST  ?= $(if $(strip $(DEVICE)),$(shell ipconfig getifaddr en0 2>/dev/null),localhost)

.DEFAULT_GOAL := help

.PHONY: help install debug web web-build web-preview ios ios-phone ios-live \
        ios-sync ios-launch ios-open ios-list build dist-mac dist-win \
        dist-linux icons site ios-archive ios-upload ios-submit server \
        server-deploy server-install release test lint fmt \
        fmt-check license-headers clean

help:
	@echo ""
	@echo "  Duel Hippo $(VERSION) — one game, three shells"
	@echo ""
	@echo "  Run:"
	@echo "    debug         Electron on the Vite dev server: web edits hot-reload,"
	@echo "                  src/app edits restart the shell; inspector on INSPECT"
	@echo "                  ($(INSPECT)); DEVTOOLS=1 opens DevTools; UNLOCK=1 opens"
	@echo "                  every map and course level, for testing"
	@echo "    web           The browser on the Vite dev server (WEB_PORT=$(WEB_PORT));"
	@echo "                  WEB_HOST=0.0.0.0 to play from a phone on the LAN;"
	@echo "                  UNLOCK=1 as for debug"
	@echo "    ios           Build and launch in the iOS Simulator (IOS_SIM=\"$(IOS_SIM)\")"
	@echo "                  or on a phone (DEVICE=<udid>)"
	@echo "    ios-phone     ios on PHONE ($(PHONE))"
	@echo "    ios-live      ios against the dev server: edits reload on the device"
	@echo ""
	@echo "  Build:"
	@echo "    web-build     Production bundle → src/www/ (what Electron and iOS ship)"
	@echo "    web-preview   Serve that bundle as a browser would get it"
	@echo "    build         Unsigned Electron app for this machine → dist/ (smoke test)"
	@echo "    dist-mac      macOS .dmg (arm64, x64) → dist/; signed and notarized when"
	@echo "                  RELEASE_ENV ($(notdir $(RELEASE_ENV))) has the credentials"
	@echo "    dist-win      Windows installer (x64, arm64) → dist/"
	@echo "    dist-linux    Linux AppImage (x64, arm64) → dist/"
	@echo "    icons         Redraw every app icon from src/icons/duelhippo.svg"
	@echo "    ios-sync      Copy the bundle into the Xcode project"
	@echo "    ios-open      Open the Xcode project"
	@echo "    ios-list      List simulators and phones ios can target"
	@echo ""
	@echo "  App Store:"
	@echo "    ios-archive   Release archive of the iPhone app → build/ios/"
	@echo "    ios-upload    Archive, then upload to App Store Connect (TestFlight)"
	@echo "    ios-submit    Put that build up for App Store review"
	@echo "                  (BUILD_NUMBER_SUBMIT=<the upload's build number>)"
	@echo ""
	@echo "  Two player (src/server, a Cloudflare Worker):"
	@echo "    server        Run the match server locally on SERVER_PORT ($(SERVER_PORT)); the"
	@echo "                  dev targets use it when NET_URL is empty (make web NET_URL=)"
	@echo "    server-deploy Publish it to Cloudflare (once: npx wrangler login); then"
	@echo "                  set NET_URL to the wss:// address it prints"
	@echo ""
	@echo "  Publish:"
	@echo "    release       make release VERSION=x.y.z: check, confirm, test, bump"
	@echo "                  src/package.json, tag and push; the tag runs the Release"
	@echo "                  workflow (installers, GitHub Release, hippoherd.com)"
	@echo "    site          Test, then copy the web build into a hippoherd checkout"
	@echo "                  (HIPPOHERD=$(HIPPOHERD)) at website/duelhippo/"
	@echo ""
	@echo "  Check:"
	@echo "    test          Unit tests, and the port-vs-prototype equivalence suite"
	@echo "    lint          ESLint"
	@echo "    fmt           Prettier (write); fmt-check to only report"
	@echo "    license-headers  Stamp the GPL header on files missing it"
	@echo ""
	@echo "    install       npm ci in src/ (the run targets do this when needed)"
	@echo "    clean         Remove src/www, dist/, build/"
	@echo ""

# ─── Dependencies ─────────────────────────────────────────────────────────────
# npm ci re-runs only when the lockfile changes; the touch stops make from
# re-running it because node_modules/ is older than package-lock.json.
# Electron fetches its binary on first use since v42 — install.js does it now
# rather than in the middle of the first `make debug`.
$(SRC_DIR)/node_modules: $(SRC_DIR)/package.json $(SRC_DIR)/package-lock.json
	cd "$(SRC_DIR)" && npm ci --no-audit --no-fund
	cd "$(SRC_DIR)" && node node_modules/electron/install.js
	@touch "$(SRC_DIR)/node_modules"

install: $(SRC_DIR)/node_modules

# ─── Run ──────────────────────────────────────────────────────────────────────
debug: install
	@cd "$(SRC_DIR)" && DEV_PORT=$(WEB_PORT) INSPECT=$(INSPECT) DEVTOOLS=$(DEVTOOLS) \
		UNLOCK=$(UNLOCK) \
		VITE_NET_URL="$(NET_URL)" \
		USER_DATA_DIR="$(DATA_DIR)" node tools/dev-electron.mjs

web: install
	@cd "$(SRC_DIR)" && WEB_PORT=$(WEB_PORT) VITE_NET_URL="$(NET_URL)" \
		"$(BIN)/vite" --host $(WEB_HOST) --open $(if $(filter 1,$(UNLOCK)),"/?unlock","/")

# ─── Build ────────────────────────────────────────────────────────────────────
web-build: install
	@cd "$(SRC_DIR)" && VITE_NET_URL="$(NET_URL)" "$(BIN)/vite" build
	@echo "  → $(WWW_DIR)/"

web-preview: web-build
	@cd "$(SRC_DIR)" && WEB_PORT=$(WEB_PORT) "$(BIN)/vite" preview --host $(WEB_HOST) --open

# A fast, unsigned `--dir` package: the whole electron-builder pack (asar,
# file list) without an installer, signing or notarization.
build: web-build
	cd "$(SRC_DIR)" && CSC_IDENTITY_AUTO_DISCOVERY=false "$(BIN)/electron-builder" \
		--dir --publish never -c.mac.notarize=false
	@echo "  → $(DIST_DIR)/"

# Installers, as the Release workflow builds them on each platform's runner.
# Signing and notarization follow RELEASE_ENV (above); with nothing there,
# keychain discovery is off so a local build is predictably unsigned.
DIST_ENV := $(if $(strip $(CSC_LINK)),,CSC_IDENTITY_AUTO_DISCOVERY=false)

dist-mac: web-build
	cd "$(SRC_DIR)" && $(DIST_ENV) "$(BIN)/electron-builder" --mac --publish never
	@echo "  → $(DIST_DIR)/"

dist-win: web-build
	cd "$(SRC_DIR)" && "$(BIN)/electron-builder" --win --publish never
	@echo "  → $(DIST_DIR)/"

dist-linux: web-build
	cd "$(SRC_DIR)" && "$(BIN)/electron-builder" --linux --publish never
	@echo "  → $(DIST_DIR)/"

# Every icon comes from the one drawing, src/icons/duelhippo.svg, rasterised
# under Electron (tools/make-icons.mjs says why). The outputs are committed.
icons: install
	cd "$(SRC_DIR)" && "$(BIN)/electron" tools/make-icons.mjs

# ─── Publish ──────────────────────────────────────────────────────────────────
# The web build to hippoherd.com/duelhippo/. --delete keeps it an exact mirror
# of src/www except for about/, hippoherd's page about the game. Tests run
# first so a red build never reaches the site. Commit and push in hippoherd
# afterwards; its CI deploys on push.
site: test web-build
	@test -d "$(HIPPOHERD)/website" || { echo "No hippoherd checkout at $(HIPPOHERD) — set HIPPOHERD=…"; exit 1; }
	@mkdir -p "$(SITE_DIR)"
	rsync -a --delete --exclude .DS_Store --exclude /about/ "$(WWW_DIR)/" "$(SITE_DIR)/"
	@echo "Published to $(SITE_DIR)/ — review, commit and push it in hippoherd."

# ─── Release ──────────────────────────────────────────────────────────────────
#   make release VERSION=1.0.0
#
# Checks first, changing nothing: VERSION is x.y.z and above the current one,
# this is a clean `main` that is not behind origin, and the tag is new. Then
# it asks. On a yes: the tests and lint run, src/package.json (and its lock)
# take the new version in a "Release vX" commit, and that commit and its tag
# go to origin in one atomic push. The tag push is what starts
# .github/workflows/release.yml; this then watches that run (with gh) until it
# finishes. YES=1 skips the question, for scripts.
#
# Nothing is pushed if anything before the push fails; a failed push leaves
# the commit and tag local, and says how to retry or undo them.
MAIN_BRANCH ?= main

release:
	@set -e; \
	NEW="$(VERSION)"; \
	if ! printf '%s' "$$NEW" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$$'; then \
		echo "Usage: make release VERSION=x.y.z   (got '$$NEW')"; exit 1; \
	fi; \
	CURRENT=$$(cd "$(SRC_DIR)" && node -p "require('./package.json').version"); \
	if ! node -e 'const [a, b] = process.argv.slice(1).map((v) => v.split(".").map(Number)); \
		for (let i = 0; i < 3; i++) if (a[i] !== b[i]) process.exit(b[i] > a[i] ? 0 : 1); \
		process.exit(1);' "$$CURRENT" "$$NEW"; then \
		echo "$$NEW is not above the current version, $$CURRENT."; exit 1; \
	fi; \
	BRANCH=$$(git rev-parse --abbrev-ref HEAD); \
	if [ "$$BRANCH" != "$(MAIN_BRANCH)" ]; then \
		echo "Releases are cut from $(MAIN_BRANCH); this is $$BRANCH."; exit 1; \
	fi; \
	if [ -n "$$(git status --porcelain --untracked-files=no)" ]; then \
		echo "Uncommitted changes: commit or stash them first."; git status --short --untracked-files=no; exit 1; \
	fi; \
	echo "Fetching origin…"; \
	git fetch --quiet --tags origin; \
	if git rev-parse -q --verify "refs/tags/v$$NEW" >/dev/null; then \
		echo "Tag v$$NEW already exists."; exit 1; \
	fi; \
	if ! git merge-base --is-ancestor "origin/$(MAIN_BRANCH)" HEAD; then \
		echo "$(MAIN_BRANCH) is behind origin (or has diverged): pull first."; exit 1; \
	fi; \
	echo ""; \
	echo "  Duel Hippo $$CURRENT → $$NEW"; \
	echo "  Test and lint, commit \"Release v$$NEW\", tag v$$NEW, push $(MAIN_BRANCH) and the tag."; \
	echo "  The tag starts the Release workflow: signed installers for macOS, Windows"; \
	echo "  and Linux, a GitHub Release, and the web build on hippoherd.com."; \
	echo ""; \
	if [ "$(YES)" != "1" ]; then \
		printf "Release v$$NEW? [y/N] "; read ans; \
		case "$$ans" in y|Y|yes|YES) ;; *) echo "Not released."; exit 1 ;; esac; \
	fi; \
	echo "Running the tests and lint…"; \
	$(MAKE) -s test lint || { echo "Checks failed: nothing was changed."; exit 1; }; \
	(cd "$(SRC_DIR)" && npm version "$$NEW" --no-git-tag-version --allow-same-version >/dev/null); \
	git add "$(SRC_DIR)/package.json" "$(SRC_DIR)/package-lock.json"; \
	git commit -q -m "Release v$$NEW"; \
	git tag -a "v$$NEW" -m "Duel Hippo $$NEW"; \
	echo "Pushing $(MAIN_BRANCH) and v$${NEW}…"; \
	if ! git push -q --atomic origin "$(MAIN_BRANCH)" "v$$NEW"; then \
		echo ""; \
		echo "The push failed, so nothing was released. The commit and tag are local:"; \
		echo "  retry:  git push --atomic origin $(MAIN_BRANCH) v$$NEW"; \
		echo "  undo:   git tag -d v$$NEW && git reset --hard HEAD~1"; \
		exit 1; \
	fi; \
	echo "Released v$$NEW. The Release workflow is starting…"; \
	if ! command -v gh >/dev/null; then \
		echo "Follow it in the repository's Actions tab."; exit 0; \
	fi; \
	RUN=""; \
	for i in 1 2 3 4 5 6 7 8 9 10; do \
		RUN=$$(gh run list --workflow release.yml --branch "v$$NEW" --limit 1 \
			--json databaseId -q '.[0].databaseId' 2>/dev/null || true); \
		[ -n "$$RUN" ] && break; sleep 3; \
	done; \
	if [ -z "$$RUN" ]; then echo "Follow it in the repository's Actions tab."; exit 0; fi; \
	gh run watch "$$RUN" --exit-status || { echo "The Release workflow failed: gh run view $$RUN --log-failed"; exit 1; }; \
	gh release view "v$$NEW" --json url -q .url

# ─── iOS (Capacitor) ──────────────────────────────────────────────────────────
# src/ios/ is a normal Xcode project, committed; `cap sync` copies src/www into
# it (as App/App/public, git-ignored) and refreshes the Swift packages.
ios-sync: web-build
	cd "$(SRC_DIR)" && "$(BIN)/cap" sync ios

# Launch on the simulator or the phone, whichever DEVICE says. Both install
# over any existing copy, so the best score (localStorage) survives.
#
# The simulator goes through `cap run`. The phone does NOT: cap run finds
# devices with native-run, which cannot see an iOS 17+ phone at all (it lists
# only simulators and then calls the phone's udid invalid). So the phone path
# is Roll Hippo's: xcodebuild for the device, then `devicectl` to install and
# launch. Signing is automatic for team 2C564TQ2FY; -allowProvisioningUpdates
# lets xcodebuild fetch the development profile itself.
IOS_BUILD := $(WORKSPACE)/build/ios
IOS_APP   := $(IOS_BUILD)/Build/Products/Debug-iphoneos/App.app
APP_ID    := com.duelhippo.app

define ios_launch
	@if [ -z "$(strip $(DEVICE))" ]; then \
		open -a Simulator && \
		cd "$(SRC_DIR)" && "$(BIN)/cap" run ios --target-name "$(IOS_SIM)" --no-sync; \
	else \
		cd "$(SRC_DIR)/ios/App" && \
		xcodebuild -project App.xcodeproj -scheme App -configuration Debug \
			-destination generic/platform=iOS -derivedDataPath "$(IOS_BUILD)" \
			-allowProvisioningUpdates -quiet build && \
		echo "Installing on $(DEVICE)…" && \
		xcrun devicectl device install app --device $(DEVICE) "$(IOS_APP)" && \
		xcrun devicectl device process launch --terminate-existing \
			--device $(DEVICE) $(APP_ID) || { \
			echo ""; \
			echo "  Could not install on $(DEVICE). Is it unlocked, and connected by"; \
			echo "  cable or on this Mac's Wi-Fi? (xcrun devicectl list devices)"; \
			exit 1; }; \
	fi
endef

ios: ios-sync
	$(ios_launch)

ios-phone:
	@if [ -z "$(PHONE)" ]; then \
	  echo "Set PHONE to your iPhone's udid (see make ios-list) in dev.env, or run make ios-phone PHONE=<udid>."; \
	  exit 1; \
	fi
	@$(MAKE) ios DEVICE=$(PHONE)

# ─── App Store ────────────────────────────────────────────────────────────────
# The Release workflow runs these on a tag; they run the same way here.
#
# Signing is automatic for team 2C564TQ2FY. On this Mac, Xcode's own signed-in
# account does it. In CI there is no account, so the App Store Connect API key
# (APPLE_API_KEY, a .p8 path, with APPLE_API_KEY_ID and APPLE_API_ISSUER — the
# same three names release.env and the sibling workflows use) authorises
# xcodebuild to fetch profiles and upload.
#
# Every upload needs a build number App Store Connect has never seen, rising
# within the version. yyDDDHHMM (UTC) does that from any machine without a
# counter to keep, and stays under 2^31.
IOS_ARCHIVE  := $(WORKSPACE)/build/ios/Duel-Hippo.xcarchive
IOS_EXPORT   := $(WORKSPACE)/build/ios/export
ifeq ($(strip $(BUILD_NUMBER)),)
BUILD_NUMBER := $(shell date -u +%y%j%H%M)
endif
ASC_AUTH := $(if $(strip $(APPLE_API_KEY)),-authenticationKeyPath "$(APPLE_API_KEY)" \
	-authenticationKeyID "$(APPLE_API_KEY_ID)" -authenticationKeyIssuerID "$(APPLE_API_ISSUER)")

# ios-sync rewrites the app's capacitor.config.json, so an archive never
# carries ios-live's dev-server URL.
ios-archive: ios-sync
	@echo "Archiving Duel Hippo $(VERSION) ($(BUILD_NUMBER))…"
	cd "$(SRC_DIR)/ios/App" && xcodebuild -project App.xcodeproj -scheme App \
		-configuration Release -destination generic/platform=iOS \
		-archivePath "$(IOS_ARCHIVE)" -allowProvisioningUpdates $(ASC_AUTH) \
		MARKETING_VERSION=$(VERSION) CURRENT_PROJECT_VERSION=$(BUILD_NUMBER) \
		-quiet archive
	@echo "  → $(IOS_ARCHIVE)"

ios-upload: ios-archive
	xcodebuild -exportArchive -archivePath "$(IOS_ARCHIVE)" \
		-exportOptionsPlist "$(SRC_DIR)/ios/ExportOptions.plist" \
		-exportPath "$(IOS_EXPORT)" -allowProvisioningUpdates $(ASC_AUTH)
	@echo "Uploaded $(VERSION) ($(BUILD_NUMBER)). It shows in TestFlight once Apple has processed it."

ios-submit:
	@test -n "$(BUILD_NUMBER_SUBMIT)" || { echo "Set BUILD_NUMBER_SUBMIT to the build ios-upload printed."; exit 1; }
	cd "$(SRC_DIR)" && node tools/asc-submit.mjs --version $(VERSION) --build $(BUILD_NUMBER_SUBMIT)

# The app loads from the Vite dev server instead of its bundled copy, so saves
# reload on the device. This is what `cap run --live-reload` does, done by
# hand so it works on the phone too: point the synced config's server.url at
# the dev server, then launch as usual. Ctrl-C stops the server; the next
# `make ios` syncs the bundled copy back.
ios-live: ios-sync
	@cd "$(SRC_DIR)" && node -e ' \
		const f = "ios/App/App/capacitor.config.json", fs = require("fs"); \
		const c = JSON.parse(fs.readFileSync(f, "utf8")); \
		c.server = { url: "http://$(LIVE_HOST):$(WEB_PORT)", cleartext: true }; \
		fs.writeFileSync(f, JSON.stringify(c, null, 2));'
	@cd "$(SRC_DIR)" && { \
		WEB_PORT=$(WEB_PORT) VITE_NET_URL="$(NET_URL)" "$(BIN)/vite" --host 0.0.0.0 & vite=$$!; \
		trap 'kill $$vite 2>/dev/null' EXIT INT TERM; \
		until curl -s -o /dev/null http://localhost:$(WEB_PORT)/; do sleep 0.3; done; \
		$(MAKE) -s -C "$(WORKSPACE)" ios-launch DEVICE="$(DEVICE)" || exit 1; \
		echo "Live reload from http://$(LIVE_HOST):$(WEB_PORT)/ — Ctrl-C to stop"; \
		wait $$vite; }

# Launch whatever is already synced (ios-live's second half).
ios-launch:
	$(ios_launch)

ios-open: install
	cd "$(SRC_DIR)" && "$(BIN)/cap" open ios

ios-list: install
	@echo "Simulators (IOS_SIM=<name>):"
	@xcrun simctl list devices available | grep -E '^ +iPhone|^ +iPad' | sed -E 's/ \(([0-9A-F-]{36})\).*//'
	@echo ""
	@echo "Phones (DEVICE=<udid>; \`unavailable\` means locked, asleep or not connected):"
	@xcrun devicectl list devices 2>/dev/null | tail -n +3

# ─── Two player: the match server ─────────────────────────────────────────────
# src/server has its own package.json, so wrangler (and the workerd runtime
# it brings) is installed only by these targets, never by the game's builds.
SERVER_DIR := $(SRC_DIR)/server
WRANGLER   := $(SERVER_DIR)/node_modules/.bin/wrangler

$(SERVER_DIR)/node_modules: $(SERVER_DIR)/package.json $(SERVER_DIR)/package-lock.json
	cd "$(SERVER_DIR)" && npm ci --no-audit --no-fund
	@touch "$(SERVER_DIR)/node_modules"

server-install: $(SERVER_DIR)/node_modules

# On every interface, so a phone on the LAN (make ios-live) reaches it.
server: server-install
	cd "$(SERVER_DIR)" && "$(WRANGLER)" dev --ip 0.0.0.0 --port $(SERVER_PORT)

server-deploy: server-install
	cd "$(SERVER_DIR)" && node --test "tests/*.test.mjs" && "$(WRANGLER)" deploy
	@echo "Set NET_URL=wss://<the workers.dev address above> in dev.env and as the"
	@echo "repository variable NET_URL, so builds can find the server."

# ─── Check ────────────────────────────────────────────────────────────────────
test: install
	@cd "$(SRC_DIR)" && node tools/license-header.mjs --check
	@cd "$(SRC_DIR)" && node --test --test-timeout=120000 "app/tests/*.test.js" "web/scripts/tests/*.test.js" "tools/tests/*.test.mjs" "server/tests/*.test.mjs"

lint: install
	@cd "$(SRC_DIR)" && "$(BIN)/eslint" .

fmt: install
	@cd "$(SRC_DIR)" && "$(BIN)/prettier" --write . > /dev/null

fmt-check: install
	@cd "$(SRC_DIR)" && "$(BIN)/prettier" --check .

license-headers:
	@cd "$(SRC_DIR)" && node tools/license-header.mjs

clean:
	rm -rf "$(WWW_DIR)" "$(DIST_DIR)" "$(WORKSPACE)/build"
