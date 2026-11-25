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
// net-rules.test.js — the lobby's and the match's rules where machines could
// disagree or be pushed about: one connection per player, the organiser by
// arrival, versions and maps that differ, newcomers mid-match, a result
// settled from everyone's fins, Play again only while a match can be made,
// and our own connection lost mid-match.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPort } from "./harness.js";
import { PROTO } from "../net/protocol.js";
import { fakeServer, tick, hash, state } from "./fake-server.js";

const game = await loadPort(14);
const { w, duel } = game;
const $ = (id) => w.document.getElementById(id);
const S = duel.S,
  P = duel.P;
const lobby = await import("../net/lobby.js");
const hidden = (id) => $(id).classList.contains("hidden");
let net;

const setup = (extra = {}) => ({
  t: "setup",
  v: PROTO,
  layout: "2x1",
  mode: "dogfight",
  map: "field",
  ff: false,
  speed: 1,
  roster: [
    [0, 0],
    [1, 1],
  ],
  ...extra,
});

async function join(seat, peers) {
  net = fakeServer(w, { seat, peers });
  $("bOnline").click();
  $("onHost").disabled = $("onJoin").disabled = false;
  $("onJoin").click();
  $("onCode").value = "ABCD";
  $("onGo").click();
  await tick(10);
}

async function host() {
  net = fakeServer(w, { seat: 0 });
  $("bOnline").click();
  $("onHost").disabled = $("onJoin").disabled = false;
  $("onHost").click();
  await tick(10);
}

const hello = (seat, c, n) => {
  net.server({ t: "peer", seat });
  net.from(seat, { t: "hi", v: PROTO, h: hash(c), n });
};

async function start() {
  net.clear();
  $("onStart").click();
  await tick(3200);
  assert.equal(duel.state, "play");
}

test("a double click opens one connection, not two seats", async () => {
  net = fakeServer(w, { seat: 1, peers: [2, 0] });
  $("bOnline").click();
  $("onHost").disabled = $("onJoin").disabled = false;
  $("onJoin").click();
  $("onCode").value = "ABCD";
  $("onGo").click();
  $("onGo").click();
  $("onCode").dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter" }));
  await tick(10);
  assert.equal(net.opened.length, 1);
  assert.ok(!hidden("onRoom"));
});

test("the organiser is whoever came first, not the lowest seat", () => {
  net.from(2, { t: "hi", v: PROTO, h: hash("c"), n: "Cy" });
  net.from(0, { t: "hi", v: PROTO, h: hash("a"), n: "Ace" });
  const roster = [
    [2, 0],
    [0, 1],
    [1, 1],
  ];
  net.from(0, setup({ mode: "flag", roster }));
  assert.doesNotMatch($("onDesc").textContent, /flag/i, "seat 0 came second");
  net.from(2, setup({ mode: "endless", roster }));
  assert.match($("onDesc").textContent, /Endless/);
  // Only the organiser may send anyone away.
  net.from(0, { t: "bad", text: "Go away" });
  assert.ok(!hidden("onRoom"), "still here");
  // The organiser leaves: the next to have come takes over. Its first setup
  // can beat the server's news of the leaving here; it still counts.
  net.from(0, setup({ mode: "flag" }));
  assert.match($("onDesc").textContent, /Endless/);
  net.server({ t: "left", seat: 2 });
  assert.match($("onDesc").textContent, /flag/i);
});

test("a map this build lacks is refused: update to play", () => {
  net.from(0, setup({ map: "atlantis" }));
  assert.match($("onMsg").textContent, /Update to play/);
  assert.ok(!hidden("onMenu"));
  assert.equal(net.ws.readyState, 3, "out of the room");
});

test("a newcomer that finds the room on another version leaves on its own", async () => {
  await join(1, [0]);
  net.clear();
  net.from(0, { t: "hi", v: PROTO + 1, h: hash("a"), n: "Ace" });
  assert.match($("onMsg").textContent, /different version.*Update to play/);
  assert.equal(net.ws.readyState, 3);
  assert.equal(net.sent("bad").length, 0, "and sends nobody away");
});

test("a newcomer in the countdown is turned away, not put in the match", async () => {
  await host();
  hello(1, "b", "Bo");
  assert.equal(net.sent("bq").length, 1, "the group's boards asked for");
  net.clear();
  $("onStart").click();
  hello(2, "c", "Cy");
  assert.deepEqual(net.sent("bad", true)[0].to, [2]);
  await tick(3200);
  assert.equal(duel.state, "play");
  assert.ok(
    net.sent("setup").every((m) => m.roster.every(([seat]) => seat !== 2)),
    "no roster with them in it went out",
  );
  assert.deepEqual([...duel.net.roster.keys()], [0, 1]);
  net.server({ t: "left", seat: 2 });
  game.run(100);
  assert.doesNotMatch($("msg").textContent, /left the match/);
  assert.equal(duel.state, "play");
});

test("both last planes down together: a draw on every machine", () => {
  S.lives = 1;
  Object.assign(P, { grounded: false, speed: 60, dmg: 100 });
  P.pos.y = 150;
  for (let i = 0; i < 400 && P.alive; i++) game.run(50);
  game.run(3500);
  assert.equal(duel.state, "over");
  const [fin] = net.sent("fin");
  assert.equal(fin.o, 1, "we were out");
  assert.equal($("oTitle").textContent, "Settling the result…");
  // Bo's last plane went down at the same moment; Bo saw ours first.
  net.from(1, { t: "out" });
  net.from(1, { t: "fin", id: duel.net.match, sc: 0, o: 1, fl: [] });
  assert.equal($("oTitle").textContent, "It's a draw");
  const [board] = Object.values(
    JSON.parse(w.localStorage.getItem("duelhippo.groups")),
  );
  assert.equal(board.dogfight[0].w, null);
  assert.ok(!hidden("oAgain"), "two teams: we may go again");
  // Someone who worked the group out late asks for our copy.
  net.clear();
  net.from(1, { t: "bq", g: duel.net.group });
  const [copy] = net.sent("board", true);
  assert.deepEqual(copy.to, [1]);
  assert.equal(copy.m.mode, "dogfight");
  assert.equal(copy.m.list.length, 1);
});

test("Play again goes when the other team leaves, and comes back with a newcomer", async () => {
  net.clear();
  net.server({ t: "left", seat: 1 });
  assert.ok(hidden("oAgain"));
  assert.ok(lobby.amOrganiser());
  lobby.rematch();
  assert.equal(net.sent("go").length, 0, "one team is not a match");
  hello(3, "d", "Di");
  assert.ok(!hidden("oAgain"));
  $("oAgain").click();
  assert.equal(net.sent("go").length, 1);
  await tick(3200);
  assert.equal(duel.state, "play");
});

test("our own connection lost mid-match: no result, nothing filed", () => {
  const before = w.localStorage.getItem("duelhippo.groups");
  net.drop();
  assert.equal(duel.state, "title");
  assert.ok(!hidden("online") && !hidden("onMenu"));
  assert.match($("onMsg").textContent, /Lost the connection/);
  assert.equal(duel.net.on, false);
  game.run(4000);
  assert.equal(w.localStorage.getItem("duelhippo.groups"), before);
});

test("a match filed after we leave keeps our score and what we heard of theirs", async () => {
  await host();
  hello(1, "e", "Ed");
  hello(2, "f", "Fi");
  $("onLayout").value = "3x1";
  $("onLayout").dispatchEvent(new w.Event("change"));
  await start();
  const id = duel.net.match,
    me = duel.net.me.h;
  net.from(2, state([1400, 120, -1700], { sc: 40 }));
  S.score = 250;
  net.from(1, { t: "out" });
  net.from(2, { t: "out" });
  net.from(1, { t: "fin", id, sc: 10, o: 1 });
  // Fi's fin never comes: the result after FIN_WAIT, the filing after
  // another, and we leave in between.
  await tick(3100);
  assert.equal($("oTitle").textContent, "You win!");
  $("oLeave").click();
  await tick(3100);
  const entry = Object.values(
    JSON.parse(w.localStorage.getItem("duelhippo.groups")),
  )
    .flatMap((b) => b.dogfight)
    .find((e) => e.id === id);
  assert.ok(entry, "filed");
  const score = (h) => entry.p.find((p) => p[0] === h)[2];
  assert.equal(score(me), 250);
  assert.equal(score(hash("e")), 10);
  assert.equal(score(hash("f")), 40);
});

test("Back in the countdown, then a new room at once: no match starts there", async () => {
  await host();
  hello(1, "b", "Bo");
  $("onStart").click();
  await tick(1200);
  $("onBack").click();
  assert.equal(duel.state, "title");
  await host();
  await tick(2500);
  assert.equal(duel.net.on, false, "the old countdown stopped");
  assert.notEqual(duel.state, "play");
  assert.ok(!hidden("online") && !hidden("onRoom"), "in the new room");
});

test("a go whose roster leaves us out: no countdown, and the organiser's word holds", async () => {
  $("onBack").click(); // out of the last test's room
  await join(2, [0, 1]);
  net.from(0, { t: "hi", v: PROTO, h: hash("a"), n: "Ace" });
  net.from(1, { t: "hi", v: PROTO, h: hash("b"), n: "Bo" });
  // Ace pressed Start before our hello reached it.
  net.from(0, setup());
  net.from(0, { t: "go", id: "aaaa1111" });
  await tick(100);
  assert.ok(hidden("onCount"), "no countdown here");
  net.from(0, { t: "bad", text: "That game has already started." });
  assert.match($("onMsg").textContent, /already started/);
  await tick(3200);
  assert.equal(duel.net.on, false);
  assert.notEqual(duel.state, "play");
});
