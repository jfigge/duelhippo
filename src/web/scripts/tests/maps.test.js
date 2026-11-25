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

// maps.test.js — the City and the Sea (maps.js): picking them, their ground,
// the City's towers and ceiling, the Sea's carrier decks, and that the
// Countryside (and Classic) stays the prototype's. Port only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPort, seededRandom } from "./harness.js";
import { PROTO } from "../net/protocol.js";
import { fakeServer, tick, hash } from "./fake-server.js";

const game = await loadPort(3);
const { w, duel } = game;
const P = duel.P;
const $ = (id) => w.document.getElementById(id);
const { land, groundY } = await import("../world.js");
const { scene } = await import("../scene.js");
const { fire } = await import("../weapons.js");
const THREE = await import("three");
const { mapNow, useMap, startMap } = await import("../maps.js");
const { HOME, GEAR, CITY, SEA } = await import("../constants.js");
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

// A street point right beside a tall tower: [x, z] of open street, and the
// x of the tower's wall, flying along +x.
function besideTower() {
  for (let x = 600; x < 2400; x += 5) {
    const z = CITY.pitch * 2 + 10; // a block's row, off the boulevard
    if (groundY(x, z) > 200 && groundY(x - 60, z) === 0) return [x - 60, z];
  }
  throw new Error("no tower found");
}

test("the Countryside is the default, with nothing plugged in", () => {
  assert.equal(mapNow(), "field");
  assert.equal(land.height, null);
  assert.equal(HOME.hl, 230);
  for (const b of w.document.querySelectorAll("[data-map]"))
    assert.equal(b.classList.contains("on"), b.dataset.map === "field");
});

test("picking the City on the title shows it at once, and is remembered", () => {
  pick("city");
  assert.equal(mapNow(), "city");
  assert.equal(land.ceil, CITY.ceil);
  assert.equal(w.localStorage.getItem("duelhippo.map"), "city");
  assert.ok(
    w.document.querySelector('[data-map="city"]').classList.contains("on"),
  );
});

test("Classic is always the Countryside", () => {
  game.start("classic");
  assert.equal(mapNow(), "field");
  assert.equal(land.height, null);
  assert.deepEqual([P.pos.x, P.pos.y], [-190, GEAR]);
  duel.startGame("free"); // and Free flight goes back to the City
  assert.equal(mapNow(), "city");
});

test("City: the runway is where it was; towers are solid ground", () => {
  game.start("free");
  assert.deepEqual([P.pos.x, P.pos.y], [-190, GEAR], "on the runway");
  game.run(100);
  assert.ok(P.alive && P.grounded);
  const [x, z] = besideTower();
  flyAt(x, 120, z, 60);
  game.run(1500);
  assert.equal(P.alive, false);
  assert.match(msg(), /Flew into a tower/);
});

test("City: the cloud ceiling turns a climb back down", () => {
  game.start("free");
  flyAt(1400, 200, 0, 70, 1);
  game.down("ArrowDown"); // pull up, hard, and keep pulling
  let top = 0;
  for (let i = 0; i < 40; i++) {
    game.run(100);
    top = Math.max(top, P.pos.y);
  }
  game.up("ArrowDown");
  assert.ok(P.alive, "still flying");
  assert.ok(top <= CITY.ceil, `peaked at ${top}`);
  assert.match(msg(), /Cloud ceiling/);
});

test("City: the enemy flyers hunt through the streets, round the towers", () => {
  // Over several games, each from its own random numbers (so what it finds
  // is not down to the tests before it), none flies into a tower.
  let seen = 0,
    towers = 0,
    turned = 0;
  for (const seed of [11, 34, 45, 47]) {
    // (and the flyers' patrol clocks from nought: they carry over)
    for (const e of duel.enemies) e.t = 0;
    Math.random = seededRandom(seed);
    game.start("free");
    let t = 0;
    const was = duel.enemies.map((e) => e.alive),
      heading = duel.enemies.map(() => null);
    // The player, kept flying a slow circuit down the boulevard and kept
    // whole, for them to hunt.
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
        const f = Math.atan2(e.q.y, e.q.w);
        if (was[k] && e.alive && Math.abs(f - heading[k]) > 0.5) turned++;
        if (was[k] && !e.alive && groundY(e.pos.x, e.pos.z) > e.pos.y - 3)
          towers++;
        if (!was[k] && e.alive) {
          seen++;
          heading[k] = f;
        }
        was[k] = e.alive;
      });
    }
  }
  assert.ok(seen >= 8, `${seen} flew`);
  assert.ok(turned > 0, "and turned to hunt");
  assert.equal(towers, 0, "none flew into a tower");
});

test("Sea: the plane starts on its carrier's deck, and takes off from it", () => {
  pick("sea");
  game.start("free");
  assert.equal(mapNow(), "sea");
  assert.equal(HOME.hl, SEA.hl);
  assert.equal(P.pos.x, HOME.x - SEA.hl + 40);
  assert.equal(P.pos.y, SEA.deck + GEAR, "on the deck");
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
  assert.ok(!P.grounded && P.pos.y > SEA.deck + 10, `at ${P.pos.y}`);
});

test("Sea: a deck landing stops on the deck; the sea is no runway", () => {
  game.start("free");
  // Over the stern, a little above the deck, sinking gently.
  flyAt(HOME.x - SEA.hl + 15, SEA.deck + GEAR + 1.5, 0, 36, 0);
  game.poke((P) => (P.sink = 2));
  game.run(5000);
  assert.ok(P.alive, msg());
  assert.ok(P.grounded, "on the deck");
  assert.ok(P.pos.x < HOME.x + SEA.hl, "stopped before the bow");
  assert.ok(P.speed < 1);
  // Ditching
  flyAt(600, GEAR + 1, -300, 40, 0);
  game.poke((P) => (P.sink = 4));
  game.run(3000);
  assert.equal(P.alive, false);
  assert.match(msg(), /Ditched in the sea/);
});

test("Sea: rolling off the deck slowly goes into the sea", () => {
  game.start("free");
  game.poke((P) => {
    P.pos.x = HOME.x + SEA.hl - 10;
    P.speed = 20;
  });
  game.run(1000);
  assert.equal(P.alive, false);
  assert.match(msg(), /Rolled off the deck/);
});

test("Sea: the fleet is the town, and bombs sink it", () => {
  game.start("free");
  const ship = duel.targets[0];
  assert.equal(ship.kind, "destroyer");
  assert.equal(ship.y, 0, "on the water");
  flyAt(ship.x - 3, 60, ship.z, 0.1, 0);
  for (let i = 0; i < 8; i++) {
    game.poke((P) => {
      P.pos.set(ship.x, 60, ship.z);
      P.vel.set(0, 0, 0);
      P.speed = 40;
      P.bombCd = 0;
    });
    game.press("KeyB");
    game.run(3700);
  }
  assert.equal(ship.alive, false, `hp ${ship.hp}`);
  assert.match(msg(), /Destroyer destroyed|town flattened/);
});

test("Sea: an island's ground is its sand and its hill, as drawn", () => {
  game.start("free");
  // The sand bars (9 sides) and their hills (7), as the map draws them.
  const isles = [];
  scene.traverse((o) => {
    const p = o.geometry?.parameters;
    if (o.geometry?.type === "CylinderGeometry" && p.radialSegments === 9)
      isles.push(o);
  });
  assert.equal(isles.length, 5);
  const hills = [];
  scene.traverse((o) => {
    const p = o.geometry?.parameters;
    if (o.geometry?.type === "CylinderGeometry" && p.radialSegments === 7)
      hills.push(o);
  });
  scene.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(),
    down = new THREE.Vector3(0, -1, 0),
    from = new THREE.Vector3();
  for (const I of isles) {
    const r = I.geometry.parameters.radiusBottom,
      { x, z } = I.position;
    let n = 0;
    for (let dx = -r; dx <= r; dx += r / 12)
      for (let dz = -r; dz <= r; dz += r / 12) {
        ray.set(from.set(x + dx, 200, z + dz), down);
        const hit = ray.intersectObjects([I, ...hills])[0],
          seen = hit && hit.point.y > 0 ? hit.point.y : 0;
        assert.ok(
          Math.abs(groundY(x + dx, z + dz) - seen) < 0.01,
          `at ${dx}, ${dz} of ${r}: ${groundY(x + dx, z + dz)} vs ${seen}`,
        );
        if (seen > 0) n++;
      }
    assert.ok(n > 100, `${n} points on it`);
  }
});

test("Sea: a ship is hit where it is, bow to stern", () => {
  game.start("free");
  const t = duel.targets[0],
    at = (x, y, z, pad) =>
      t.hit(t, new THREE.Vector3(t.x + x, t.y + y, t.z + z), pad);
  assert.equal(t.kind, "destroyer");
  assert.ok(at(50, 2, 0), "the bow, past its old reach");
  assert.ok(at(-38, 3, 0), "the stern");
  assert.ok(at(5, 14, 0), "the bridge");
  assert.ok(!at(50, 2, 6), "beside the bow");
  assert.ok(!at(-30, 20, 0), "over the deck");
  assert.ok(at(-30, 20, 0, 12), "a bomb's burst reaches it");
  // Turned a quarter, its bow is along −z.
  t.g.rotation.y = Math.PI / 2;
  assert.ok(t.hit(t, new THREE.Vector3(t.x, 2, t.z - 50)));
  assert.ok(!t.hit(t, new THREE.Vector3(t.x + 50, 2, t.z)));
  t.g.rotation.y = 0;
  // A round across its bow, 44 m out from its middle, holes it.
  const hp = t.hp;
  fire(
    new THREE.Vector3(t.x + 44, 3, t.z + 40),
    new THREE.Vector3(0, 0, -1),
    480,
    "p",
  );
  game.run(200);
  assert.equal(t.hp, hp - 1);
  for (const k of ["cargo", "patrol"]) {
    const u = duel.targets.find((u) => u.kind === k);
    assert.equal(typeof u.hit, "function", k);
  }
  const cargo = duel.targets.find((u) => u.kind === "cargo");
  assert.ok(cargo.hit(cargo, new THREE.Vector3(cargo.x + 43, 4, cargo.z)));
});

test("back to the Countryside: everything as the prototype had it", () => {
  pick("field");
  game.start("free");
  assert.equal(mapNow(), "field");
  assert.equal(land.height, null);
  assert.equal(land.ceil, 0);
  assert.equal(HOME.hl, 230);
  assert.deepEqual([P.pos.x, P.pos.y], [-190, GEAR]);
  assert.equal(duel.targets[0].kind, "tanks");
});

test("a team game on the Sea: the organiser's map, a carrier each", async () => {
  pick("city"); // the organiser's own map is the first offer
  const net = fakeServer(w, { seat: 0 });
  const lastSetup = () => net.sent("setup").at(-1);
  $("bOnline").click();
  $("onHost").disabled = false;
  $("onName").value = "Ace";
  $("onName").dispatchEvent(new w.Event("input"));
  $("onHost").click();
  await tick(10);
  net.server({ t: "peer", seat: 1 });
  net.from(1, { t: "hi", v: PROTO, h: hash("b"), n: "Bo" });
  assert.equal(lastSetup().map, "city");
  w.document.querySelector('[data-lmap="sea"]').click();
  assert.equal(lastSetup().map, "sea");
  assert.match($("onDesc").textContent, /Sea/);
  w.document.querySelector('[data-gmode="flag"]').click();
  $("onStart").click();
  await tick(3200);
  assert.equal(duel.state, "play");
  assert.equal(mapNow(), "sea");
  const f = duel.fields[0];
  assert.equal(f.hl, SEA.hl, "our runway is a flight deck");
  assert.equal(groundY(f.x, f.z), SEA.deck);
  assert.equal(P.pos.x, f.x - SEA.hl + 40);
  assert.equal(P.pos.y, SEA.deck + GEAR, "on our deck");
  const flag = duel.targets.find((t) => t.kind === "flag" && t.side === 0);
  assert.equal(flag.y, SEA.deck, "our flag stands on it");
  // Leaving: the team carriers go, and the title is the player's map again.
  $("quit").click();
  await tick(10);
  assert.equal(duel.state, "title");
  assert.equal(duel.fields.length, 0);
  assert.equal(mapNow(), "city");
  useMap("sea");
  assert.equal(groundY(f.x, f.z), 0, "no deck where the team's was");
  useMap("city");
});

test("a team game in the City clears room round each field", async () => {
  const { buildFields, clearFields, fields } = await import("../world.js");
  const { fieldSpots } = await import("../net/teams.js");
  assert.equal(mapNow(), "city");
  // Is there a tower anywhere on a field's runway or round it?
  const crowded = ({ x, z }) => {
    for (let dx = -330; dx <= 330; dx += 15)
      for (let dz = -150; dz <= 150; dz += 15)
        if (groundY(x + dx, z + dz) > 0) return true;
    return false;
  };
  // Is a tower drawn there? (Under the cloud, higher than a hangar.)
  scene.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(),
    down = new THREE.Vector3(0, -1, 0),
    drawn = ({ x, z }) => {
      // the merged meshes: the towers by colour, and their roofs
      const big = [];
      scene.traverse((o) => {
        if (o.isMesh && !o.isInstancedMesh && o.visible)
          if (o.geometry.attributes.position.count > 500) big.push(o);
      });
      for (let dx = -330; dx <= 330; dx += 30)
        for (let dz = -150; dz <= 150; dz += 30) {
          ray.set(new THREE.Vector3(x + dx, CITY.ceil - 5, z + dz), down);
          const hit = ray.intersectObjects(big)[0];
          if (hit && hit.point.y > 20) return true;
        }
      return false;
    };
  // How many times the towers have been drawn again: each drawing frees the
  // last one's merged meshes, so count the drawings whose meshes went.
  let drawing = 0;
  const gone = new Set(),
    watched = new Set(),
    watch = () => {
      drawing++;
      scene.traverse((o) => {
        const g = o.geometry;
        if (!o.isMesh || o.isInstancedMesh || watched.has(g)) return;
        if (g.attributes.position.count <= 500) return;
        watched.add(g);
        const n = drawing;
        g.addEventListener("dispose", () => gone.add(n));
      });
    },
    redraws = () => gone.size;
  const spots = fieldSpots(3);
  const before = spots.map(crowded);
  assert.ok(before.some(Boolean), "the city stands where the fields go");
  assert.deepEqual(spots.map(drawn), before, "and is drawn there");
  watch();
  buildFields(3);
  assert.deepEqual(spots.map(crowded), [false, false, false]);
  assert.equal(redraws(), 0, "not once a field");
  // Drawn again once, as the game starts.
  startMap();
  assert.equal(redraws(), 1, "once, as the game starts");
  watch();
  startMap();
  assert.equal(redraws(), 1, "and not again for nothing");
  scene.updateMatrixWorld(true);
  assert.deepEqual(spots.map(drawn), [false, false, false]);
  // A rematch: the fields go and come again (game.js startMatch), and the
  // towers are drawn once more, as it starts.
  watch();
  clearFields();
  buildFields(3);
  assert.equal(redraws(), 1, "not as the fields go and come");
  startMap();
  assert.equal(redraws(), 2, "once, as the rematch starts");
  // The match over: the ground at once, the towers on the title.
  watch();
  clearFields();
  assert.equal(fields.length, 0);
  assert.deepEqual(spots.map(crowded), before, "and stands again after");
  assert.equal(redraws(), 2, "drawn on the title, not as the fields go");
  startMap();
  assert.equal(redraws(), 3);
  scene.updateMatrixWorld(true);
  assert.deepEqual(spots.map(drawn), before, "drawn again after");
});
