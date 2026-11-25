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

// sights.test.js — aiming down the sights in Free flight: Shift held or Caps
// Lock on. Port only; the prototype has no such view.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPort } from "./harness.js";

const game = await loadPort(42);
const { w, duel } = game;
const $ = (id) => w.document.getElementById(id);
const aiming = () => $("hud").classList.contains("ads");

// A key event carrying the Caps Lock state, as a browser sends it.
function key(type, code, caps) {
  w.dispatchEvent(
    new w.KeyboardEvent(type, { code, bubbles: true, modifierCapsLock: caps }),
  );
}

// Airborne in Free flight, level, at speed.
function fly() {
  game.start("free");
  game.down("KeyW");
  game.run(6000);
  game.up("KeyW");
  assert.ok(!duel.P.grounded, "airborne");
}

// Radians the nose turns through in half a second of full up elevator.
function pitchRate() {
  const q = duel.P.q.clone();
  game.down("ArrowDown");
  game.run(500);
  game.up("ArrowDown");
  return q.angleTo(duel.P.q);
}

test("Shift held aims down the sights, and turns are finer", () => {
  fly();
  assert.equal(aiming(), false);
  const coarse = pitchRate();
  game.down("ShiftLeft");
  game.run(400); // the zoom eases in
  assert.equal(aiming(), true);
  assert.ok(duel.camera.fov < 30, `zoomed to ${duel.camera.fov}`);
  const fine = pitchRate();
  assert.ok(fine < coarse * 0.15, `fine ${fine} vs ${coarse}`);
  game.up("ShiftLeft");
  game.run(800);
  assert.equal(aiming(), false);
  assert.equal(duel.camera.fov, 60, "zoomed back out");
});

test("Caps Lock latches the sights; Shift then flips them off while held", () => {
  fly();
  key("keydown", "CapsLock", true);
  game.run(100);
  assert.equal(aiming(), true, "on with the lock");
  // Every key event carries the lock's state; the lock is still on.
  key("keydown", "ShiftRight", true);
  game.run(100);
  assert.equal(aiming(), false, "Shift flips them while held");
  key("keyup", "ShiftRight", true);
  game.run(100);
  assert.equal(aiming(), true);
  key("keyup", "CapsLock", false); // macOS: the keyup turns the lock off
  game.run(100);
  assert.equal(aiming(), false);
});

test("no sights in Classic: it is side-on", () => {
  game.start("classic");
  game.down("ShiftLeft");
  game.run(200);
  assert.equal(aiming(), false);
  game.up("ShiftLeft");
});
