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

// scores.js — who this player is, and the two kinds of scoreboard.
//
// The player: a random id made the first time the game runs, kept on this
// device and never shown. Three-letter initials for the one-player board
// (short enough to leave little room for rude words; the server checks them
// too) and a free-text name for two-player games. All three live in storage
// under PLAYER_KEY.
//
// One player: a single board for everyone, on the match server (src/server/
// board.js). Each id has one row, its best, so two players who both chose
// "ACE" never overwrite each other. A score that cannot be sent (offline, no
// initials yet) waits in PENDING_KEY and goes with the next attempt.
//
// Two player: boards that live only on the players' devices. Each belongs to
// one group of players, named by a hash of their ids' hashes, so the same
// friends meeting again see their own board and a different line-up sees a
// different one. Raw ids never leave this device; only their hashes travel,
// so a friend cannot post to the one-player board as you. Every member keeps
// a copy, and the copies are merged whenever the group meets.
//
// Nothing here touches Math.random: the one-player game's sequence of random
// draws is the prototype's (CLAUDE.md), so ids come from crypto alone.

import { serverUrl } from "./net/config.js";
import { sha256 } from "./sha256.js";

export const PLAYER_KEY = "duelhippo.player";
export const PENDING_KEY = "duelhippo.pending";
export const GROUPS_KEY = "duelhippo.groups";

export const TOP = 10;
export const NAME_MAX = 12;
export const MAX_SCORE = 1_000_000; // as src/server/board.js
const MODES = ["classic", "free"];
const HEX64 = /^[0-9a-f]{64}$/;

// ── Storage ─────────────────────────────────────────────────────────────────
function load(key, fallback) {
  try {
    const v = JSON.parse(window.localStorage.getItem(key));
    return v && typeof v === "object" ? v : fallback;
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // No storage: it lasts the session.
  }
}

// ── The player ──────────────────────────────────────────────────────────────
// A version 4 UUID, by hand where randomUUID is missing (it needs a secure
// context). With no crypto at all there is no id, and no one-player board.
function makeId() {
  const c = window.crypto;
  if (!c) return null;
  if (typeof c.randomUUID === "function") return c.randomUUID();
  if (typeof c.getRandomValues !== "function") return null;
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

let me = null;
export function player() {
  if (me) return me;
  const saved = load(PLAYER_KEY, {});
  me = {
    id: typeof saved.id === "string" ? saved.id : makeId(),
    n: cleanInitials(saved.n) || "",
    name: cleanName(saved.name),
  };
  if (me.id !== saved.id) save(PLAYER_KEY, me);
  return me;
}

export function cleanInitials(v) {
  const s = String(v ?? "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  return s.length === 3 ? s : null;
}

// What a player may call themselves in a match: letters, digits and a little
// punctuation, up to NAME_MAX. Also applied to whatever a peer sends.
export function cleanName(v) {
  return String(v ?? "")
    .replace(/[^\p{L}\p{N} ._'-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NAME_MAX);
}

export function setInitials(v) {
  const n = cleanInitials(v);
  if (!n) return false;
  player().n = n;
  save(PLAYER_KEY, me);
  return true;
}

export function setName(v) {
  player().name = cleanName(v);
  save(PLAYER_KEY, me);
  return me.name;
}

// The name a match shows: the player's own, or their initials, or a default.
export const matchName = () => player().name || player().n || "Pilot";

// The id as other machines know it. Salted so the hash is this game's alone.
export const playerHash = () =>
  player().id ? sha256("duelhippo.player:" + player().id) : null;

export const groupId = (hashes) => sha256([...hashes].sort().join(","));

export const isHash = (h) => typeof h === "string" && HEX64.test(h);

// A match's id: the host makes it, and both machines file the match under it.
export function newMatchId() {
  const c = window.crypto;
  if (!c || typeof c.getRandomValues !== "function") return null;
  return [...c.getRandomValues(new Uint8Array(8))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export const isMatchId = (v) =>
  typeof v === "string" && /^[A-Za-z0-9-]{1,40}$/.test(v);

// ── One player: the shared board ────────────────────────────────────────────
// The match server's address, as http(s) for fetch; null in a build without
// one.
export function boardUrl() {
  const ws = serverUrl();
  return ws ? ws.replace(/^ws/, "http") + "/board/solo" : null;
}

async function call(method, body) {
  const url = boardUrl();
  if (!url || typeof window.fetch !== "function")
    throw new Error("no scoreboard");
  const ctl = new window.AbortController();
  const timer = window.setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await window.fetch(
      method === "GET" ? `${url}?id=${encodeURIComponent(player().id)}` : url,
      {
        method,
        signal: ctl.signal,
        // text/plain keeps it a "simple" request: no preflight.
        headers: { "content-type": "text/plain" },
        body: body && JSON.stringify(body),
      },
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "refused");
    return data;
  } finally {
    window.clearTimeout(timer);
  }
}

export const hasBoard = () => !!boardUrl() && !!player().id;

export const readBoard = () => call("GET");

// A finished one-player game. Sends it (with anything still waiting) if it
// can, and keeps the best unsent score if it cannot. Resolves to the board,
// or to {pending: true, reason}.
export async function submitSolo(sc, m) {
  const waiting = load(PENDING_KEY, null);
  let best = {
    sc: Math.max(0, Math.floor(sc)),
    m: MODES.includes(m) ? m : "classic",
  };
  if (waiting && Number.isInteger(waiting.sc) && waiting.sc > best.sc)
    best = {
      sc: waiting.sc,
      m: MODES.includes(waiting.m) ? waiting.m : "classic",
    };
  save(PENDING_KEY, best);
  return flushSolo();
}

// Sends whatever is waiting. With nothing waiting it just reads the board.
export async function flushSolo() {
  if (!hasBoard()) return { pending: true, reason: "none" };
  const waiting = load(PENDING_KEY, null);
  if (!waiting) return readBoard();
  if (!player().n) return { pending: true, reason: "initials" };
  try {
    const data = await call("POST", {
      id: player().id,
      n: player().n,
      sc: waiting.sc,
      m: waiting.m,
    });
    save(PENDING_KEY, null);
    return data;
  } catch {
    return { pending: true, reason: "offline" };
  }
}

// ── Two player: the group boards ────────────────────────────────────────────
// A group's board: {duel: [entry], coop: [entry]}, ten of each. An entry is
// one finished match:
//   {id, at, m, p: [[hash, name, score], …], w: winner's hash | null}
// Duels rank by the best single score in them, co-op games by the team's
// total; a tie goes to the earlier match.
const rankScore = (kind, e) =>
  kind === "coop"
    ? e.p.reduce((t, p) => t + p[2], 0)
    : Math.max(...e.p.map((p) => p[2]));

function cleanEntry(e, members) {
  if (!e || typeof e !== "object") return null;
  if (typeof e.id !== "string" || !/^[A-Za-z0-9-]{1,40}$/.test(e.id))
    return null;
  if (!Number.isFinite(e.at) || !MODES.includes(e.m) || !Array.isArray(e.p))
    return null;
  const p = [];
  for (const x of e.p) {
    if (!Array.isArray(x) || !HEX64.test(x[0])) return null;
    if (!Number.isInteger(x[2]) || x[2] < 0 || x[2] > MAX_SCORE) return null;
    p.push([x[0], cleanName(x[1]) || "Pilot", x[2]]);
  }
  // Exactly this group's players, once each.
  const hs = p.map((x) => x[0]);
  if (new Set(hs).size !== hs.length || hs.length !== members.length)
    return null;
  if (!hs.every((h) => members.includes(h))) return null;
  const w = HEX64.test(e.w) && hs.includes(e.w) ? e.w : null;
  // In hash order, so every member's copy of a match reads the same.
  p.sort((x, y) => (x[0] < y[0] ? -1 : 1));
  return { id: e.id, at: e.at, m: e.m, p, w };
}

// Two copies of a board made one. The same match on both keeps each
// player's higher score (scores only grow in a match, so the higher one is
// the later reading).
export function mergeLists(kind, a, b, members) {
  const byId = new Map();
  for (const raw of [...a, ...b]) {
    const e = cleanEntry(raw, members);
    if (!e) continue;
    const had = byId.get(e.id);
    if (!had) {
      byId.set(e.id, e);
      continue;
    }
    for (const x of had.p) {
      const y = e.p.find((q) => q[0] === x[0]);
      if (y && y[2] > x[2]) x[2] = y[2];
    }
    had.w = had.w || e.w;
  }
  return [...byId.values()]
    .sort((x, y) => rankScore(kind, y) - rankScore(kind, x) || x.at - y.at)
    .slice(0, TOP);
}

function allGroups() {
  return load(GROUPS_KEY, {});
}

// A group's board, empty if they have never finished a match together.
export function groupBoard(gid) {
  const g = allGroups()[gid];
  return {
    duel: Array.isArray(g?.duel) ? g.duel : [],
    coop: Array.isArray(g?.coop) ? g.coop : [],
  };
}

// Folds another copy (a peer's, or one new match) into this device's.
export function mergeGroup(gid, members, other) {
  const groups = allGroups(),
    mine = groupBoard(gid);
  const next = {
    duel: mergeLists("duel", mine.duel, other?.duel || [], members),
    coop: mergeLists("coop", mine.coop, other?.coop || [], members),
  };
  if (next.duel.length || next.coop.length) {
    groups[gid] = next;
    save(GROUPS_KEY, groups);
  }
  return next;
}

export function recordMatch(gid, members, kind, entry) {
  return mergeGroup(gid, members, { [kind]: [entry] });
}

export const rankOf = rankScore;
