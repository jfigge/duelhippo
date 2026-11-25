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

// board.js — the one-player scoreboard's rules, kept free of Cloudflare's
// APIs so they run under plain Node. worker.js wires them to a Durable
// Object's SQLite storage; the tests use node:sqlite. Both are reached
// through `query(sql, ...binds) → rows`.
//
// One row per player. A player is the random id their game made the first
// time it ran, never shown to anyone, so two players who both pick "ACE" are
// two rows, and a player's new best replaces their own row and nobody
// else's. Names are three letters A–Z: short enough to leave little room for
// rude words, checked here as well as in the game.
//
// Ranking is by score, then by who got there first: a later tie does not
// push an earlier player down.

export const TOP = 10;
export const MODES = ["classic", "free"];

// The game makes ids with crypto.randomUUID (or the same shape by hand).
const ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const INITIALS = /^[A-Z]{3}$/;

// A ceiling on what a game can believably score, so a forged submission
// cannot park an absurd number at the top for good. A long, very good
// one-player game scores in the tens of thousands.
export const MAX_SCORE = 1_000_000;

export const parseId = (v) =>
  typeof v === "string" && ID.test(v.toLowerCase()) ? v.toLowerCase() : null;

export function parseInitials(v) {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  return INITIALS.test(s) ? s : null;
}

// A submission from the game: {id, n, sc, m}. Anything else is refused,
// with a reason for the developer reading the response.
export function parseSubmit(body) {
  if (!body || typeof body !== "object") return { error: "not an object" };
  const id = parseId(body.id);
  if (!id) return { error: "bad id" };
  const n = parseInitials(body.n);
  if (!n) return { error: "initials are three letters, A to Z" };
  const sc = body.sc;
  if (!Number.isInteger(sc) || sc < 0 || sc > MAX_SCORE)
    return { error: "bad score" };
  const m = MODES.includes(body.m) ? body.m : null;
  if (!m) return { error: "bad mode" };
  return { entry: { id, n, sc, m } };
}

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS solo (
     id TEXT PRIMARY KEY,
     n  TEXT NOT NULL,
     sc INTEGER NOT NULL,
     m  TEXT NOT NULL,
     at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS solo_rank ON solo (sc DESC, at ASC)`,
];

export function makeBoard(query) {
  for (const sql of SCHEMA) query(sql);

  // Where a player stands: 1 + everyone ahead of them.
  function standing(id) {
    const [me] = query(`SELECT n, sc, m, at FROM solo WHERE id = ?`, id);
    if (!me) return null;
    const [{ ahead }] = query(
      `SELECT COUNT(*) AS ahead FROM solo WHERE sc > ? OR (sc = ? AND at < ?)`,
      me.sc,
      me.sc,
      me.at,
    );
    return { rank: Number(ahead) + 1, n: me.n, sc: Number(me.sc), m: me.m };
  }

  // The top ten, the player's own place, and how many are on the board. Ids
  // never leave the server: the game finds its own row by its rank.
  function read(id = null) {
    const top = query(
      `SELECT n, sc, m FROM solo ORDER BY sc DESC, at ASC LIMIT ?`,
      TOP,
    ).map((r) => ({ n: r.n, sc: Number(r.sc), m: r.m }));
    const [{ total }] = query(`SELECT COUNT(*) AS total FROM solo`);
    return { top, me: id ? standing(id) : null, total: Number(total) };
  }

  // A game's score. A higher one replaces the player's best (and its mode
  // and time); a lower one changes nothing but the name, so new initials
  // show at once.
  function submit({ id, n, sc, m }, now = Date.now()) {
    query(
      `INSERT INTO solo (id, n, sc, m, at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         n  = excluded.n,
         m  = CASE WHEN excluded.sc > solo.sc THEN excluded.m  ELSE solo.m  END,
         at = CASE WHEN excluded.sc > solo.sc THEN excluded.at ELSE solo.at END,
         sc = MAX(solo.sc, excluded.sc)`,
      id,
      n,
      sc,
      m,
      now,
    );
    return read(id);
  }

  return { read, submit };
}
