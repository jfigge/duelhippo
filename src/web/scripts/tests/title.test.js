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

// title.test.js — the title card: the ‹ map › picker and its note, every
// map's button behind the name, and the Settings screen the switches moved
// to. Port only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPort } from "./harness.js";

const game = await loadPort(17);
const { w, duel } = game;
const S = duel.S;
const $ = (id) => w.document.getElementById(id);
const shown = (id) => !$(id).classList.contains("hidden");
const { mapNow } = await import("../maps.js");

test("‹ and › step through every map; a locked one is greyed, not picked", () => {
  S.best = 1500; // the Countryside and Sky islands
  const locked = () => $("mapName").classList.contains("locked");
  $("mapNext").click();
  assert.equal($("mapName").textContent, "Sky islands");
  assert.equal(mapNow(), "sky", "shown behind the card");
  assert.ok(!locked());
  assert.match($("mapNote").textContent, /^2 of 10 open · Arctic at 2,000$/);
  $("mapNext").click();
  assert.equal($("mapName").textContent, "Arctic");
  assert.ok(locked(), "greyed");
  assert.equal($("mapName").getAttribute("aria-disabled"), "true");
  assert.equal($("mapNote").textContent, "Locked · score over 2,000 to open");
  assert.equal(mapNow(), "sky", "not opened");
  game.start("free");
  assert.equal(mapNow(), "sky", "a game starts on the last open pick");
  game.press("KeyP");
  $("menu").click();
  assert.equal($("mapName").textContent, "Sky islands", "back to it after");
  assert.ok(!locked());
  $("mapPrev").click();
  assert.equal($("mapName").textContent, "Countryside");
  $("mapPrev").click();
  assert.ok(locked(), "round the end, to the last map, locked");
  S.best = 99999;
  $("mapNext").click();
  assert.equal($("mapName").textContent, "Countryside");
  assert.equal($("mapNote").textContent, "All 10 open");
  S.best = 0;
  $("mapNext").click();
  assert.equal($("mapName").textContent, "Sky islands");
  assert.ok(locked(), "a new player: only the Countryside opens");
  assert.equal(mapNow(), "field");
});

test("the name opens every map's button, locked ones with their score", () => {
  assert.ok(!shown("maps"), "closed to begin with");
  $("mapName").click();
  assert.ok(shown("maps"));
  assert.equal($("mapName").getAttribute("aria-expanded"), "true");
  assert.match($("maps").textContent, /Arctic\s*Score over 2,000/);
  $("mapName").click();
  assert.ok(!shown("maps"));
});

test("the switches live on Settings, which Back leaves", () => {
  for (const id of ["bInvert", "bSpeed", "bMute", "bAbout", "bUpdates"])
    assert.ok($("settings").contains($(id)), id);
  $("bSettings").click();
  assert.ok(shown("settings") && !shown("title"));
  game.press("Enter");
  assert.equal(duel.state, "title", "Enter starts nothing there");
  $("bSpeed").click();
  assert.match($("bSpeed").textContent, /75%/, "they still work");
  $("bSpeed").click();
  $("bSpeed").click();
  $("bSpeed").click();
  $("setBack").click();
  assert.ok(!shown("settings") && shown("title"));
});
