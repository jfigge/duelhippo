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

// map-volcano.test.js — the Volcano (maps/volcano.js): the island's plain
// and runways, the ash plume and the vents' updrafts, what a crash hits,
// the enemy flyers round the volcano, and the team fields. Port only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPort, seededRandom } from "./harness.js";

const game = await loadPort(3);
const { w, duel } = game;
const P = duel.P;
const $ = (id) => w.document.getElementById(id);
const { land, groundY, buildFields, clearFields, fields, solids, hippos } =
  await import("../world.js");
const { mapNow } = await import("../maps.js");
const { HOME, EB, GEAR } = await import("../constants.js");
const { fieldSpots } = await import("../net/teams.js");
const { VOLCANO } = await import("../maps/volcano.js");
const { VX, VZ, TOP, PLAIN, PLUME, UP, LAGOON } = VOLCANO;
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
// Is the ground flat at `y` over a rect about (x, z)?
function flatAt(x, z, hx, hz, y) {
  for (let dx = -hx; dx <= hx; dx += 10)
    for (let dz = -hz; dz <= hz; dz += 6)
      if (groundY(x + dx, z + dz) !== y) return false;
  return true;
}

test("Volcano: the plane starts on the plain's runway, and takes off", () => {
  pick("volcano");
  game.start("free");
  assert.equal(mapNow(), "volcano");
  assert.ok(land.height && land.tick);
  assert.equal(groundY(VX, VZ + VOLCANO.RIM), TOP, "the crater's rim");
  assert.ok(groundY(VX, VZ) < TOP - 100, "and the crater in it");
  assert.ok(flatAt(HOME.x, HOME.z, HOME.hl + 60, HOME.hw + 40, PLAIN));
  assert.ok(flatAt(EB.x, EB.z, EB.hl + 60, EB.hw + 40, PLAIN));
  assert.ok(
    duel.targets.every((t) => t.y === PLAIN),
    "the town on the plain",
  );
  assert.deepEqual([P.pos.x, P.pos.y], [HOME.x - HOME.hl + 40, PLAIN + GEAR]);
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
  assert.ok(!P.grounded && P.pos.y > PLAIN + 10, `at ${P.pos.y}`);
});

test("Volcano: flying into the ash plume stalls the engine for a while", () => {
  game.start("free");
  // Halfway up the column, at its centre.
  const s = 0.5,
    l = PLUME.lean * s ** 1.6,
    y = PLUME.base + s * (PLUME.top - PLUME.base);
  flyAt(VX + PLUME.wx * l, y, VZ + PLUME.wz * l, 60, 1);
  game.run(200);
  assert.ok(P.alive);
  assert.equal(land.power, 0, "no thrust");
  assert.match(msg(), /Ash in the engine!/);
  // Said once, on the way in: not again every frame it lasts, over
  // whatever else there is to say.
  $("msg").textContent = "something else";
  flyAt(VX + PLUME.wx * l, y, VZ + PLUME.wz * l, 60, 1);
  game.run(300);
  assert.equal(land.power, 0, "still in it");
  assert.equal(msg(), "something else");
  // Out of it, the engine catches again after 2.5 s.
  flyAt(1400, 900, 1400, 60, 1);
  game.run(1500);
  assert.equal(land.power, 0, "still choking");
  game.run(1500);
  assert.equal(land.power, 1, "running again");
  // Clear air never touches it.
  flyAt(1400, 900, 1400, 60, 1);
  game.run(3000);
  assert.equal(land.power, 1);
});

test("Volcano: a vent's updraft lifts a plane over it", () => {
  const climb = (x, z) => {
    game.start("free");
    flyAt(x, 300, z, 45);
    const y0 = P.pos.y;
    game.run(1000);
    assert.ok(P.alive, msg());
    return P.pos.y - y0;
  };
  const { vents } = VOLCANO;
  assert.equal(vents.length, 4);
  for (const v of vents) assert.ok(v.y > 100 && v.y < UP.top - 100, `${v.y}`);
  const still = climb(1400, 1500); // over the plain, nowhere near one
  const v = vents[0],
    lifted = climb(v.x - 20, v.z);
  assert.match(msg(), /Updraft!/);
  assert.ok(lifted > still + 8, `${lifted} against ${still}`);
  // Too high, and the updraft has spent itself.
  game.start("free");
  flyAt(v.x - 20, UP.top + 50, v.z, 45);
  const y0 = P.pos.y;
  game.run(1000);
  assert.ok(P.pos.y - y0 < still + 2, "no lift up there");
});

test("Volcano: what a crash hits", () => {
  const into = (x, y, z, re) => {
    game.start("free");
    flyAt(x, y, z, 60);
    for (let i = 0; i < 150 && P.alive; i++) game.run(100);
    assert.equal(P.alive, false);
    assert.match(msg(), re);
  };
  // Along +x at 200 m into the west flank, clear of every vent.
  into(VX - 700, 200, VZ, /Flew into the volcano/);
  const [hx, hz] = VOLCANO.HILLS[0];
  into(hx - 400, 80, hz, /Flew into the island/);
  // Gliding down off the south shore, and into the lagoon.
  game.start("free");
  flyAt(1400, GEAR + 1, 3000, 40, 0);
  game.poke((P) => (P.sink = 4));
  game.run(3000);
  assert.equal(P.alive, false);
  assert.match(msg(), /Ditched in the sea/);
  game.start("free");
  flyAt(LAGOON[0] - 30, GEAR + 1, LAGOON[1] + 40, 30, 0);
  game.poke((P) => (P.sink = 4));
  game.run(2000);
  assert.equal(P.alive, false);
  assert.match(msg(), /Ditched in the sea/);
  assert.ok(
    hippos.every(
      (h) => Math.hypot(h.x - LAGOON[0], h.z - LAGOON[1]) < LAGOON[2] - 30,
    ),
    "the hippos are in the lagoon",
  );
});

test("Volcano: the enemy flyers hunt round the volcano, not into it", () => {
  // Its own random numbers, so what it finds is not down to the tests
  // before it.
  Math.random = seededRandom(15);
  game.start("free");
  let seen = 0,
    ground = 0,
    t = 0;
  const was = duel.enemies.map((e) => e.alive);
  // The player, kept flying a slow circuit up the lane, kept whole.
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
        ground++;
      if (!was[k] && e.alive) seen++;
      was[k] = e.alive;
    });
  }
  assert.ok(seen >= 2, `${seen} flew`);
  assert.ok(ground <= 1, `${ground} flew into the ground`);
});

test("Volcano: team fields lie flat on the plain for 2 to 8 teams", () => {
  game.start("free");
  for (let n = 2; n <= 8; n++) {
    const spots = fieldSpots(n);
    // The runway, its hangar, its flag and room to roll off the end.
    const ok = () =>
      spots.every(
        ({ x, z }) =>
          flatAt(x, z, 300, 30, PLAIN) &&
          flatAt(x - 120, z - 70, 20, 20, PLAIN) &&
          flatAt(x + 60, z + 70, 10, 10, PLAIN),
      );
    assert.ok(ok(), `${n} teams: before`);
    buildFields(n);
    assert.equal(fields.length, n);
    assert.ok(ok(), `${n} teams: built`);
    assert.ok(fields.every((f) => f.hl === 230 && f.g.children.length));
    for (const f of fields)
      assert.ok(
        solids.some((s) => s.x === f.x - 120 && s.h === 12.5 + PLAIN),
        "its hangar stands on the plain",
      );
    clearFields();
    assert.equal(fields.length, 0);
    assert.ok(ok(), `${n} teams: after`);
  }
});

test("back to the Countryside: nothing of the Volcano left", () => {
  game.start("free");
  // Leave choking on ash: the Countryside's engine still runs.
  const s = 0.3,
    l = PLUME.lean * s ** 1.6;
  flyAt(
    VX + PLUME.wx * l,
    PLUME.base + s * (PLUME.top - PLUME.base),
    VZ + PLUME.wz * l,
    60,
    1,
  );
  game.run(200);
  assert.equal(land.power, 0);
  $("quit").click();
  pick("field");
  game.start("free");
  assert.equal(mapNow(), "field");
  assert.equal(land.height, null);
  assert.equal(land.tick, null);
  assert.equal(land.power, 1);
  assert.deepEqual([P.pos.x, P.pos.y], [-190, GEAR]);
});
