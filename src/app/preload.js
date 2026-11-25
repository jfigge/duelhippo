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

// preload.js — the one bridge between the sandboxed game page and Electron.
//
// It tells the page it is running in the desktop shell (web/scripts/
// platform.js reads it), and carries the auto-updater (app/updater.js) both
// ways. New capabilities go here as narrow, named functions — never a raw
// ipcRenderer. A sandboxed preload may require only Electron's own modules.

"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("duelhippo", {
  platform: "electron",
  os: process.platform,
  arch: process.arch,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
  // web/scripts/updates.js is the one user. A callback through the bridge,
  // not a re-dispatched DOM event: the bridge copies the payload into the
  // page's world, which a CustomEvent's detail cannot be relied on to cross.
  // The menu's About Duel Hippo (web/scripts/about.js opens the card).
  onAbout: (fn) => {
    ipcRenderer.on("menu:about", () => fn());
  },
  updater: {
    check: (manual) => ipcRenderer.invoke("updater:check", manual === true),
    install: () => ipcRenderer.invoke("updater:install"),
    onEvent: (fn) => {
      ipcRenderer.on("updater", (_e, ev) => fn(ev));
    },
  },
});
