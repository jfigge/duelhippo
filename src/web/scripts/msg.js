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

// msg.js — the centre-top message banner ("Touchdown!", "Enemy down! +100").
//
// Split out of hud.js so the simulation modules (world, flight, ai, weapons)
// can post a message without importing the HUD — and through it every other
// module — which would turn the import graph into a knot whose evaluation
// order nobody could predict.

import { $ } from "./util.js";

let msgT = 0;

export function say(text, t = 2.5) {
  $("msg").textContent = text;
  $("msg").classList.add("on");
  msgT = t;
}

// Called once a frame by the HUD: fades the banner when its time is up.
export function tickMsg(dt) {
  if ((msgT -= dt) <= 0) $("msg").classList.remove("on");
}
