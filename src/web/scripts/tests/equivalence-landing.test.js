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

// equivalence-landing.test.js — the landing rules, in both modes, against the
// prototype: a gentle touchdown lands and services the plane; a steep dive
// into the ground crashes it.
//
// The set-ups are the prototype's own (features/prototype/scripts/
// landtest.mjs), applied to each game through its own objects.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPrototype, loadPort, diff, FRAME_MS } from "./harness.js";

const SEED = 7;
const proto = loadPrototype(SEED);
const port = await loadPort(SEED);
const both = (fn) => [proto, port].forEach(fn);

function runBoth(ms, label) {
  for (let n = Math.round(ms / FRAME_MS); n > 0; n--) {
    proto.run(FRAME_MS);
    port.run(FRAME_MS);
    const d = diff(proto.snapshot(), port.snapshot());
    assert.deepEqual(d, [], `${label}: diverged with ${n} frames left`);
  }
}

for (const mode of ["classic", "free"]) {
  test(`${mode}: gentle approach, touchdown, rollout and service match the prototype`, () => {
    both((g) => g.start(mode));
    both((g) =>
      g.poke((P) => {
        P.grounded = false;
        P.pos.set(-200, 4.5, 0);
        P.speed = 36;
        P.thr = 0.15;
        P.sink = 2;
        P.fuel = 30;
        P.bombs = 2;
      }),
    );
    runBoth(1500, "approach");
    assert.equal(port.snapshot().grounded, false, `${mode}: still floating in`);

    // Throttle to idle: speed bleeds off, lift goes, it settles onto the
    // runway, rolls to a stop and the ground crew get to work.
    both((g) =>
      g.poke((P) => {
        P.thr = 0;
      }),
    );
    runBoth(2000, "touchdown");
    const down = port.snapshot();
    assert.equal(down.grounded, true, `${mode}: should have landed`);
    assert.equal(down.alive, true);
    assert.match(down.msg, /Touchdown/);

    runBoth(7000, "rollout and service");
    const served = port.snapshot();
    assert.ok(
      served.fuel > 30,
      `${mode}: should have refuelled, got ${served.fuel}`,
    );
    assert.ok(served.bombs > 2, `${mode}: should have rearmed bombs`);
  });

  test(`${mode}: a steep dive into the ground crashes, as in the prototype`, () => {
    const before = port.snapshot().lives;
    both((g) =>
      g.poke((P) => {
        const Q = P.q.constructor,
          V = P.pos.constructor;
        P.grounded = false;
        P.pos.set(-100, 40, 0);
        P.speed = 70;
        P.sink = 0;
        P.thr = 1;
        P.q
          .setFromAxisAngle(new V(0, 0, 1), -1.0)
          .multiply(new Q().setFromAxisAngle(new V(0, 1, 0), -Math.PI / 2));
        P.th = -1.0;
      }),
    );
    runBoth(1500, "dive");
    const after = port.snapshot();
    assert.equal(after.alive, false, `${mode}: should have crashed`);
    assert.equal(after.lives, before - 1);
  });
}
