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

// main.js — browser entry point (Vite bundles from here).
//
// The type is the system's own sans-serif, so there are no fonts to bundle:
// the game works offline in all three shells and under the page's
// Content-Security-Policy.

import "../styles/style.css";

import * as THREE from "three";
import "./platform.js";
import { boot } from "./game.js";

boot({
  createRenderer: () =>
    new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    }),
});
