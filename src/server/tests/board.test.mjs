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

// board.test.mjs — the one-player scoreboard's rules, on node:sqlite in place
// of the Durable Object's database (the same SQLite dialect).

import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  makeBoard,
  parseSubmit,
  parseInitials,
  MAX_SCORE,
  TOP,
} from "../board.js";

const fresh = () => {
  const db = new DatabaseSync(":memory:");
  return makeBoard((sql, ...binds) => db.prepare(sql).all(...binds));
};
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("initials are three letters, A to Z, and nothing else", () => {
  assert.equal(parseInitials("ace"), "ACE");
  assert.equal(parseInitials(" Ace "), "ACE");
  for (const bad of ["AC", "ACES", "A1E", "A E", "ÁCE", "", null, 123])
    assert.equal(parseInitials(bad), null, String(bad));
});

test("a submission is checked from end to end", () => {
  const ok = { id: id(1), n: "ace", sc: 1200, m: "free" };
  assert.deepEqual(parseSubmit(ok).entry, { ...ok, n: "ACE" });
  for (const [why, patch] of [
    ["id", { id: "me" }],
    ["initials", { n: "LONGNAME" }],
    ["fraction", { sc: 1.5 }],
    ["negative", { sc: -1 }],
    ["absurd", { sc: MAX_SCORE + 1 }],
    ["string score", { sc: "1200" }],
    ["mode", { m: "god" }],
  ])
    assert.ok(parseSubmit({ ...ok, ...patch }).error, why);
  assert.ok(parseSubmit(null).error);
});

test("one row per player: a new best replaces their own, a worse one does not", () => {
  const b = fresh();
  b.submit({ id: id(1), n: "ACE", sc: 500, m: "classic" }, 1);
  b.submit({ id: id(2), n: "ACE", sc: 700, m: "classic" }, 2);
  let r = b.submit({ id: id(1), n: "ACE", sc: 300, m: "free" }, 3);
  assert.equal(r.total, 2, "the same initials are still two players");
  assert.deepEqual(r.me, { rank: 2, n: "ACE", sc: 500, m: "classic" });
  r = b.submit({ id: id(1), n: "ACE", sc: 900, m: "free" }, 4);
  assert.deepEqual(r.me, { rank: 1, n: "ACE", sc: 900, m: "free" });
  assert.deepEqual(
    r.top.map((e) => e.sc),
    [900, 700],
  );
});

test("new initials show at once, whatever the score", () => {
  const b = fresh();
  b.submit({ id: id(1), n: "ACE", sc: 500, m: "classic" }, 1);
  const r = b.submit({ id: id(1), n: "BOB", sc: 10, m: "classic" }, 2);
  assert.deepEqual(r.me, { rank: 1, n: "BOB", sc: 500, m: "classic" });
});

test("the top ten, and the player's place outside it", () => {
  const b = fresh();
  for (let i = 1; i <= 15; i++)
    b.submit({ id: id(i), n: "AAA", sc: i * 100, m: "classic" }, i);
  const r = b.read(id(3));
  assert.equal(r.top.length, TOP);
  assert.equal(r.top[0].sc, 1500);
  assert.equal(r.total, 15);
  assert.equal(r.me.rank, 13);
  assert.ok(!("id" in r.top[0]), "ids never leave the server");
  assert.equal(b.read().me, null);
  assert.equal(b.read(id(99)).me, null, "not on the board yet");
});

test("a tie goes to whoever got there first", () => {
  const b = fresh();
  b.submit({ id: id(1), n: "AAA", sc: 800, m: "classic" }, 10);
  b.submit({ id: id(2), n: "BBB", sc: 800, m: "classic" }, 20);
  assert.equal(b.read(id(1)).me.rank, 1);
  assert.equal(b.read(id(2)).me.rank, 2);
  assert.deepEqual(
    b.read().top.map((e) => e.n),
    ["AAA", "BBB"],
  );
});

test("a score names its plane; an unknown one is dropped, not refused", () => {
  const ok = { id: id(1), n: "ACE", sc: 100, m: "free" };
  assert.equal(parseSubmit({ ...ok, pl: 2 }).entry.pl, 2);
  for (const bad of [4, -1, 1.5, "2", null])
    assert.equal(parseSubmit({ ...ok, pl: bad }).entry.pl, undefined, bad);
  const b = fresh();
  b.submit({ ...ok, pl: 2 }, 1);
  let r = b.submit({ ...ok, sc: 50, pl: 3 }, 2);
  assert.deepEqual(r.me, { rank: 1, n: "ACE", sc: 100, m: "free", pl: 2 });
  r = b.submit({ ...ok, sc: 300, pl: 1 }, 3);
  assert.equal(r.top[0].pl, 1, "the plane follows the best score");
});

test("a board from before plane types gains the column, and keeps its rows", () => {
  const db = new DatabaseSync(":memory:");
  const query = (sql, ...binds) => db.prepare(sql).all(...binds);
  query(`CREATE TABLE solo (
     id TEXT PRIMARY KEY, n TEXT NOT NULL, sc INTEGER NOT NULL,
     m TEXT NOT NULL, at INTEGER NOT NULL)`);
  query(`INSERT INTO solo VALUES (?, 'OLD', 700, 'classic', 1)`, id(9));
  const b = makeBoard(query);
  assert.deepEqual(b.read().top, [{ n: "OLD", sc: 700, m: "classic" }]);
  const r = b.submit({ id: id(1), n: "NEW", sc: 900, m: "free", pl: 3 }, 2);
  assert.deepEqual(r.top[0], { n: "NEW", sc: 900, m: "free", pl: 3 });
  makeBoard(query); // and opening it again is fine
});
