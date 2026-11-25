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

// bus.js — the one piece of team-game state every module may import.
//
// The simulation modules (flight, weapons, world, ai) report what happens
// to the other players through `send()`, and read `net` to know whether a
// match is on, what kind, and who is on whose team. This module imports
// nothing, so importing it cannot change the order modules evaluate in (see
// world.js) and cannot make a cycle; the lobby plugs the real link in.
//
// When `net.on` is false — every single-player game — nothing here is
// touched, and the game is the prototype's.

export const net = {
  on: false,
  seat: null, // this player's seat in the room, 0–8
  link: null, // net/link.js, while connected
  mode: null, // "dogfight" | "flag" | "endless"
  map: "field", // the map (constants.js MAPS)
  ff: false, // friendly fire: teammates can hurt each other
  teams: 0, // how many teams this match has
  // seat → {seat, h, n, team}: everyone in the match, this player included.
  // h is a player's hash (never their id), n their name.
  roster: new Map(),
  me: null, // {h, n}
  group: null, // the group board's id: a hash of every player's hash
  match: null, // this match's id, the organiser's, so all record the same one
  // world.js → net/match.js: a team's flag has fallen.
  onFlag: null,
};

// To everyone else. `fast` messages (state updates) may be dropped, and one
// that arrives after a newer one is dropped too; the rest (events) arrive,
// and almost always in order (net/link.js).
export function send(msg, fast = false) {
  if (net.on && net.link) net.link.send(msg, fast);
}

export const teamOf = (seat) => net.roster.get(seat)?.team ?? -1;
export const myTeam = () => teamOf(net.seat);
export const isMode = (m) => net.on && net.mode === m;
// Can the player in `seat` hurt this one (and this one them)? Always, unless
// they are on the same team and friendly fire is off.
export const canHurt = (seat) => !net.on || net.ff || teamOf(seat) !== myTeam();
