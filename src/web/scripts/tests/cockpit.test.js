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

// cockpit.test.js — the third camera view: from the seat, over a dashboard
// for each plane type, with an arrow to the nearest enemy. Port only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPort } from "./harness.js";

const game = await loadPort(11);
const { w, duel } = game;
const P = duel.P;
const { game: G } = await import("../state.js");
const { LAYOUTS, cockpitOn, dash } = await import("../cockpit.js");
const { nearestFoe } = await import("../missiles.js");
const { enemies } = await import("../ai.js");
const { PLANES } = await import("../constants.js");
const body = w.document.body;

function fly() {
  game.poke((P) => {
    P.grounded = false;
    P.alive = true;
    P.pos.set(1400, 300, 0);
    P.q.identity();
    P.speed = 60;
    P.thr = 0.6;
  });
}
const panels = () => dash.scene.children.filter((o) => o.isGroup);

test("C steps chase, hood, cockpit in Free flight; near and far in Classic", () => {
  game.start("free");
  const seen = [];
  for (let i = 0; i < 4; i++) {
    seen.push(G.camZoom);
    game.press("KeyC");
  }
  assert.deepEqual(seen, [0, 1, 2, 0]);
  game.start("classic");
  for (let i = 0; i < 3; i++) {
    seen.push(G.camZoom);
    game.press("KeyC");
  }
  assert.deepEqual(seen.slice(4), [0, 1, 0]);
});

test("in the cockpit the plane is seen from its seat, and the HUD's gauges go", () => {
  game.start("free");
  fly();
  game.press("KeyC");
  game.press("KeyC");
  game.run(50);
  assert.ok(cockpitOn());
  assert.ok(P.obj.visible, "the wings and propeller in view");
  const [x, y, z] = LAYOUTS[0].eye;
  const want = P.pos
    .clone()
    .add(new P.pos.constructor(x, y, z).applyQuaternion(P.q));
  assert.ok(duel.camera.position.distanceTo(want) < 1e-6, "at the Kite's seat");
  assert.ok(body.classList.contains("cockpit"));
  assert.equal(panels().filter((g) => g.visible).length, 1);
  // Back to the chase: the panel and the class go.
  game.press("KeyC");
  game.run(50);
  assert.ok(!cockpitOn());
  assert.ok(!body.classList.contains("cockpit"));
  assert.equal(panels().filter((g) => g.visible).length, 0);
});

test("each plane type has its own seat and dashboard", () => {
  assert.equal(LAYOUTS.length, PLANES.length);
  assert.equal(new Set(LAYOUTS.map((l) => l.style)).size, PLANES.length);
  assert.equal(
    new Set(LAYOUTS.map((l) => l.thr.kind + l.thr.x)).size,
    PLANES.length,
  );
  game.start("free");
  G.camZoom = 2;
  const seen = new Set();
  for (let k = 0; k < PLANES.length; k++) {
    game.press(`Digit${k + 1}`); // on the runway, stopped: a new plane
    assert.equal(P.kind, k);
    fly();
    game.run(50);
    const [, y] = LAYOUTS[k].eye;
    const up = duel.camera.position.y - P.pos.y;
    assert.ok(Math.abs(up - y) < 1e-6, `${PLANES[k].name} seat ${up}`);
    const shown = panels().filter((g) => g.visible);
    assert.equal(shown.length, 1);
    seen.add(shown[0]);
    game.start("free");
    G.camZoom = 2;
  }
  assert.equal(seen.size, PLANES.length, "a dashboard each");
});

test("the throttle on the panel moves with the player's", () => {
  game.start("free");
  G.camZoom = 2;
  fly();
  game.run(50);
  const panel = panels().find((g) => g.visible);
  const pose = () =>
    JSON.stringify(
      panel.children.map((o) => [
        o.rotation.x.toFixed(3),
        o.position.z.toFixed(3),
      ]),
    );
  const at = pose();
  game.poke((P) => (P.thr = 0.1));
  game.run(50);
  assert.notEqual(pose(), at);
});

test("down the sights, the sights' view wins over the cockpit", () => {
  game.start("free");
  G.camZoom = 2;
  fly();
  game.down("ShiftLeft");
  game.run(100);
  assert.ok(!cockpitOn());
  assert.ok(!P.obj.visible);
  game.up("ShiftLeft");
  game.run(100);
  assert.ok(cockpitOn());
});

test("the enemy indicator points at the nearest flyer that is alive", () => {
  game.start("free");
  fly();
  for (const e of enemies) e.alive = false;
  assert.equal(nearestFoe().foe, null);
  const [a, b] = enemies;
  a.alive = b.alive = true;
  a.pos.set(1400, 300, -900);
  b.pos.set(1400, 300, 400);
  const n = nearestFoe();
  assert.equal(n.foe, b);
  assert.ok(Math.abs(n.dist - 400) < 1e-9);
  b.alive = false;
  assert.equal(nearestFoe().foe, a);
});
