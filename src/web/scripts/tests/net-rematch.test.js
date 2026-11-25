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
// net-rematch.test.js — rematches from a player who is not the organiser
// (seat 1): a "go" that arrives while this machine is still in the last
// match starts the organiser's new setup, not the old one, and a player
// who leaves during the countdown is in the match on every machine, out.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPort } from "./harness.js";
import { PROTO } from "../net/protocol.js";
import { fakeServer, tick, hash } from "./fake-server.js";

const game = await loadPort(15);
const { w, duel } = game;
const $ = (id) => w.document.getElementById(id);
let net = fakeServer(w, { seat: 1, peers: [0, 2] });
const setup = (layout, roster) => ({
  t: "setup",
  v: PROTO,
  layout,
  mode: "dogfight",
  map: "field",
  ff: false,
  speed: 1,
  roster,
});
const seats = () => [...duel.net.roster.keys()].sort();

async function go(id) {
  net.from(0, { t: "go", id });
  await tick(3200);
  assert.equal(duel.state, "play");
  assert.equal(duel.net.match, id);
}

test("a rematch while we still fly: the organiser's new roster, not the old", async () => {
  $("bOnline").click();
  $("onHost").disabled = $("onJoin").disabled = false;
  $("onJoin").click();
  $("onCode").value = "ABCD";
  $("onGo").click();
  await tick(10);
  net.from(0, { t: "hi", v: PROTO, h: hash("a"), n: "Ace" });
  net.from(2, { t: "hi", v: PROTO, h: hash("c"), n: "Cy" });
  const old = [
    [0, 0],
    [1, 1],
    [2, 1],
  ];
  net.from(0, setup("2x2", old));
  await go("aaaa1111");
  game.run(500);
  net.from(2, { t: "out" });
  // The organiser has settled and taken on a newcomer; our news of the end
  // is slow, so its setups (after the match, and with go) come mid-match.
  net.server({ t: "peer", seat: 3 });
  net.from(3, { t: "hi", v: PROTO, h: hash("d"), n: "Di" });
  const next = [...old, [3, 0]];
  net.from(0, setup("2x2", next));
  net.from(0, setup("2x2", next));
  await go("bbbb2222");
  assert.deepEqual(seats(), [0, 1, 2, 3]);
  assert.ok(duel.remotes.has(3), "Di is drawn");
});

test("a rematch while we still settle: the new layout and roster too", async () => {
  game.run(500);
  for (const s of [0, 2, 3]) net.from(s, { t: "out" });
  net.from(0, { t: "fin", id: "bbbb2222", sc: 0, o: 1, fl: [] });
  assert.equal($("oTitle").textContent, "Settling the result…");
  net.server({ t: "peer", seat: 4 });
  net.from(4, { t: "hi", v: PROTO, h: hash("e"), n: "Ed" });
  const next = [
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 4],
  ];
  net.from(0, setup("5x1", next));
  await go("cccc3333");
  assert.deepEqual(seats(), [0, 1, 2, 3, 4]);
  assert.equal(duel.net.teams, 5);
});

test("a player who leaves in the countdown is in the match, and out of it", async () => {
  for (const s of [0, 2, 3, 4]) net.from(s, { t: "out" });
  for (const s of [0, 2, 3, 4])
    net.from(s, { t: "fin", id: "cccc3333", sc: 0, o: 1, fl: [] });
  assert.equal(duel.state, "over");
  net.from(0, { t: "go", id: "dddd4444" });
  await tick(1500);
  net.server({ t: "left", seat: 4 });
  await tick(1700);
  assert.equal(duel.state, "play");
  assert.deepEqual(seats(), [0, 1, 2, 3, 4], "the roster everyone has");
  assert.ok(duel.remotes.get(4).gone, "Ed is gone from it");
});

const refused = () => {
  assert.equal(duel.state, "title");
  assert.equal(duel.net.on, false);
  assert.ok($("over").classList.contains("hidden"), "no over card");
  assert.ok(!$("online").classList.contains("hidden"));
  assert.ok(!$("onMenu").classList.contains("hidden"));
  assert.match($("onMsg").textContent, /Update to play/);
};

test("a setup with a map we lack, kept from the match: the match ends, and we go", async () => {
  net.from(
    0,
    setup("5x1", [
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
    ]),
  );
  net.from(0, {
    ...setup("5x1", [
      [0, 0],
      [1, 1],
    ]),
    map: "atlantis",
  });
  for (const s of [0, 2, 3]) net.from(s, { t: "out" });
  for (const s of [0, 2, 3])
    net.from(s, { t: "fin", id: "dddd4444", sc: 0, o: 1, fl: [] });
  await tick(10);
  refused();
});

test("and the same when the organiser's go comes mid-match", async () => {
  net = fakeServer(w, { seat: 1, peers: [0] });
  $("onJoin").click();
  $("onCode").value = "ABCD";
  $("onGo").click();
  await tick(10);
  net.from(0, { t: "hi", v: PROTO, h: hash("a"), n: "Ace" });
  const two = [
    [0, 0],
    [1, 1],
  ];
  net.from(0, setup("2x1", two));
  await go("eeee5555");
  net.from(0, { ...setup("2x1", two), map: "atlantis" });
  net.from(0, { t: "go", id: "ffff6666" });
  await tick(10);
  refused();
  await tick(3300);
  assert.equal(duel.state, "title", "no countdown either");
});
