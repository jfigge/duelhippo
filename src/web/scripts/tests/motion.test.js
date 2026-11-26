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

// motion.test.js — the phone's moves for a repair by phone (motion.js):
// shakes along each line, told apart from wobble and from each other, and
// the phone held upright or on its side. Port only; no browser needed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDetector } from "../motion.js";

const G = 9.81;
// Held as the game is played: landscape, the screen facing the player, so
// gravity runs along the phone's x (across the screen held upright).
const LANDSCAPE = { x: -G, y: 0, z: 0 };
const UPRIGHT = { x: 0, y: -G, z: 0 };

// Feeds `secs` of readings at 60 Hz: a shake of `amp` m/s² at 3 Hz along
// the phone's own `axis`, plus `echo` of it along `also`. Returns the kinds
// the detector reported.
function shake(
  d,
  { axis, amp = 16, also = null, echo = 0, secs = 0.8, g = LANDSCAPE, t0 = 0 },
) {
  const out = [];
  for (let i = 0; i < secs * 60; i++) {
    const t = t0 + i / 60,
      v = amp * Math.sin(2 * Math.PI * 3 * t),
      a = { x: 0, y: 0, z: 0 };
    a[axis] += v;
    if (also) a[also] += echo * v;
    const ag = { x: a.x + g.x, y: a.y + g.y, z: a.z + g.z };
    const k = d.feed(a, ag, t);
    if (k) out.push(k);
  }
  return out;
}

test("held landscape: a shake along each line is told for what it is", () => {
  // Gravity along x: up and down is x, back and forth z (the screen's
  // facing), side to side y.
  for (const [axis, kind] of [
    ["x", "updown"],
    ["z", "backforth"],
    ["y", "side"],
  ]) {
    const d = makeDetector();
    const got = shake(d, { axis });
    assert.ok(got.length >= 1, `${kind}: seen`);
    assert.ok(
      got.every((k) => k === kind),
      `${kind}: ${got}`,
    );
  }
});

test("held upright the lines follow gravity, not the phone", () => {
  const d = makeDetector();
  assert.deepEqual(
    [...new Set(shake(d, { axis: "y", g: UPRIGHT }))],
    ["updown"],
  );
  assert.deepEqual(
    [...new Set(shake(d, { axis: "x", g: UPRIGHT, t0: 2 }))],
    ["side"],
  );
});

test("the wobble of holding a phone is no shake", () => {
  const d = makeDetector();
  assert.deepEqual(shake(d, { axis: "x", amp: 4, secs: 2 }), []);
  assert.deepEqual(shake(d, { axis: "y", amp: 6, secs: 2, t0: 3 }), []);
});

test("a shake with an echo along another line is the strong line's alone", () => {
  const d = makeDetector();
  const got = shake(d, { axis: "y", also: "z", echo: 0.4 });
  assert.ok(got.length >= 1);
  assert.ok(
    got.every((k) => k === "side"),
    String(got),
  );
  // Two lines alike: neither stands out, so neither counts.
  assert.deepEqual(
    shake(makeDetector(), { axis: "y", also: "z", echo: 1 }),
    [],
  );
});

test("upright: gravity along the phone's long side", () => {
  const d = makeDetector();
  d.feed({ x: 0, y: 0, z: 0 }, LANDSCAPE, 0);
  assert.equal(d.upright(), false);
  d.feed({ x: 0, y: 0, z: 0 }, UPRIGHT, 0.1);
  assert.equal(d.upright(), true);
  // With only the reading with gravity in it, it learns gravity over time.
  const e = makeDetector();
  for (let i = 0; i < 60; i++) e.feed(null, UPRIGHT, i / 60);
  assert.equal(e.upright(), true);
});
