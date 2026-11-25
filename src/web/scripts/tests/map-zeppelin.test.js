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

// map-zeppelin.test.js — Zeppelins (maps/zeppelin.js): the carrier airships'
// decks and hulls, the cloud floor, the enemy airships (drifting, firing
// back, sinking when wrecked), the flyers' hunt, and the team carriers.
// Port only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPort } from "./harness.js";

const game = await loadPort(3);
const { w, duel } = game;
const P = duel.P;
const $ = (id) => w.document.getElementById(id);
const { land, groundY, targets, buildFields, clearFields, fields } =
  await import("../world.js");
const { mapNow } = await import("../maps.js");
const { HOME, EB, GEAR } = await import("../constants.js");
const { bullets } = await import("../weapons.js");
const { fieldSpots } = await import("../net/teams.js");
const { ZEP } = await import("../maps/zeppelin.js");
const D = ZEP.deck;
const msg = () => $("msg").textContent;
// Every map earned (they open with the best score: maps-unlock.test.js).
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

test("Zeppelins: the plane starts on its carrier's deck, and takes off", () => {
  pick("zeppelin");
  game.start("free");
  assert.equal(mapNow(), "zeppelin");
  assert.equal(HOME.hl, ZEP.hl);
  assert.equal(EB.hw, ZEP.hw);
  assert.equal(P.pos.x, HOME.x - ZEP.hl + 40);
  assert.equal(P.pos.y, D + GEAR, "on the deck");
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
  assert.ok(!P.grounded && P.pos.y > D + 10, `at ${P.pos.y}`);
});

test("Zeppelins: the deck is flat; the hull hangs under it; then cloud", () => {
  for (const R of [HOME, EB]) {
    for (let dx = -R.hl + 1; dx < R.hl; dx += 7)
      for (let dz = -R.hw + 0.5; dz < R.hw; dz += 3)
        assert.equal(groundY(R.x + dx, R.z + dz), D, `deck at ${dx}, ${dz}`);
    assert.equal(groundY(R.x, R.z, D - 20), D, "the hull is solid");
    assert.equal(groundY(R.x, R.z, D - 44), D, "down to the gondola");
    assert.equal(groundY(R.x, R.z, D - 50), 0, "under the keel: cloud");
    assert.equal(groundY(R.x + 100, R.z, D - 42), 0);
    assert.equal(groundY(R.x + R.hl + 2, R.z), 0, "off the bow: cloud");
    assert.equal(groundY(R.x, R.z + R.hw + 2), 0, "off the side");
  }
});

test("Zeppelins: a deck landing stops on the deck, the wires helping", () => {
  game.start("free");
  assert.equal(land.brake, ZEP.brake);
  flyAt(HOME.x - ZEP.hl + 15, D + GEAR + 1.5, 0, 36, 0);
  game.poke((P) => (P.sink = 2));
  game.run(5000);
  assert.ok(P.alive, msg());
  assert.ok(P.grounded, "on the deck");
  assert.ok(P.pos.x < HOME.x + ZEP.hl, "stopped before the bow");
  assert.ok(P.speed < 1);
  assert.equal(P.pos.y, D + GEAR);
});

test("Zeppelins: rolling off the deck slowly falls off it", () => {
  game.start("free");
  game.poke((P) => {
    P.pos.x = HOME.x + ZEP.hl - 10;
    P.speed = 20;
  });
  game.run(1000);
  assert.equal(P.alive, false);
  assert.match(msg(), /Rolled off the deck/);
});

test("Zeppelins: under a carrier's keel is open air", () => {
  game.start("free");
  flyAt(HOME.x - 400, D - 60, 0, 60, 0.7);
  for (let i = 0; i < 40; i++) {
    game.poke((P) => {
      P.pos.y = D - 60;
      P.sink = 0;
    });
    game.run(250);
  }
  assert.ok(P.alive, msg());
  assert.ok(P.pos.x > HOME.x + ZEP.hl, `past it, at ${P.pos.x}`);
});

test("Zeppelins: flying into a carrier's hull crashes, landing on nothing", () => {
  // Level into its stern, under the deck: not a landing.
  game.start("free");
  flyAt(HOME.x - ZEP.hl - 60, D - 20, 0, 50);
  game.run(3000);
  assert.equal(P.alive, false);
  assert.match(msg(), /Flew into the airship/);
  // Into its side.
  game.start("free");
  flyAt(HOME.x + 40, D - 25, -120, 50);
  game.poke((P) => P.q.setFromAxisAngle(P.pos.clone().set(0, 1, 0), Math.PI));
  game.run(4000);
  assert.equal(P.alive, false);
  assert.match(msg(), /Flew into the airship/);
});

test("Zeppelins: the cloud floor is where planes are lost", () => {
  game.start("free");
  flyAt(600, GEAR + 1, -300, 40, 0);
  game.poke((P) => (P.sink = 4));
  game.run(3000);
  assert.equal(P.alive, false);
  assert.match(msg(), /Lost in the clouds/);
});

test("Zeppelins: the targets are airships, floating, and drifting", () => {
  game.start("free");
  assert.ok(targets.length >= 6);
  for (const t of targets) {
    assert.equal(t.kind, "airship");
    assert.ok(t.y >= 250 && t.y <= 450, `at ${t.y}`);
    assert.equal(t.name, "Airship");
    assert.equal(t.pts, 300);
  }
  const t = targets[2],
    x0 = t.x,
    z0 = t.z;
  game.poke((P) => (P.thr = 0));
  game.run(30000);
  assert.ok(P.alive && P.grounded, "sat on the deck meanwhile");
  const moved = Math.hypot(t.x - x0, t.z - z0);
  assert.ok(moved > 5 && moved < 80, `drifted ${moved} m`);
  assert.equal(t.g.position.x, t.x);
  assert.equal(t.g.position.z, t.z);
  for (const u of targets)
    assert.ok(
      Math.abs(u.x - u.g.userData.x0) < 95 &&
        Math.abs(u.z - u.g.userData.z0) < 45,
      "near its spot",
    );
  // Flying into one is flying into the airship.
  flyAt(t.x - 80, t.y + 15, t.z, 50);
  game.run(3000);
  assert.equal(P.alive, false);
  assert.match(msg(), /Flew into the airship/);
});

test("Zeppelins: an airship fires bursts at a player in range", () => {
  game.start("free");
  const t = targets[0];
  const enemyRounds = () => bullets.filter((b) => b.on && b.own === "e");
  let shots = 0,
    near = 0;
  for (let i = 0; i < 60; i++) {
    game.poke((P) => {
      P.alive = true;
      P.dmg = 0;
      P.grounded = false;
      P.pos.set(t.x, t.y - 250, t.z);
      P.vel.set(0, 0, 0);
      P.speed = 40;
      P.sink = 0;
    });
    const before = new Set(enemyRounds());
    game.run(100);
    for (const b of enemyRounds())
      if (!before.has(b)) {
        shots++;
        if (b.p0.distanceTo(t.g.position) < 20) near++;
      }
  }
  assert.ok(shots >= 4 && shots <= 20, `${shots} rounds in 6 s`);
  assert.ok(near > 0, "from the gondola");
  // Out of range, none.
  shots = 0;
  for (let i = 0; i < 30; i++) {
    game.poke((P) => {
      P.pos.set(t.x, t.y - 700, t.z + 400);
      P.sink = 0;
    });
    const before = new Set(enemyRounds());
    game.run(100);
    for (const b of enemyRounds()) if (!before.has(b)) shots++;
  }
  assert.equal(shots, 0);
});

test("Zeppelins: bombs bring an airship down, and it sinks into the cloud", () => {
  game.start("free");
  const t = targets[0];
  for (let i = 0; i < 4 && t.alive; i++) {
    game.poke((P) => {
      P.pos.set(t.x, t.y + 60, t.z);
      P.vel.set(0, 0, 0);
      P.speed = 40;
      P.bombCd = 0;
    });
    game.press("KeyB");
    game.run(2500);
  }
  assert.equal(t.alive, false, `hp ${t.hp}`);
  assert.match(msg(), /Airship destroyed|town flattened/);
  const y0 = t.g.position.y;
  game.poke((P) => {
    P.alive = true;
    P.dmg = 0;
    P.pos.set(HOME.x, D + GEAR, 0);
    P.grounded = true;
    P.speed = 0;
    P.thr = 0;
  });
  game.run(5000);
  assert.ok(t.g.position.y < y0 - 20, `sank to ${t.g.position.y}`);
  assert.equal(t.y, t.g.position.y, "its wreck with it");
  game.run(60000);
  assert.equal(t.g.visible, false, "gone into the cloud");
});

test("Zeppelins: the enemy flyers hunt round their carrier without hitting it", () => {
  game.start("free");
  let seen = 0,
    crashed = 0,
    near = 0,
    t = 0;
  const was = duel.enemies.map((e) => e.alive);
  // The player, kept flying a circuit round the enemy's carrier at its
  // hull's height and kept whole, for the flyers to hunt.
  for (let i = 0; i < 1500; i++) {
    t += 0.1;
    game.poke((P) => {
      P.alive = true;
      P.dmg = 0;
      P.grounded = false;
      P.pos.set(
        EB.x - 250 + Math.cos(t * 0.15) * 600,
        250,
        Math.sin(t * 0.15) * 200,
      );
      P.speed = 50;
      P.sink = 0;
    });
    game.run(100);
    duel.enemies.forEach((e, k) => {
      if (e.alive && Math.abs(e.pos.x - EB.x) < 250 && Math.abs(e.pos.z) < 60)
        near++;
      if (
        was[k] &&
        !e.alive &&
        groundY(e.pos.x, e.pos.z, e.pos.y) > e.pos.y - 3
      )
        crashed++;
      if (!was[k] && e.alive) seen++;
      was[k] = e.alive;
    });
  }
  assert.ok(seen >= 2, `${seen} flew`);
  assert.ok(near > 0, "round the carrier");
  assert.ok(crashed <= 1, `${crashed} flew into a carrier or the cloud`);
});

test("Zeppelins: team games put a carrier at every field, 2 to 8 teams", () => {
  for (let n = 2; n <= 8; n++) {
    const spots = fieldSpots(n);
    buildFields(n);
    assert.equal(fields.length, n);
    for (const f of fields) {
      assert.equal(f.hl, ZEP.hl);
      assert.equal(f.hw, ZEP.hw);
      for (let dx = -f.hl + 1; dx < f.hl; dx += 9)
        for (let dz = -f.hw + 0.5; dz < f.hw; dz += 4)
          assert.equal(groundY(f.x + dx, f.z + dz), D, `${n} teams`);
      assert.equal(groundY(f.x, f.z, D - 60), 0, "air under its keel");
      for (const R of [HOME, EB])
        assert.ok(
          Math.abs(f.x - R.x) > R.hl + f.hl || Math.abs(f.z - R.z) > 60,
          "clear of the two sides' carriers",
        );
      for (const t of targets)
        assert.ok(
          Math.hypot(t.x - f.x, t.z - f.z) > f.hl + 120,
          "clear of the airships",
        );
    }
    clearFields();
    assert.equal(fields.length, 0);
    for (const s of spots) assert.equal(groundY(s.x, s.z), 0, "gone again");
  }
});

test("back to the Countryside: nothing of the Zeppelins left plugged in", () => {
  pick("field");
  game.start("free");
  assert.equal(mapNow(), "field");
  assert.equal(land.height, null);
  assert.equal(land.tick, null);
  assert.equal(land.deck, false);
  assert.equal(HOME.hl, 230);
  assert.deepEqual([P.pos.x, P.pos.y], [-190, GEAR]);
  assert.equal(duel.targets[0].kind, "tanks");
});
