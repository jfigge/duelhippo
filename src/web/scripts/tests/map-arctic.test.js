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

// map-arctic.test.js — the Arctic (maps/arctic.js): the ice strips and their
// long slide, the mountains, the blizzards, the convoy, the hunting flyers,
// the team pads, and that leaving puts the Countryside back. Port only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPort } from "./harness.js";

const game = await loadPort(5);
const { w, duel } = game;
const P = duel.P;
const $ = (id) => w.document.getElementById(id);
const { land, groundY, buildFields, clearFields, fields, hippos } =
  await import("../world.js");
const { mapNow } = await import("../maps.js");
const { HOME, EB, GEAR } = await import("../constants.js");
const { fieldSpots } = await import("../net/teams.js");
const { scene } = await import("../scene.js");
const { FJORD, CONVOY, blizzards } = await import("../maps/arctic.js");
const msg = () => $("msg").textContent;
duel.S.best = 1e6;
(await import("../game.js")).showMaps();
const pick = (id) => w.document.querySelector(`[data-map="${id}"]`).click();

// Airborne at `pos`, level, nose along +x (yaw −90°), at `speed`.
function flyAt(x, y, z, speed, thr = 0.5) {
  game.poke((P) => {
    P.grounded = false;
    P.pos.set(x, y, z);
    P.q.setFromAxisAngle(P.pos.clone().set(0, 1, 0), -Math.PI / 2);
    P.speed = speed;
    P.thr = thr;
    P.sink = 0;
  });
}
// On the ground, rolling along +x at `speed`, throttle idle.
function rollAt(x, speed) {
  game.poke((P) => {
    P.grounded = true;
    P.pos.set(x, GEAR, 0);
    P.q.setFromAxisAngle(P.pos.clone().set(0, 1, 0), -Math.PI / 2);
    P.speed = speed;
    P.thr = 0;
    P.sink = 0;
  });
}
// How far a plane rolling at 25 m/s, throttle idle, slides before it stops.
function slide() {
  const x0 = HOME.x - HOME.hl + 20;
  rollAt(x0, 25);
  game.run(15000);
  assert.ok(P.alive && P.grounded, msg());
  assert.ok(P.speed < 0.5);
  return P.pos.x - x0;
}
let slid = 0;
// Run until the player crashes (before a new plane comes out), up to `ms`.
function untilDown(ms) {
  for (let t = 0; t < ms && P.alive; t += 100) game.run(100);
}
const convoy = () => duel.targets.filter((t) => t.z === CONVOY.z);

test("Arctic: picked on the title, built within a phone's budget", () => {
  pick("arctic");
  assert.equal(mapNow(), "arctic");
  assert.equal(typeof land.height, "function");
  const terrain = scene.getObjectByName("arctic-terrain");
  const tris = terrain.geometry.attributes.position.count / 3;
  assert.ok(tris < 60000, `${tris} triangles`);
});

test("Arctic: the fjord is flat ice past both strips; mountains either side", () => {
  for (let x = FJORD.x0; x <= FJORD.x1; x += 25)
    for (let z = -150; z <= 150; z += 25)
      assert.equal(groundY(x, z), 0, `ice at ${x}, ${z}`);
  let top = 0;
  for (let x = FJORD.x0; x <= FJORD.x1; x += 20)
    for (let z = 200; z <= 900; z += 20)
      top = Math.max(top, groundY(x, z), groundY(x, -z));
  assert.ok(top > 290 && top < 380, `peaks reach ${top}`);
});

test("Arctic: start on the ice strip, grounded, and take off", () => {
  game.start("free");
  assert.deepEqual([P.pos.x, P.pos.y], [HOME.x - HOME.hl + 40, GEAR]);
  game.run(100);
  assert.ok(P.alive && P.grounded);
  game.down("KeyW");
  game.run(2500);
  game.down("ArrowDown");
  game.run(600);
  game.up("ArrowDown");
  game.run(3000);
  game.up("KeyW");
  assert.ok(P.alive, msg());
  assert.ok(!P.grounded && P.pos.y > 10, `at ${P.pos.y}`);
});

test("Arctic: on the ice a plane slides a long way, and off the end safely", () => {
  game.start("free");
  // Brake 2.5 m/s² (and the drag): about twice the Countryside's slide,
  // compared on the way out (below).
  slid = slide();
  assert.ok(slid > 80 && slid < 130, `slid ${slid} m`);
  // Off the strip's far end under 22 m/s: onto the ice, and stops there.
  rollAt(HOME.x + HOME.hl - 20, 22);
  game.run(8000);
  assert.ok(P.alive, msg());
  assert.ok(P.pos.x > HOME.x + HOME.hl && P.speed < 0.5, `at ${P.pos.x}`);
  // Faster than that is still a crash.
  rollAt(EB.x + EB.hl - 5, 26);
  untilDown(1000);
  assert.equal(P.alive, false);
  assert.match(msg(), /Ran off the runway/);
});

test("Arctic: a landing on the ice strip, and a crash on the ice beside it", () => {
  game.start("free");
  flyAt(HOME.x - HOME.hl + 15, GEAR + 1.5, 0, 34, 0);
  game.poke((P) => (P.sink = 2));
  game.run(12000);
  assert.ok(P.alive, msg());
  assert.ok(P.grounded && P.speed < 0.5);
  flyAt(1300, GEAR + 1, -60, 40, 0);
  game.poke((P) => (P.sink = 4));
  untilDown(3000);
  assert.equal(P.alive, false);
  assert.match(msg(), /Crashed on the ice/);
});

test("Arctic: flying into the mountainside crashes", () => {
  game.start("free");
  let spot = null;
  for (let z = 260; z < 700 && !spot; z += 20)
    for (let x = 400; x < 2400; x += 20)
      if (groundY(x, z) > 200 && groundY(x - 300, z) < 100) {
        spot = [x - 300, z];
        break;
      }
  assert.ok(spot, "a mountain to fly into");
  flyAt(spot[0], 150, spot[1], 60);
  untilDown(8000);
  assert.equal(P.alive, false);
  assert.match(msg(), /Flew into a mountain/);
});

test("Arctic: the hippos' meadow is flat snow", () => {
  for (const h of hippos) {
    assert.ok(h.g.position.y > 0, "out of the fjord");
    for (let dx = -34; dx <= 34; dx += 2)
      assert.equal(groundY(h.x0 + dx, h.z), h.g.position.y);
  }
});

test("Arctic: in a blizzard the fog shuts in, and lifts outside it", () => {
  game.start("free");
  const own = [scene.fog.near, scene.fog.far];
  assert.deepEqual(own, [550, 3000]);
  const b = blizzards[0];
  flyAt(b.x - 60, 220, b.z, 45);
  game.run(3000);
  assert.ok(P.alive, msg());
  assert.match(msg(), /Blizzard!/);
  assert.ok(scene.fog.far < 450, `fog far ${scene.fog.far}`);
  assert.ok(scene.fog.near < 100);
  const snow = scene.getObjectByProperty("isPoints", true);
  assert.ok(snow && snow.visible, "and it snows");
  // Away up the fjord, clear of every blizzard.
  flyAt(-400, 220, 0, 45);
  game.run(3000);
  assert.ok(
    blizzards.every((b) => Math.hypot(P.pos.x - b.x, P.pos.z - b.z) > b.r),
  );
  assert.deepEqual([scene.fog.near, scene.fog.far], own);
  assert.equal(snow.visible, false);
});

test("Arctic: the convoy drives the fjord and turns round at its ends", () => {
  game.start("free");
  const cars = convoy();
  assert.equal(cars.length, 8);
  assert.deepEqual([...new Set(cars.map((t) => t.kind))].sort(), [
    "halftrack",
    "sled",
    "truck",
  ]);
  const x0 = cars.map((t) => t.x);
  game.run(5000);
  cars.forEach((t, i) => {
    const v = (t.x - x0[i]) / 5;
    assert.ok(Math.abs(v) >= 6 && Math.abs(v) <= 10, `${v} m/s`);
    assert.equal(t.z, CONVOY.z);
    assert.equal(t.g.position.x, t.x);
    assert.equal(groundY(t.x, t.z), 0, "on the ice");
  });
  // Taken to the fjord's head, the column turns back down it.
  const lead = Math.max(...cars.map((t) => t.x));
  for (const t of cars) t.x += FJORD.x1 - 10 - lead;
  game.run(100);
  const at = cars.map((t) => t.x);
  game.run(3000);
  cars.forEach((t, i) => assert.ok(t.x < at[i], "heading back"));
  assert.ok(Math.max(...cars.map((t) => t.x)) < FJORD.x1);
  // And at its foot, back up again.
  const tail = Math.min(...cars.map((t) => t.x));
  for (const t of cars) t.x += FJORD.x0 + 10 - tail;
  game.run(100);
  const at2 = cars.map((t) => t.x);
  game.run(3000);
  cars.forEach((t, i) => assert.ok(t.x > at2[i], "heading up"));
});

test("Arctic: the enemy flyers hunt the player round the mountains", () => {
  game.start("free");
  let seen = 0,
    hills = 0,
    t = 0;
  const was = duel.enemies.map((e) => e.alive);
  for (let i = 0; i < 1500; i++) {
    t += 0.1;
    game.poke((P) => {
      P.alive = true;
      P.dmg = 0;
      P.grounded = false;
      P.pos.set(1400 + Math.cos(t * 0.2) * 600, 150, Math.sin(t * 0.2) * 100);
      P.speed = 50;
      P.sink = 0;
    });
    game.run(100);
    duel.enemies.forEach((e, k) => {
      if (was[k] && !e.alive && groundY(e.pos.x, e.pos.z) > e.pos.y - 3)
        hills++;
      if (!was[k] && e.alive) seen++;
      was[k] = e.alive;
    });
  }
  assert.ok(seen >= 2, `${seen} flew`);
  assert.ok(hills <= 1, `${hills} flew into the mountains`);
});

test("Arctic: team pads are flat ice for 2 to 8 teams, and go again", () => {
  const sample = (f, fn) => {
    const out = [];
    for (let dx = -f.hl - 20; dx <= f.hl + 20; dx += 10)
      for (let dz = -f.hw - 20; dz <= f.hw + 20; dz += 6)
        out.push(fn(f.x + dx, f.z + dz));
    return out;
  };
  for (let n = 2; n <= 8; n++) {
    const spots = fieldSpots(n).map((s) => ({ ...s, hl: 230, hw: 18 }));
    const before = spots.map((s) => sample(s, groundY));
    buildFields(n);
    assert.equal(fields.length, n);
    for (const f of fields) {
      const hs = sample(f, groundY),
        y = hs[0];
      assert.ok(
        hs.every((h) => h === y),
        `team ${f.team} of ${n}: flat`,
      );
    }
    clearFields();
    assert.deepEqual(
      spots.map((s) => sample(s, groundY)),
      before,
      `${n} teams: as before`,
    );
  }
});

test("back to the Countryside from a blizzard: all put back", () => {
  game.start("free");
  const b = blizzards[0];
  flyAt(b.x, 220, b.z, 45);
  game.run(3000);
  assert.ok(scene.fog.far < 450);
  pick("field");
  game.start("free");
  assert.equal(mapNow(), "field");
  assert.equal(land.height, null);
  assert.equal(land.tick, null);
  assert.deepEqual([scene.fog.near, scene.fog.far], [700, 3400]);
  assert.equal(scene.getObjectByName("arctic-terrain"), undefined);
  assert.equal(duel.targets[0].kind, "tanks");
  const there = slide();
  assert.ok(slid > there * 1.8, `${slid} m on the ice, ${there} m here`);
});
