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

// config.js — where the match server is.
//
// VITE_NET_URL, from the Makefile's NET_URL, names the deployed server; every
// build that has it uses it, dev servers included. A dev server without it
// talks to `make server` on port 8787 of whatever host served the page, so a
// phone on the LAN finds that too.

const env = import.meta.env || {};

export function serverUrl(loc = window.location) {
  if (env.VITE_NET_URL) return env.VITE_NET_URL.replace(/\/+$/, "");
  if (env.DEV) return `ws://${loc.hostname || "localhost"}:8787`;
  return null; // this build has no server: two-player is switched off
}

// What to tell a developer whose local server is not running.
export const serverHint = () =>
  !env.VITE_NET_URL && env.DEV
    ? " Start it with make server, or set NET_URL to use the deployed one."
    : "";
