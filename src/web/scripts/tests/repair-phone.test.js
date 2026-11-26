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

// repair-phone.test.js — repairing in flight on a phone: the FIX button,
// shown only while a repair can begin, and a run of moves of the phone (a
// shake along a line, or a turn) in place of number keys. Its own file: the
// motion sensor, once heard from, is heard from for good. Port only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPort, FRAME_MS } from "./harness.js";

const game = await loadPort(23);
const { w, duel } = game;
const P = duel.P;
const $ = (id) => w.document.getElementById(id);
const { fix, runLength } = await import("../repair.js");
const { REPAIR } = await import("../constants.js");
const msg = () => $("msg").textContent;
const fixShown = () => !$("bFix").classList.contains("hidden");
const COUNT = REPAIR.count * REPAIR.tick * 1000;
// The FIX button's handler asks for the sensors (a promise) before it acts.
const settle = () => new Promise((r) => setTimeout(r, 0));

const G = 9.81;
const LANDSCAPE = { x: -G, y: 0, z: 0 },
  UPRIGHT = { x: 0, y: -G, z: 0 };
let held = LANDSCAPE;
// Which of the phone's axes each line is, held the way it is.
const axisOf = (kind) =>
  kind === "backforth"
    ? "z"
    : (kind === "updown") === (held === LANDSCAPE)
      ? "x"
      : "y";

function hurt(dmg) {
  game.start("free");
  game.poke((P) => {
    P.grounded = false;
    P.alive = true;
    P.pos.set(1400, 400, 0);
    P.speed = 60;
    P.dmg = dmg;
  });
}
const keepFlying = () =>
  game.poke((P) => {
    P.pos.y = 400;
    P.speed = 60;
  });
// One reading of the phone, as a browser sends it.
function reading(a) {
  const e = new w.Event("devicemotion");
  e.acceleration = a;
  e.accelerationIncludingGravity = {
    x: a.x + held.x,
    y: a.y + held.y,
    z: a.z + held.z,
  };
  w.dispatchEvent(e);
}
// `ms` of frames, the phone still (or shaken along `axis`) the while.
function frames(ms, axis = null, amp = 16) {
  for (let t = 0; t < ms; t += FRAME_MS) {
    const a = { x: 0, y: 0, z: 0 };
    if (axis)
      a[axis] = amp * Math.sin(2 * Math.PI * 3 * (w.performance.now() / 1000));
    reading(a);
    keepFlying();
    game.run(FRAME_MS);
  }
}

test("FIX shows only while a repair can begin", () => {
  game.start("free");
  game.poke((P) => (P.dmg = 30)); // hurt, but on the runway
  game.run(50);
  assert.ok(!fixShown(), "not on the ground");
  hurt(0);
  game.run(50);
  assert.ok(!fixShown(), "not unhurt");
  hurt(30);
  game.run(50);
  assert.ok(fixShown(), "hurt, in the air");
  game.press("KeyF"); // a repair by keys spends it as well
  game.run(50);
  assert.ok(!fixShown(), "not while one runs, nor after");
});

test("no motion sensor: the run turns to number keys", async () => {
  hurt(30);
  $("bFix").click();
  await settle();
  assert.equal(fix.mode, "moves");
  for (let t = 0; t < COUNT + 50; t += 50) {
    keepFlying();
    game.run(50);
  }
  assert.equal(fix.stage, "steps");
  assert.equal(fix.mode, "keys");
  assert.match(msg(), /No motion sensor/);
  assert.ok(fix.seq.every((n) => Number.isInteger(n)));
});

test("turned down, the sensors' question leaves the repair unspent", async () => {
  w.DeviceMotionEvent = { requestPermission: () => Promise.resolve("denied") };
  hurt(30);
  $("bFix").click();
  await settle();
  await settle();
  assert.equal(fix.stage, null);
  assert.equal(fix.used, false);
  assert.match(msg(), /Motion access is needed/);
  delete w.DeviceMotionEvent;
});

test("FIX, then each move shown: shakes and turns, and the damage is gone", async () => {
  held = LANDSCAPE;
  hurt(60);
  $("bFix").click();
  await settle();
  assert.equal(fix.mode, "moves");
  assert.equal(fix.seq.length, runLength(60));
  frames(COUNT + 50);
  assert.equal(fix.stage, "steps");
  assert.equal(fix.mode, "moves", "the sensor was heard from");
  // Every kind of move, in an order of our own, and a turn back.
  fix.seq = ["updown", "turn", "side", "backforth", "turn", "updown"];
  fix.i = 0;
  fix.upright = false;
  frames(FRAME_MS); // the panel redrawn
  for (let i = 0; i < fix.seq.length; i++) {
    const m = fix.seq[i];
    const box = $("repair").textContent;
    if (m === "turn") {
      assert.match(box, fix.upright ? /upright/ : /on its side/);
      held = held === LANDSCAPE ? UPRIGHT : LANDSCAPE;
      frames(100);
    } else {
      assert.match(
        box,
        {
          updown: /up and down/,
          side: /side to side/,
          backforth: /back and forth/,
        }[m],
      );
      for (let t = 0; t < 2000 && fix.i === i && fix.stage; t += FRAME_MS)
        frames(FRAME_MS, axisOf(m));
      frames(200); // still again
    }
    if (i < fix.seq.length - 1) assert.equal(fix.i, i + 1, `${m} done`);
  }
  assert.equal(fix.stage, null);
  assert.equal(P.dmg, 0);
  assert.match(msg(), /Repaired/);
  held = LANDSCAPE;
});

test("a shake along the wrong line fails it", async () => {
  held = LANDSCAPE;
  hurt(30);
  $("bFix").click();
  await settle();
  frames(COUNT + 50);
  fix.seq = fix.seq.map(() => "updown");
  for (let t = 0; t < 2000 && fix.stage; t += FRAME_MS)
    frames(FRAME_MS, axisOf("side"));
  assert.equal(fix.stage, null);
  assert.equal(P.dmg, 30);
  assert.match(msg(), /Repair failed: wrong move/);
});

test("3 s for each move, and no more", async () => {
  held = LANDSCAPE;
  hurt(30);
  $("bFix").click();
  await settle();
  frames(COUNT + 50);
  fix.seq = fix.seq.map(() => "updown");
  frames(2800);
  assert.equal(fix.stage, "steps", "still time at 2.8 s");
  frames(400);
  assert.equal(fix.stage, null);
  assert.match(msg(), /too slow/);
});
