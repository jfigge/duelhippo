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

// tilt-steer.test.js — steering by tilting the phone, in the game: the
// Settings switch, the stick hidden, the plane banked and pulled up by the
// phone, level taken afresh on resume, and the stick back when the switch is
// turned off or motion access is refused. Its own file: the tilt listener,
// once bound, is bound for good. Port only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { loadPort, FRAME_MS } from "./harness.js";

const game = await loadPort(31);
const { w, duel } = game;
const $ = (id) => w.document.getElementById(id);
const { touch } = await import("../input.js");
const { opt } = await import("../state.js");
const settle = () => new Promise((r) => setTimeout(r, 0));

// Held landscape, top to the left, as the game is played.
Object.defineProperty(w.screen, "orientation", { value: { angle: 90 } });

// One deviceorientation reading for the screen leant back `lean` rad and
// turned `wheel` rad clockwise (as tilt.test.js's pose, at 90°).
function reading(lean, wheel = 0) {
  const s = {
    x: Math.cos(lean) * Math.sin(wheel),
    y: -Math.cos(lean) * Math.cos(wheel),
    z: -Math.sin(lean),
  };
  const d = { x: s.y, y: -s.x, z: s.z }; // the screen's frame to the phone's
  const e = new w.Event("deviceorientation");
  e.beta = (Math.asin(-d.y) * 180) / Math.PI;
  e.gamma = (Math.atan2(d.x, -d.z) * 180) / Math.PI;
  w.dispatchEvent(e);
}

function airborne() {
  game.start("free");
  game.run(100);
  game.poke((P) => {
    P.grounded = false;
    P.pos.set(1400, 400, 0);
    P.speed = 60;
    P.thr = 0.8;
    P.q.identity();
  });
}
// `ms` of frames, the phone held so the while.
function fly(ms, lean, wheel) {
  for (let t = 0; t < ms; t += FRAME_MS) {
    reading(lean, wheel);
    game.poke((P) => (P.pos.y = 400));
    game.run(FRAME_MS);
  }
}
const bank = () => new Vector3(1, 0, 0).applyQuaternion(duel.P.q).y;
const climb = () => new Vector3(0, 0, -1).applyQuaternion(duel.P.q).y;

test("the switch: off at first, on with a tap, and the stick goes", async () => {
  assert.equal(opt.tilt, false);
  assert.match($("bTilt").textContent, /stick/);
  $("bTilt").click();
  await settle();
  assert.equal(opt.tilt, true);
  assert.match($("bTilt").textContent, /tilt/);
  assert.match($("bTiltPause").textContent, /tilt/);
  assert.ok(w.document.body.classList.contains("tilt"));
  assert.equal(w.localStorage.getItem("duelhippo.tilt"), "1");
});

test("turned clockwise the plane banks right; tipped back it climbs", () => {
  airborne();
  fly(200, 0.5, 0); // the pose it goes live in is level
  assert.equal(touch.pitch, 0);
  assert.equal(touch.roll, 0);
  fly(600, 0.5, 0.35);
  assert.ok(touch.roll < 0 && touch.held && touch.flying);
  assert.ok(bank() < -0.1, `banked right (right.y ${bank()})`);

  airborne();
  fly(200, 0.5, 0);
  fly(600, 0.25, 0);
  assert.ok(touch.pitch > 0);
  assert.ok(climb() > 0.1, `nose up (forward.y ${climb()})`);
});

test("paused, tilt does nothing; resumed, level is the pose held then", () => {
  airborne();
  fly(200, 0.5, 0);
  game.press("KeyP");
  fly(200, 0.1, 0);
  assert.equal(touch.pitch, 0, "a pause takes no reading");
  game.press("KeyP");
  fly(400, 0.1, 0); // the new level
  assert.equal(touch.pitch, 0);
  fly(400, 0.4, 0);
  assert.ok(touch.pitch < 0, "and away from it pushes down");
});

test("off again: the stick back, and nothing of the tilt left", async () => {
  airborne();
  fly(200, 0.5, 0);
  fly(200, 0.5, 0.4);
  $("bTiltPause").click();
  await settle();
  assert.equal(opt.tilt, false);
  assert.ok(!w.document.body.classList.contains("tilt"));
  assert.equal(touch.roll, 0);
  fly(200, 0.5, 0.4);
  assert.equal(touch.roll, 0, "the phone no longer steers");
});

test("refused motion access: the stick stays", async () => {
  w.DeviceOrientationEvent = {
    requestPermission: () => Promise.resolve("denied"),
  };
  game.press("KeyP");
  $("bTiltPause").click();
  await settle();
  await settle();
  assert.equal(opt.tilt, false);
  assert.match($("bTiltPause").textContent, /stick/);
  assert.match($("msg").textContent, /motion access/);
  delete w.DeviceOrientationEvent;
});
