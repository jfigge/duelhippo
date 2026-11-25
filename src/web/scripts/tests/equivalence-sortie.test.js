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

// equivalence-sortie.test.js — take off, fly, shoot and bomb, in both modes,
// and check the port matches the prototype frame by frame.
//
// The script is the prototype's own playtest (features/prototype/scripts/
// playtest.mjs): full throttle for 1.6 s, roll, pull up, guns and a bomb,
// then six seconds of the enemies doing as they please.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPrototype, loadPort, diff, FRAME_MS } from "./harness.js";

const SEED = 1984;
const proto = loadPrototype(SEED);
const port = await loadPort(SEED);
const both = (fn) => [proto, port].forEach(fn);

// Advance both games in lock-step, comparing every frame; report the first
// frame they part company, which is where a porting slip shows up.
function runBoth(ms, label) {
  for (let n = Math.round(ms / FRAME_MS); n > 0; n--) {
    proto.run(FRAME_MS);
    port.run(FRAME_MS);
    const d = diff(proto.snapshot(), port.snapshot());
    assert.deepEqual(d, [], `${label}: diverged with ${n} frames left`);
  }
}

test("the title screens agree before anything starts", () => {
  runBoth(500, "title");
  assert.equal(port.snapshot().state, "title");
});

for (const mode of ["classic", "free"]) {
  test(`${mode}: takeoff, climb, guns and bomb match the prototype`, () => {
    both((g) => g.start(mode));
    runBoth(300, "start");

    both((g) => g.down("KeyW"));
    runBoth(1600, "throttle up");
    both((g) => g.up("KeyW"));
    runBoth(3500, "rolling");
    const rolling = port.snapshot();
    assert.ok(
      rolling.speed > 20,
      `${mode}: should be rolling, got ${rolling.speed}`,
    );

    both((g) => g.down("ArrowDown"));
    runBoth(900, "pull up");
    both((g) => g.up("ArrowDown"));
    runBoth(2500, "climb");
    assert.equal(
      port.snapshot().grounded,
      false,
      `${mode}: should be airborne`,
    );

    both((g) => {
      g.down("Space");
      g.press("KeyB");
    });
    runBoth(600, "guns");
    both((g) => g.up("Space"));
    const shot = port.snapshot();
    assert.ok(shot.ammo < 300, `${mode}: guns should have fired`);
    assert.equal(shot.bombs, 5, `${mode}: one bomb should be gone`);

    runBoth(6000, "later");
  });
}
