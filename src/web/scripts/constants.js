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

// constants.js — the world's fixed numbers, unchanged from the prototype.
//
// DESIGN.md (features/prototype/) is where these are explained; the values
// are pinned to the prototype's until the requirements say otherwise.

export const G = 9.8; // gravity, m/s²
export const STALL = 32; // m/s
export const THR = 24; // full-throttle thrust, m/s²
export const DRAG = 24 / (88 * 88); // v² drag: top level speed ≈ 88 m/s
export const GEAR = 1.95; // height of the plane's origin above the wheels
export const CX = 1400; // centre of the flat play area along +X
export const FLAT = 2700; // half-width of the flat area; hills beyond

// Runways: centre x/z, half-length, half-width.
export const HOME = { x: 0, z: 0, hl: 230, hw: 18 };
export const EB = { x: 2850, z: 0, hl: 230, hw: 18 };

// Classic-mode lane bounds along X.
export const LANE = { min: -700, max: 3600 };

// The enemy town: [kind, x] along the lane.
export const TDEF = [
  ["tanks", 850],
  ["factory", 1200],
  ["hangar", 1550],
  ["tanks", 1900],
  ["hq", 2200],
  ["factory", 2450],
  ["hangar", 3250],
  ["tanks", 3450],
];

// The duel's two towns: one each, mirrored about the midpoint of the two
// runways (x = 1425), so neither side is nearer its target. The guest's is
// the right-hand half of TDEF; the host's is that, reflected. Not part of
// the prototype.
export const DUEL_TDEF = [
  ["tanks", -600, "host"],
  ["hangar", -400, "host"],
  ["factory", 400, "host"],
  ["hq", 650, "host"],
  ["hq", 2200, "guest"],
  ["factory", 2450, "guest"],
  ["hangar", 3250, "guest"],
  ["tanks", 3450, "guest"],
];

export const SKY = 0x8fd3ff;

export const BEST_KEY = "duelhippo.best";

// Game speed: the factor every simulated second is scaled by. Not part of the
// prototype; 1 is the prototype's own pace and the default.
export const SPEEDS = [0.25, 0.5, 0.75, 1];
export const SPEED_KEY = "duelhippo.speed";

// Auto-level: let go of the touch stick and the plane eases back to straight
// and level flight. Not part of the prototype, and keyboard play never uses
// it. Each axis corrects in proportion to its error (gain, per second),
// capped at a gentle turn rate (rad/s), then scaled by airspeed authority
// like every other control input.
export const LEVEL = { roll: 1, rollMax: 0.6, pitch: 0.8, pitchMax: 0.35 };
