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
// do), turbulence throws the plane about, gusts of wind blow it sideways,
// and lightning blinds you for a moment.

const GUST = 0.35; // rad/s of buffeting, at most, about each axis
const RAIN = 1400; // streaks, kept round the camera
// Wind gusts: every `every` s (a range), one blows for `last` s from a
// random side, building to `peak` m/s of sideways push and dying away; the
// rain slants with it and streaks of spray race past. `warn` s before it
// arrives the player is told which side it comes from.
const WIND = { every: [6, 13], last: [1.8, 3.2], peak: [9, 16], warn: 0.8 };
const STREAKS = 160;

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
  const UP = new THREE.Vector3(0, 1, 0),
    slant = new THREE.Vector3();
  // The rain blows with the wind: a steady breeze, and the gust on top.
  // Every drop, every frame: plain loops, nothing allocated.
  const wrap = (v, h) => (v > h ? v - 2 * h : v < -h ? v + 2 * h : v);
  function fall(dt) {
    const wx = 18 + wind.dir.x * wind.now * 2.5,
      wz = wind.dir.z * wind.now * 2.5;
    tilt.setFromUnitVectors(UP, slant.set(-wx, 70, -wz).normalize());
    for (let i = 0; i < RAIN; i++) {
      const d = drops[i];
      d[1] -= 70 * dt;
      d[0] = wrap(d[0] + wx * dt, 80);
      d[2] = wrap(d[2] + wz * dt, 80);
      if (d[1] < 0) d[1] += 120;
      at.set(
        camera.position.x + d[0],
        camera.position.y - 60 + d[1],
        camera.position.z + d[2],
      );
      rain.setMatrixAt(i, mx.compose(at, tilt, one));
    }
    rain.instanceMatrix.needsUpdate = true;
  }

  // ── Wind gusts ───────────────────────────────────────────────────────────
  // `now` is the gust's push (m/s) this frame, along `dir` (level, unit).
  const wind = {
    next: 4,
    t: 0,
    last: 0,
    peak: 0,
    now: 0,
    warned: false,
    dir: new THREE.Vector3(1, 0, 0),
  };
  const pick = ([a, b]) => a + Math.random() * (b - a);
  const right = new THREE.Vector3(),
    fwd = new THREE.Vector3(),
    tq2 = new THREE.Quaternion();
  function blow(dt) {
    if (wind.last <= 0) {
      if ((wind.next -= dt) > 0) {
        if (wind.next < WIND.warn && !wind.warned) warn();
        return;
      }
      if (!wind.warned) warn();
      wind.last = pick(WIND.last);
      wind.peak = pick(WIND.peak);
      wind.t = 0;
    }
    wind.t += dt;
    // Up and back down: a gust builds, holds, and dies away.
    const k = Math.min(1, wind.t / wind.last);
    wind.now = wind.peak * Math.sin(Math.PI * k) ** 0.6;
    if (k >= 1) {
      wind.last = wind.now = 0;
      wind.next = pick(WIND.every);
      wind.warned = false;
    }
    if (!P.alive || P.grounded) return;
    // Sideways: the plane is carried with the air, and the gust under one
    // wing rolls it away from the side it comes from.
    P.pos.addScaledVector(wind.dir, wind.now * dt);
    right.set(1, 0, 0).applyQuaternion(P.q);
    const side = right.dot(wind.dir); // > 0: blowing from the left
    P.q.multiply(
      tq2.setFromAxisAngle(fwd.set(0, 0, 1), -side * wind.now * 0.03 * dt),
    );
    P.q.normalize();
  }
  // A new gust's side, said as the player sees it, a moment before it hits.
  function warn() {
    const a = Math.random() * Math.PI * 2;
    wind.dir.set(Math.cos(a), 0, Math.sin(a));
    wind.warned = true;
    if (!P.alive || P.grounded) return;
    right.set(1, 0, 0).applyQuaternion(P.q).setY(0).normalize();
    fwd.set(0, 0, -1).applyQuaternion(P.q).setY(0).normalize();
    const across = right.dot(wind.dir),
      along = fwd.dot(wind.dir);
    kit.say(
      Math.abs(across) > Math.abs(along)
        ? `Gust from the ${across > 0 ? "left" : "right"}!`
        : along > 0
          ? "Gust from behind!"
          : "Gust head-on!",
      1.4,
    );
  }

  // Streaks of spray racing past with a gust, round the camera: seen only
  // while it blows, the stronger the brighter.
  const streaks = new THREE.InstancedMesh(
    new THREE.BoxGeometry(16, 0.09, 0.09),
    new THREE.MeshBasicMaterial({
      color: 0xe8eef5,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }),
    STREAKS,
  );
  streaks.frustumCulled = false;
  const spray = Array.from({ length: STREAKS }, () => [
      (rand() - 0.5) * 140,
      (rand() - 0.5) * 50,
      (rand() - 0.5) * 140,
    ]),
    along = new THREE.Quaternion(),
    X = new THREE.Vector3(1, 0, 0),
    stretch = new THREE.Vector3();
  function race(dt) {
    const k = wind.now / 16;
    streaks.material.opacity = 0.55 * k;
    streaks.visible = k > 0.02;
    if (!streaks.visible) return;
    along.setFromUnitVectors(X, wind.dir);
    stretch.set(0.5 + k, 1, 1);
    const v = 40 + wind.now * 5;
    for (let i = 0; i < STREAKS; i++) {
      const d = spray[i];
      d[0] = wrap(d[0] + wind.dir.x * v * dt, 70);
      d[2] = wrap(d[2] + wind.dir.z * v * dt, 70);
      at.set(
        camera.position.x + d[0],
        camera.position.y + d[1],
        camera.position.z + d[2],
      );
      streaks.setMatrixAt(i, mx.compose(at, along, stretch));
    }
    streaks.instanceMatrix.needsUpdate = true;
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

  function calm() {
    wind.last = wind.now = wind.t = 0;
    wind.next = 4;
    wind.warned = false;
    gust.fill(0);
    nextBolt = 8;
    thunderIn = -1;
    flash()?.classList.remove("on");
    fall(0);
    race(0);
  }
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
        blow(dt);
        fall(dt);
        race(dt);
        buffet(dt);
        lightning(dt);
      },
    },
    sky: 0x5d6873,
    fog: [120, 1100],
    below: 0x3e4a35,
    light: [0.55, 0.35],
    enter() {
      scene.add(rain, streaks);
      calm();
    },
    // A new game: no gust blowing or on its way, the buffeting settled, the
    // first bolt a while off.
    start: calm,
    leave() {
      rain.removeFromParent();
      streaks.removeFromParent();
      flash()?.classList.remove("on");
    },
  };
}
