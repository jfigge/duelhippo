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
// the clock; three levels, each closer and tighter, each opened by finishing
// the one before; its own table, apart from the best score. Port only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPort } from "./harness.js";

const game = await loadPort(9);
const { w, duel } = game;
const P = duel.P,
  S = duel.S;
const $ = (id) => w.document.getElementById(id);
const { COURSES, run } = await import("../course.js");
const { COURSE } = await import("../constants.js");
const { mapNow } = await import("../maps.js");
const msg = () => $("msg").textContent;
const level = (i) => $("cSizes").children[i];

// Put the plane `back` m short of ring `i`, flying straight through it,
// `off` m to one side of its middle; and let it fly on for a second.
function through(i, off = 0, back = 25) {
  const { c, n } = COURSES[run.level][i];
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

test("three courses of fifty rings, each closer and tighter than the last", () => {
  COURSES.forEach((rings, lv) => {
    const { gap, turn } = COURSE.levels[lv];
    assert.equal(rings.length, 50);
    for (const { c } of rings) {
      assert.ok(c.y >= 40 && c.y <= 240, `ring at ${c.y} m`);
      assert.ok(Math.hypot(c.x - 1400, c.z) < 2700, "over the flat");
    }
    for (let i = 1; i < 50; i++) {
      const d = rings[i].c.distanceTo(rings[i - 1].c);
      assert.ok(
        d > gap[0] - 10 && d < gap[1] + 10,
        `level ${lv}: ${d} m apart`,
      );
      const t = rings[i].n.angleTo(rings[i - 1].n);
      assert.ok(
        i < 2 || t < turn + 0.25,
        `level ${lv}: ring ${i + 1} turns ${t}`,
      );
    }
  });
  const span = (lv) => COURSES[lv].at(-1).c.distanceTo(COURSES[lv][0].c);
  assert.ok(COURSE.levels[2].gap[1] < COURSE.levels[0].gap[0], "closer");
  assert.ok(span(0) > 0 && span(2) > 0);
});

test("a new player can fly the Easy level only, and has an empty table", () => {
  $("bCourse").click();
  assert.ok(!$("course").classList.contains("hidden"));
  assert.ok(!level(0).disabled);
  assert.ok(level(1).disabled && level(2).disabled);
  assert.match(level(1).textContent, /Finish Easy first/);
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

test("finishing: the score, a time bonus, the table, and Tight opens", () => {
  for (let i = 2; i < 50; i++) through(i);
  assert.equal(duel.state, "over");
  assert.match($("oTitle").textContent, /Course complete/);
  assert.equal($("oKills").textContent, "50/50");
  assert.ok(run.bonus > 0);
  assert.equal(run.score, 5000 + run.bonus);
  assert.match($("oUnlock").textContent, /Next level open: Tight/);
  assert.equal($("oCourse").querySelectorAll("li").length, 1);
  assert.ok($("oCourse").querySelector("li.mine"));
  assert.equal(S.best, 0, "the course is not the one-player best");
  $("oMenu").click();
  $("bCourse").click();
  assert.ok(!level(1).disabled, "Tight is open");
  assert.ok(level(2).disabled, "Twisting is not yet");
});

test("Tight is its own course, closer together, at twice the points", () => {
  level(1).click();
  $("cFly").click();
  assert.equal(run.level, 1);
  through(0);
  through(1);
  assert.equal(run.score, 2 * COURSE.levels[1].pts);
  const gap = COURSES[1][1].c.distanceTo(COURSES[1][0].c);
  assert.ok(gap < COURSE.levels[0].gap[0], `${gap} m to the next ring`);
  $("quit").click(); // out of planes, unfinished: on the table all the same
  assert.match($("oTitle").textContent, /Out of planes/);
  assert.match($("oCourse").textContent, /Tight · unfinished/);
  assert.ok($("oUnlock").classList.contains("hidden"));
});
