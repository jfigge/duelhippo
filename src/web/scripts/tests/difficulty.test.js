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

// difficulty.test.js — how hard the enemy is, 1 to 5 (constants.js
// DIFFICULTY): level 4 is the prototype's, a new player starts on 2, and
// below 4 the enemy planes are fewer, slower to turn, shorter-ranged and
// wilder, and the flak scatters more. In a team game the organiser picks.
// Port only (the equivalence suites fly level 4: harness.js loadPort).

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPort, FRAME_MS } from "./harness.js";
import { fakeServer, tick, hash } from "./fake-server.js";

const game = await loadPort(29, { level: null }); // a new player
const { w, duel } = game;
const P = duel.P;
const $ = (id) => w.document.getElementById(id);
const { DIFFICULTY, DEFAULT_LEVEL, DIFFICULTY_KEY } =
  await import("../constants.js");
const { game: G, opt } = await import("../state.js");
const { enemies } = await import("../ai.js");
const { bullets } = await import("../weapons.js");
const { flakAt } = await import("../maps.js");
const { PROTO } = await import("../net/protocol.js");
const msg = () => $("msg").textContent;

// Steps the Settings button until the level is `n`.
function setLevel(n) {
  for (let i = 0; i < 5 && opt.difficulty !== n; i++) $("bLevel").click();
  assert.equal(opt.difficulty, n);
}

test("a new player starts on level 2, and the buttons step 1 to 5", () => {
  assert.equal(DEFAULT_LEVEL, 2);
  assert.equal(opt.difficulty, 2);
  assert.match($("bLevel").textContent, /Difficulty\s*2 Easy/);
  const seen = [];
  for (let i = 0; i < 5; i++) {
    $("bLevel").click();
    seen.push(opt.difficulty);
  }
  assert.deepEqual(seen, [3, 4, 5, 1, 2]);
  $("bLevelPause").click();
  assert.equal(w.localStorage.getItem(DIFFICULTY_KEY), "3");
  assert.match($("bLevelPause").textContent, /3 Fair/);
  assert.match($("bLevel").textContent, /3 Fair/);
});

test("level 4 is the prototype's numbers, and each level is harder than the last", () => {
  assert.deepEqual(DIFFICULTY[4], {
    turn: 1,
    range: 420,
    cone: 0.982,
    spread: 0.025,
    rest: 1.3,
    lead: 1,
    more: 0,
    flak: 1,
    pace: 1,
  });
  for (let n = 2; n <= 5; n++) {
    const a = DIFFICULTY[n - 1],
      b = DIFFICULTY[n];
    assert.ok(b.turn > a.turn && b.range > a.range, `${n}: turns, reaches`);
    assert.ok(b.cone < a.cone && b.spread < a.spread, `${n}: aims`);
    assert.ok(b.rest < a.rest && b.lead >= a.lead && b.more >= a.more, `${n}`);
    assert.ok(b.flak < a.flak && b.pace < a.pace, `${n}: flak`);
  }
});

// A flyer `d` m dead ahead of a still player, nose on them: how many rounds
// it fires in 0.6 s.
function shotsFrom(d) {
  game.start("free");
  for (const e of enemies) e.alive = false;
  const e = enemies[0];
  Object.assign(e, { alive: true, hp: 3, cd: 0, burst: 0, speed: 58 });
  e.obj.visible = true;
  const still = () =>
    game.poke((P) => {
      P.grounded = false;
      P.alive = true;
      P.dmg = 0;
      P.pos.set(1400, 400, 0);
      P.vel.set(0, 0, 0);
      P.speed = 0.1;
      e.pos.set(1400, 400, -d);
      e.q.identity().setFromAxisAngle(P.pos.clone().set(0, 1, 0), Math.PI);
    });
  let shots = 0;
  for (let t = 0; t < 600; t += FRAME_MS) {
    still();
    const before = new Set(bullets.filter((b) => b.on && b.own === "e"));
    game.run(FRAME_MS);
    for (const b of bullets)
      if (b.on && b.own === "e" && !before.has(b)) shots++;
  }
  return shots;
}

test("the enemy opens fire nearer on an easier level", () => {
  setLevel(4);
  assert.ok(shotsFrom(380) > 0, "level 4 fires at 380 m");
  setLevel(2);
  assert.equal(shotsFrom(380), 0, "level 2 holds fire at 380 m");
  assert.ok(shotsFrom(250) > 0, "and fires at 250 m");
});

test("fewer enemy planes at once on an easier level", () => {
  const most = (n) => {
    setLevel(n);
    game.start("free");
    let up = 0;
    for (let t = 0; t < 30000; t += 500) {
      game.poke((P) => {
        P.grounded = true; // on the runway: they patrol, and nobody is hurt
        P.dmg = 0;
      });
      game.run(500);
      up = Math.max(up, enemies.filter((e) => e.alive).length);
    }
    return up;
  };
  assert.equal(most(4), 2, "the prototype's two to start");
  assert.equal(most(2), 1);
});

test("the flak scatters wider on an easier level", () => {
  const scatter = (n) => {
    setLevel(n);
    game.start("free");
    game.poke((P) => {
      P.grounded = false;
      P.alive = true;
      P.pos.set(1400, 400, 0);
      P.vel.set(0, 0, 0);
    });
    const from = P.pos.clone().setY(100);
    let off = 0;
    for (let i = 0; i < 40; i++) {
      for (const b of bullets) b.on = false;
      assert.ok(flakAt(from, 600, 0.03));
      const b = bullets.find((b) => b.on);
      off += b.v
        .clone()
        .normalize()
        .angleTo(P.pos.clone().sub(from).normalize());
    }
    return off / 40;
  };
  assert.ok(scatter(1) > 2 * scatter(4));
});

test("a team game flies the organiser's level, and the buttons leave it be", async () => {
  setLevel(1);
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
  assert.equal(lastSetup().difficulty, 1, "the organiser's own, to start");
  $("onLevel").click();
  assert.equal(lastSetup().difficulty, 2);
  assert.match($("onDesc").textContent, /Level 2/);
  $("onStart").click();
  await tick(3200);
  assert.equal(duel.state, "play");
  assert.equal(G.level, 2);
  $("bLevelPause").click();
  assert.equal(G.level, 2);
  assert.match(msg(), /organiser sets the difficulty/);
  $("quit").click();
  await tick(10);
  assert.equal(G.level, 1, "the player's own again");
});
