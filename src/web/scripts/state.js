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

// state.js — the game's mutable top-level state, shared by every module.
//
// In the prototype these were `let`s inside one closure. An ES module cannot
// reassign another module's binding, so the scalars that change at run time
// (mode, flow state, pause, camera choice, respawn timer) live on `game`, and
// the score sheet stays the `S` object it always was.

import {
  BEST_KEY,
  INVERT_KEY,
  MAPS,
  MAP_KEY,
  UNLOCK,
  PLANES,
  PLANE_KEY,
  SPEEDS,
  SPEED_KEY,
} from "./constants.js";

export const S = {
  score: 0,
  kills: 0,
  wave: 0,
  lives: 3,
  rebuildT: 0,
  spawnT: 0,
  best: 0,
  // Seconds in the air in each plane type (constants.js PLANES) this game:
  // the one-player board files a score under the plane flown longest.
  flown: [0, 0, 0, 0],
};
try {
  S.best = +window.localStorage.getItem(BEST_KEY) || 0;
} catch {
  // No storage (private mode, sandboxed frame): best score is per-session.
}
// Testing (make debug UNLOCK=1, or ?unlock on the dev server): every map and
// course level open. Only a dev build reads it, so a released game can't be
// unlocked from its address.
export const unlockAll =
  !!import.meta.env?.DEV && /[?&]unlock\b/.test(window.location.search);

// A map the player has earned (constants.js UNLOCK).
export const mapOpen = (id) => unlockAll || !UNLOCK[id] || S.best > UNLOCK[id];

export const game = {
  mode: "classic", // 'classic' | 'free'
  state: "title", // 'title' | 'play' | 'over'
  paused: false,
  camZoom: 0, // classic: near/far · free: chase/cockpit
  respawnT: 0,
};

// Player options. `speed` scales game time (constants.js SPEEDS), `invert`
// flips pitch, `plane` is the plane type (constants.js PLANES) the player
// last picked and `map` the map (constants.js MAPS). All are remembered
// between sessions; anything unrecognised in storage reads as full speed,
// normal pitch, the Kite and the Countryside.
export const opt = { invert: false, speed: 1, plane: 0, map: "field" };
try {
  const saved = +window.localStorage.getItem(SPEED_KEY);
  if (SPEEDS.includes(saved)) opt.speed = saved;
  opt.invert = window.localStorage.getItem(INVERT_KEY) === "1";
  const plane = window.localStorage.getItem(PLANE_KEY);
  if (plane !== null && PLANES[+plane] && Number.isInteger(+plane))
    opt.plane = +plane;
  const map = window.localStorage.getItem(MAP_KEY);
  if (Object.hasOwn(MAPS, map) && mapOpen(map)) opt.map = map;
} catch {
  // No storage: full speed, normal pitch and the Kite each session.
}
