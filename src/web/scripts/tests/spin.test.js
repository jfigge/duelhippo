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

// spin.test.js — what makes the plane types after the Kite hard to fly:
// snap stalls and spins (and the way out), and the Hornet's rotary engine.
// Port only; the prototype's one plane does neither.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Euler, Quaternion, Vector3 } from "three";
import { loadPort } from "./harness.js";

const game = await loadPort(9);
const { w, duel } = game;
const P = duel.P;
const msg = () => w.document.getElementById("msg").textContent;

// Stopped on the runway in plane type `kind`, then put in the air: high over
// the middle of the map, pointing along -Z, the nose `climb` rad up.
function airborne(mode, kind, { speed, thr, climb = 0 }) {
  game.start(mode);
  game.run(100);
  if (kind !== P.kind) game.press("Digit" + (kind + 1));
  assert.equal(P.kind, kind);
  game.poke((P) => {
    P.grounded = false;
    P.pos.set(1400, 900, mode === "classic" ? 0 : 1500);
    P.speed = speed;
    P.thr = thr;
    P.sink = 0;
    if (mode === "classic") P.th = climb;
    else P.q.copy(new Quaternion().setFromEuler(new Euler(climb, 0, 0)));
  });
}

const heading = (q) => {
  const f = new Vector3(0, 0, -1).applyQuaternion(q);
  return Math.atan2(-f.x, -f.z);
};

// Hauls back, slow and climbing, for a second.
function haul() {
  game.down("ArrowDown");
  game.run(1000);
  game.up("ArrowDown");
}

test("the Kite never spins, however hard it is hauled about", () => {
  for (const mode of ["free", "classic"]) {
    airborne(mode, 0, { speed: 30, thr: 0, climb: 0.5 });
    game.down("ArrowDown");
    game.run(3000);
    game.up("ArrowDown");
    assert.equal(P.spin, 0, mode);
  }
});

test("a hard pull while slow snaps the Hornet into a spin", () => {
  airborne("free", 1, { speed: 38, thr: 0, climb: 0.5 });
  haul();
  assert.equal(P.spin, 1, "to the left, as its engine pulls");
  assert.match(msg(), /Spin!/);
  const y = P.pos.y,
    h = heading(P.q);
  game.run(3000);
  assert.equal(P.spin, 1, "and it stays in, hands off");
  assert.ok(y - P.pos.y > 80, `falling fast: ${y - P.pos.y} m in 3 s`);
  assert.notEqual(heading(P.q), h, "round and round");
});

test("a fast pull, or a pull with power on, does not snap", () => {
  airborne("free", 1, { speed: 60, thr: 0, climb: 0.3 });
  haul();
  assert.equal(P.spin, 0, "too fast");
  airborne("free", 1, { speed: 36, thr: 1, climb: 0 });
  haul();
  assert.equal(P.spin, 0, "gaining speed, not losing it");
});

test("push, idle and opposite rudder bring the Hornet out", () => {
  airborne("free", 1, { speed: 38, thr: 0, climb: 0.5 });
  haul();
  assert.equal(P.spin, 1);
  game.run(1000);
  const y = P.pos.y;
  // Push alone is not enough.
  game.down("ArrowUp");
  game.run(1500);
  assert.equal(P.spin, 1, "push alone");
  game.down("KeyD"); // against a spin to the left
  game.run(1200);
  game.up("KeyD");
  game.up("ArrowUp");
  assert.equal(P.spin, 0, "out");
  assert.match(msg(), /Out of the spin/);
  assert.ok(P.alive);
  const lost = y - P.pos.y;
  assert.ok(lost > 100 && lost < 400, `${lost} m lost`);
});

test("the Brute is slow to come out of a spin", () => {
  airborne("free", 3, { speed: 38, thr: 0, climb: 0.5 });
  haul();
  assert.equal(Math.abs(P.spin), 1);
  const against = P.spin > 0 ? "KeyD" : "KeyA";
  game.down("ArrowUp");
  game.down(against);
  game.run(1200);
  assert.notEqual(P.spin, 0, "a Hornet would be out by now");
  game.run(1000);
  game.up(against);
  game.up("ArrowUp");
  assert.equal(P.spin, 0);
});

test("side-on, the Lancer tumbles, and push and idle bring it out", () => {
  airborne("classic", 2, { speed: 45, thr: 0, climb: 0.6 });
  haul();
  assert.equal(P.spin, 1);
  const th = P.th;
  game.run(500);
  assert.notEqual(P.th, th, "the nose goes over and over");
  game.down("ArrowUp");
  game.run(1200);
  game.up("ArrowUp");
  assert.equal(P.spin, 0);
  assert.ok(P.alive);
});

test("spinning into the ground is a crash, and says how to get out", () => {
  airborne("free", 1, { speed: 38, thr: 0, climb: 0.5 });
  game.poke((P) => (P.pos.y = 140));
  haul();
  for (let i = 0; i < 200 && P.alive; i++) game.run(50);
  assert.ok(!P.alive);
  assert.match(msg(), /Spun in/);
});

test("the Hornet's rotary pulls it left under power; rudder holds it", () => {
  // Hands off, full power: the heading wanders left (a larger angle).
  airborne("free", 1, { speed: 70, thr: 1 });
  let h = heading(P.q);
  game.down("KeyW");
  game.run(2000);
  const drift = heading(P.q) - h;
  assert.ok(drift > 0.2, `left by ${drift}`);
  // With right rudder held, it does not.
  airborne("free", 1, { speed: 70, thr: 1 });
  h = heading(P.q);
  game.down("KeyD");
  game.run(2000);
  game.up("KeyD");
  game.up("KeyW");
  assert.ok(heading(P.q) - h < 0, "right rudder beats it");
  // The Kite has no such habit.
  airborne("free", 0, { speed: 70, thr: 1 });
  h = heading(P.q);
  game.down("KeyW");
  game.run(2000);
  game.up("KeyW");
  assert.ok(Math.abs(heading(P.q) - h) < 1e-9, "the Kite flies straight");
});

test("the Hornet turns right more quickly than left", () => {
  const turn = (key) => {
    airborne("free", 1, { speed: 70, thr: 1 });
    // Bank 45°, then hold it there and let the bank turn the plane.
    game.poke((P) =>
      P.q.copy(
        new Quaternion().setFromEuler(
          new Euler(0, 0, key === "right" ? -0.8 : 0.8, "YXZ"),
        ),
      ),
    );
    const h = heading(P.q);
    game.down("KeyW");
    game.run(1000);
    game.up("KeyW");
    return Math.abs(heading(P.q) - h);
  };
  const right = turn("right"),
    left = turn("left");
  assert.ok(right > left * 1.2, `right ${right} vs left ${left}`);
});
