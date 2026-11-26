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

// motion.js — reading the phone's movement for a repair by phone (repair.js):
// a shake up and down, back and forth or side to side, and whether the phone
// is held upright. Not part of the prototype. It imports nothing of the
// game's, so the detector runs as well under the tests as on a phone.
//
// A devicemotion event gives the phone's acceleration in its own frame (x
// across the screen held upright, y up it, z out of it), with and without
// gravity. The shake's line is judged against the world, not the phone: up
// and down is along gravity, back and forth along the screen's facing (level),
// side to side across both, so it reads the same held landscape, as the game
// is played, or upright.

import { MOTION } from "./constants.js";

const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const unit = (v) => {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};
const KINDS = ["updown", "backforth", "side"];

// A detector: feed() it each reading; it returns the kind of shake just made
// ("updown", "backforth" or "side"), or null.
export function makeDetector() {
  let g = null; // gravity, the phone's frame
  const peaks = [[], [], []], // per line: { t, sign, mag }
    strength = [0, 0, 0]; // the hardest swing along each line, lately
  let last = 0;
  const d = {
    // `a` the acceleration without gravity (null where the phone gives only
    // the other), `ag` with it; `t` the time, in seconds.
    feed(a, ag, t) {
      if (!ag) return null;
      if (a) g = { x: ag.x - a.x, y: ag.y - a.y, z: ag.z - a.z };
      else {
        // No split given: gravity is what changes slowly.
        g ??= { ...ag };
        for (const k of ["x", "y", "z"]) g[k] += (ag[k] - g[k]) * 0.1;
        a = { x: ag.x - g.x, y: ag.y - g.y, z: ag.z - g.z };
      }
      const up = unit(g);
      // The screen's facing, made level; a phone lying flat has none, so
      // its top edge stands in.
      let face = { x: 0, y: 0, z: 1 };
      let k = dot(face, up);
      if (Math.abs(k) > 0.9)
        ((face = { x: 0, y: 1, z: 0 }), (k = dot(face, up)));
      face = unit({
        x: face.x - k * up.x,
        y: face.y - k * up.y,
        z: face.z - k * up.z,
      });
      const across = {
        x: up.y * face.z - up.z * face.y,
        y: up.z * face.x - up.x * face.z,
        z: up.x * face.y - up.y * face.x,
      };
      const parts = [dot(a, up), dot(a, face), dot(a, across)];
      const fade = Math.exp(-Math.max(0, t - last) / MOTION.window);
      last = t;
      for (let i = 0; i < 3; i++) {
        const v = parts[i],
          ps = peaks[i];
        strength[i] = Math.max(Math.abs(v), strength[i] * fade);
        while (ps.length && t - ps[0].t > MOTION.window) ps.shift();
        if (Math.abs(v) < MOTION.shake) continue;
        const sign = Math.sign(v),
          top = ps.at(-1);
        if (top && top.sign === sign) top.mag = Math.max(top.mag, Math.abs(v));
        else ps.push({ t, sign, mag: Math.abs(v) });
      }
      for (let i = 0; i < 3; i++) {
        if (peaks[i].length <= MOTION.turns) continue;
        const others = Math.max(...strength.filter((_, j) => j !== i));
        const mine = Math.min(...peaks[i].map((p) => p.mag));
        if (mine < MOTION.dominant * others) continue;
        d.reset();
        return KINDS[i];
      }
      return null;
    },
    // Upright: gravity along the phone's long side, as held in portrait.
    upright() {
      return !!g && Math.abs(g.y) > MOTION.upright * Math.hypot(g.x, g.y, g.z);
    },
    // A fresh start: nothing half made counts towards the next shake.
    reset() {
      for (const ps of peaks) ps.length = 0;
      strength.fill(0);
    },
  };
  return d;
}

// The phone's: whether it has given a reading at all, and the detector.
export const motion = { seen: false, detector: makeDetector() };

// Listens for the phone's movement, once; `onShake(kind)` for each shake.
let bound = false;
export function listenMotion(onShake) {
  if (bound) return;
  bound = true;
  window.addEventListener("devicemotion", (e) => {
    const ag = e.accelerationIncludingGravity;
    if (!ag || ag.x === null) return;
    motion.seen = true;
    const a =
      e.acceleration && e.acceleration.x !== null ? e.acceleration : null;
    const kind = motion.detector.feed(a, ag, window.performance.now() / 1000);
    if (kind) onShake(kind);
  });
}

// iOS asks the player before a page may read the motion sensors, and only
// from inside a tap: the FIX button's (input.js). True if it may.
export function askMotion() {
  const ask = window.DeviceMotionEvent?.requestPermission;
  if (typeof ask !== "function") return Promise.resolve(true);
  return ask
    .call(window.DeviceMotionEvent)
    .then((s) => s === "granted")
    .catch(() => false);
}
