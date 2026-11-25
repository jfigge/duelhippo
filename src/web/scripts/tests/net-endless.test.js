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

// net-endless.test.js — Endless enemies from a player who joins (seat 2):
// the organiser's setup, this machine's own flyer, kills by seat, a ghost
// once the planes are gone, and the end when everyone is out.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPort } from "./harness.js";
import { fakeServer, tick, hash, state } from "./fake-server.js";

const game = await loadPort(12);
const { w, duel } = game;
const $ = (id) => w.document.getElementById(id);
const S = duel.S,
  P = duel.P;
const net = fakeServer(w, { seat: 2, peers: [0, 1] });

test("joining: a hello to each player already there", async () => {
  $("bOnline").click();
  // A test build has no server address; the fake server stands in for one.
  $("onHost").disabled = $("onJoin").disabled = false;
  $("onJoin").click();
  $("onCode").value = "abcd";
  $("onCode").dispatchEvent(new w.Event("input"));
  $("onGo").click();
  await tick(10);
  assert.match(net.opened[0], /\/join\/ABCD$/);
  assert.deepEqual(
    net.sent("hi", true).map((x) => x.to[0]),
    [0, 1],
  );
  assert.ok($("onStart").classList.contains("hidden"), "seat 0 organises");
});

test("the organiser's setup is ours; anyone else's is not", () => {
  net.from(0, { t: "hi", v: 3, h: hash("a"), n: "Ace" });
  net.from(1, { t: "hi", v: 3, h: hash("b"), n: "Bo" });
  const setup = {
    t: "setup",
    v: 3,
    layout: "3x1",
    mode: "endless",
    ff: false,
    speed: 1,
    roster: [
      [0, 0],
      [1, 1],
      [2, 2],
    ],
  };
  net.from(1, { ...setup, mode: "flag" });
  assert.doesNotMatch($("onDesc").textContent, /flag/i);
  net.from(0, setup);
  assert.match($("onDesc").textContent, /Endless enemies/);
  assert.equal($("onTeams").querySelectorAll(".team").length, 3);
  assert.ok($("onLayout").disabled, "only the organiser picks");
});

test("asking to change team goes to the organiser", () => {
  net.clear();
  $("onTeams").querySelectorAll(".team")[0].click();
  const [ask] = net.sent("team", true);
  assert.deepEqual(ask, { m: { t: "team", team: 0 }, to: [0] });
});

test("on the organiser's go: the match, and our own flyer a moment later", async () => {
  net.from(0, { t: "go", id: "0123456789abcdef" });
  await tick(3200);
  assert.equal(duel.state, "play");
  assert.equal(duel.targets.length, 8, "the magenta town, to bomb");
  assert.ok(duel.enemies.length >= 3, "one flyer per seat");
  game.run(3500);
  assert.ok(duel.enemies[2].alive, "ours, at our seat");
  assert.ok(!duel.enemies[0].alive && !duel.enemies[1].alive);
  net.clear();
  game.run(200);
  assert.equal(net.sent("s").at(-1).e.length, 7, "and its state goes out");
});

test("another player's flyer is drawn from their state, and our hits go to them", () => {
  const at = [P.pos.x + 80, P.pos.y + 0.6, P.pos.z];
  net.from(0, state([500, 200, 500], { e: [...at, 0, 0, 0, 1] }));
  game.run(50);
  assert.ok(duel.enemies[0].alive);
  net.clear();
  game.down("Space");
  for (let i = 0; i < 8; i++) {
    net.from(0, state([500, 200, 500], { e: [...at, 0, 0, 0, 1] }));
    game.run(50);
  }
  game.up("Space");
  assert.ok(
    net.sent("eh").some((m) => m.i === 0),
    "reported to its owner",
  );
});

test("a kill credited to our seat scores here; a false claim does nothing", () => {
  const s = S.score;
  net.from(1, { t: "ek", i: 0, by: 2 });
  assert.equal(S.score, s, "flyer 0 is seat 0's to call");
  net.from(0, { t: "ek", i: 0, by: 2 });
  assert.equal(S.score, s + 100);
  assert.ok(!duel.enemies[0].alive);
});

test("our flyer, hit by others: we decide, and say who got it", () => {
  net.clear();
  for (let i = 0; i < 3; i++) net.from(1, { t: "eh", i: 2 });
  assert.ok(!duel.enemies[2].alive);
  assert.deepEqual(net.sent("ek")[0], { t: "ek", i: 2, by: 1 });
});

test("out of planes: we fly on as a ghost, and say so", () => {
  net.clear();
  S.lives = 1;
  Object.assign(P, { grounded: false, speed: 60, dmg: 100 });
  P.pos.y = 150;
  for (let i = 0; i < 400 && P.alive; i++) game.run(50);
  game.run(3500);
  assert.equal(net.sent("out").length, 1);
  assert.ok(P.ghost);
  assert.ok(P.alive, "back on the runway");
  assert.equal(duel.state, "play");
});

test("a ghost is never hit, and cannot shoot", () => {
  const o = [P.pos.x - 40, P.pos.y, P.pos.z];
  net.from(0, { t: "ef", o, d: [1, 0, 0], s: 500 });
  game.run(300);
  assert.equal(P.dmg, 0);
  net.clear();
  game.down("Space");
  game.run(300);
  game.up("Space");
  assert.equal(net.sent("f").length, 0);
  game.run(200);
  assert.equal(net.sent("s").at(-1).gh, 1, "the others see a ghost");
});

test("everyone out: the scores are counted, and the most points wins", () => {
  net.from(0, state([500, 200, 500], { sc: 50 }));
  net.from(1, state([600, 200, 500], { sc: 0 }));
  net.from(0, { t: "out" });
  assert.equal(duel.state, "play", "Bo still has planes");
  net.clear();
  net.from(1, { t: "out" });
  assert.equal(duel.state, "over");
  assert.equal(net.sent("fin")[0].sc, S.score);
  assert.equal($("oTitle").textContent, "Counting the scores…");
  // Ace's last update was a kill behind: the final score decides.
  net.from(0, { t: "fin", sc: S.score + 50 });
  assert.equal($("oTitle").textContent, "Counting the scores…", "Bo's is due");
  net.from(1, { t: "fin", sc: 0 });
  assert.equal($("oTitle").textContent, "Cyan wins");
  assert.ok($("oAgain").classList.contains("hidden"), "the organiser restarts");
});
