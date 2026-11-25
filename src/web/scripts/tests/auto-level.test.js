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

// auto-level.test.js — letting go of the touch stick eases the plane back to
// straight and level flight. Port only: the prototype has no auto-level, and
// keyboard play (the equivalence suites) never triggers it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Euler, Quaternion, Vector3 } from "three";
import { loadPort } from "./harness.js";

const game = await loadPort(7);
// After the boot: the game modules need its window to evaluate.
const { touch } = await import("../input.js");
const { duel } = game;

// The stick has been flying the plane and was just let go.
function stickUsed() {
  touch.flying = true;
  touch.held = false;
}

// Put the player in the air at cruise, high over the middle of the map.
function airborne(mode, setup) {
  game.start(mode);
  game.run(100);
  game.poke((P) => {
    P.grounded = false;
    P.pos.set(1400, 400, 0); // mid-lane, so no "turn back"
    P.speed = 60;
    P.thr = 0.8;
    setup(P);
  });
}

// How far the nose points up, and how far the right wing points up.
const attitude = (P) => ({
  climb: new Vector3(0, 0, -1).applyQuaternion(P.q).y,
  bank: new Vector3(1, 0, 0).applyQuaternion(P.q).y,
});

test("free flight: hands off levels a climbing, banked plane", () => {
  airborne("free", (P) =>
    P.q.copy(new Quaternion().setFromEuler(new Euler(0.3, 0, 0.7, "YXZ"))),
  );
  stickUsed();
  game.run(1000);
  const early = attitude(duel.P);
  assert.ok(Math.abs(early.bank) > 0.1, "slowly, not in one frame");
  game.run(6000);
  const { climb, bank } = attitude(duel.P);
  assert.ok(duel.P.alive, "still flying");
  assert.ok(Math.abs(bank) < 0.03, `wings level (right.y ${bank})`);
  assert.ok(Math.abs(climb) < 0.03, `nose on the horizon (forward.y ${climb})`);
});

test("free flight: inverted, hands off rolls the right way up", () => {
  airborne("free", (P) =>
    P.q.copy(new Quaternion().setFromEuler(new Euler(0, 0, 2.8, "YXZ"))),
  );
  stickUsed();
  game.run(10000);
  const up = new Vector3(0, 1, 0).applyQuaternion(duel.P.q).y;
  assert.ok(up > 0.99, `upright (up.y ${up})`);
});

test("free flight: a thumb resting on the stick holds the bank", () => {
  airborne("free", (P) =>
    P.q.copy(new Quaternion().setFromEuler(new Euler(0, 0, 0.5, "YXZ"))),
  );
  touch.flying = touch.held = true;
  const before = attitude(duel.P).bank;
  game.run(3000);
  touch.held = false;
  assert.ok(
    Math.abs(attitude(duel.P).bank - before) < 0.02,
    "bank unchanged while held",
  );
});

test("classic: hands off brings the nose back to the horizon", () => {
  for (const [th, want] of [
    [0.6, 0],
    [Math.PI - 0.6, Math.PI],
  ]) {
    airborne("classic", (P) => {
      P.th = th;
    });
    stickUsed();
    game.run(6000);
    const err = Math.abs(
      Math.atan2(Math.sin(duel.P.th - want), Math.cos(duel.P.th - want)),
    );
    assert.ok(err < 0.03, `th ${duel.P.th} → ${want}`);
  }
});

test("below stall the nose is left to drop", () => {
  airborne("free", (P) => {
    P.speed = 20;
    P.thr = 0;
    P.q.identity();
  });
  stickUsed();
  game.run(1500);
  assert.ok(attitude(duel.P).climb < -0.2, "nose dropped to gain speed");
});

test("a steering key hands control back: no auto-level", () => {
  airborne("free", (P) =>
    P.q.copy(new Quaternion().setFromEuler(new Euler(0, 0, 0.5, "YXZ"))),
  );
  stickUsed();
  game.press("KeyA");
  const before = attitude(duel.P).bank;
  game.run(3000);
  assert.ok(Math.abs(attitude(duel.P).bank - before) < 0.02, "bank held");
});
