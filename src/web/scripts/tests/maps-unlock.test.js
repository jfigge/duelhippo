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

// maps-unlock.test.js — the title screen: maps are earned (each opens once
// the best one-player score is over its number, 1,000 apart; constants.js
// UNLOCK), and the keys have a screen of their own.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPort } from "./harness.js";

const game = await loadPort(5);
const { w, duel } = game;
const S = duel.S;
const $ = (id) => w.document.getElementById(id);
const { mapNow } = await import("../maps.js");
const { MAPS, UNLOCK } = await import("../constants.js");
const [, FIRST, SECOND] = Object.keys(MAPS);
const button = (id) => w.document.querySelector(`[data-map="${id}"]`);
const msg = () => $("msg").textContent;

// A one-player game that ends with `score`.
function scoreAndEnd(score) {
  game.start("classic");
  S.score = score;
  game.run(200);
  $("quit").click();
}

test("the keys have a screen of their own, off the title", () => {
  assert.equal($("titleBody").querySelector(".keys"), null);
  $("bControls").click();
  assert.ok($("title").classList.contains("hidden"));
  assert.ok(!$("controls").classList.contains("hidden"));
  assert.match($("controls").textContent, /Throttle up/);
  $("ctBack").click();
  assert.ok(!$("title").classList.contains("hidden"));
  assert.ok($("controls").classList.contains("hidden"));
});

test("the maps open 1,000 points apart, the Countryside from the start", () => {
  const ids = Object.keys(MAPS);
  assert.equal(ids.length, 10);
  ids.forEach((id, i) => assert.equal(UNLOCK[id], i * 1000, id));
});

test("a new player has the Countryside, and sees what opens the others", () => {
  assert.equal(S.best, 0);
  assert.ok(!button("field").disabled);
  for (const id of Object.keys(MAPS).slice(1)) {
    assert.ok(button(id).disabled, `${id} is locked`);
    assert.ok(button(id).classList.contains("locked"));
    assert.match(
      button(id).textContent,
      new RegExp(`Score over ${UNLOCK[id].toLocaleString("en")}`),
    );
  }
  button("sea").click();
  assert.equal(mapNow(), "field", "a locked map can't be picked");
});

test("1,000 is not enough; over it opens the first map, and says so", () => {
  scoreAndEnd(1000);
  assert.ok(button(FIRST).disabled, "exactly 1,000 is not over it");
  assert.ok($("oUnlock").classList.contains("hidden"));
  game.start("free");
  S.score = 1050;
  game.run(300);
  assert.match(msg(), new RegExp(`New map: ${MAPS[FIRST]}`), "told in flight");
  $("quit").click();
  assert.match($("oUnlock").textContent, new RegExp(`New map: ${MAPS[FIRST]}`));
  assert.ok(!$("oUnlock").classList.contains("hidden"));
  assert.ok(!button(FIRST).disabled);
  assert.equal(button(FIRST).textContent, MAPS[FIRST]);
  assert.ok(button(SECOND).disabled, "the next needs more");
  $("oMenu").click();
  button(FIRST).click();
  assert.equal(mapNow(), FIRST);
  assert.equal(w.localStorage.getItem("duelhippo.map"), FIRST);
});

test("a big score opens every map it beats, all at once", () => {
  scoreAndEnd(4500);
  for (const id of Object.keys(MAPS))
    assert.equal(button(id).disabled, UNLOCK[id] >= 4500, id);
  assert.match($("oUnlock").textContent, /New map: .* and /);
});

test("a team game's organiser offers only the maps they have earned", async () => {
  const { fakeServer, tick, hash } = await import("./fake-server.js");
  const { PROTO } = await import("../net/protocol.js");
  S.best = 5500; // the Sea, not the City
  const net = fakeServer(w, { seat: 0 });
  $("bOnline").click();
  $("onHost").disabled = false;
  $("onHost").click();
  await tick(10);
  net.server({ t: "peer", seat: 1 });
  net.from(1, { t: "hi", v: PROTO, h: hash("b"), n: "Bo" });
  const lmap = (id) => w.document.querySelector(`[data-lmap="${id}"]`);
  assert.ok(!lmap("sea").disabled);
  assert.ok(lmap("city").disabled);
  assert.match(lmap("city").textContent, /Score over 9,000/);
  lmap("sea").click();
  assert.equal(net.sent("setup").at(-1).map, "sea");
});
