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

// maps/snow.js — snowfall round the camera, for snowy weather (weather.js)
// on any map: flakes in a box that follows the camera, drifting down on a
// light wind and wrapping round, so there is always snow near and none far.
// The Arctic's blizzards have their own, which come and go.

const FLAKES = 1800,
  BOX = [150, 90, 150],
  WIND = [3, -7, 1.5]; // m/s: falling, and drifting a little with the air

export function snowfall(kit) {
  const { THREE, scene, camera } = kit;
  const rand = kit.seeded(91),
    flakes = Float32Array.from(
      { length: FLAKES * 3 },
      (_, i) => rand() * BOX[i % 3],
    ),
    shown = new Float32Array(FLAKES * 3),
    geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(shown, 3));
  // A flake is a round dot, not a square (no 2D canvas under the tests:
  // squares there).
  let dot = null;
  const cv = document.createElement("canvas");
  cv.width = cv.height = 16;
  const c2 = cv.getContext("2d");
  if (c2) {
    c2.fillStyle = "#ffffff";
    c2.beginPath();
    c2.arc(8, 8, 7, 0, 2 * Math.PI);
    c2.fill();
    dot = new THREE.CanvasTexture(cv);
  }
  const snow = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      color: 0xffffff,
      map: dot,
      size: 0.32,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      fog: false,
    }),
  );
  snow.frustumCulled = false;

  function tick(dt) {
    const p = camera.position;
    snow.position.copy(p);
    for (let i = 0; i < FLAKES * 3; i += 3)
      for (let a = 0; a < 3; a++) {
        const n = (flakes[i + a] =
          (flakes[i + a] + WIND[a] * dt + BOX[a]) % BOX[a]);
        // Wrapped about the camera, so the box never runs out of snow.
        const c = p.getComponent(a);
        shown[i + a] = ((((n - c) % BOX[a]) + BOX[a]) % BOX[a]) - BOX[a] / 2;
      }
    geo.attributes.position.needsUpdate = true;
  }

  return {
    tick,
    enter() {
      scene.add(snow);
      tick(0);
    },
    leave() {
      snow.removeFromParent();
    },
  };
}
