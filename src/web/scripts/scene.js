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

// scene.js — the three.js scene, camera, lights and mesh helpers.
//
// The renderer itself is NOT made here (main.js makes it, because only a real
// browser can): everything in this module runs headless, which is what lets
// the tests build the whole world under Node.
//
// Porting from r128 to current three.js, two defaults changed underneath the
// prototype's colours and both are put back here so the look is unchanged:
//   * Colour management (r152): hex colours are now treated as sRGB and
//     converted to linear on the way in. The prototype's palette was authored
//     against r128, which used hex values as-is and wrote linear output — so
//     management is switched off before any colour is made, and main.js sets
//     the renderer's output to linear to match.
//   * Physically-correct lighting (r155, legacy mode removed in r165): light
//     intensities are no longer multiplied by π inside the shaders. Each
//     intensity below is the prototype's × π, which is three.js's documented
//     migration for an identical result.
// What could NOT be kept bit-for-bit: MeshLambertMaterial became per-fragment
// in r149 and now honours `flatShading`, which r128 ignored on Lambert (it
// warned and shaded per vertex). Most meshes here are boxes or non-indexed
// geometry whose normals are per-face anyway, so side by side the two builds
// look the same; the round parts (cones, cylinders) are a touch more faceted.

import * as THREE from "three";
import { SKY } from "./constants.js";

THREE.ColorManagement.enabled = false;

export const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 700, 3400);

export const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.5,
  7000,
);

scene.add(new THREE.HemisphereLight(0xe8f6ff, 0x58743a, 0.8 * Math.PI));
const sun = new THREE.DirectionalLight(0xfff4e0, 0.75 * Math.PI);
sun.position.set(400, 700, 300);
scene.add(sun);

export const M = (c) =>
  new THREE.MeshLambertMaterial({ color: c, flatShading: true });
export const box = (w, h, d, c) =>
  new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M(c));
export const put = (parent, m, x, y, z) => {
  m.position.set(x, y, z);
  parent.add(m);
  return m;
};
// A flat decal on the ground; `off` is the polygon offset that keeps stacked
// decals (road, runway, markings) from z-fighting.
export const flat = (w, d, c, off) => {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshLambertMaterial({
      color: c,
      polygonOffset: true,
      polygonOffsetFactor: off,
      polygonOffsetUnits: off,
    }),
  );
  m.rotation.x = -Math.PI / 2;
  return m;
};
