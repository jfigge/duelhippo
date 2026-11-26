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

// weather.test.js — T steps the weather (constants.js WEATHERS) on any map
// but the Storm and the Sea, whose weather is their own; it is remembered,
// and in a team game the organiser's. Port only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPort } from "./harness.js";
import { PROTO } from "../net/protocol.js";
import { fakeServer, tick, hash } from "./fake-server.js";

const game = await loadPort(8);
const { w, duel } = game;
const $ = (id) => w.document.getElementById(id);
duel.S.best = 1e6;
(await import("../game.js")).showMaps();
const { land } = await import("../world.js");
const { mapNow, useMap, weatherNow } = await import("../maps.js");
const { MAPS, WEATHERS, WEATHER_KEY } = await import("../constants.js");
const { opt } = await import("../state.js");
const { scene } = await import("../scene.js");
const pick = (id) => w.document.querySelector(`[data-map="${id}"]`).click();
const hemi = scene.children.find((o) => o.isHemisphereLight),
  sun = scene.children.find((o) => o.isDirectionalLight);
const msg = () => $("msg").textContent;

// The sky, fog, lights and rules that weather changes.
const look = () => ({
  sky: scene.background.getHex(),
  fog: [scene.fog.color.getHex(), scene.fog.near, scene.fog.far],
  hemi: [hemi.intensity, hemi.groundColor.getHex()],
  sun: sun.intensity,
  tick: land.tick,
  // Rain and snow, which follow the camera and fog does not touch.
  falls: scene.children.filter(
    (o) => (o.isPoints || o.isInstancedMesh) && o.material.fog === false,
  ).length,
});
function airborne() {
  game.poke((P) => {
    P.grounded = false;
    P.alive = true;
    P.pos.set(1400, 300, 0);
    P.speed = 60;
    P.thr = 0.6;
  });
}

test("T steps sunny, foggy, stormy, snowy and back; sunny is the map as it is", () => {
  pick("field");
  game.start("free");
  assert.equal(weatherNow(), "sunny");
  const clear = look();
  assert.equal(clear.tick, null, "nothing plugged into the Countryside");
  const seen = [];
  for (let i = 0; i < WEATHERS.length; i++) {
    game.press("KeyT");
    seen.push(weatherNow());
    if (weatherNow() !== "sunny") {
      assert.ok(scene.fog.far < 3400, `${weatherNow()} closes the view`);
      assert.notEqual(scene.background.getHex(), clear.sky);
    }
    if (weatherNow() === "stormy" || weatherNow() === "snowy") {
      assert.equal(typeof land.tick, "function", "something falls");
      assert.ok(look().falls > clear.falls, `${weatherNow()}: rain or snow`);
    }
    airborne();
    game.run(300);
  }
  assert.deepEqual(seen, ["foggy", "stormy", "snowy", "sunny"]);
  assert.match(msg(), /Weather: Sunny/);
  const after = look();
  assert.deepEqual(after, clear, "the Countryside exactly as it was");
});

test("the touch screen's weather button steps it too, and shows it", () => {
  pick("field");
  game.start("free");
  assert.equal($("bWx").textContent, "SUN");
  $("bWx").click();
  assert.equal(weatherNow(), "foggy");
  assert.equal($("bWx").textContent, "FOG");
  assert.equal($("bWx").getAttribute("aria-label"), "Weather: Foggy");
  for (const tag of ["RAIN", "SNOW", "SUN"]) {
    $("bWx").click();
    assert.equal($("bWx").textContent, tag);
  }
  // On the Sea it shows the Sea's own fog, and a tap leaves it.
  pick("sea");
  game.start("free");
  assert.equal($("bWx").textContent, "FOG");
  $("bWx").click();
  assert.equal($("bWx").textContent, "FOG");
  assert.match(msg(), /Sea fog never lifts/);
  pick("field");
  game.start("free");
});

test("the weather is remembered", () => {
  game.press("KeyT");
  assert.equal(opt.weather, "foggy");
  assert.equal(w.localStorage.getItem(WEATHER_KEY), "foggy");
  // And kept from game to game.
  game.start("free");
  assert.equal(weatherNow(), "foggy");
  for (let i = 1; i < WEATHERS.length; i++) game.press("KeyT");
  assert.equal(opt.weather, "sunny");
});

test("the Storm is always stormy, the Sea always foggy: T does nothing there", () => {
  pick("storm");
  game.start("free");
  const storm = look();
  game.press("KeyT");
  assert.equal(weatherNow(), "stormy");
  assert.match(msg(), /storm won't lift/);
  assert.deepEqual(look(), storm);
  assert.equal(opt.weather, "sunny", "the choice elsewhere is untouched");

  pick("sea");
  game.start("free");
  assert.equal(weatherNow(), "foggy");
  assert.ok(scene.fog.far <= 620, `sea fog: ${scene.fog.far} m`);
  game.press("KeyT");
  assert.match(msg(), /Sea fog never lifts/);
  assert.ok(scene.fog.far <= 620);
});

test("each weather on every map, then the Countryside as it was", () => {
  pick("field");
  game.start("free");
  const clear = look();
  for (const id of Object.keys(MAPS)) {
    pick(id);
    game.start("free");
    for (let i = 0; i < WEATHERS.length; i++) {
      airborne();
      game.run(500);
      game.poke((P) => (P.dmg = 0));
      game.press("KeyT");
    }
  }
  pick("field");
  game.start("free");
  assert.equal(opt.weather, "sunny");
  assert.deepEqual(look(), clear);
});

test("Classic in a storm: rain and lightning, but no gusts on its lane", () => {
  game.start("free");
  game.press("KeyT");
  game.press("KeyT");
  assert.equal(opt.weather, "stormy");
  game.start("classic");
  assert.equal(weatherNow(), "stormy");
  let gust = false;
  for (let i = 0; i < 200; i++) {
    game.poke((P) => {
      P.grounded = false;
      P.alive = true;
      P.dmg = 0;
      P.pos.y = 300;
      P.speed = 60;
    });
    game.run(100);
    gust ||= /Gust/.test(msg());
  }
  assert.ok(!gust, "no gust in Classic");
  game.press("KeyT");
  game.press("KeyT");
  assert.equal(opt.weather, "sunny");
});

test("a team game flies the organiser's weather, and T leaves it be", async () => {
  pick("field");
  game.start("free");
  game.press("KeyT"); // foggy: the organiser's own, the first offer
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
  assert.equal(lastSetup().weather, "foggy");
  $("onWeather").click();
  assert.equal(lastSetup().weather, "stormy");
  assert.match($("onWeather").textContent, /stormy/);
  // A map with weather of its own: the button shows it and is off.
  w.document.querySelector('[data-lmap="sea"]').click();
  assert.ok($("onWeather").disabled);
  assert.match($("onWeather").textContent, /foggy/);
  w.document.querySelector('[data-lmap="field"]').click();
  assert.ok(!$("onWeather").disabled);
  $("onStart").click();
  await tick(3200);
  assert.equal(duel.state, "play");
  assert.equal(mapNow(), "field");
  assert.equal(weatherNow(), "stormy");
  game.press("KeyT");
  assert.equal(weatherNow(), "stormy");
  assert.match(msg(), /organiser chose the weather/);
  $("quit").click();
  await tick(10);
  assert.equal(duel.state, "title");
  assert.equal(weatherNow(), "foggy", "the player's own again");
  useMap("field");
});
