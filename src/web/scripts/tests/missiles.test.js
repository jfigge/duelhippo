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

// missiles.test.js — homing missiles: a lock earned by five seconds down the
// sights, a launch, a kill, and a missile beaten by a break turn. Port only;
// the prototype has no missiles.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { loadPort } from "./harness.js";

const game = await loadPort(21);
const { w, duel } = game;
const P = duel.P,
  S = duel.S;
const $ = (id) => w.document.getElementById(id);
const msg = () => $("msg").textContent;
// After the boot: the game modules need its window to evaluate.
const { lock, locked, launch, missiles } = await import("../missiles.js");

// In the air in plane type `kind`, fully armed: level, pointing along -Z, at
// 80 m/s.
function airborne(mode, kind) {
  game.start(mode);
  game.run(100);
  if (kind !== P.kind) game.press("Digit" + (kind + 1));
  assert.equal(P.kind, kind);
  game.poke((P) => {
    P.grounded = false;
    P.pos.set(1400, 500, mode === "classic" ? 0 : 2000);
    if (mode === "classic") P.th = 0;
    else P.q.identity();
    P.speed = 80;
    P.thr = 0.9;
    P.sink = 0;
    P.msl = P.pt.missiles;
  });
  S.spawnT = 1e9; // no flyers but the one placed
}

// A flyer `dist` m dead ahead, coming the other way, holding its fire.
function flyerAhead(dist, mode = "free") {
  const e = duel.enemies[0];
  e.alive = true;
  e.hp = 3;
  e.speed = 58;
  e.cd = 1e9;
  e.up.set(0, 1, 0);
  e.obj.visible = true;
  if (mode === "classic") {
    e.pos.set(P.pos.x + dist, P.pos.y, 0);
    e.th = e.ph = e.phT = Math.PI;
  } else {
    e.pos.set(P.pos.x, P.pos.y, P.pos.z - dist);
    e.q.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
  }
  return e;
}

test("the Kite carries no missiles, and never locks", () => {
  airborne("free", 0);
  flyerAhead(900);
  game.down("ShiftLeft");
  game.run(5500);
  assert.equal(lock.t, 0);
  game.press("KeyR");
  game.up("ShiftLeft");
  assert.match(msg(), /carries no missiles/);
  assert.equal(missiles.filter((m) => m.on).length, 0);
});

test("five seconds down the sights make a lock; R then kills", () => {
  airborne("free", 2); // the Lancer: four missiles
  const e = flyerAhead(950);
  game.down("ShiftLeft");
  game.run(4000);
  assert.ok(lock.tgt === e, "building on the flyer");
  assert.ok(!locked());
  assert.match($("lock").textContent, /%/);
  game.press("KeyR");
  assert.match(msg(), /No lock/);
  assert.equal(P.msl, 4);
  game.run(1200);
  assert.ok(locked(), `locked after ${lock.t} s`);
  assert.ok($("lock").classList.contains("on"));
  assert.equal($("lock").textContent, "LOCK");
  const kills = S.kills;
  game.press("KeyR");
  game.up("ShiftLeft");
  assert.equal(P.msl, 3);
  assert.ok(lock.tgt === null, "the next one needs a new lock");
  game.run(2000);
  assert.ok(!e.alive, "one missile is three hits");
  assert.equal(S.kills, kills + 1);
});

test("taking the sights off the target starts the lock again", () => {
  airborne("free", 2);
  flyerAhead(950);
  game.down("ShiftLeft");
  game.run(3000);
  assert.ok(lock.t > 2.5);
  game.up("ShiftLeft");
  game.run(500);
  assert.equal(lock.t, 0, "more than a moment off it");
  game.down("ShiftLeft");
  game.run(1000);
  game.up("ShiftLeft");
  assert.ok(lock.t < 1.5, `${lock.t}`);
});

test("no lock in Classic: there are no sights", () => {
  airborne("classic", 2);
  flyerAhead(900, "classic");
  game.down("ShiftLeft");
  game.run(5500);
  game.press("KeyR");
  game.up("ShiftLeft");
  assert.equal(lock.t, 0);
  assert.match(msg(), /Free flight only/);
});

// Another player's missile, launched `dist` m behind this plane at it.
function chased(dist) {
  airborne("free", 0);
  P.dmg = 0;
  const o = new Vector3(P.pos.x, P.pos.y, P.pos.z + dist);
  launch(o, new Vector3(0, 0, -1), 120, P, "r");
  return missiles.find((m) => m.on);
}

test("flying straight, a missile hits", () => {
  const m = chased(400);
  game.run(300);
  assert.match($("warn").textContent, /MISSILE/);
  for (let i = 0; i < 100 && m.on; i++) game.run(50);
  assert.equal(P.dmg, 40);
});

test("a hard break turn, late, beats it", () => {
  const m = chased(400);
  while (m.on && m.pos.distanceTo(P.pos) > 110) game.run(17);
  game.down("ArrowLeft");
  game.down("ArrowDown");
  game.run(600);
  game.up("ArrowLeft");
  for (let i = 0; i < 100 && m.on; i++) game.run(50);
  game.up("ArrowDown");
  assert.equal(P.dmg, 0, "it missed");
});
