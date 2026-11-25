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
// A room is two WebSockets: the host, who made it, and one guest, who typed
// its code in. The server never looks inside the game: it introduces the two
// players, carries their WebRTC handshake, and relays their game messages
// when a direct connection cannot be made. Everything a player sends is
// passed to the other player unchanged; the only messages the server writes
// itself are these:
//
//   {t:"room", code, role}   you are in room `code`, as "host" or "guest"
//   {t:"peer"}               (to the host) a guest has joined
//   {t:"left"}               the other player has gone
//   {t:"error", code, text}  and then the socket closes

// Room codes: four letters from an alphabet with nothing to misread — no I
// or L beside 1, no O beside 0, no U beside V. 22⁴ = 234,256 codes, retried
// on a collision, for rooms that last minutes.
export const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_LEN = 4;

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
  taken: 4009, // a host asked for a code already in use: the worker retries
  nogame: 4004, // joined a code nobody is hosting
  full: 4003, // the room already has its guest
  ended: 4000, // the host left
};

// A message a player may send through the room: text, short. A game state
// update is about 200 bytes; 8 KB leaves room for a WebRTC offer.
export const MAX_MESSAGE = 8192;

// A flood guard rather than a quota: the game sends about 40 messages a
// second when relayed, so 120 is a misbehaving client, whose surplus is
// dropped.
export const MAX_PER_SECOND = 120;

export function acceptable(message) {
  return typeof message === "string" && message.length <= MAX_MESSAGE;
}

// Who may come in. `present` is the set of roles already connected.
export function admit(kind, present) {
  if (kind === "host")
    return present.has("host") || present.has("guest")
      ? { ok: false, close: CLOSE.taken, text: "That room is in use." }
      : { ok: true, role: "host" };
  if (!present.has("host"))
    return {
      ok: false,
      close: CLOSE.nogame,
      text: "No game with that code. Check it with your friend.",
    };
  if (present.has("guest"))
    return {
      ok: false,
      close: CLOSE.full,
      text: "That game already has two players.",
    };
  return { ok: true, role: "guest" };
}

export const other = (role) => (role === "host" ? "guest" : "host");

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
