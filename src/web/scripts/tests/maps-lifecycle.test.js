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

// maps-lifecycle.test.js — every map, picked and played and left, over and
// over: each time back on the Countryside its sky, fog, light, ground and
// rules are the prototype's again, nothing of a map left glowing on it,
// and nothing left behind in the scene. Port only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPort } from "./harness.js";

const game = await loadPort(6);
const { w, duel } = game;
const P = duel.P;
duel.S.best = 1e6;
(await import("../game.js")).showMaps();
const { land, countryside } = await import("../world.js");
const { mapNow, useMap } = await import("../maps.js");
const { MAPS } = await import("../constants.js");
const { scene } = await import("../scene.js");
const pick = (id) => w.document.querySelector(`[data-map="${id}"]`).click();
const hemi = scene.children.find((o) => o.isHemisphereLight),
  sun = scene.children.find((o) => o.isDirectionalLight);

// What a map changes and must put back.
function look() {
  const glow = [];
  countryside.traverse((o) => {
    const ms = [o.material ?? []].flat();
    for (const m of ms) if (m.emissive) glow.push(m.emissive.getHex());
  });
  return {
    map: mapNow(),
    sky: scene.background.getHex(),
    fog: [scene.fog.color.getHex(), scene.fog.near, scene.fog.far],
    hemi: [hemi.intensity, hemi.groundColor.getHex()],
    sun: sun.intensity,
    shown: countryside.visible,
    land: [land.power, land.tick, land.height, land.floor, land.ceil],
    glow,
  };
}

const IDS = Object.keys(MAPS).filter((id) => id !== "field");
// The scene, less the town (built afresh with each map: none at boot).
const held = () => scene.children.length - duel.targets.length;
const before = look(),
  children = held();

test("the Countryside to start with: nothing plugged in", () => {
  assert.equal(before.map, "field");
  assert.deepEqual(before.land, [1, null, null, null, 0]);
  assert.ok(before.shown);
  assert.ok(
    before.glow.every((g) => g === 0),
    "nothing on it glows",
  );
});

test("every map in turn, three times over, then the Countryside as it was", () => {
  for (let round = 0; round < 3; round++) {
    for (const id of IDS) {
      useMap(id);
      assert.equal(mapNow(), id);
    }
    useMap("field");
    assert.deepEqual(look(), before, `round ${round}`);
    assert.equal(held(), children, `round ${round}: children`);
  }
});

test("every map played a while, and left from in play, puts it all back", () => {
  for (let round = 0; round < 2; round++) {
    for (const id of IDS) {
      pick(id);
      game.start("free");
      assert.equal(mapNow(), id);
      // Up and about (into the weather, the beams, the ash), for a few
      // seconds; then straight on to the next map.
      game.poke((P) => {
        P.grounded = false;
        P.pos.set(1400, 300, 0);
        P.speed = 50;
        P.thr = 0.6;
      });
      game.run(3000);
      game.poke((P) => (P.dmg = 0));
    }
    pick("field");
    game.start("free");
    // (The scene's count is the test above's: play grows the pools of
    // rounds and puffs, which stay.)
    assert.deepEqual(look(), before, `round ${round}`);
    // And the Countryside plays as itself.
    assert.ok(P.alive);
    assert.equal(duel.targets[0].kind, "tanks");
  }
});

// A game played, quit, and back to the title menu: the map behind it is
// fresh and idle (game.js toTitle runs startMap).
function playAndLeave(id, fly) {
  pick(id);
  game.start("free");
  for (let i = 0; i < 30; i++) {
    game.poke((P) => {
      P.grounded = false;
      P.alive = true;
      P.dmg = 0;
      fly(P.pos);
      P.speed = 50;
      P.sink = 0;
    });
    game.run(100);
  }
  game.press("Escape");
  game.run(50);
  w.document.getElementById("quit").click();
  game.run(50);
  w.document.getElementById("oMenu").click();
  game.run(50);
  assert.equal(duel.state, "title");
  assert.equal(mapNow(), id);
}

test("the Arctic's title after a game: clear air, no snow", async () => {
  const { blizzards } = await import("../maps/arctic.js");
  const b = blizzards[0];
  playAndLeave("arctic", (p) => p.set(b.x, 300, b.z));
  assert.deepEqual([scene.fog.near, scene.fog.far], [550, 3000]);
  assert.equal(scene.background.getHex(), 0xd3e4ee);
  assert.equal(scene.fog.color.getHex(), 0xd3e4ee);
  const snow = scene.getObjectByProperty("isPoints", true);
  assert.ok(!snow || !snow.visible, "no snow");
});

test("the Night raid's title after a game: the town's windows lit", () => {
  playAndLeave("night", (p) => p.set(1900, 450, -120));
  const town = duel.targets.filter((t) => t.kind !== "flag");
  assert.ok(town.length > 0);
  for (const t of town) {
    assert.equal(t.g.userData.lit?.length, 6, t.name);
    for (const m of t.g.userData.lit)
      assert.ok(m.material.emissive.getHex() !== 0);
  }
});

test("the Zeppelins' title after a game: the airships on station", () => {
  playAndLeave("zeppelin", (p) => p.set(1400, 500, 0));
  const ships = duel.targets.filter((t) => t.kind === "airship");
  assert.ok(ships.length > 0);
  for (const t of ships) assert.ok(t.g.userData.x0 !== undefined, "posed");
  assert.ok(
    ships.some((t) => Math.abs(t.g.rotation.y - Math.PI) < 1e-9),
    "not all facing +x",
  );
});
