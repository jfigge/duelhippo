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

// bus.js — the one piece of two-player state every module may import.
//
// The simulation modules (flight, weapons, world, ai) report what happens to
// the other player through `send()`, and read `net` to know whether a match
// is on and who they are in it. This module imports nothing, so importing it
// cannot change the order modules evaluate in (see world.js) and cannot
// make a cycle; match.js plugs the real link in.
//
// When `net.on` is false — every single-player game — nothing here is
// touched, and the game is the prototype's.

export const net = {
  on: false,
  role: null, // "host" | "guest"
  kind: null, // "duel" | "coop"
  link: null, // net/link.js, while connected
  // Who is playing, for the group scoreboard (scores.js). Hashes, never ids.
  me: null, // {h, n}: this player's hash and match name
  peer: null, // {h, n}: the other player's
  group: null, // the group board's id: a hash of every player's hash
  match: null, // this match's id, the host's, so both record the same one
};

// To the other player. `fast` messages (state updates) may be dropped and
// arrive out of order; the rest (events) arrive, in order.
export function send(msg, fast = false) {
  if (net.on && net.link) net.link.send(msg, fast);
}

export const isHost = () => net.on && net.role === "host";
export const isGuest = () => net.on && net.role === "guest";
export const isDuel = () => net.on && net.kind === "duel";
export const isCoop = () => net.on && net.kind === "coop";
