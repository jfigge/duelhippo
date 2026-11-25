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

// cli-args.js — the Electron shell's command-line flags, parsed purely.
//
//   --dev-url=<url>   load the game from a dev server (make debug) instead of
//                     the packaged www/ — and turn on the dev-only menu items
//   --devtools        open DevTools at launch (make debug DEVTOOLS=1)
//
// Pure so it can be tested without Electron; main.js passes process.argv.

"use strict";

function parseArgs(argv) {
  const out = { devUrl: null, devTools: false };
  for (const a of argv) {
    if (a.startsWith("--dev-url=")) {
      const url = a.slice("--dev-url=".length);
      // Only a local http(s) dev server: this URL gets the app's window.
      if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(url))
        out.devUrl = url;
    } else if (a === "--devtools") out.devTools = true;
  }
  return out;
}

module.exports = { parseArgs };
