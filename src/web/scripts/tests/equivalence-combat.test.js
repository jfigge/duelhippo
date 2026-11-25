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

// equivalence-combat.test.js — a long, busy sortie in each mode: enemies
// spawning, hunting and shooting, the player's guns and bombs on the town,
// damage, crashes and respawns. Everything the short tests don't reach, held
// to the prototype frame by frame.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPrototype, loadPort, diff, FRAME_MS } from "./harness.js";

const SEED = 31337;
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

// A scripted pilot: full power off the runway, then alternate climbing and
// diving with the guns hammering and a bomb every couple of seconds.
function sortie(mode, seconds) {
  both((g) => g.start(mode));
  both((g) => g.down("KeyW"));
  runBoth(5000, `${mode} takeoff roll`);
  both((g) => g.down("ArrowDown"));
  runBoth(1200, `${mode} rotate`);
  both((g) => g.up("ArrowDown"));
  both((g) => g.down("Space"));
  for (let t = 0; t < seconds; t += 2) {
    const pull = t % 8 < 4 ? "ArrowDown" : "ArrowUp";
    both((g) => g.down(pull));
    runBoth(700, `${mode} t=${t} ${pull}`);
    both((g) => {
      g.up(pull);
      g.press("KeyB");
      if (mode === "free" && t % 6 === 0) g.press("ArrowLeft");
    });
    runBoth(1300, `${mode} t=${t} level`);
  }
  both((g) => {
    g.up("Space");
    g.up("KeyW");
  });
}

// A closed-loop pilot for the bombing run: hold ~60 m over the lane, guns
// on, and release each bomb where it will fall on a standing target.
// Decisions are read from the prototype's state (identical to the port's
// while the test is passing) and applied to both as the same key presses.
function bombingRun(seconds) {
  both((g) => g.start("classic"));
  both((g) => g.down("KeyW"));
  runBoth(5000, "bomber takeoff roll");
  both((g) => g.down("Space"));
  let held = null;
  for (let f = Math.round((seconds * 1000) / FRAME_MS); f > 0; f--) {
    const P = proto.duel.P;
    const want = Math.max(-0.3, Math.min(0.3, (60 - P.pos.y) * 0.02));
    const th = Math.atan2(Math.sin(P.th), Math.cos(P.th));
    const next = !P.alive
      ? null
      : th < want - 0.03
        ? "ArrowDown"
        : th > want + 0.03
          ? "ArrowUp"
          : null;
    if (next !== held) {
      both((g) => {
        if (held) g.up(held);
        if (next) g.down(next);
      });
      held = next;
    }
    // Where a bomb released now lands: it keeps the plane's speed while it
    // falls the height (h = ½·G·t²).
    const carry = P.vel.x * Math.sqrt((2 * Math.max(1, P.pos.y)) / 9.8);
    if (P.alive && !P.grounded && P.bombs > 0 && P.bombCd <= 0)
      for (const t of proto.duel.targets)
        if (t.alive && Math.abs(t.x - P.pos.x - carry) < 8) {
          both((g) => g.press("KeyB"));
          break;
        }
    runBoth(FRAME_MS, `bombing run, ${f} frames left`);
  }
  both((g) => {
    if (held) g.up(held);
    g.up("Space");
    g.up("KeyW");
  });
}

test("classic: a 40 s bombing run through the enemy town matches the prototype", () => {
  bombingRun(40);
  const s = port.snapshot();
  // It has to have been an eventful flight, or matching proves little.
  assert.ok(
    s.targets.some((alive) => !alive),
    "some of the town should be down",
  );
});

test("classic: a 40 s looping dogfight matches the prototype", () => {
  sortie("classic", 40);
  const s = port.snapshot();
  assert.ok(s.ammo < 300, "the guns should have fired");
});

test("free: a 30 s dogfight matches the prototype", () => {
  sortie("free", 30);
});
