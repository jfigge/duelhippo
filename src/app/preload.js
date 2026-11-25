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
// The game needs nothing from Node or the OS today; this only tells the page
// it is running in the desktop shell (web/scripts/platform.js reads it). New
// capabilities go here as narrow, named functions — never a raw ipcRenderer.
// A sandboxed preload may require only Electron's own modules.

"use strict";

const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("duelhippo", {
  platform: "electron",
  os: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
});
