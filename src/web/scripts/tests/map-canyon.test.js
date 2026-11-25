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

// map-canyon.test.js — the Canyon (maps/canyon.js): its gorge and runways,
// the arches you can fly under, the flak on the rim, its crashes, the enemy
// flyers in the gorge, and its team fields. Port only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPort, seededRandom } from "./harness.js";

const game = await loadPort(5);
const { w, duel } = game;
const P = duel.P;
const $ = (id) => w.document.getElementById(id);
const { land, groundY, buildFields, clearFields, fields, targets } =
  await import("../world.js");
const { mapNow, kit } = await import("../maps.js");
const { HOME, EB, GEAR } = await import("../constants.js");
const { fieldSpots } = await import("../net/teams.js");
const msg = () => $("msg").textContent;
duel.S.best = 1e6;
(await import("../game.js")).showMaps();
const pick = (id) => w.document.querySelector(`[data-map="${id}"]`).click();
pick("canyon");
// A second build of the map (seeded, so the same): where its gorge, arches
// and batteries are.
const C = (await import("../maps/index.js")).MORE.canyon(kit);
const { centre, slope, arches } = C;

// Airborne at `pos`, level, heading `a` (rad from +x towards +z), at `speed`.
function flyAt(x, y, z, speed, a = 0, thr = 0.5) {
  game.poke((P) => {
    P.grounded = false;
    P.alive = true;
    P.dmg = 0;
    P.pos.set(x, y, z);
    P.q.setFromAxisAngle(P.pos.clone().set(0, 1, 0), -Math.PI / 2 - a);
    P.speed = speed;
    P.thr = thr;
    P.sink = 0;
  });
}
// No enemy flyers about (they fire magenta rounds too).
function calm() {
  game.poke((P, d) => {
    for (const e of d.enemies) {
      e.alive = false;
      e.obj.visible = false;
    }
    d.S.spawnT = 1e9;
  });
}

test("the Canyon is picked; the plane starts on its runway on the floor", () => {
  assert.equal(mapNow(), "canyon");
  game.start("free");
  assert.deepEqual(
    [P.pos.x, P.pos.y, P.pos.z],
    [HOME.x - HOME.hl + 40, GEAR, 0],
  );
  game.run(100);
  assert.ok(P.alive && P.grounded);
  // Both runways flat on the floor, the rim far above them.
  for (const R of [HOME, EB])
    for (let x = -R.hl; x <= R.hl; x += 10)
      for (let z = -R.hw; z <= R.hw; z += 6)
        assert.equal(groundY(R.x + x, R.z + z), 0, `runway at ${x}, ${z}`);
  assert.ok(groundY(0, 700) >= 245, "the plateau north of home");
  assert.ok(groundY(EB.x, -800) >= 245, "and south of the enemy's");
});

test("a takeoff down the gorge", () => {
  game.start("free");
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

// Along an arch's gorge: the point `s` metres along it from the arch, `y` up.
function byArch(a, s, y) {
  return [a.x + a.c * s, y, a.z + a.s * s];
}
const mid = (pts) => pts[(pts.length - 1) / 2][1];

test("arches: the floor under the vault, the top in and over the rock", () => {
  assert.equal(arches.length, 3);
  for (const a of arches) {
    const vault = mid(a.vaults),
      top = mid(a.tops);
    assert.ok(vault > 60 && top > vault + 30, `vault ${vault}, top ${top}`);
    assert.equal(groundY(a.x, a.z, vault - 5), 0, "under it");
    assert.equal(groundY(a.x, a.z, (vault + top) / 2), top, "in it");
    assert.equal(groundY(a.x, a.z), top, "over it");
    assert.equal(land.floor(a.x, a.z), 0, "the camera's ground");
    // Just past it, along the gorge, nothing overhead.
    assert.equal(
      groundY(...byArch(a, a.T / 2 + 3, 0).filter((_, i) => i !== 1)),
      0,
    );
  }
});

test("arches: fly under one; fly into one", () => {
  calm();
  for (const a of arches) {
    game.start("free");
    calm();
    const [x, y, z] = byArch(a, -120, mid(a.vaults) * 0.45);
    flyAt(x, y, z, 50, a.th);
    game.run(4800);
    assert.ok(P.alive, `under the arch at ${a.x}: ${msg()}`);
    const past = (P.pos.x - a.x) * a.c + (P.pos.z - a.z) * a.s;
    assert.ok(past > a.T / 2, `through it (${past} m)`);
  }
  const a = arches[1];
  game.start("free");
  calm();
  flyAt(...byArch(a, -120, (mid(a.vaults) + mid(a.tops)) / 2), 50, a.th);
  game.run(4000);
  assert.equal(P.alive, false);
  assert.match(msg(), /Hit the arch/);
});

test("crashes: the canyon wall, and the floor away from a runway", () => {
  game.start("free");
  calm();
  const x = 700;
  flyAt(x, 100, centre(x), 50, Math.atan(slope(x)) + Math.PI / 2);
  game.run(5000);
  assert.equal(P.alive, false);
  assert.match(msg(), /Flew into the canyon wall/);
  game.start("free");
  calm();
  flyAt(1120, GEAR + 1, centre(1120), 40, Math.atan(slope(1120)), 0);
  game.poke((P) => (P.sink = 4));
  game.run(3000);
  assert.equal(P.alive, false);
  assert.match(msg(), /Crashed — land on a runway/);
});

// Every round a battery fires, by battery and frame.
function spyFlak() {
  const shots = [],
    real = kit.flakAt;
  let frame = 0;
  kit.flakAt = (from, range, spread) => {
    const ok = real(from, range, spread);
    if (ok) shots.push({ x: from.x, z: from.z, frame });
    return ok;
  };
  return {
    shots,
    run(ms, each) {
      for (let n = Math.round(ms / (1000 / 60)); n > 0; n--) {
        if (each) game.poke(each);
        game.run(1000 / 60);
        frame++;
      }
    },
    done: () => (kit.flakAt = real),
  };
}
// Only battery `f` left standing, so whatever hits the player is its.
function alone(f) {
  for (const t of targets) if (t.kind === "flak" && t !== f) t.alive = false;
}
// Hold the player still at (x, y, z), in the air.
const hold = (x, y, z) => (P) => {
  P.grounded = false;
  P.alive = true;
  P.pos.set(x, y, z);
  P.speed = 0.1;
  P.sink = 0;
  P.spin = 0;
};

test("flak on the rim: five-round bursts at a plane in the open", () => {
  game.start("free");
  calm();
  const flak = targets.filter((t) => t.kind === "flak");
  assert.equal(flak.length, 4);
  for (const t of flak) assert.ok(t.y > 240, `on the rim, at ${t.y}`);
  const f = flak[0],
    spy = spyFlak();
  alone(f);
  game.poke((P) => (P.dmg = 0));
  spy.run(6000, hold(f.x - 300, f.y + 200, f.z));
  spy.done();
  const mine = spy.shots;
  assert.ok(mine.length >= 10, `${mine.length} rounds`);
  // Grouped in fives: 0.12 s apart within a burst, 1.5 s between.
  const gaps = mine.slice(1).map((s, i) => (s.frame - mine[i].frame) / 60);
  gaps.forEach((g, i) => {
    if ((i + 1) % 5) assert.ok(Math.abs(g - 0.12) < 0.02, `gap ${g}`);
    else assert.ok(Math.abs(g - 1.5) < 0.02, `rest ${g}`);
  });
  assert.ok(P.dmg > 0, "and it hits");
});

test("flak: the rim shields a plane close under it", () => {
  game.start("free");
  calm();
  const f = targets.find((t) => t.kind === "flak");
  alone(f);
  // On the floor side of the battery's own wall, at its foot.
  const x = f.x,
    side = Math.sign(f.z - centre(x)),
    z = centre(x) + side * 70,
    spy = spyFlak();
  assert.ok(groundY(x, z) < 5, "on the floor");
  game.poke((P) => (P.dmg = 0));
  spy.run(5000, hold(x, 40, z));
  spy.done();
  assert.ok(spy.shots.length >= 5, `it fired ${spy.shots.length}`);
  assert.equal(P.dmg, 0, "into the rock");
});

test("flak: a bomb silences a battery", () => {
  game.start("free");
  calm();
  const f = targets.find((t) => t.kind === "flak");
  flyAt(f.x, f.y + 60, f.z, 0.1, 0, 0);
  game.poke((P) => {
    P.vel.set(0, 0, 0);
    P.bombCd = 0;
  });
  game.press("KeyB");
  const spy = spyFlak();
  spy.run(4000, hold(f.x, f.y + 60, f.z));
  assert.equal(f.alive, false, `hp ${f.hp}`);
  assert.match(msg(), /Flak battery destroyed/);
  const n = spy.shots.length;
  spy.run(4000, hold(f.x - 200, f.y + 150, f.z));
  spy.done();
  assert.equal(
    spy.shots.slice(n).filter((s) => s.x === f.x).length,
    0,
    "no more from it",
  );
});

test("the enemy flyers hunt down the gorge without flying into it", () => {
  // Its own random numbers, so what it finds is not down to the tests
  // before it.
  Math.random = seededRandom(12);
  game.start("free");
  let seen = 0,
    rock = 0,
    t = 0;
  const was = duel.enemies.map((e) => e.alive);
  for (let i = 0; i < 1500; i++) {
    t += 0.1;
    const x = 1400 + Math.cos(t * 0.15) * 650;
    game.poke((P) => {
      P.alive = true;
      P.dmg = 0;
      P.grounded = false;
      P.pos.set(x, 170, centre(x));
      P.speed = 50;
      P.sink = 0;
    });
    game.run(100);
    // Every 15 s the flyers are sent home, so fresh ones come in from the
    // enemy's basin and find their way down the gorge.
    if (i % 150 === 149)
      duel.enemies.forEach((e, k) => {
        e.alive = was[k] = false;
        e.obj.visible = false;
      });
    duel.enemies.forEach((e, k) => {
      if (
        was[k] &&
        !e.alive &&
        groundY(e.pos.x, e.pos.z, e.pos.y) > e.pos.y - 3
      )
        rock++;
      if (!was[k] && e.alive) seen++;
      was[k] = e.alive;
    });
  }
  assert.ok(seen >= 15, `${seen} flew`);
  assert.ok(rock <= 1, `${rock} flew into the canyon`);
});

test("team fields: a flat pad for each, 2 to 8 teams, and back after", () => {
  const sample = (f) => {
    const hs = new Set();
    for (let x = -f.hl; x <= f.hl; x += 10)
      for (let z = -f.hw; z <= f.hw; z += 6) hs.add(groundY(f.x + x, f.z + z));
    return [...hs];
  };
  for (let n = 2; n <= 8; n++) {
    const before = fieldSpots(n).map(({ x, z }) => groundY(x, z));
    buildFields(n);
    assert.equal(fields.length, n);
    for (const f of fields) {
      const hs = sample(f);
      assert.equal(hs.length, 1, `${n} teams: field at ${f.x}, ${f.z}: ${hs}`);
      assert.ok(hs[0] === 0 || hs[0] === 250, `at ${hs[0]}`);
    }
    clearFields();
    assert.deepEqual(
      fieldSpots(n).map(({ x, z }) => groundY(x, z)),
      before,
      "as it was",
    );
  }
});

test("back to the Countryside: land.height is null again", () => {
  pick("field");
  game.start("free");
  assert.equal(mapNow(), "field");
  assert.equal(land.height, null);
  assert.equal(land.tick, null);
  assert.deepEqual([P.pos.x, P.pos.y], [-190, GEAR]);
});
