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

// about.test.js — the About card: where it opens, that it takes the keyboard
// while it is up, that a game is paused under it, and what the (i) and the
// footer show in each shell. Port only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { loadPort } from "./harness.js";

const game = await loadPort(13);
const { w, duel } = game;
const $ = (id) => w.document.getElementById(id);
const shown = (id) => !$(id).classList.contains("hidden");
const { bindAbout } = await import("../about.js");

test("About opens from the title, and Close, Escape or the backdrop close it", () => {
  assert.equal(duel.state, "title");
  $("bAbout").click();
  assert.ok(shown("about"));
  assert.equal(w.document.activeElement, $("aboutClose"));
  $("aboutClose").click();
  assert.ok(!shown("about"));
  $("bAbout").click();
  game.press("Escape");
  assert.ok(!shown("about"), "Escape");
  assert.ok(!shown("pause"), "and nothing else");
  $("bAbout").click();
  $("about").click();
  assert.ok(!shown("about"), "a click outside the card");
  $("bAbout").click();
  $("about").querySelector(".aboutDesc").click();
  assert.ok(shown("about"), "a click on it does not");
  $("aboutClose").click();
});

test("while it is up, no key reaches the game", () => {
  $("bAbout").click();
  game.press("Enter");
  assert.equal(duel.state, "title", "Enter starts nothing");
  $("aboutClose").click();
});

test("the (i) shows the version; Escape closes it before the card", () => {
  $("bAbout").click();
  assert.ok($("aboutBuild").hidden);
  $("aboutInfo").click();
  assert.ok(!$("aboutBuild").hidden);
  assert.equal($("aboutInfo").getAttribute("aria-expanded"), "true");
  const text = $("aboutBuild").textContent;
  assert.match(text, /Version\s*dev build/, "unbundled: no version");
  assert.match(text, /Platform\s*Browser/);
  game.press("Escape");
  assert.ok($("aboutBuild").hidden && shown("about"));
  game.press("Escape");
  assert.ok(!shown("about"));
});

test("opened mid-game, it pauses the game under it", () => {
  game.start("classic");
  game.run(100);
  $("bAbout").click();
  assert.ok(shown("about") && shown("pause"));
  assert.equal(duel.state, "play");
  $("aboutClose").click();
  assert.ok(shown("pause"), "back to the pause menu");
  $("menu").click();
  assert.equal(duel.state, "title");
});

// The card alone, in a page made to look like another shell.
const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
function shellPage(platform, bridge) {
  const pw = new JSDOM(html, { url: "http://localhost/" }).window;
  pw.document.documentElement.dataset.platform = platform;
  if (bridge) pw.duelhippo = bridge;
  return { pw, about: bindAbout({ w: pw }) };
}

test("the desktop app names its runtime, and its menu opens the card", () => {
  let menu = null;
  const { pw } = shellPage("electron", {
    platform: "electron",
    os: "darwin",
    arch: "arm64",
    versions: { electron: "45.5.0", chrome: "142.0" },
    onAbout: (fn) => (menu = fn),
  });
  const text = pw.document.getElementById("aboutBuild").textContent;
  assert.match(text, /Electron\s*45\.5\.0/);
  assert.match(text, /Chromium\s*142\.0/);
  assert.match(text, /Platform\s*darwin arm64/);
  menu();
  assert.ok(!pw.document.getElementById("about").classList.contains("hidden"));
});

test("the sponsor link is offered everywhere but iOS", () => {
  const donate = (pw) =>
    !pw.document.getElementById("aboutDonate").classList.contains("hidden");
  assert.ok(donate(shellPage("web").pw));
  assert.ok(donate(shellPage("electron", { versions: {} }).pw));
  const ios = shellPage("ios").pw;
  assert.ok(!donate(ios));
  assert.match(
    ios.document.getElementById("aboutBuild").textContent,
    /iPhone app/,
  );
  assert.match(
    ios.document.querySelector(".aboutSupport a").getAttribute("href"),
    /^mailto:hippoherd@gmail\.com$/,
    "the support address stays",
  );
});
