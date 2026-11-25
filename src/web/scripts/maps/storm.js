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

// maps/storm.js — the Storm: the Countryside under a thunderstorm. Rain
// closes the view to about a kilometre (the radar sees further than you
// do), gusts throw the plane about, and lightning blinds you for a moment.

const GUST = 0.35; // rad/s of buffeting, at most, about each axis
const RAIN = 1400; // streaks, kept round the camera

export default function build(kit) {
  const { THREE, scene, camera, P, sfx } = kit;

  // Rain: thin streaks in a box that follows the camera, falling and
  // wrapping round, so there is always rain near and none far.
  const rain = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.06, 3.2, 0.06),
    new THREE.MeshBasicMaterial({
      color: 0xb8c4d0,
      transparent: true,
      opacity: 0.45,
      fog: false,
    }),
    RAIN,
  );
  rain.frustumCulled = false;
  const rand = kit.seeded(77),
    drops = Array.from({ length: RAIN }, () => [
      (rand() - 0.5) * 160,
      rand() * 120,
      (rand() - 0.5) * 160,
    ]),
    mx = new THREE.Matrix4(),
    tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.25)),
    one = new THREE.Vector3(1, 1, 1),
    at = new THREE.Vector3();
  function fall(dt) {
    drops.forEach((d, i) => {
      d[1] -= 70 * dt;
      d[0] += 18 * dt;
      if (d[1] < 0) d[1] += 120;
      if (d[0] > 80) d[0] -= 160;
      at.set(
        camera.position.x + d[0],
        camera.position.y - 60 + d[1],
        camera.position.z + d[2],
      );
      rain.setMatrixAt(i, mx.compose(at, tilt, one));
    });
    rain.instanceMatrix.needsUpdate = true;
  }

  // Gusts: a slowly wandering turn about each of the plane's own axes, so
  // the bumps come in waves rather than as jitter.
  const gust = [0, 0, 0],
    tq = new THREE.Quaternion(),
    axes = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 1, 0),
    ];
  function buffet(dt) {
    if (!P.alive || P.grounded) return;
    for (let k = 0; k < 3; k++) {
      gust[k] += (Math.random() - 0.5) * 2.4 * dt;
      gust[k] *= 1 - 0.8 * dt;
      gust[k] = Math.max(-GUST, Math.min(GUST, gust[k]));
      P.q.multiply(
        tq.setFromAxisAngle(axes[k], gust[k] * dt * (k === 2 ? 0.4 : 1)),
      );
    }
    P.q.normalize();
    P.pos.y += gust[0] * 6 * dt; // and up and down drafts with them
  }

  // Lightning: every 6–14 s a flash over the whole screen that fades, and
  // thunder a moment later.
  let nextBolt = 8,
    thunderIn = -1;
  const flash = () => document.getElementById("flash");
  function lightning(dt) {
    if ((nextBolt -= dt) <= 0) {
      nextBolt = 6 + Math.random() * 8;
      const f = flash();
      f.classList.remove("on");
      void f.offsetWidth; // restart the fade
      f.classList.add("on");
      thunderIn = 0.4 + Math.random() * 1.2;
    }
    if (thunderIn > 0 && (thunderIn -= dt) <= 0) sfx.boom(true, 300);
  }

  return {
    country: true,
    land: {
      tick(dt) {
        fall(dt);
        buffet(dt);
        lightning(dt);
      },
    },
    sky: 0x5d6873,
    fog: [120, 1100],
    below: 0x3e4a35,
    light: [0.55, 0.35],
    enter() {
      scene.add(rain);
      fall(0);
    },
    leave() {
      rain.removeFromParent();
      flash()?.classList.remove("on");
    },
  };
}
