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

// tilt.test.js — steering by tilting the phone (motion.js makeTilt): the
// phone held landscape either way round, tipped and turned, read as the
// stick's pitch and roll. Port only; no browser needed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { makeTilt, downFrom, toScreen } from "../motion.js";
import { TILT } from "../constants.js";

const DEG = 180 / Math.PI;

// deviceorientation's beta and gamma for a phone held landscape (`angle`),
// its screen leant back `lean` rad from upright and turned `wheel` rad
// clockwise, as a steering wheel.
function pose(angle, lean, wheel = 0) {
  // Down in the screen's frame, then in the phone's.
  let s = { x: 0, y: -Math.cos(lean), z: -Math.sin(lean) };
  s = {
    x: s.x * Math.cos(wheel) - s.y * Math.sin(wheel),
    y: s.x * Math.sin(wheel) + s.y * Math.cos(wheel),
    z: s.z,
  };
  const d = toScreen(s, -angle);
  return { beta: Math.asin(-d.y) * DEG, gamma: Math.atan2(d.x, -d.z) * DEG };
}

// Holds the pose long enough for the smoothing to settle.
function hold(t, angle, lean, wheel, at) {
  const { beta, gamma } = pose(angle, lean, wheel);
  t.feed(beta, gamma, angle, at);
  return t.feed(beta, gamma, angle, at + 2);
}

test("down from beta and gamma: flat, upright and on its side", () => {
  const near = (v, w) =>
    ["x", "y", "z"].forEach((k) => assert.ok(Math.abs(v[k] - w[k]) < 1e-9));
  near(downFrom(0, 0), { x: 0, y: 0, z: -1 });
  near(downFrom(90, 0), { x: 0, y: -1, z: 0 });
  near(downFrom(0, -90), { x: -1, y: 0, z: 0 });
  // That last held landscape, top to the left: down the screen.
  near(toScreen(downFrom(0, -90), 90), { x: 0, y: -1, z: 0 });
});

for (const angle of [90, -90]) {
  test(`landscape (${angle}°): the pose held at the start is centre`, () => {
    const t = makeTilt();
    const r = hold(t, angle, 0.5, 0, 0);
    assert.deepEqual(r, { pitch: 0, roll: 0, held: false });
  });

  test(`landscape (${angle}°): top towards you pulls up, away pushes`, () => {
    const t = makeTilt();
    hold(t, angle, 0.5, 0, 0);
    const up = hold(t, angle, 0.3, 0, 10);
    assert.ok(up.pitch > 0.3 && up.pitch < 1, `pull ${up.pitch}`);
    assert.ok(Math.abs(up.roll) < 1e-9 && up.held);
    const down = hold(t, angle, 0.7, 0, 20);
    assert.ok(Math.abs(down.pitch + up.pitch) < 1e-6, "the same, mirrored");
  });

  test(`landscape (${angle}°): turned clockwise banks right`, () => {
    const t = makeTilt();
    hold(t, angle, 0.5, 0, 0);
    const right = hold(t, angle, 0.5, 0.3, 10);
    assert.ok(right.roll < -0.3 && right.roll > -1, `roll ${right.roll}`);
    assert.ok(Math.abs(right.pitch) < 1e-6, "no pitch from a turn");
    assert.ok(
      hold(t, angle, 0.5, -0.3, 20).roll > 0.3,
      "and anticlockwise left",
    );
  });
}

test("inside the dead zone is centre; past full is full", () => {
  const t = makeTilt();
  hold(t, 90, 0.5, 0, 0);
  const small = TILT.dead * 0.8;
  assert.deepEqual(hold(t, 90, 0.5 - small, small, 10), {
    pitch: 0,
    roll: 0,
    held: false,
  });
  const r = hold(t, 90, 0.5 - 2 * TILT.pitch, 2 * TILT.roll, 20);
  assert.equal(r.pitch, 1);
  assert.equal(r.roll, -1);
});

test("a sudden tip is eased in, not taken at once", () => {
  const t = makeTilt();
  hold(t, 90, 0.5, 0, 0);
  const { beta, gamma } = pose(90, 0.5, 0.6);
  const first = t.feed(beta, gamma, 90, 2 + 1 / 60);
  assert.ok(first.roll > -0.5, `one frame in ${first.roll}`);
  assert.ok(t.feed(beta, gamma, 90, 4).roll < -0.8, "then all of it");
});

test("centre() makes the next pose level", () => {
  const t = makeTilt();
  hold(t, 90, 0.5, 0, 0);
  assert.ok(hold(t, 90, 0.2, 0, 10).pitch > 0);
  t.centre();
  assert.equal(hold(t, 90, 0.2, 0, 20).pitch, 0);
});

test("no reading yet (a desktop's empty event) gives nothing", () => {
  assert.equal(makeTilt().feed(null, null, 0, 0), null);
});
