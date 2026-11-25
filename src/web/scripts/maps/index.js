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

// maps/index.js — the maps beyond the City and the Sea, one module each.
// Each default-exports build(kit): kit is maps.js's shared pieces, and the
// map it returns is described above useMap() in maps.js.

import canyon from "./canyon.js";
import arctic from "./arctic.js";
import volcano from "./volcano.js";
import sky from "./sky.js";
import zeppelin from "./zeppelin.js";
import storm from "./storm.js";
import night from "./night.js";

export const MORE = { canyon, arctic, volcano, sky, zeppelin, storm, night };
