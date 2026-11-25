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

import { BEST_KEY, SPEEDS, SPEED_KEY } from "./constants.js";

export const S = {
  score: 0,
  kills: 0,
  wave: 0,
  lives: 3,
  rebuildT: 0,
  spawnT: 0,
  best: 0,
  rebuild: { host: 0, guest: 0 }, // duel only: each town's rebuild timer
};
try {
  S.best = +window.localStorage.getItem(BEST_KEY) || 0;
} catch {
  // No storage (private mode, sandboxed frame): best score is per-session.
}

export const game = {
  mode: "classic", // 'classic' | 'free'
  state: "title", // 'title' | 'play' | 'over'
  paused: false,
  camZoom: 0, // classic: near/far · free: chase/cockpit
  respawnT: 0,
};

// Player options. `speed` scales game time (constants.js SPEEDS); it is
// remembered between sessions, and anything unrecognised in storage reads as
// full speed.
export const opt = { invert: false, speed: 1 };
try {
  const saved = +window.localStorage.getItem(SPEED_KEY);
  if (SPEEDS.includes(saved)) opt.speed = saved;
} catch {
  // No storage: full speed each session.
}
