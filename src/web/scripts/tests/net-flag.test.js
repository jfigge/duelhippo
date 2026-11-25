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

// net-flag.test.js — Bomb the flag from seat 1 of two: flags at every field,
// damage that adds up whoever deals it, our own flag safe from us with
// friendly fire off, and both ways a match can end.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPort } from "./harness.js";
import { fakeServer, tick, hash } from "./fake-server.js";

const game = await loadPort(13);
const { w, duel } = game;
const $ = (id) => w.document.getElementById(id);
const S = duel.S,
  P = duel.P;
const net = fakeServer(w, { seat: 1, peers: [0] });
const flag = (team) =>
  duel.targets.find((t) => t.kind === "flag" && t.side === team);

async function play(id) {
  net.from(0, { t: "go", id });
  await tick(3200);
  assert.equal(duel.state, "play");
}

// Over a flag, then a bomb, and time for it to land.
function bomb(t) {
  Object.assign(P, { grounded: false, speed: 40, bombCd: 0, bombs: 6, dmg: 0 });
  P.pos.set(t.x, 30, t.z);
  P.vel.set(0, 0, 0);
  game.press("KeyB");
  for (let i = 0; i < 60; i++) {
    P.pos.set(t.x, 30, t.z); // hold station: we are not testing flying
    game.run(50);
  }
}

test("a flag game: one flag per team, beside its field", async () => {
  $("bOnline").click();
  $("onHost").disabled = $("onJoin").disabled = false;
  $("onJoin").click();
  $("onCode").value = "ABCD";
  $("onGo").click();
  await tick(10);
  net.from(0, { t: "hi", v: 3, h: hash("a"), n: "Ace" });
  net.from(0, {
    t: "setup",
    v: 3,
    layout: "2x1",
    mode: "flag",
    ff: false,
    speed: 1,
    roster: [
      [0, 0],
      [1, 1],
    ],
  });
  await play("aaaaaaaaaaaaaaaa");
  assert.equal(duel.targets.length, 2);
  for (const t of [0, 1]) {
    const f = duel.fields[t];
    assert.ok(Math.hypot(flag(t).x - f.x, flag(t).z - f.z) < 120);
  }
  game.run(100);
  assert.equal($("hLives").textContent, "∞", "planes without end");
});

test("our own flag is safe from our bombs with friendly fire off", () => {
  net.clear();
  bomb(flag(1));
  assert.equal(flag(1).hp, 36);
  assert.equal(net.sent("tg").length, 0);
});

test("damage to a flag adds up, whoever deals it", () => {
  net.from(0, { t: "tg", i: duel.targets.indexOf(flag(1)), d: 12 });
  assert.equal(flag(1).hp, 24);
  assert.ok(flag(1).alive);
});

test("three bombs on theirs: the flag falls, their team is out, we win", () => {
  net.clear();
  const s = S.score;
  for (let i = 0; i < 3 && flag(0).alive; i++) bomb(flag(0));
  assert.ok(!flag(0).alive);
  assert.ok(
    net.sent("tg").every((m) => m.d > 0),
    "sent as amounts",
  );
  assert.equal(S.score, s + 500);
  assert.equal(duel.state, "over");
  assert.equal($("oTitle").textContent, "You win!");
});

test("a rematch, and this time our flag falls: we are out at once", async () => {
  await play("bbbbbbbbbbbbbbbb");
  assert.ok(flag(0).alive && flag(1).alive, "fresh flags");
  game.run(500);
  const i = duel.targets.indexOf(flag(1));
  for (let k = 0; k < 3; k++) net.from(0, { t: "tg", i, d: 12 });
  assert.ok(!P.alive, "our plane goes with it");
  assert.equal(duel.state, "over");
  assert.equal($("oTitle").textContent, "Cyan wins");
});
