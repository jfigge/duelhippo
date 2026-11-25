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
IOS_SIM  ?= iPhone 17 Pro
DEVICE   ?=
PHONE    ?=
-include $(WORKSPACE)/dev.env

# `make ios` picks the simulator by name unless DEVICE names a phone by udid
# (`make ios-list`).
# Live reload: the simulator reaches this Mac as localhost; a phone needs its
# LAN address.
LIVE_HOST  ?= $(if $(strip $(DEVICE)),$(shell ipconfig getifaddr en0 2>/dev/null),localhost)

.DEFAULT_GOAL := help

.PHONY: help install debug web web-build web-preview ios ios-phone ios-live \
        ios-sync ios-launch ios-open ios-list build test lint fmt fmt-check \
        license-headers clean

help:
	@echo ""
	@echo "  Duel Hippo $(VERSION) — one game, three shells"
	@echo ""
	@echo "  Run:"
	@echo "    debug         Electron on the Vite dev server: web edits hot-reload,"
	@echo "                  src/app edits restart the shell; inspector on INSPECT"
	@echo "                  ($(INSPECT)); DEVTOOLS=1 opens DevTools"
	@echo "    web           The browser on the Vite dev server (WEB_PORT=$(WEB_PORT));"
	@echo "                  WEB_HOST=0.0.0.0 to play from a phone on the LAN"
	@echo "    ios           Build and launch in the iOS Simulator (IOS_SIM=\"$(IOS_SIM)\")"
	@echo "                  or on a phone (DEVICE=<udid>)"
	@echo "    ios-phone     ios on PHONE ($(PHONE))"
	@echo "    ios-live      ios against the dev server: edits reload on the device"
	@echo ""
	@echo "  Build:"
	@echo "    web-build     Production bundle → src/www/ (what Electron and iOS ship)"
	@echo "    web-preview   Serve that bundle as a browser would get it"
	@echo "    build         Unsigned Electron app for this machine → dist/ (smoke test)"
	@echo "    ios-sync      Copy the bundle into the Xcode project"
	@echo "    ios-open      Open the Xcode project"
	@echo "    ios-list      List simulators and phones ios can target"
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
		USER_DATA_DIR="$(DATA_DIR)" node tools/dev-electron.mjs

web: install
	@cd "$(SRC_DIR)" && WEB_PORT=$(WEB_PORT) "$(BIN)/vite" --host $(WEB_HOST) --open

# ─── Build ────────────────────────────────────────────────────────────────────
web-build: install
	@cd "$(SRC_DIR)" && "$(BIN)/vite" build
	@echo "  → $(WWW_DIR)/"

web-preview: web-build
	@cd "$(SRC_DIR)" && WEB_PORT=$(WEB_PORT) "$(BIN)/vite" preview --host $(WEB_HOST) --open

# A fast, unsigned `--dir` package: the whole electron-builder pack (asar,
# file list) without an installer, signing or notarization.
build: web-build
	cd "$(SRC_DIR)" && CSC_IDENTITY_AUTO_DISCOVERY=false "$(BIN)/electron-builder" \
		--dir --publish never -c.mac.notarize=false
	@echo "  → $(DIST_DIR)/"

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
		WEB_PORT=$(WEB_PORT) "$(BIN)/vite" --host 0.0.0.0 & vite=$$!; \
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

# ─── Check ────────────────────────────────────────────────────────────────────
test: install
	@cd "$(SRC_DIR)" && node tools/license-header.mjs --check
	@cd "$(SRC_DIR)" && node --test --test-timeout=120000 "app/tests/*.test.js" "web/scripts/tests/*.test.js"

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
