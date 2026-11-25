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

// net-duel.test.js — a duel, with this machine as the host and the test as
// the guest: the lobby handshake, state both ways, the rules of who decides
// a hit, the towns, and the end of the match.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPort } from "./harness.js";
import { fakeServer, tick } from "./fake-server.js";

const game = await loadPort(11);
const { w, duel } = game;
const $ = (id) => w.document.getElementById(id);
const S = duel.S,
  P = duel.P;
const net = fakeServer(w, { role: "host" });
const HEX64 = /^[0-9a-f]{64}$/;
const RIVAL = "b".repeat(64); // the guest's player hash

test("hosting: a code, then the guest's hello gets the match on offer", async () => {
  $("bOnline").click();
  $("onHost").click();
  w.document.querySelector("[data-kind=duel]").click();
  w.document.querySelector("[data-mmode=classic]").click();
  $("onCreate").click();
  await tick(10);
  assert.match(net.opened[0], /\/host$/);
  assert.equal($("onCodeShow").textContent, "ABCD");
  assert.ok($("onStart").disabled, "nobody to play yet");
  net.server({ t: "peer" });
  assert.equal(
    $("onLink").textContent,
    "VIA SERVER",
    "no WebRTC here: relayed",
  );
  net.peer({ t: "hi", v: 2, h: RIVAL, n: "Red <b>Baron</b>" });
  const { h, ...setup } = net.toPeer("setup")[0];
  assert.deepEqual(setup, {
    t: "setup",
    v: 2,
    kind: "duel",
    mode: "classic",
    speed: 1,
    n: "Pilot",
  });
  assert.match(h, HEX64, "a hash, never the id itself");
  assert.ok(!$("onStart").disabled);
});

test("then the pair's group board: named by both, sent, and shown", () => {
  const [board] = net.toPeer("board");
  assert.match(board.g, HEX64);
  assert.deepEqual([board.duel, board.coop], [[], []]);
  assert.equal(duel.net.peer.n, "Red bBaronb", "a peer's name is cleaned");
  assert.ok(!$("onBoard").classList.contains("hidden"));
  assert.match($("onBoard").textContent, /No games together yet/);
  // A board for some other pair is not ours to merge.
  net.peer({ t: "board", g: "c".repeat(64), duel: [], coop: [] });
  assert.equal(w.localStorage.getItem("duelhippo.groups"), null);
});

test("START counts both down, then the duel begins at the home runway", async () => {
  $("onStart").click();
  assert.equal(net.toPeer("go").length, 1);
  assert.match(net.toPeer("go")[0].id, /^[0-9a-f]{16}$/, "a match id");
  await tick(3200);
  assert.equal(duel.state, "play");
  assert.equal(duel.net.kind, "duel");
  assert.equal(P.pos.x, -190);
  assert.deepEqual(
    duel.targets.map((t) => t.side),
    ["host", "host", "host", "host", "guest", "guest", "guest", "guest"],
  );
  assert.ok(!$("hRivalRow").classList.contains("hidden"));
  game.run(3000);
  assert.equal(
    duel.enemies.filter((e) => e.alive).length,
    0,
    "no AI in a duel",
  );
});

test("state goes out 20 times a second, and the rival is drawn from theirs", () => {
  net.clear();
  game.run(1000);
  const sent = net.toPeer("s").length;
  assert.ok(sent >= 18 && sent <= 22, `${sent} updates in a second`);
  for (let i = 0; i < 6; i++) {
    net.peer({
      t: "s",
      p: [2800 - i * 3, 100, 0],
      q: [0, 0, 0, 1],
      v: 60,
      h: 1,
      a: 1,
      g: 0,
      d: 0,
      sc: 50,
      k: 0,
      l: 3,
    });
    game.run(50);
  }
  game.run(200);
  assert.ok(duel.R.alive);
  assert.ok(Math.abs(duel.R.pos.y - 100) < 1, `rival at y ${duel.R.pos.y}`);
  assert.ok(duel.R.pos.x < 2800 && duel.R.pos.x > 2700);
  game.run(200);
  assert.equal($("hRival").textContent, "50");
});

test("the rival's rounds hurt this plane, and this machine says so", () => {
  const before = P.dmg;
  P.pos.set(500, 200, 0);
  P.grounded = false;
  for (let i = 0; i < 3; i++) {
    net.peer({ t: "f", o: [P.pos.x - 30, P.pos.y, 0], d: [1, 0, 0], s: 480 });
    game.run(100);
  }
  assert.ok(P.dmg > before, "damaged");
  assert.equal(P.hitBy, "r");
});

test("shot down by the rival: the crash credits them", () => {
  net.clear();
  P.dmg = 100;
  for (let i = 0; i < 300 && P.alive; i++) game.run(50);
  assert.ok(!P.alive);
  assert.equal(net.toPeer("down")[0].by, "you");
});

test("their crash at our hands scores here", () => {
  const k = S.kills,
    s = S.score;
  net.peer({ t: "down", p: [2600, 50, 0], by: "you" });
  assert.equal(S.kills, k + 1);
  assert.equal(S.score, s + 100);
});

test("buildings: theirs score when we hit them; ours fall when they say", () => {
  game.run(4000); // respawn
  const s = S.score;
  // The guest bombs our headquarters.
  net.peer({ t: "tg", i: 3, hp: -6 });
  assert.equal(duel.targets[3].alive, false);
  assert.equal(S.score, s, "our own building scores nothing here");
  // We bomb theirs: over their headquarters at x 2200.
  net.clear();
  Object.assign(P, { grounded: false, speed: 40, bombCd: 0, bombs: 6 });
  P.pos.set(2200, 30, 0);
  P.vel.set(0, 0, 0);
  game.press("KeyB");
  for (let i = 0; i < 100 && duel.targets[4].alive; i++) game.run(50);
  assert.equal(duel.targets[4].alive, false, "their HQ is down");
  assert.ok(
    net.toPeer("tg").some((m) => m.i === 4 && m.hp <= 0),
    "and we said so",
  );
  assert.equal(S.score, s + 250);
});

test("their last plane gone: we win, and the host may go again", () => {
  net.peer({ t: "out" });
  assert.equal(duel.state, "over");
  assert.equal($("oTitle").textContent, "You win!");
  assert.ok(!$("oAgain").classList.contains("hidden"));
  assert.ok($("overModes").classList.contains("hidden"));
  assert.ok($("oSolo").classList.contains("hidden"), "no one-player board");
});

test("the match goes on the pair's board once both final scores are in", () => {
  const [fin] = net.toPeer("fin");
  assert.deepEqual(fin, { t: "fin", sc: S.score });
  assert.ok($("oGroup").classList.contains("hidden"), "waiting for theirs");
  net.peer({ t: "fin", sc: 300 });
  assert.ok(!$("oGroup").classList.contains("hidden"));
  assert.match($("oGroup").textContent, /Your best duels/);
  const groups = JSON.parse(w.localStorage.getItem("duelhippo.groups"));
  const [board] = Object.values(groups);
  assert.equal(board.duel.length, 1);
  const [e] = board.duel;
  assert.equal(e.id, duel.net.match, "filed under the host's id");
  assert.equal(e.w, duel.net.me.h, "we won");
  const score = (h) => e.p.find((p) => p[0] === h)[2];
  assert.equal(score(duel.net.me.h), S.score);
  assert.equal(score(RIVAL), 300);
  // The same match again (their copy, say) is still one match.
  net.peer({ t: "fin", sc: 300 });
  assert.equal(
    JSON.parse(w.localStorage.getItem("duelhippo.groups"))[
      Object.keys(groups)[0]
    ].duel.length,
    1,
  );
});

test("leaving: a goodbye, then a one-player title screen", () => {
  net.clear();
  $("oLeave").click();
  assert.equal(net.toPeer("bye").length, 1);
  assert.equal(duel.net.on, false);
  assert.equal(duel.state, "title");
  assert.ok(!$("title").classList.contains("hidden"));
  assert.ok($("hRivalRow").classList.contains("hidden"));
  assert.equal(
    duel.targets.every((t) => t.side === undefined),
    true,
  );
});
