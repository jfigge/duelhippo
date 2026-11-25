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

// scores.test.js — the scoreboards' rules that need no game: names, the
// hash, and merging two copies of a group's board.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { sha256 } from "../sha256.js";
import {
  cleanInitials,
  cleanName,
  groupId,
  mergeLists,
  NAME_MAX,
} from "../scores.js";

const A = "a".repeat(64),
  B = "b".repeat(64),
  C = "c".repeat(64);
const match = (id, at, sa, sb, w = null) => ({
  id,
  at,
  m: "free",
  p: [
    [A, "Ann", sa, 0],
    [B, "Bo", sb, 1],
  ],
  w,
});

test("sha256 agrees with Node's", () => {
  for (const s of ["", "abc", "x".repeat(55), "x".repeat(64), "héllo 🐱"])
    assert.equal(sha256(s), createHash("sha256").update(s).digest("hex"));
});

test("initials: three letters or nothing", () => {
  assert.equal(cleanInitials("a-c-e"), "ACE");
  assert.equal(cleanInitials("ab"), null);
  assert.equal(cleanInitials("abcd"), null);
  assert.equal(cleanInitials(undefined), null);
});

test("match names: letters, digits, a little punctuation, short", () => {
  assert.equal(cleanName("  Red   Baron "), "Red Baron");
  assert.equal(cleanName("<img src=x>"), "img srcx");
  assert.equal(cleanName("Zoë_O'Neil-2"), "Zoë_O'Neil-2");
  assert.equal(cleanName("x".repeat(40)).length, NAME_MAX);
});

test("a group is the same group whoever lists it first", () => {
  assert.equal(groupId([A, B]), groupId([B, A]));
  assert.notEqual(groupId([A, B]), groupId([A, C]));
  assert.notEqual(groupId([A, B]), groupId([A, B, C]));
});

test("two copies merge: each match once, best first, ten at most", () => {
  const mine = [match("m1", 1, 500, 200), match("m2", 2, 100, 100)];
  const theirs = [match("m1", 1, 400, 350), match("m3", 3, 900, 0)];
  const merged = mergeLists("dogfight", mine, theirs, [A, B]);
  assert.deepEqual(
    merged.map((e) => e.id),
    ["m3", "m1", "m2"],
  );
  // The same match on both: each player's higher reading.
  assert.deepEqual(
    merged[1].p.map((p) => p[2]),
    [500, 350],
  );
  const many = Array.from({ length: 14 }, (_, i) => match("x" + i, i, i, 0));
  assert.equal(mergeLists("dogfight", many, [], [A, B]).length, 10);
});

test("team modes rank by the best team's total; dogfights by the best single score", () => {
  const pair = (id, at, a, b, c) => ({
    id,
    at,
    m: "free",
    p: [
      [A, "Ann", a, 0],
      [B, "Bo", b, 0],
      [C, "Cy", c, 1],
    ],
    w: 0,
  });
  const list = [pair("star", 1, 900, 0, 0), pair("team", 2, 600, 600, 0)];
  for (const m of ["flag", "endless"])
    assert.equal(mergeLists(m, list, [], [A, B, C])[0].id, "team", m);
  assert.equal(mergeLists("dogfight", list, [], [A, B, C])[0].id, "star");
});

test("a peer's copy cannot smuggle in strangers or nonsense", () => {
  const with_ = (id, p) => ({ ...match(id, 1, 10, 10), p });
  const bad = [
    with_("y1", [
      [A, "Ann", 10, 0],
      [C, "Cy", 10, 1],
    ]),
    with_("y2", [[A, "Ann", 10, 0]]),
    with_("y6", [
      [A, "Ann", 10, 0],
      [B, "Bo", 10, 9],
    ]),
    match("y3", 1, -5, 10),
    match("y4", 1, 1.5, 10),
    { ...match("y5", 1, 10, 10), m: "god" },
    match("<script>", 1, 10, 10),
    null,
    "junk",
  ];
  assert.deepEqual(mergeLists("dogfight", [], bad, [A, B]), []);
  const named = mergeLists(
    "dogfight",
    [],
    [
      {
        ...with_("z", [
          [A, "<b>x</b>", 10, 0],
          [B, "", 10, 1],
        ]),
        w: 7,
      },
    ],
    [A, B],
  );
  assert.deepEqual(
    named[0].p.map((p) => p[1]),
    ["bxb", "Pilot"],
  );
  assert.equal(named[0].w, null, "no team 7 played");
});
