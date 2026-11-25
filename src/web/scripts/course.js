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

// course.js — the obstacle course (constants.js COURSE): fifty rings over
// the Countryside, flown in order against the clock, at one of three sizes.
//
// The course is laid out from its own seeded generator, so every flight
// (and every player) flies the same one. The clock starts at the first ring
// and stops at the last. The record (the sizes opened, and the best scores)
// lives in localStorage: the course has its own table, not the one-player
// board's, and its scores do not count toward opening maps.

import * as THREE from "three";
import { CX, COURSE, COURSE_KEY } from "./constants.js";
import { scene, put } from "./scene.js";
import { say } from "./msg.js";
import { sfx } from "./audio.js";
import { P } from "./flight.js";

// mulberry32, as maps.js has it: the course must not touch Math.random.
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The rings' centres and the way through each: off the home runway's far
// end and up, then onward in gentle climbs, dives and turns. They are far
// apart (380–480 m: six or seven seconds' flying) and each turns at most
// 30° from the last and climbs or dives at most 7°, so there is time to
// line up on the next. Kept over the flat ground (within 2200 m of the
// middle) and 40–240 m up.
const GAP = [380, 480],
  TURN = 0.52,
  CLIMB = 0.12;
export const RINGS = (() => {
  const rand = seeded(50),
    out = [];
  let x = 900,
    y = 60,
    z = 0,
    hd = 0;
  for (let i = 0; i < COURSE.rings; i++) {
    const d = i ? GAP[0] + rand() * (GAP[1] - GAP[0]) : 0;
    let climb = 0;
    if (i) {
      let turn = (rand() - 0.5) * 0.7;
      // Far from the middle, turn back towards it.
      const off = Math.atan2(-z, CX - x) - hd,
        far = Math.hypot(x - CX, z) / 2200;
      if (far > 0.55) turn += Math.atan2(Math.sin(off), Math.cos(off)) * far;
      hd += Math.max(-TURN, Math.min(TURN, turn));
      const want = 40 + rand() * 200;
      climb = Math.max(-CLIMB, Math.min(CLIMB, (want - y) / d));
    }
    const nx = x + Math.cos(hd) * d * Math.cos(climb),
      nz = z + Math.sin(hd) * d * Math.cos(climb),
      ny = Math.max(40, Math.min(240, y + Math.sin(climb) * d));
    const n = new THREE.Vector3(nx - x, ny - y, nz - z);
    if (!i) n.set(1, 0.05, 0);
    out.push({ c: new THREE.Vector3(nx, ny, nz), n: n.normalize() });
    [x, y, z] = [nx, ny, nz];
  }
  return out;
})();

// ── The record ──────────────────────────────────────────────────────────────
// {open: sizes flown (0: Large only), best: [{n, s, z, t}] top ten}.
function load() {
  try {
    const r = JSON.parse(window.localStorage.getItem(COURSE_KEY));
    if (r && Number.isInteger(r.open) && Array.isArray(r.best)) return r;
  } catch {
    // Nothing saved, or unreadable: a fresh record.
  }
  return { open: 0, best: [] };
}
const record = load();
function keep() {
  try {
    window.localStorage.setItem(COURSE_KEY, JSON.stringify(record));
  } catch {
    // No storage: the record lasts the session.
  }
}
export const sizeOpen = (z) => z <= record.open;
export const courseBest = () => record.best;

// ── A flight ────────────────────────────────────────────────────────────────
export const run = {
  on: false,
  size: 0,
  next: 0, // the ring to fly through next
  t: 0, // seconds since the first ring
  score: 0,
  done: false,
};

const group = new THREE.Group();
const meshes = [];
const COLOURS = { next: 0xffe66b, soon: 0x55ffff, later: 0xdedede };
function draw() {
  for (const m of meshes) m.removeFromParent();
  meshes.length = 0;
  const { r } = COURSE.sizes[run.size];
  const geo = new THREE.TorusGeometry(r, Math.max(0.9, r * 0.09), 8, 40);
  for (const ring of RINGS) {
    const m = new THREE.Mesh(
      geo,
      new THREE.MeshLambertMaterial({ color: COLOURS.later }),
    );
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), ring.n);
    put(group, m, ring.c.x, ring.c.y, ring.c.z);
    meshes.push(m);
  }
  shade();
}
// The next ring glows yellow, the one after cyan; flown ones are gone.
function shade() {
  meshes.forEach((m, i) => {
    m.visible = i >= run.next;
    const c =
      i === run.next
        ? COLOURS.next
        : i === run.next + 1
          ? COLOURS.soon
          : COLOURS.later;
    m.material.color.setHex(c);
    m.material.emissive.setHex(i <= run.next + 1 ? c : 0);
    m.material.emissiveIntensity = i === run.next ? 0.6 : 0.25;
  });
}

export function startCourse(size) {
  run.on = true;
  run.size = sizeOpen(size) ? size : 0;
  run.next = 0;
  run.t = 0;
  run.score = 0;
  run.done = false;
  draw();
  scene.add(group);
  last.copy(P.pos);
}
export function endCourse() {
  run.on = false;
  group.removeFromParent();
}

// Once a frame in play: the clock, and whether the plane went through the
// next ring since the last frame (its path crossed the ring's plane, the
// right way, inside the hole). Returns true when the last ring is flown.
const last = new THREE.Vector3(),
  hit = new THREE.Vector3();
export function updCourse(dt) {
  if (!run.on || run.done) return false;
  if (run.next > 0) run.t += dt;
  P.fuel = 100; // the course is about flying, not fuel
  const ring = RINGS[run.next],
    { r, pts } = COURSE.sizes[run.size];
  if (P.alive) {
    const d0 = last.clone().sub(ring.c).dot(ring.n),
      d1 = hit.copy(P.pos).sub(ring.c).dot(ring.n);
    if (d0 < 0 && d1 >= 0) {
      hit.lerpVectors(last, P.pos, d0 / (d0 - d1));
      const miss = hit.distanceTo(ring.c);
      if (miss <= r) {
        run.next++;
        run.score += pts;
        sfx.tick();
        shade();
        if (run.next === RINGS.length) return finish();
        say(`Ring ${run.next} of ${RINGS.length}`, 0.8);
      } else if (miss < r * 4)
        say(`Missed ring ${run.next + 1}. Go round`, 1.5);
    }
  }
  last.copy(P.pos);
  return false;
}

function finish() {
  run.done = true;
  const { pts } = COURSE.sizes[run.size];
  run.bonus = Math.max(
    0,
    Math.round(((COURSE.par - run.t) * COURSE.bonus * pts) / 100),
  );
  run.score += run.bonus;
  return true;
}

// The flight's score into the table (top ten), and the next size opened
// if this one was finished. Returns {rank (0-based, or -1), opened}.
export function recordCourse(initials) {
  const entry = {
    n: initials || "???",
    s: run.score,
    z: run.size,
    t: run.done ? Math.round(run.t * 10) / 10 : null,
  };
  record.best.push(entry);
  record.best.sort((a, b) => b.s - a.s);
  record.best.length = Math.min(record.best.length, 10);
  const rank = record.best.indexOf(entry);
  let opened = null;
  if (
    run.done &&
    run.size === record.open &&
    record.open < COURSE.sizes.length - 1
  ) {
    record.open++;
    opened = COURSE.sizes[record.open].name;
  }
  keep();
  return { rank, opened };
}

// m:ss.s
export const clock = (t) =>
  `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
