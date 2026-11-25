/*
 * Copyright 2026 Jason Figge
 *
 * This file is part of Duel Hippo.
 *
 * Duel Hippo is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option)
 * any later version.
 *
 * Duel Hippo is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
 * more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with Duel Hippo. If not, see <https://www.gnu.org/licenses/>.
 */

// updater.js — auto-update, wrapping electron-updater's autoUpdater: Rest
// Hippo's and Volt Hippo's updater, ported.
//
// It reads the GitHub Releases feed the Release workflow publishes (the
// latest*.yml beside each installer), downloads a newer build in the
// background, and lets the page offer to restart into it. Every step is
// pushed to the page on the `updater` channel; the page (web/scripts/
// updates.js) decides what to say, and this module owns no UI.
//
// Nothing restarts without consent: a downloaded update installs when the
// game is quit, or on the player's own click of Restart.

"use strict";

const { app } = require("electron");

// Resolved lazily: reading the getter builds the platform updater, which
// needs Electron's native autoUpdater, and that is absent under `node --test`.
const getAutoUpdater = () => require("electron-updater").autoUpdater;

// A store build is updated by its store, and electron-builder strips the
// feed from it. Duel Hippo has no store channel yet; the herd's gate costs
// nothing, and adding one becomes a packaging change.
const storeBuild = () => process.mas === true || process.windowsStore === true;

// While the game is 0.x every release is a GitHub pre-release (release.yml),
// and the feed's /releases/latest skips pre-releases, so a 0.x copy would
// never see one. From 1.0 on, stable releases only, as the other hippos.
const prereleaseAllowed = (version) => /^0\./.test(String(version));

let getWindow = () => null;
// Whether the check in flight was asked for. electron-updater's events carry
// no caller, so it is captured when a check starts: an asked-for check
// answers, a startup one speaks only when it finds something.
let manualCheck = false;
let wired = false;

function push(type, payload = {}) {
  const win = getWindow();
  if (win && !win.isDestroyed())
    win.webContents.send("updater", { type, manual: manualCheck, ...payload });
}

/** Wire autoUpdater once; `resolveWindow` says where to report. */
function initUpdater(resolveWindow) {
  if (resolveWindow) getWindow = resolveWindow;
  if (wired) return;
  wired = true;
  const au = getAutoUpdater();
  au.autoDownload = true;
  au.autoInstallOnAppQuit = true;
  au.allowPrerelease = prereleaseAllowed(app.getVersion());
  // An update that fails silently looks like one that never ran.
  const at = (level) => (m) =>
    console[level](`[updater] ${m && m.stack ? m.stack : m}`);
  au.logger = {
    info: at("log"),
    warn: at("warn"),
    error: at("error"),
    debug: () => {},
  };
  au.on("checking-for-update", () => push("checking"));
  au.on("update-available", (info) =>
    push("available", { version: info?.version }),
  );
  au.on("update-not-available", () =>
    push("not-available", { current: app.getVersion() }),
  );
  au.on("update-downloaded", (info) =>
    push("downloaded", { version: info?.version }),
  );
  au.on("error", (err) =>
    push("error", { message: (err && err.message) || String(err) }),
  );
}

/**
 * Check for an update. A copy that cannot update itself says so as a reason,
 * not an error: "this is a dev build" is an answer.
 */
function checkForUpdates({ manual = false } = {}) {
  manualCheck = manual === true;
  if (storeBuild()) return push("not-available", { reason: "store-build" });
  // `make debug` has no installer to replace; electron-updater would throw.
  if (!app.isPackaged) return push("not-available", { reason: "dev-build" });
  // The "error" event has already reported a failure; the rejection would
  // only repeat it as an unhandled one.
  Promise.resolve(getAutoUpdater().checkForUpdates()).catch(() => {});
}

/** Quit and install a downloaded update: the player's click only. */
function quitAndInstall() {
  try {
    // Show the Windows installer, and relaunch once it is done.
    getAutoUpdater().quitAndInstall(false, true);
  } catch {
    // Nothing downloaded, or not packaged: nothing to do.
  }
}

module.exports = {
  initUpdater,
  checkForUpdates,
  quitAndInstall,
  prereleaseAllowed,
};
