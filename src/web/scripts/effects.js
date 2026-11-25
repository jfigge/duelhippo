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

// effects.js — pooled particles: puffs of smoke, dust, sparks and explosions.

import * as THREE from "three";
import { V, rnd, tv } from "./util.js";
import { scene, camera } from "./scene.js";
import { game } from "./state.js";
import { sfx } from "./audio.js";

export const parts = [];
const pGeo = new THREE.IcosahedronGeometry(1, 0);

// An idle particle, or none. Searched from where the last one was found, so
// a big burst does not rescan the busy front of the pool for every puff and
// allocates nothing. Whether one is found (and so how many random numbers a
// puff draws) is as the prototype's first-idle search had it.
let next = 0;
function idle() {
  for (let k = 0, n = parts.length; k < n; k++) {
    const i = (next + k) % n;
    if (!parts[i].on) {
      next = i;
      return parts[i];
    }
  }
  return null;
}

export function puff(pos, color, n, spd, size, life, rise = 0) {
  for (let i = 0; i < n; i++) {
    let p = idle();
    if (!p) {
      if (parts.length > 360) return;
      p = {
        m: new THREE.Mesh(
          pGeo,
          new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }),
        ),
        v: new V(),
      };
      scene.add(p.m);
      parts.push(p);
    }
    p.on = true;
    p.m.visible = true;
    p.m.material.color.setHex(color);
    p.m.position.copy(pos).add(tv.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)));
    p.v
      .set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1))
      .normalize()
      .multiplyScalar(spd * rnd(0.3, 1));
    p.v.y += rise;
    if (game.mode === "classic") p.v.z *= 0.3;
    p.s0 = size * rnd(0.5, 1.1);
    p.t = 0;
    p.life = life * rnd(0.7, 1.2);
  }
}

export function boom(pos, big) {
  puff(pos, 0xffb030, big ? 16 : 10, big ? 20 : 14, big ? 2.8 : 1.8, 0.6);
  puff(pos, 0xfff27a, big ? 6 : 4, 10, 1.4, 0.35);
  puff(pos, 0x4a4a4a, big ? 12 : 7, 7, big ? 3.4 : 2.2, 1.9, 5);
  sfx.boom(big, camera.position.distanceTo(pos));
}

export function updParticles(dt) {
  for (const p of parts) {
    if (!p.on) continue;
    p.t += dt;
    const k = p.t / p.life;
    if (k >= 1) {
      p.on = false;
      p.m.visible = false;
      continue;
    }
    p.m.position.addScaledVector(p.v, dt);
    p.v.multiplyScalar(1 - 1.5 * dt);
    p.m.scale.setScalar(p.s0 * (1 + k * 2));
    p.m.material.opacity = (1 - k) * 0.9;
  }
}
