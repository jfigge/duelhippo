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
import { loadPort, FRAME_MS } from "./harness.js";

const game = await loadPort(4);
const { w, duel } = game;
const P = duel.P;
const $ = (id) => w.document.getElementById(id);
duel.S.best = 1e6;
(await import("../game.js")).showMaps();
const { land, targets, fields, buildFields, clearFields, hurtTarget } =
  await import("../world.js");
const { mapNow, useMap, flakAt } = await import("../maps.js");
const { TEAM } = await import("../net/teams.js");
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

test("the Storm: gusts of wind blow the plane sideways, and say from where", () => {
  pick("storm");
  game.start("free");
  cruise(1400, 300, 1500);
  // How far the plane moves that its own velocity does not explain, frame
  // by frame: the wind's doing.
  const dt = FRAME_MS / 1000;
  let blown = 0,
    warned = false;
  for (let i = 0; i < 30 / dt; i++) {
    const was = P.pos.clone();
    game.run(FRAME_MS);
    const by = P.pos.clone().sub(was).addScaledVector(P.vel, -dt);
    blown += Math.hypot(by.x, by.z);
    game.poke((P) => (P.dmg = 0));
    warned ||= /Gust (from the (left|right)|from behind|head-on)/.test(
      $("msg").textContent,
    );
  }
  assert.ok(warned, "a gust was called out");
  assert.ok(blown > 8, `blown ${blown.toFixed(1)} m sideways in 30 s`);
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

// A town's lit windows: a building's own, and whether they glow.
const windows = (t) => t.g.userData.lit ?? [];
const glows = (m) => m.material.emissive.getHex() !== 0;

test("the Night raid on the title: the town's windows lit at once", () => {
  useMap("storm");
  useMap("night"); // as the title shows it, no game begun
  const town = targets.filter((t) => t.kind !== "flag");
  assert.ok(town.length > 0);
  for (const t of town) {
    assert.equal(windows(t).length, 6, t.name);
    assert.ok(windows(t).every(glows));
  }
});

test("the Night raid: a wreck goes dark, and only its own windows", () => {
  game.start("free");
  const [a, ...rest] = targets;
  const lamp = windows(rest[0])[0].material,
    colour = lamp.color.getHex();
  hurtTarget(a, 1000, a.g.position.clone());
  assert.equal(a.alive, false);
  game.run(100);
  assert.equal(windows(a).length, 0, "its windows gone");
  for (const t of rest) assert.ok(windows(t).length && windows(t).every(glows));
  assert.equal(lamp.color.getHex(), colour, "the others' lamp as it was");
});

test("the Night raid: every team's runway lights glow, in its own colour", () => {
  buildFields(5);
  game.start("free");
  game.run(100);
  for (const f of fields) {
    const edge = TEAM[f.team % TEAM.length].plane[2],
      lights = [];
    f.g.traverse((o) => {
      if (o.isMesh && o.material.color.getHex() === edge) lights.push(o);
    });
    assert.ok(lights.length > 10, `team ${f.team}: ${lights.length} lights`);
    for (const o of lights)
      assert.equal(o.material.emissive.getHex(), edge, `team ${f.team}`);
  }
  clearFields();
});

test("the Night raid's flak, unlike the Canyon's, hits as hard as a plane's", () => {
  pick("night");
  game.start("free");
  cruise(1400, 300, 0);
  game.poke((P) => P.vel.set(0, 0, 0));
  const from = P.pos.clone().set(1400, 300, 120);
  assert.equal(flakAt(from, 600, 0), true);
  for (let i = 0; i < 30 && !P.dmg; i++) {
    game.poke((P) => P.pos.set(1400, 300, 0));
    game.run(FRAME_MS);
  }
  assert.equal(P.dmg, P.pt.armour);
});

test("the Night raid lights every plane, port red and starboard green", async () => {
  const { NAV, makePlane } = await import("../world.js");
  const { enemies } = await import("../ai.js");
  const { addRemote, dropRemote } = await import("../remote.js");
  const lit = () => NAV.port.lamp.visible && NAV.star.glow.visible;
  pick("field");
  game.start("free");
  assert.ok(!lit(), "not on the Countryside");
  pick("night");
  game.start("free");
  assert.ok(lit());
  const navs = (o) => {
    const n = [];
    o.traverse((c) => c.userData.nav && c.isMesh && n.push(c));
    return n;
  };
  for (const plane of [P.obj, enemies[0].obj, makePlane(1, 2, 3, 4, 3)]) {
    const [port, star] = navs(plane);
    assert.ok(port.position.x < 0 && port.material === NAV.port.lamp);
    assert.ok(star.position.x > 0 && star.material === NAV.star.lamp);
  }
  // A player's plane put away keeps the shared lights for everyone else.
  let freed = false;
  NAV.port.lamp.addEventListener("dispose", () => (freed = true));
  const r = addRemote(5, 1);
  assert.equal(navs(r.obj).length, 2);
  dropRemote(5);
  assert.ok(!freed, "the shared lamp is not disposed");
  pick("field");
  game.start("free");
  assert.ok(!lit(), "off again");
});

test("flak fires only at a plane its rounds can reach", () => {
  game.start("free");
  // A round flies 1.4 s at 480 m/s (weapons.js): 672 m.
  const from = P.pos.clone().set(1400, 4, 0);
  cruise(1400, 4 + 700, 0);
  assert.equal(flakAt(from, 1100), false, "700 m up: out of reach");
  cruise(1400, 4 + 600, 0);
  game.poke((P) => P.vel.set(60, 0, 0));
  assert.equal(flakAt(from, 1100), true, "600 m up: in reach");
  // Climbing away, it will be past reach where the round must meet it.
  game.poke((P) => P.vel.set(0, 60, 0));
  assert.equal(flakAt(from, 1100), false, "600 m up, climbing away");
});

test("back to the Countryside: its own sky and light", () => {
  pick("field");
  game.start("free");
  assert.equal(mapNow(), "field");
  assert.equal(land.tick, null);
  assert.ok(!$("flash").classList.contains("on"));
});
