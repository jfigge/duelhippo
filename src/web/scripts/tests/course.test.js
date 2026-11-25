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

// course.test.js — the obstacle course: thirty rings flown in order against
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
const { COURSES, run, PERFECT, LIMITS, clock, readRecord, courseBest } =
  await import("../course.js");
const { COURSE } = await import("../constants.js");
const { scene } = await import("../scene.js");
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

test("three courses of thirty rings, each closer and tighter than the last", () => {
  COURSES.forEach((rings, lv) => {
    const { gap, turn } = COURSE.levels[lv];
    assert.equal(rings.length, 30);
    for (const { c } of rings) {
      assert.ok(c.y >= 40 && c.y <= 240, `ring at ${c.y} m`);
      assert.ok(Math.hypot(c.x - 1400, c.z) < 2700, "over the flat");
    }
    for (let i = 1; i < 30; i++) {
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

test("each level's time limit is twice a perfect run's time", () => {
  COURSES.forEach((rings, lv) => {
    let d = 0;
    for (let i = 1; i < rings.length; i++)
      d += rings[i].c.distanceTo(rings[i - 1].c);
    assert.ok(Math.abs(PERFECT[lv] - d / 88) < 1e-9, "at the Kite's 88 m/s");
    assert.equal(LIMITS[lv], Math.ceil(2 * PERFECT[lv]));
  });
  assert.ok(LIMITS[0] > LIMITS[1] && LIMITS[1] > LIMITS[2], "shorter courses");
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
  for (let i = 2; i < 30; i++) through(i);
  assert.equal(duel.state, "over");
  assert.match($("oTitle").textContent, /Course complete/);
  assert.equal($("oKills").textContent, "30/30");
  assert.ok(run.bonus > 0);
  assert.equal(run.score, 3000 + run.bonus);
  assert.equal(
    run.bonus,
    Math.round((LIMITS[0] - run.t) * COURSE.bonus),
    "10 points a second left",
  );
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
  $("quit").click(); // given up, unfinished: on the table all the same
  assert.match($("oTitle").textContent, /Course abandoned/);
  assert.match($("oCourse").textContent, /Tight · unfinished/);
  assert.ok($("oUnlock").classList.contains("hidden"));
});

test("too slow: the time runs out, unfinished, and nothing opens", () => {
  level(0).click();
  $("cFly").click();
  through(0);
  game.poke((P) => (P.dmg = 0));
  for (let t = 0; t <= LIMITS[0] && duel.state === "play"; t += 10) {
    game.poke((P) => {
      P.alive = true;
      P.grounded = false;
      P.pos.set(1400, 150, 0);
      P.sink = 0;
    });
    game.run(10000);
  }
  assert.equal(duel.state, "over");
  assert.match($("oTitle").textContent, /Out of time/);
  assert.equal($("oKills").textContent, "1/30");
  assert.ok($("oUnlock").classList.contains("hidden"), "nothing opened");
  assert.match($("oCourse").textContent, /unfinished/);
});

test("the clock rounds to the tenth before it splits the minutes", () => {
  assert.equal(clock(0), "0:00.0");
  assert.equal(clock(59.96), "1:00.0");
  assert.equal(clock(59.94), "0:59.9");
  assert.equal(clock(125.04), "2:05.0");
  assert.equal(clock(-3), "0:00.0", "no time left is none, not less");
});

test("the HUD shows the time left, not the clock and the limit", () => {
  level(0).click();
  $("cFly").click();
  game.run(200);
  assert.equal($("hTime").textContent, clock(LIMITS[0]), "full before ring 1");
  through(0);
  const [m, sec] = $("hTime").textContent.split(":");
  const left = 60 * +m + +sec;
  // The readout refreshes ten times a second.
  assert.ok(Math.abs(left - (LIMITS[0] - run.t)) < 0.25, `${left} s left`);
  $("menu").click();
});

test("Quit before the first ring: no run on the table", () => {
  const before = courseBest().length;
  $("bCourse").click();
  $("cFly").click();
  game.run(500);
  game.press("KeyP");
  $("quit").click();
  assert.equal(duel.state, "over");
  assert.match($("oTitle").textContent, /Course abandoned/);
  assert.equal(courseBest().length, before, "nothing recorded");
  assert.ok(!$("oCourse").querySelector("li.mine"));
});

test("Main menu mid-course keeps the run as Quit does, from ring 1 on", () => {
  const before = courseBest().length;
  $("oMenu").click();
  $("bCourse").click();
  $("cFly").click();
  game.press("KeyP");
  $("menu").click(); // not a ring flown: nothing
  assert.equal(courseBest().length, before);
  $("bCourse").click();
  $("cFly").click();
  through(0);
  game.press("KeyP");
  $("menu").click();
  assert.equal(duel.state, "title");
  assert.equal(courseBest().length, Math.min(10, before + 1));
});

test("the level buttons say which is picked, and keep the focus", () => {
  $("bCourse").click();
  assert.equal(level(0).getAttribute("aria-pressed"), "true");
  assert.equal(level(1).getAttribute("aria-pressed"), "false");
  level(1).click();
  assert.equal(level(1).getAttribute("aria-pressed"), "true");
  assert.equal(w.document.activeElement, level(1), "focus on the new button");
  level(0).click();
  $("cBack").click();
});

test("each level's rings are built once, sharing one geometry", () => {
  const rings = () => {
    const out = [];
    scene.traverse((o) => {
      if (o.geometry?.type === "TorusGeometry") out.push(o);
    });
    return out;
  };
  $("bCourse").click();
  $("cFly").click();
  const first = rings();
  assert.equal(first.length, 30);
  $("menu").click();
  $("bCourse").click();
  $("cFly").click();
  const again = rings();
  assert.equal(again.length, 30, "the old rings are not left behind");
  assert.ok(
    again.every((m, i) => m === first[i]),
    "the same meshes",
  );
  assert.equal(new Set(again.map((m) => m.geometry)).size, 1);
  $("menu").click();
});

test("a corrupt record is cleaned, not thrown on", () => {
  const n = COURSE.levels.length;
  assert.deepEqual(readRecord(null), { open: 0, best: [] });
  assert.deepEqual(readRecord("{not json"), { open: 0, best: [] });
  assert.deepEqual(readRecord('"a string"'), { open: 0, best: [] });
  assert.equal(readRecord('{"open":-4,"best":[]}').open, 0);
  assert.equal(readRecord('{"open":99,"best":[]}').open, n - 1);
  assert.equal(readRecord('{"open":1.5,"best":[]}').open, 0);
  const good = { n: "AAA", s: 500, z: 0, t: 61.2 };
  const r = readRecord(
    JSON.stringify({
      open: 1,
      best: [
        good,
        { n: "BBB", s: 900, z: 1, t: null },
        null,
        { n: "CCC", s: 800 }, // no level
        { n: "DDD", s: 800, z: n }, // a level that is not there
        { n: "EEE", s: 800, z: -1, t: null },
        { n: "FFF", s: "800", z: 0, t: null },
        { n: 7, s: 800, z: 0, t: null },
        { n: "GGG", s: 800, z: 0, t: "1:00" },
        { n: "HHH", s: 800, z: 0.5, t: null },
        ...Array.from({ length: 12 }, (_, i) => ({
          n: "ZZZ",
          s: i,
          z: 2,
          t: null,
        })),
      ],
    }),
  );
  assert.equal(r.open, 1);
  assert.equal(r.best.length, 10, "the top ten only");
  assert.deepEqual(r.best[0], { n: "BBB", s: 900, z: 1, t: null });
  assert.deepEqual(r.best[1], good);
  assert.ok(r.best.every((e) => Number.isInteger(e.z) && e.z >= 0 && e.z < n));
});

test("a stored record from an old build is not read (the key is v2)", async () => {
  const { COURSE_KEY } = await import("../constants.js");
  assert.equal(COURSE_KEY, "duelhippo.course.v2");
  assert.ok(w.localStorage.getItem(COURSE_KEY), "the runs above were kept");
});
