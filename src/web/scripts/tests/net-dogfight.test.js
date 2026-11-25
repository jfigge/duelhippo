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

// net-dogfight.test.js — a team game from the organiser's machine (seat 0):
// making a room, three friends joining, teams, a dogfight to the end, and
// the group's scoreboard. The other players are played by fake-server.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPort } from "./harness.js";
import { PROTO } from "../net/protocol.js";
import { fakeServer, tick, hash, state } from "./fake-server.js";

const game = await loadPort(11);
const { w, duel } = game;
const $ = (id) => w.document.getElementById(id);
const S = duel.S,
  P = duel.P;
const net = fakeServer(w, { seat: 0 });
const lastSetup = () => net.sent("setup").at(-1);
const roster = () => lastSetup().roster;

test("making a room: a code, and nobody to play yet", async () => {
  $("bOnline").click();
  // A test build has no server address; the fake server stands in for one.
  $("onHost").disabled = $("onJoin").disabled = false;
  $("onName").value = "Ace";
  $("onName").dispatchEvent(new w.Event("input"));
  $("onHost").click();
  await tick(10);
  assert.match(net.opened[0], /\/host$/);
  assert.equal($("onCodeShow").textContent, "ABCD");
  assert.ok(!$("onStart").classList.contains("hidden"), "we organise");
  assert.ok($("onStart").disabled, "one team is not a game");
});

test("friends join: a hello to each, and onto the emptiest team", () => {
  net.server({ t: "peer", seat: 1 });
  const [hi] = net.sent("hi", true);
  assert.deepEqual(hi.to, [1], "addressed to the newcomer");
  assert.equal(hi.m.v, PROTO);
  assert.equal(hi.m.n, "Ace");
  net.from(1, { t: "hi", v: PROTO, h: hash("b"), n: "Bo" });
  assert.deepEqual(roster(), [
    [0, 0],
    [1, 1],
  ]);
  assert.ok(!$("onStart").disabled, "two teams: ready");
  $("onLayout").value = "2x2";
  $("onLayout").dispatchEvent(new w.Event("change"));
  assert.equal(lastSetup().layout, "2x2");
  net.server({ t: "peer", seat: 2 });
  net.from(2, { t: "hi", v: PROTO, h: hash("c"), n: "Cy" });
  assert.deepEqual(roster().at(-1), [2, 0], "a tie goes to the first team");
});

test("a player may change team, but not into a full one", () => {
  net.from(2, { t: "team", team: 1 });
  assert.deepEqual(roster().at(-1), [2, 1]);
  net.server({ t: "peer", seat: 3 });
  net.from(3, { t: "hi", v: PROTO, h: hash("d"), n: "Di" });
  assert.deepEqual(roster().at(-1), [3, 0]);
  const before = JSON.stringify(roster());
  net.from(3, { t: "team", team: 1 });
  assert.equal(JSON.stringify(roster()), before, "team 1 is full");
  assert.equal($("onTeams").querySelectorAll(".team").length, 2);
  assert.match($("onTeams").textContent, /Ace \(you\).*Di.*Bo.*Cy/s);
});

test("a different version is told why and left out", () => {
  net.clear();
  net.from(3, { t: "hi", v: PROTO - 1, h: hash("d"), n: "Di" });
  assert.equal(net.sent("bad", true)[0].to[0], 3);
});

test("the group's board follows the roster", () => {
  assert.ok(!$("onBoard").classList.contains("hidden"));
  assert.match($("onBoard").textContent, /Your best dogfights/);
});

test("START counts every machine down, then the dogfight starts at our field", async () => {
  net.clear();
  $("onStart").click();
  assert.match(net.sent("go")[0].id, /^[0-9a-f]{16}$/);
  await tick(3200);
  assert.equal(duel.state, "play");
  assert.equal(duel.mode, "free", "team games are Free flight");
  assert.equal(duel.fields.length, 2);
  const f = duel.fields[0];
  assert.equal(P.pos.x, f.x - 190, "first in line on our runway");
  assert.equal(P.pos.z, f.z);
  assert.equal(duel.remotes.size, 3);
  assert.equal(duel.targets.length, 0, "a dogfight has no town");
  assert.ok(!$("hTeams").classList.contains("hidden"));
  game.run(3000);
  assert.equal(duel.enemies.filter((e) => e.alive).length, 0, "no AI");
});

test("state goes out 20 times a second, one copy for everyone", () => {
  net.clear();
  game.run(1000);
  const sent = net.sent("s", true);
  assert.ok(sent.length >= 18 && sent.length <= 22, `${sent.length} a second`);
  assert.equal(sent[0].to, undefined, "the server fans it out");
  for (let i = 0; i < 6; i++) {
    net.from(1, state([1400 - i * 3, 120, -1700]));
    w.__advance(50);
  }
  game.run(100);
  const r = duel.remotes.get(1);
  assert.ok(r.obj.visible, "drawn");
  assert.ok(Math.abs(r.pos.z + 1700) < 20, "near its reported place");
});

test("a teammate's rounds pass through; a rival's hurt, and name them", () => {
  const at = (x) => [x, P.pos.y, P.pos.z];
  net.from(3, { t: "f", o: at(P.pos.x - 40), d: [1, 0, 0], s: 500 });
  game.run(300);
  assert.equal(P.dmg, 0, "friendly fire is off");
  net.from(1, { t: "f", o: at(P.pos.x - 40), d: [1, 0, 0], s: 500 });
  game.run(300);
  assert.ok(P.dmg > 0);
  assert.equal(P.hitBy, 1);
});

test("each plane is drawn as the type its player flies", () => {
  net.clear();
  game.run(100);
  assert.equal(net.sent("s").at(-1).pl, 0, "ours: the Kite");
  const r = duel.remotes.get(1),
    kite = r.obj;
  net.from(1, state([1400, 120, -1700], { pl: 2 }));
  assert.equal(r.kind, 2);
  assert.notEqual(r.obj, kite, "a Lancer now");
  net.from(1, state([1400, 120, -1700], { pl: 9 }));
  assert.equal(r.kind, 0, "nonsense reads as the Kite");
});

test("a lock on us is told; a missile at us is ours to judge", () => {
  net.from(1, { t: "lk", to: 0, on: 1 });
  game.run(200);
  assert.match($("warn").textContent, /LOCKED ON/);
  net.from(1, { t: "lk", to: 0, on: 0 });
  game.run(200);
  assert.doesNotMatch($("warn").textContent, /LOCKED ON/);
  // A teammate's passes harmlessly; a rival's hits, and names them.
  const o = [P.pos.x - 80, P.pos.y, P.pos.z];
  P.dmg = 0;
  P.hitBy = null;
  P.thr = 0.15; // not idle, so no repairs to hide a hit
  net.from(3, { t: "ms", o, d: [1, 0, 0], s: 180, to: 0 });
  game.run(1500);
  assert.equal(P.dmg, 0, "friendly fire is off");
  net.from(1, { t: "ms", o, d: [1, 0, 0], s: 180, to: 0 });
  game.run(300);
  assert.match($("warn").textContent, /MISSILE/);
  game.run(1200);
  assert.equal(P.dmg, 40);
  assert.equal(P.hitBy, 1);
});

test("shot down: the crash credits the rival who did it", () => {
  net.clear();
  Object.assign(P, { grounded: false, speed: 60, dmg: 100 });
  P.pos.y = 150;
  for (let i = 0; i < 400 && P.alive; i++) game.run(50);
  assert.ok(!P.alive);
  assert.equal(net.sent("down")[0].by, 1);
});

test("our kills score; a teammate's crash at our hands does not", () => {
  const s = S.score;
  net.from(2, { t: "down", p: [0, 50, 0], by: 0 });
  assert.equal(S.score, s + 100);
  net.from(3, { t: "down", p: [0, 50, 0], by: 0 });
  assert.equal(S.score, s + 100);
});

test("a team is out when all its players are; the last team flying wins", () => {
  game.run(4000); // back on the runway
  net.from(1, { t: "out" });
  assert.equal(duel.state, "play", "Cy flies on");
  net.clear();
  net.from(2, { t: "out" });
  assert.equal(duel.state, "over");
  assert.equal($("oTitle").textContent, "Your team wins!");
  assert.deepEqual(net.sent("fin")[0], { t: "fin", sc: S.score });
  assert.ok(!$("oAgain").classList.contains("hidden"), "we may go again");
});

test("the match goes on the group's board once every final score is in", () => {
  assert.ok($("oGroup").classList.contains("hidden"));
  net.from(1, { t: "fin", sc: 0 });
  net.from(2, { t: "fin", sc: 100 });
  assert.ok($("oGroup").classList.contains("hidden"), "Di's is missing");
  net.from(3, { t: "fin", sc: 300 });
  assert.ok(!$("oGroup").classList.contains("hidden"));
  const [board] = Object.values(
    JSON.parse(w.localStorage.getItem("duelhippo.groups")),
  );
  const [e] = board.dogfight;
  assert.equal(e.id, duel.net.match);
  assert.equal(e.w, 0, "team 0 won");
  assert.equal(e.p.length, 4);
  assert.equal(e.p.find((p) => p[0] === hash("d"))[2], 300);
});

test("leaving: a goodbye, then a one-player title screen", () => {
  net.clear();
  $("oLeave").click();
  assert.equal(net.sent("bye").length, 1);
  assert.equal(duel.net.on, false);
  assert.equal(duel.state, "title");
  assert.equal(duel.fields.length, 0);
  assert.equal(duel.remotes.size, 0);
  assert.equal(duel.targets.length, 8, "the one-player town is back");
  assert.ok($("hTeams").classList.contains("hidden"));
});
