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

// map-storm-night.test.js — the Storm and the Night raid: the Countryside's
// world under weather and dark. Gusts and lightning; searchlights whose flak
// follows a plane caught in a beam. Port only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPort } from "./harness.js";

const game = await loadPort(4);
const { w, duel } = game;
const P = duel.P;
const $ = (id) => w.document.getElementById(id);
duel.S.best = 1e6;
(await import("../game.js")).showMaps();
const { land } = await import("../world.js");
const { mapNow } = await import("../maps.js");
const { bullets } = await import("../weapons.js");
const pick = (id) => w.document.querySelector(`[data-map="${id}"]`).click();

function cruise(x, y, z, yaw = -Math.PI / 2) {
  game.poke((P) => {
    P.grounded = false;
    P.alive = true;
    P.dmg = 0;
    P.pos.set(x, y, z);
    P.q.setFromAxisAngle(P.pos.clone().set(0, 1, 0), yaw);
    P.speed = 60;
    P.thr = 0.6;
    P.sink = 0;
  });
}

test("the Storm: the Countryside's ground, gusts that throw the plane, lightning", () => {
  pick("storm");
  game.start("free");
  assert.equal(mapNow(), "storm");
  assert.equal(land.height, null, "the Countryside's own ground");
  assert.deepEqual([P.pos.x, P.grounded], [-190, true]);
  cruise(1400, 300, 1500);
  const q = P.q.clone();
  let flashed = false;
  for (let i = 0; i < 150; i++) {
    game.run(100);
    flashed ||= $("flash").classList.contains("on");
    game.poke((P) => (P.dmg = 0));
  }
  assert.ok(P.q.angleTo(q) > 0.05, "knocked off its line");
  assert.ok(flashed, "lightning within 15 s");
});

test("the Night raid: caught in a searchlight, the flak follows", () => {
  pick("night");
  game.start("free");
  assert.equal(mapNow(), "night");
  // Held over the town, where the beams sweep: caught sooner or later.
  let caught = false;
  for (let i = 0; i < 1500 && !caught; i++) {
    cruise(1900, 450, -120, Math.PI / 2);
    game.run(50);
    caught = /Searchlight/.test($("msg").textContent);
  }
  assert.ok(caught, "caught in a beam");
  assert.ok(
    bullets.some((b) => b.on && b.own === "e"),
    "and the flak opened up",
  );
});

test("back to the Countryside: its own sky and light", () => {
  pick("field");
  game.start("free");
  assert.equal(mapNow(), "field");
  assert.equal(land.tick, null);
  assert.ok(!$("flash").classList.contains("on"));
});
