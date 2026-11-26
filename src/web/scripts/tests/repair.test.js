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

// repair.test.js — F fixes a damaged plane in flight, once a flight: a
// quick countdown, then number keys 1.75 s each, while no other plane's
// fire can touch it. Port only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPort } from "./harness.js";

const game = await loadPort(21);
const { w, duel } = game;
const P = duel.P;
const $ = (id) => w.document.getElementById(id);
const { fix, runLength } = await import("../repair.js");
const { REPAIR } = await import("../constants.js");
const { enemies } = await import("../ai.js");
const { fire, bullets } = await import("../weapons.js");
const { flakAt } = await import("../maps.js");
const msg = () => $("msg").textContent;

const num = (n) => game.press(`Digit${n}`);
// Through the countdown: three numbers, half a second each.
const COUNT = REPAIR.count * REPAIR.tick * 1000;
function hurt(dmg) {
  game.start("free");
  game.poke((P) => {
    P.grounded = false;
    P.alive = true;
    P.pos.set(1400, 400, 0);
    P.speed = 60;
    P.thr = 0.6;
    P.dmg = dmg;
    P.ammo = 120;
    P.fuel = 55;
  });
}
// Holds the plane up and level, so it stays in the air while keys go in.
const keepFlying = () =>
  game.poke((P) => {
    P.pos.y = 400;
    P.speed = 60;
  });
function wait(ms) {
  for (let t = 0; t < ms; t += 50) {
    keepFlying();
    game.run(50);
  }
}

test("the run is longer the worse the damage: 4 keys to 8", () => {
  assert.equal(runLength(6), REPAIR.min);
  assert.equal(runLength(50), 6);
  assert.equal(runLength(99), REPAIR.max);
});

test("F, a half-second countdown, the keys in order: the damage is gone, not the fuel or rounds", () => {
  hurt(40);
  game.press("KeyF");
  assert.equal(fix.stage, "count");
  assert.ok(!$("repair").classList.contains("hidden"));
  assert.match($("repair").textContent, /3…/);
  wait(550);
  assert.match($("repair").textContent, /2…/);
  num(1); // ignored while counting down
  assert.equal(fix.stage, "count");
  wait(500);
  assert.match($("repair").textContent, /1…/);
  wait(500);
  assert.equal(fix.stage, "keys");
  assert.equal(fix.seq.length, runLength(40));
  for (const n of fix.seq) {
    assert.ok(Number.isInteger(n) && n >= 0 && n <= 9, "a plain number");
    assert.equal(w.document.querySelector("#repair b").textContent, String(n));
    wait(400);
    num(n);
  }
  assert.equal(fix.stage, null);
  assert.equal(P.dmg, 0);
  assert.ok(P.ammo <= 120 && P.fuel <= 55, "fuel and rounds untouched");
  assert.match(msg(), /Repaired/);
  assert.ok($("repair").classList.contains("hidden"));
  // Once a flight.
  game.poke((P) => (P.dmg = 30));
  game.press("KeyF");
  assert.equal(fix.stage, null);
  assert.match(msg(), /once already/);
});

test("a wrong key ends it with the plane still hurt", () => {
  hurt(30);
  game.press("KeyF");
  wait(COUNT + 50);
  num((fix.seq[0] + 1) % 10);
  assert.equal(fix.stage, null);
  assert.equal(P.dmg, 30);
  assert.match(msg(), /Repair failed: wrong key/);
});

test("1.75 s for each key, and no more", () => {
  hurt(30);
  game.press("KeyF");
  wait(COUNT + 50);
  wait(1600);
  assert.equal(fix.stage, "keys", "still time at 1.6 s");
  num(fix.seq[0]);
  assert.equal(fix.i, 1);
  wait(REPAIR.per * 1000 + 100);
  assert.equal(fix.stage, null);
  assert.equal(P.dmg, 30);
  assert.match(msg(), /too slow/);
});

test("only in the air, only if hurt, and not past saving", () => {
  game.start("free"); // on the runway
  game.poke((P) => (P.dmg = 20));
  game.press("KeyF");
  assert.equal(fix.stage, null);
  hurt(0);
  game.press("KeyF");
  assert.equal(fix.stage, null);
  assert.match(msg(), /Nothing to fix/);
  hurt(100);
  game.press("KeyF");
  assert.equal(fix.stage, null);
});

// A flyer dead ahead of the player, its nose on them, within range.
function flyerOnTail() {
  for (const e of enemies) e.alive = false;
  const e = enemies[0];
  e.alive = true;
  e.obj.visible = true;
  e.hp = 3;
  e.cd = 0;
  e.pos.set(1400, 400, -150);
  e.q.identity().setFromAxisAngle(P.pos.clone().set(0, 1, 0), Math.PI);
  return e;
}
const enemyRounds = () => bullets.filter((b) => b.on && b.own === "e").length;

test("while it runs, the flyers hold their fire and no plane's round hurts", () => {
  hurt(30);
  game.press("KeyF");
  let fired = 0;
  for (let t = 0; t < COUNT; t += 50) {
    keepFlying();
    flyerOnTail();
    game.run(50);
    fired += enemyRounds();
  }
  assert.equal(fired, 0, "no flyer fired");
  // Held still, so a round aimed at it would hit: a plane's does nothing...
  const at = P.pos.clone(),
    still = () =>
      game.poke((P) => {
        P.pos.copy(at);
        P.speed = 0.1;
        P.vel.set(0, 0, 0);
        P.grounded = false;
      });
  still();
  const from = at.clone().add(at.clone().set(0, 0, -60));
  fire(from, at.clone().sub(from).normalize(), 480, "e");
  for (let i = 0; i < 12; i++) {
    still();
    game.run(16);
  }
  assert.equal(P.dmg, 30);
  // ...but flak from the ground still does.
  still();
  assert.ok(flakAt(at.clone().add(at.clone().set(0, -120, 0)), 600, 0));
  for (let i = 0; i < 20 && P.dmg === 30; i++) {
    still();
    game.run(16);
  }
  assert.ok(P.dmg > 30, "flak hits");
  // Once it is over, the flyers fire again.
  game.press(`Digit${(fix.seq[0] + 1) % 10}`);
  assert.equal(fix.stage, null);
  // The same plane's round now hurts.
  const was = P.dmg;
  still();
  fire(from, at.clone().sub(from).normalize(), 480, "e");
  for (let i = 0; i < 12; i++) {
    still();
    game.run(16);
  }
  assert.ok(P.dmg > was, "a round hurts again");
  fired = 0;
  for (let t = 0; t < 1000; t += 50) {
    keepFlying();
    flyerOnTail();
    game.run(50);
    fired += enemyRounds();
  }
  assert.ok(fired > 0, "fire resumes");
  // A new flight gives the repair back.
  game.start("free");
  assert.equal(fix.used, false);
});
