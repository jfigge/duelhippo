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
  m: "classic",
  p: [
    [A, "Ann", sa],
    [B, "Bo", sb],
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
  const merged = mergeLists("duel", mine, theirs, [A, B]);
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
  assert.equal(mergeLists("duel", many, [], [A, B]).length, 10);
});

test("co-op ranks by the team's total; duels by the best single score", () => {
  const list = [match("solo-star", 1, 900, 0), match("team", 2, 500, 500)];
  assert.equal(mergeLists("coop", list, [], [A, B])[0].id, "team");
  assert.equal(mergeLists("duel", list, [], [A, B])[0].id, "solo-star");
});

test("a peer's copy cannot smuggle in strangers or nonsense", () => {
  const bad = [
    {
      ...match("y1", 1, 10, 10),
      p: [
        [A, "Ann", 10],
        [C, "Cy", 10],
      ],
    },
    { ...match("y2", 1, 10, 10), p: [[A, "Ann", 10]] },
    match("y3", 1, -5, 10),
    match("y4", 1, 1.5, 10),
    { ...match("y5", 1, 10, 10), m: "god" },
    { ...match("<script>", 1, 10, 10) },
    null,
    "junk",
  ];
  assert.deepEqual(mergeLists("duel", [], bad, [A, B]), []);
  const named = mergeLists(
    "duel",
    [],
    [
      {
        ...match("z", 1, 10, 10),
        p: [
          [A, "<b>x</b>", 10],
          [B, "", 10],
        ],
      },
    ],
    [A, B],
  );
  assert.deepEqual(
    named[0].p.map((p) => p[1]),
    ["bxb", "Pilot"],
  );
});
