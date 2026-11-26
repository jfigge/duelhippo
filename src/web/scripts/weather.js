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

// weather.js — what the weather (constants.js WEATHERS) does to a map: its
// sky, fog and light, and what falls from it. Not part of the prototype.
// Sunny leaves a map as it is, so the Countryside under a clear sky is the
// prototype's. maps.js applies it (useMap, setWeather); a map with weather of
// its own (the Storm, the Sea) keeps it.

import * as THREE from "three";
import { storm } from "./maps/storm.js";
import { snowfall } from "./maps/snow.js";

const ca = new THREE.Color(),
  cb = new THREE.Color();
const mix = (a, b, k) => ca.setHex(a).lerp(cb.setHex(b), k).getHex();

// Each weather's colour by day, and by night: a map's own light (its share
// of the Countryside's sun) picks between them, so fog on the Night raid
// stays dark rather than glowing grey.
const TINT = {
  foggy: [0x1c2128, 0xbcc5cb],
  stormy: [0x10141a, 0x5d6873], // the Storm's own sky (maps/storm.js)
  snowy: [0x262c35, 0xdde4e9],
};
const tint = (w, day) => mix(TINT[w][0], TINT[w][1], Math.min(1, day));
// Fog never lifts past a map's own: [near, far] at most.
const closer = (fog, [n, f]) => [Math.min(fog[0], n), Math.min(fog[1], f)];

// The look of map `m` (its sky, fog [near, far], below, light) in weather `w`.
export function weathered(m, w) {
  const { sky, fog, below, light } = m,
    day = light[0];
  switch (w) {
    case "foggy":
      return {
        sky: mix(sky, tint(w, day), 0.8),
        fog: closer(fog, [60, 620]),
        below,
        light: [light[0] * 0.85, light[1] * 0.6],
      };
    case "stormy":
      // The Storm's numbers, on the Countryside.
      return {
        sky: mix(sky, tint(w, day), 0.9),
        fog: closer(fog, [120, 1100]),
        below: mix(below, 0x000000, 0.3),
        light: [light[0] * 0.55, light[1] * 0.35],
      };
    case "snowy":
      return {
        sky: mix(sky, tint(w, day), 0.75),
        fog: closer(fog, [240, 1500]),
        below: mix(below, 0xf2f5f7, 0.45 * Math.min(1, day)),
        light: [light[0] * 0.95, light[1] * 0.7],
      };
    default:
      return { sky, fog, below, light };
  }
}

// What falls in weather `w`: rain, wind and lightning in a storm, snow when
// snowy, nothing otherwise. Built the first time it is needed, from `kit`
// (maps.js), and kept. `windy()` is passed on to the storm.
const fx = {};
export function weatherFx(w, kit, windy) {
  if (w === "stormy") {
    if (!fx.stormy) {
      const m = storm(kit, windy);
      fx.stormy = {
        tick: m.land.tick,
        enter: m.enter,
        leave: m.leave,
        start: m.start,
      };
    }
    return fx.stormy;
  }
  if (w === "snowy") return (fx.snowy ??= snowfall(kit));
  return null;
}
