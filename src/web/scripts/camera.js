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

// camera.js — where the (always perspective) camera sits each frame.
//
// Classic: a side camera on +z that follows the plane, near or far (C), so
// trees, clouds and hangars at different depths give parallax — the reason
// DESIGN.md rules out an orthographic camera. Free: a lagging chase camera,
// or the cockpit (C), or down the sights (Shift, Caps Lock). Title screen: a
// slow orbit of the home airfield.

import { UP, tv, basis } from "./util.js";
import { HOME, ADS } from "./constants.js";
import { camera } from "./scene.js";
import { game } from "./state.js";
import { floorY, groundY, land } from "./world.js";
import { P, PB, crashAt, aiming } from "./flight.js";

let orbitT = 0;
const FOV = camera.fov;

// Zoom in or out towards the sights' field of view. Untouched when there is
// nothing to do, so a game that never aims never changes the projection.
function zoom(dt, want) {
  if (camera.fov === want) return;
  camera.fov += (want - camera.fov) * (1 - Math.exp(-dt * ADS.ease));
  if (Math.abs(camera.fov - want) < 0.05) camera.fov = want;
  camera.updateProjectionMatrix();
}

export function updCamera(dt) {
  zoom(dt, aiming() ? ADS.fov : FOV);
  if (game.state !== "play") {
    // Over the home runway, wherever it lies: a raised one (an island's, an
    // airship's) is not seen from under it. The Countryside's is at 0.
    const y0 = land.height ? groundY(HOME.x, HOME.z) : 0;
    orbitT += dt * 0.07;
    camera.up.set(0, 1, 0);
    camera.position.set(
      HOME.x - 100 + Math.cos(orbitT) * 150,
      42 + y0,
      Math.sin(orbitT) * 150 + 40,
    );
    camera.lookAt(HOME.x - 160, 6 + y0, 0);
    return;
  }
  if (!P.alive) {
    camera.lookAt(crashAt);
    return;
  }
  const b = basis(P.q, PB);
  P.obj.visible = true;
  if (game.mode === "classic") {
    const dist = game.camZoom ? 120 : 56;
    const k = 1 - Math.exp(-dt * 5);
    camera.position.x += (P.pos.x + P.vel.x * 0.3 - camera.position.x) * k;
    camera.position.y +=
      (Math.max(P.pos.y + 4, 16) - camera.position.y) * Math.min(1, k * 2.5);
    camera.position.z += (dist - camera.position.z) * k;
    camera.up.set(0, 1, 0);
    camera.lookAt(camera.position.x, camera.position.y - 5, 0);
    return;
  }
  if (aiming()) {
    // Down the sights: on the guns' centre line, between the two muzzles, so
    // the middle of the screen is where the rounds go.
    camera.position
      .copy(P.pos)
      .addScaledVector(b.u, 0.6)
      .addScaledVector(b.f, 2);
    camera.quaternion.copy(P.q);
    P.obj.visible = false;
    return;
  }
  if (game.camZoom === 1) {
    // cockpit view
    camera.position
      .copy(P.pos)
      .addScaledVector(b.u, 2.25)
      .addScaledVector(b.f, -0.4);
    camera.quaternion.copy(P.q);
    P.obj.visible = false;
    return;
  }
  const want = tv.copy(P.pos).addScaledVector(b.f, -21).addScaledVector(b.u, 4);
  want.y += 3.5;
  camera.position.lerp(want, 1 - Math.exp(-dt * 6));
  const gy = floorY(camera.position.x, camera.position.z) + 1.2;
  if (camera.position.y < gy) camera.position.y = gy;
  camera.up.copy(b.u).lerp(UP, 0.55).normalize();
  camera.lookAt(tv.copy(P.pos).addScaledVector(b.f, 18));
}
