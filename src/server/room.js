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

// room.js — the rules of a room, kept free of Cloudflare's APIs so they can
// be tested under plain Node. worker.js wires them to a Durable Object.
//
// A room is up to MAX_SEATS WebSockets, one per player, each in a numbered
// seat (0 is whoever made the room). There is no host: once the players are
// in, every pair connects directly (WebRTC), and the room only introduces
// them, carries each pair's handshake, and relays game messages for a pair
// whose direct connection cannot be made. The server never looks inside the
// game; it reads only the envelope of what a player sends:
//
//   {t:"sig", to, …}         a handshake message for seat `to`
//   {t:"g", m, to?: [seat]}  a game message for those seats (all others if
//                            `to` is left out); relayed, one copy each
//
// and stamps `from` (the sender's seat) on what it passes on. The only
// messages the server writes itself are these:
//
//   {t:"room", code, seat, peers}  you are in room `code`, in `seat`; `peers`
//                                  are the seats already there
//   {t:"peer", seat}               a player has joined, in `seat`
//   {t:"left", seat}               the player in `seat` has gone
//   {t:"error", code, text}        and then the socket closes

// Room codes: four letters from an alphabet with nothing to misread — no I
// or L beside 1, no O beside 0, no U beside V. 22⁴ = 234,256 codes, retried
// on a collision, for rooms that last minutes.
export const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_LEN = 4;

// Three teams of three is the largest game.
export const MAX_SEATS = 9;

export function makeCode(random = Math.random) {
  let s = "";
  for (let i = 0; i < CODE_LEN; i++)
    s += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return s;
}

// What a player types, made into a code: case and stray spaces forgiven,
// anything else refused.
export function normaliseCode(raw) {
  const s = String(raw || "")
    .toUpperCase()
    .replace(/\s+/g, "");
  return s.length === CODE_LEN && [...s].every((c) => ALPHABET.includes(c))
    ? s
    : null;
}

// Close codes the client turns into words (net/link.js).
export const CLOSE = {
  taken: 4009, // a new room asked for a code already in use: the worker retries
  nogame: 4004, // joined a code nobody is in
  full: 4003, // every seat is taken
};

// A message a player may send through the room: text, short. A game state
// update is about 250 bytes; 8 KB leaves room for a WebRTC offer and a
// group scoreboard.
export const MAX_MESSAGE = 8192;

// A flood guard rather than a quota: a relayed player sends about 40
// messages a second (one copy, however many it is for), so 120 is a
// misbehaving client, whose surplus is dropped.
export const MAX_PER_SECOND = 120;

export function acceptable(message) {
  return typeof message === "string" && message.length <= MAX_MESSAGE;
}

// Who may come in. `present` is the set of seats already taken; a newcomer
// gets the lowest free one.
export function admit(kind, present) {
  if (kind === "host")
    return present.size
      ? { ok: false, close: CLOSE.taken, text: "That room is in use." }
      : { ok: true, seat: 0 };
  if (!present.size)
    return {
      ok: false,
      close: CLOSE.nogame,
      text: "No game with that code. Check it with your friends.",
    };
  for (let seat = 0; seat < MAX_SEATS; seat++)
    if (!present.has(seat)) return { ok: true, seat };
  return {
    ok: false,
    close: CLOSE.full,
    text: `That game already has ${MAX_SEATS} players.`,
  };
}

// Where a player's message goes, and what it becomes on the way: the seats
// to deliver to, and the text to deliver, with the sender stamped on. Null
// for anything the room does not carry.
export function route(text, from, present) {
  let m;
  try {
    m = JSON.parse(text);
  } catch {
    return null;
  }
  if (!m || typeof m !== "object") return null;
  const others = [...present].filter((s) => s !== from);
  if (m.t === "sig") {
    if (!Number.isInteger(m.to) || m.to === from || !present.has(m.to))
      return null;
    return { to: [m.to], text: JSON.stringify({ ...m, from }) };
  }
  if (m.t === "g") {
    const to = Array.isArray(m.to)
      ? others.filter((s) => m.to.includes(s))
      : others;
    if (!to.length) return null;
    return { to, text: JSON.stringify({ t: "g", m: m.m, from }) };
  }
  return null;
}

// A per-socket rate counter: true while under MAX_PER_SECOND in the current
// second.
export function underLimit(counter, now = Date.now()) {
  const second = Math.floor(now / 1000);
  if (counter.second !== second) {
    counter.second = second;
    counter.n = 0;
  }
  return ++counter.n <= MAX_PER_SECOND;
}
