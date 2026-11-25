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

// net-coop.test.js — co-op, with this machine as the guest and the test as
// the host: joining by code, the host's speed, the host's AI flyers, and the
// host leaving.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPort } from "./harness.js";
import { fakeServer, tick } from "./fake-server.js";

const game = await loadPort(12);
const { w, duel } = game;
const $ = (id) => w.document.getElementById(id);
const S = duel.S,
  P = duel.P;
const net = fakeServer(w, { role: "guest" });
const HOST = "a".repeat(64); // the host's player hash
const ownSpeed = () => +$("bSpeed").textContent.match(/\d+/)[0];

test("joining by code: lower case is fine, and hello goes to the host", async () => {
  $("bOnline").click();
  $("onJoin").click();
  $("onCode").value = "abcd";
  $("onCode").dispatchEvent(new w.Event("input"));
  $("onGo").click();
  await tick(10);
  assert.match(net.opened[0], /\/join\/ABCD$/);
  const { h, ...hi } = net.toPeer("hi")[0];
  assert.deepEqual(hi, { t: "hi", v: 2, n: "Pilot" });
  assert.match(h, /^[0-9a-f]{64}$/);
});

test("the host's match, at the host's speed, starts on its go", async () => {
  net.peer({
    t: "setup",
    v: 2,
    kind: "coop",
    mode: "classic",
    speed: 0.5,
    h: HOST,
    n: "Goose",
  });
  assert.equal(net.toPeer("board").length, 1, "our copy of the pair's board");
  assert.match($("onMsg").textContent, /Co-op · Classic · 50% speed/);
  net.peer({ t: "go", id: "0123456789abcdef" });
  await tick(3200);
  assert.equal(duel.state, "play");
  assert.equal(duel.net.role, "guest");
  assert.equal(P.pos.x, -120, "lined up ahead of the host");
  assert.equal($("hRivalLabel").textContent, "WINGMAN");
  assert.equal(ownSpeed(), 50);
});

test("the guest flies no flyers of its own; it draws the host's", () => {
  game.run(6000);
  assert.equal(duel.enemies.filter((e) => e.alive).length, 0);
  const q = [0, -0.7071, 0, 0.7071];
  for (let i = 0; i < 4; i++) {
    net.peer({
      t: "s",
      p: [0, 2, 0],
      q: [0, 0, 0, 1],
      v: 0,
      h: 0,
      a: 1,
      g: 1,
      d: 0,
      sc: 0,
      k: 0,
      l: 3,
      e: [[2, 2600 - i * 3, 250, 0, ...q]],
    });
    game.run(50);
  }
  const e = duel.enemies[2];
  assert.ok(e.alive && e.obj.visible);
  assert.ok(Math.abs(e.pos.y - 250) < 1);
});

test("a kill the host credits to us scores here", () => {
  const s = S.score;
  net.peer({ t: "ek", i: 2, by: "guest" });
  assert.equal(duel.enemies[2].alive, false);
  assert.equal(S.score, s + 100);
  assert.equal(S.kills, 1);
});

test("the host's flyers' rounds can hit us; our wingman's cannot", () => {
  P.pos.set(800, 200, 0);
  P.grounded = false;
  P.dmg = 0;
  net.peer({ t: "f", o: [P.pos.x - 30, 200, 0], d: [1, 0, 0], s: 480 });
  game.run(150);
  assert.equal(P.dmg, 0, "friendly fire is off");
  net.peer({ t: "ef", o: [P.pos.x - 30, P.pos.y, 0], d: [1, 0, 0], s: 480 });
  game.run(150);
  assert.ok(P.dmg > 0);
});

test("the host leaving ends the match, and the speed is ours again", () => {
  net.server({ t: "left" });
  assert.equal(duel.state, "over");
  assert.equal($("oTitle").textContent, "Your friend left");
  assert.ok($("oAgain").classList.contains("hidden"));
  $("oLeave").click();
  assert.equal(duel.net.on, false);
  assert.equal(ownSpeed(), 100);
});
