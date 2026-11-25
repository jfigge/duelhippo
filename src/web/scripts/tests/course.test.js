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

// course.test.js — the obstacle course: fifty rings flown in order against
// the clock; three sizes, each opened by finishing the one before; its own
// table, apart from the best score. Port only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPort } from "./harness.js";

const game = await loadPort(9);
const { w, duel } = game;
const P = duel.P,
  S = duel.S;
const $ = (id) => w.document.getElementById(id);
const { RINGS, run } = await import("../course.js");
const { COURSE } = await import("../constants.js");
const { mapNow } = await import("../maps.js");
const msg = () => $("msg").textContent;
const size = (i) => $("cSizes").children[i];

// Put the plane `back` m short of ring `i`, flying straight through it,
// `off` m to one side of its middle; and let it fly on for a second.
function through(i, off = 0, back = 25) {
  const { c, n } = RINGS[i];
  game.poke((P) => {
    P.grounded = false;
    P.alive = true;
    P.pos.copy(c).addScaledVector(n, -back);
    P.pos.x += off * n.z;
    P.pos.z -= off * n.x;
    P.q.setFromUnitVectors(P.pos.clone().set(0, 0, -1), n);
    P.speed = 60;
    P.sink = 0;
    P.thr = 0.6;
  });
  game.run(100); // the course sees where the plane is now
  game.run(900);
}

test("fifty rings, far apart, gently turning, over the flat, never too low", () => {
  assert.equal(RINGS.length, 50);
  for (const { c } of RINGS) {
    assert.ok(c.y >= 40 && c.y <= 240, `ring at ${c.y} m`);
    assert.ok(Math.hypot(c.x - 1400, c.z) < 2700, "over the flat");
  }
  for (let i = 1; i < 50; i++) {
    const d = RINGS[i].c.distanceTo(RINGS[i - 1].c);
    assert.ok(d > 370 && d < 490, `${d} m apart`);
    const turn = RINGS[i].n.angleTo(RINGS[i - 1].n);
    assert.ok(i < 2 || turn < 0.6, `ring ${i + 1} turns ${turn} rad`);
  }
});

test("a new player can fly Large rings only, and has an empty table", () => {
  $("bCourse").click();
  assert.ok(!$("course").classList.contains("hidden"));
  assert.ok(!size(0).disabled);
  assert.ok(size(1).disabled && size(2).disabled);
  assert.match(size(1).textContent, /Finish Large first/);
  assert.match($("cBoard").textContent, /No scores yet/);
});

test("the course: rings in order, a miss says go round, no enemies", () => {
  $("cFly").click();
  assert.equal(duel.state, "play");
  assert.equal(mapNow(), "field");
  assert.equal(duel.targets.length, 0, "no town to bomb");
  through(0);
  assert.equal(run.next, 1);
  assert.equal(run.score, 100);
  through(1, 40); // wide of it
  assert.equal(run.next, 1);
  assert.match(msg(), /Missed ring 2/);
  through(2); // the wrong ring does nothing
  assert.equal(run.next, 1);
  through(1);
  assert.equal(run.next, 2);
  assert.ok(run.t > 0, "the clock runs from the first ring");
  game.run(10000);
  assert.ok(
    duel.enemies.every((e) => !e.alive),
    "no flyers on the course",
  );
  assert.equal(P.fuel, 100);
});

test("finishing: the score, a time bonus, the table, and Medium opens", () => {
  for (let i = 2; i < 50; i++) through(i);
  assert.equal(duel.state, "over");
  assert.match($("oTitle").textContent, /Course complete/);
  assert.equal($("oKills").textContent, "50/50");
  assert.ok(run.bonus > 0);
  assert.equal(run.score, 5000 + run.bonus);
  assert.match($("oUnlock").textContent, /Medium rings/);
  assert.equal($("oCourse").querySelectorAll("li").length, 1);
  assert.ok($("oCourse").querySelector("li.mine"));
  assert.equal(S.best, 0, "the course is not the one-player best");
  $("oMenu").click();
  $("bCourse").click();
  assert.ok(!size(1).disabled, "Medium is open");
  assert.ok(size(2).disabled, "Small is not yet");
});

test("Medium rings are smaller, and score twice as much", () => {
  size(1).click();
  $("cFly").click();
  through(0, 14); // inside a Large ring, outside a Medium one
  assert.equal(run.next, 0);
  through(0);
  assert.equal(run.score, COURSE.sizes[1].pts);
  $("quit").click(); // out of planes, unfinished: on the table all the same
  assert.match($("oTitle").textContent, /Out of planes/);
  assert.match($("oCourse").textContent, /unfinished/);
  assert.ok($("oUnlock").classList.contains("hidden"));
});
