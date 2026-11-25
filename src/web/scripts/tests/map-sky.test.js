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

// map-sky.test.js — Sky islands (maps/sky.js): runways on floating islands,
// air under every island and rock inside it, the cloud floor, the town on
// its chain, the enemy flyers round them, and team fields on islands of
// their own. Port only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPort, seededRandom } from "./harness.js";

const game = await loadPort(3);
const { w, duel } = game;
const P = duel.P;
const $ = (id) => w.document.getElementById(id);
const { land, groundY, hippos, buildFields, clearFields, fields } =
  await import("../world.js");
const { mapNow, kit } = await import("../maps.js");
const { HOME, EB, GEAR } = await import("../constants.js");
const { fieldSpots } = await import("../net/teams.js");
// The same islands the game built (the map is drawn from its own seed).
const sky = (await import("../maps/sky.js")).default(kit);
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
// Held level and at speed, as a pilot would, for `ms`; returns whether it
// was ever under rock.
function holdLevel(y, ms) {
  let under = false;
  for (let t = 0; t < ms && P.alive; t += 100) {
    game.poke((P) => {
      P.pos.y = y;
      P.q.setFromAxisAngle(P.pos.clone().set(0, 1, 0), -Math.PI / 2);
      P.speed = 60;
      P.sink = 0;
    });
    game.run(100);
    if (P.alive && groundY(P.pos.x, P.pos.z) > P.pos.y + 20) under = true;
  }
  return under;
}

test("Sky islands: the plane starts on HOME's island, and takes off", () => {
  pick("sky");
  game.start("free");
  assert.equal(mapNow(), "sky");
  const top = groundY(HOME.x, HOME.z);
  assert.ok(top >= 250 && top <= 300, `HOME's island top at ${top}`);
  assert.equal(P.pos.x, HOME.x - HOME.hl + 40);
  assert.equal(P.pos.y, top + GEAR, "on the runway");
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
  assert.ok(!P.grounded && P.pos.y > top + 10, `at ${P.pos.y}`);
});

test("Sky islands: rock inside, air under, the cloud floor below", () => {
  for (const R of [HOME, EB]) {
    const top = groundY(R.x, R.z);
    // Flat over the whole runway.
    for (let dx = -R.hl; dx <= R.hl; dx += 23)
      for (const dz of [-R.hw + 0.5, 0, R.hw - 0.5])
        assert.equal(groundY(R.x + dx, R.z + dz), top);
    assert.equal(groundY(R.x, R.z, top - 20), top, "inside the rock");
    assert.equal(groundY(R.x, R.z, 5), 0, "under the rock");
    assert.equal(groundY(R.x, R.z + 1000), 0, "off it, the clouds");
  }
  assert.ok(sky.isles.length - 8 >= 25 && sky.isles.length - 8 <= 40);
  const tops = sky.isles.map((I) => I.top);
  assert.ok(Math.min(...tops) <= 150 && Math.max(...tops) >= 550, "heights");
});

test("Sky islands: a plane flies under an island and out the other side", () => {
  // A high one, wide enough to be under for a while, with nothing low near.
  const I = sky.isles.find(
    (I) =>
      I.low > 430 &&
      I.ax > 70 &&
      [-1, 0, 1].every((k) => groundY(I.x - I.ax * 3, I.z + k * 15) === 0),
  );
  assert.ok(I, "a high island");
  const y = I.low - 50;
  flyAt(I.x - I.ax * 2.5, y, I.z, 60);
  assert.equal(groundY(I.x, I.z, y), 0);
  const under = holdLevel(y, ((I.ax * 5) / 60) * 1000);
  assert.ok(P.alive, msg());
  assert.ok(under, "passed under it");
  assert.ok(P.pos.x > I.x + I.ax, "and out the far side");
});

test("Sky islands: flying into an island's side crashes", () => {
  const top = groundY(HOME.x, HOME.z);
  flyAt(HOME.x - 900, top - 25, 0, 60);
  holdLevel(top - 25, 15000);
  assert.equal(P.alive, false);
  assert.match(msg(), /Flew into an island/);
  assert.ok(
    P.pos.x < HOME.x - HOME.hl,
    `at the island's west face, ${P.pos.x}`,
  );
});

test("Sky islands: diving into the cloud sea is the end", () => {
  game.start("free");
  // Somewhere with no island over it.
  let x = 1400,
    z = -2000;
  while (groundY(x, z) > 0) x += 40;
  flyAt(x, GEAR + 2, z, 40, 0);
  game.poke((P) => (P.sink = 4));
  for (let t = 0; t < 5000 && P.alive; t += 100) game.run(100);
  assert.equal(P.alive, false);
  assert.match(msg(), /Lost in the clouds/);
});

test("Sky islands: a landing on HOME's island stops on it", () => {
  game.start("free");
  const top = groundY(HOME.x, HOME.z);
  flyAt(HOME.x - HOME.hl + 15, top + GEAR + 1.5, 0, 36, 0);
  game.poke((P) => (P.sink = 2));
  game.run(8000);
  assert.ok(P.alive, msg());
  assert.ok(P.grounded, "on the runway");
  assert.ok(P.speed < 1);
  assert.equal(P.pos.y, top + GEAR);
});

test("Sky islands: the approaches along the lane are clear", () => {
  // Between the runway islands nothing reaches the height of EB's runway
  // (the lower of the two) less 25 m, but what a plane flies under.
  const low = groundY(EB.x, EB.z) - 25;
  const ends = [HOME.x + HOME.hl + 50, EB.x - EB.hl - 50];
  for (let x = ends[0]; x < ends[1]; x += 10)
    for (const z of [-40, 0, 40]) {
      if (groundY(x, z) === groundY(HOME.x, HOME.z)) continue; // HOME's
      if (groundY(x, z) === groundY(EB.x, EB.z)) continue; // EB's
      assert.ok(
        groundY(x, z, 440) <= low,
        `${groundY(x, z, 440)} at ${x}, ${z}`,
      );
    }
  // And off each end, a kilometre of open air at runway height.
  for (const [R, s] of [
    [HOME, -1],
    [EB, 1],
  ]) {
    const top = groundY(R.x, R.z);
    for (let d = R.hl + 450; d < R.hl + 1100; d += 10)
      assert.ok(groundY(R.x + s * d, 0, top + 60) < top - 30);
  }
});

test("Sky islands: the town stands on its chain, the hippos on theirs", () => {
  game.start("free");
  assert.equal(duel.targets.length, 8);
  for (const t of duel.targets) {
    assert.ok(t.y > 0, `${t.name} floats on an island`);
    assert.equal(t.y, groundY(t.x, t.z));
    assert.ok(Math.abs(t.z) < 60 && t.x > HOME.x && t.x < EB.x);
  }
  for (const h of hippos) {
    assert.ok(h.g.position.y > 0);
    for (const dx of [-31, 0, 31])
      assert.equal(groundY(h.x0 + dx, h.z), h.g.position.y, "room to wander");
  }
  // A bomb on the first building.
  const t = duel.targets[0];
  for (let i = 0; i < 3 && t.alive; i++) {
    game.poke((P) => {
      P.alive = true;
      P.grounded = false;
      P.pos.set(t.x, t.y + 60, t.z);
      P.vel.set(0, 0, 0);
      P.speed = 40;
      P.bombCd = 0;
    });
    game.press("KeyB");
    game.run(3700);
  }
  assert.equal(t.alive, false, `hp ${t.hp}`);
});

test("Sky islands: the enemy flyers hunt round the islands", () => {
  // High (over the islands) and low (skirting the town island's edges, where
  // a careless avoider turns back into the rock), each from its own random
  // numbers, so what it finds is not down to the tests before it.
  let seen = 0,
    rocks = 0;
  for (const [alt, seeds] of [
    [320, [14]],
    [130, [1, 2, 3, 4, 5, 6, 7, 8, 9]],
  ])
    for (const seed of seeds) {
      Math.random = seededRandom(seed);
      for (const e of duel.enemies) e.t = 0;
      pick("sky");
      game.start("free");
      assert.equal(mapNow(), "sky");
      duel.S.wave = 3; // five at once
      let t = 0;
      const was = duel.enemies.map((e) => e.alive);
      // The player, flying a slow circuit over the town and kept whole,
      // for them to hunt.
      for (let i = 0; i < 900; i++) {
        t += 0.1;
        game.poke((P) => {
          P.alive = true;
          P.dmg = 0;
          P.grounded = false;
          P.pos.set(
            1400 + Math.cos(t * 0.2) * 600,
            alt,
            Math.sin(t * 0.2) * 100,
          );
          P.speed = 50;
          P.sink = 0;
        });
        game.run(100);
        duel.enemies.forEach((e, k) => {
          if (
            was[k] &&
            !e.alive &&
            groundY(e.pos.x, e.pos.z, e.pos.y) > e.pos.y - 3
          )
            rocks++;
          if (!was[k] && e.alive) seen++;
          was[k] = e.alive;
        });
      }
    }
  assert.ok(seen >= 30, `${seen} flew`);
  assert.equal(rocks, 0, `${rocks} flew into an island or the clouds`);
});

test("Sky islands: a team field is a floating island, flat round its runway", () => {
  for (let n = 2; n <= 8; n++) {
    const spots = fieldSpots(n),
      sample = ({ x, z }) => {
        const hs = [];
        for (let dx = -330; dx <= 330; dx += 30)
          for (let dz = -150; dz <= 150; dz += 30)
            hs.push(groundY(x + dx, z + dz), groundY(x + dx, z + dz, 100));
        return hs;
      },
      before = spots.map(sample);
    buildFields(n);
    assert.equal(fields.length, n);
    for (const f of fields) {
      const top = groundY(f.x, f.z);
      assert.ok(top > 0, `${n} teams: field ${f.team} floats`);
      for (let dx = -f.hl; dx <= f.hl; dx += 23)
        for (const dz of [-f.hw + 0.5, 0, f.hw - 0.5])
          assert.equal(groundY(f.x + dx, f.z + dz), top, `${n}: flat`);
      assert.equal(groundY(f.x + 60, f.z + 70), top, "room for its flag");
      assert.equal(groundY(f.x, f.z, 5), 0, "air under it");
    }
    clearFields();
    assert.deepEqual(spots.map(sample), before, `${n}: as before`);
  }
});

test("back to the Countryside: nothing plugged in", () => {
  pick("field");
  game.start("free");
  assert.equal(mapNow(), "field");
  assert.equal(land.height, null);
  assert.deepEqual([P.pos.x, P.pos.y], [-190, GEAR]);
});
