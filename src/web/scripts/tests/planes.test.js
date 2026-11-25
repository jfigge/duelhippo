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

// planes.test.js — the plane types: the Kite is the prototype's plane, the
// others fly to their own numbers, and a plane is changed only stopped on
// the home runway. Port only; the prototype has one plane.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { loadPort } from "./harness.js";
import { PLANES, PLANE_KEY, STALL, THR, DRAG, GEAR } from "../constants.js";

const game = await loadPort(5);
const { w, duel } = game;
const P = duel.P;
const $ = (id) => w.document.getElementById(id);
const { fire } = await import("../weapons.js");
const msg = () => $("msg").textContent;
// The corner tag naming a plane just picked, while it shows.
const tag = () =>
  $("planeTag").classList.contains("on") ? $("planeTag").textContent : "";

// A fresh game, stopped on the home runway, in plane type `kind`.
function onRunway(mode, kind) {
  game.start(mode);
  game.run(100);
  if (kind !== P.kind) game.press("Digit" + (kind + 1));
  assert.equal(P.kind, kind);
}

// Airborne, level and pointing along -Z, high over the middle of the map.
function cruise(speed, thr) {
  game.poke((P) => {
    P.grounded = false;
    P.pos.set(1400, 500, 2500);
    P.q.identity();
    P.speed = speed;
    P.thr = thr;
    P.sink = 0;
  });
}

test("the Kite is the prototype's plane, and the default", () => {
  const k = PLANES[0];
  assert.equal(k.stall, STALL);
  assert.equal(k.thr, THR);
  assert.equal(k.drag, DRAG, "the same drag, to the last bit");
  assert.deepEqual(
    [k.pitch, k.roll, k.yaw, k.bank, k.cpitch],
    [1.25, 2.3, 0.55, 1.05, 1.5],
  );
  assert.deepEqual([k.sink, k.bankLand, k.along], [6.5, 0.26, 0.35]);
  assert.deepEqual(
    [k.burn, k.ammo, k.bombs, k.cadence, k.muzzle, k.armour],
    [0.42, 300, 6, 0.075, 420, 6],
  );
  assert.equal(k.missiles, 0);
  assert.equal(k.torque, 0);
  assert.equal(k.snap, null);
  game.start("free");
  assert.equal(P.kind, 0);
  assert.equal(P.pt, k);
});

test("planes change only stopped on your own runway", () => {
  onRunway("free", 0);
  game.run(200);
  assert.ok(!$("planes").classList.contains("hidden"), "the picker is up");
  const kite = P.obj;
  game.press("Digit2");
  assert.equal(P.pt.name, "Hornet");
  assert.notEqual(P.obj, kite, "and looks it");
  game.run(200);
  assert.equal($("hPlane").textContent, "Hornet");
  assert.match(tag(), /Hornet.*Turn fighter/, "named in the corner");
  // Rolling: no more changes.
  game.down("KeyW");
  game.run(1500);
  game.up("KeyW");
  game.press("Digit3");
  assert.equal(P.kind, 1);
  assert.match(msg(), /Stop on your own runway/);
  game.run(200);
  assert.ok($("planes").classList.contains("hidden"));
  // Airborne: none either.
  cruise(60, 0.5);
  game.press("Digit4");
  assert.equal(P.kind, 1);
});

test("< and >, the arrows and a swipe step round the planes", () => {
  onRunway("free", 0);
  game.press("Period"); // >
  assert.equal(P.kind, 1);
  assert.match(tag(), /Hornet/);
  game.press("Comma"); // <
  game.press("Comma");
  assert.equal(P.kind, 3, "round from the Kite to the Brute");
  $("pNext").click();
  assert.equal(P.kind, 0, "and back round");
  // The tag shows for three seconds.
  game.run(2500);
  assert.match(tag(), /Kite/);
  game.run(1000);
  assert.equal(tag(), "");
  // A swipe: left for the previous, right for the next.
  const swipe = (dx) => {
    const at = (type, x) =>
      w.document.getElementById("view").dispatchEvent(
        new w.PointerEvent(type, {
          bubbles: true,
          pointerId: 7,
          pointerType: "touch",
          clientX: x,
          clientY: 300,
        }),
      );
    at("pointerdown", 400);
    at("pointerup", 400 + dx);
  };
  swipe(120);
  assert.equal(P.kind, 1);
  swipe(-120);
  swipe(-120);
  assert.equal(P.kind, 3);
  swipe(20); // too short to be a swipe
  assert.equal(P.kind, 3);
  // Airborne, a swipe does nothing and says nothing.
  cruise(60, 0.5);
  $("msg").textContent = "";
  swipe(120);
  assert.equal(P.kind, 3);
  assert.equal(msg(), "");
});

test("a change refills nothing, and is remembered", () => {
  onRunway("free", 0);
  P.ammo = 150;
  P.bombs = 3;
  game.press("Digit4"); // the Brute: 400 rounds, 12 bombs, 2 missiles
  assert.equal(P.ammo, 200, "half the Kite's is half the Brute's");
  assert.equal(P.bombs, 6);
  assert.equal(P.msl, 0, "the Kite had none to carry over");
  assert.equal(w.localStorage.getItem(PLANE_KEY), "3");
  game.run(8000); // service tops it all up
  assert.equal(Math.floor(P.ammo), 400);
  assert.equal(P.bombs, 12);
  assert.equal(P.msl, 2);
  // A new plane after a crash, and a new game, are the same type.
  game.poke((P) => {
    P.dmg = 100;
    P.grounded = false;
    P.pos.y = 60;
  });
  for (let i = 0; i < 200 && P.alive; i++) game.run(50);
  game.run(3500);
  assert.ok(P.alive);
  assert.equal(P.kind, 3);
  game.start("classic");
  assert.equal(P.kind, 3);
  assert.equal(P.ammo, 400);
});

test("each plane's top speed is its own", () => {
  const top = {};
  for (const kind of [0, 2, 3]) {
    onRunway("free", kind);
    cruise(60, 1);
    game.down("KeyW");
    game.run(40000);
    game.up("KeyW");
    top[kind] = P.speed;
  }
  assert.ok(Math.abs(top[0] - 88) < 1, `Kite ${top[0]}`);
  assert.ok(Math.abs(top[2] - 108) < 1.5, `Lancer ${top[2]}`);
  assert.ok(Math.abs(top[3] - 78) < 1, `Brute ${top[3]}`);
});

// Just above the home runway, level, sinking at `sink` m/s.
function touchdown(kind, sink) {
  onRunway("classic", kind);
  game.poke((P) => {
    P.grounded = false;
    P.th = P.ph = P.phT = 0;
    P.pos.set(-100, GEAR + 0.05, 0);
    P.speed = 45;
    P.thr = 0;
    P.sink = sink;
  });
  game.run(300);
}

test("the Lancer lands on a knife edge", () => {
  touchdown(0, 5.5);
  assert.ok(P.alive && P.grounded, "the Kite takes 5.5 m/s");
  touchdown(2, 5.5);
  assert.ok(!P.alive, "the Lancer does not");
  assert.match(msg(), /sink under 4 m\/s/);
  touchdown(2, 3.5);
  assert.ok(P.alive && P.grounded, "but lands gently");
});

test("a round does the damage the plane is built to take", () => {
  for (const [kind, want] of [
    [0, 6],
    [3, 4],
    [1, 8],
  ]) {
    onRunway("free", kind);
    P.dmg = 0;
    P.thr = 0.15; // not idle, so no repairs while the round flies
    const o = new Vector3(P.pos.x - 40, P.pos.y, P.pos.z);
    fire(o, new Vector3(1, 0, 0), 500, "e");
    game.run(200);
    assert.equal(P.dmg, want, P.pt.name);
  }
});
