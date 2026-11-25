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

// protocol.js — what the players' machines say to each other, and its shape.
//
// Messages are small JSON objects with a one-letter-ish type `t`, sent to
// everyone in the match unless marked otherwise; the link knows which seat
// each came from. State updates are "fast" (net/link.js: may be lost, never
// resent); everything else is "sure". There is no host: every machine is the
// authority for its own plane (and, in Endless enemies, for the flyer at its
// seat); hits are decided by whoever is hit (or, for buildings, whoever
// dropped the bomb) and reported to everyone.
//
// Lobby (the organiser is whoever has been in the room longest)
//   hi     {v, h, n}                   to each player met: version, hash, name
//   setup  {v, layout, mode, map, ff, speed, roster: [[seat, team]]}
//                                      organiser: the match on offer
//   team   {team}                      to the organiser: put me on that team
//   board  {g, mode, list}             each: its copy of one mode of the
//                                      group board (one mode a message keeps
//                                      it under the server's MAX_MESSAGE)
//   go     {id}                        organiser: start (all count 3-2-1)
//   bad    {text}                      organiser, to a newcomer: a different
//                                      version, or a match already on
// Play
//   s      packed state (below)        each, 20 a second, fast
//   f      {o, d, s}                   I fired a round: origin, direction, speed
//   b      {p, v}                      I dropped a bomb: position, velocity
//   tg     {i, d}                      I did d damage to building i
//   down   {p, by}                     my plane is down at p; by: the seat
//                                      that shot it down, if one did
//   out    {}                          I have no planes left
//   ef     {o, d, s}                   my flyer fired a round
//   eh     {i, n}                      I hit flyer i, n times (1 if left out;
//                                      a missile is 3); its owner decides
//   ms     {o, d, s, to}               I launched a missile: origin,
//                                      direction, speed, and its target: a
//                                      seat, or "e" and a flyer's index
//   lk     {to, on}                    I am (on: 1) or no longer (0) locking
//                                      on to the plane in seat `to`
//   ek     {i, by}                     my flyer i is down; by: the seat that
//                                      gets the kill
//   fin    {id, sc, o, fl}             my match is over: its id, my final
//                                      score, whether I was out (o: 1), and
//                                      the teams whose flags I saw fall; the
//                                      result is settled from everyone's
//   bq     {g}                         send me your copy of group g's
//                                      board (I have only now worked it out)
//   bye    {}                          leaving
// Link (net/link.js)
//   rs     {ms: [message]}             sure messages resent through the
//                                      server after a data channel died
// Every message also carries the sender's running count, sq (sure) or fq
// (fast); the link reads it and takes it off.
//
// h is a player's hash and n their name (scores.js); g is the group board's
// id, a hash of every player's hash.

import { PLANES } from "../constants.js";

// Bump it whenever a message changes shape, and whenever the maps or planes
// change (constants.js MAPS, PLANES): builds with different maps would fly
// different worlds. tests/net-protocol.test.js holds each version's.
export const PROTO = 6;

// Messages worth nothing late: shown (or, for a flyer, counted) as they
// arrive, so net/link.js does not resend them after a data channel dies.
export const TRANSIENT = new Set(["f", "b", "ef", "ms", "eh"]);

const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(v * 10000) / 10000;

// The player's state, in about 150 bytes of JSON (200 with a flyer). `pl` is
// the plane type (constants.js PLANES), so the others draw the right one.
export function packState(P, S, enemy = null) {
  const m = {
    t: "s",
    p: [r2(P.pos.x), r2(P.pos.y), r2(P.pos.z)],
    q: [r4(P.q.x), r4(P.q.y), r4(P.q.z), r4(P.q.w)],
    v: r2(P.speed),
    h: r2(P.thr),
    a: P.alive ? 1 : 0,
    g: P.grounded ? 1 : 0,
    d: Math.round(P.dmg),
    sc: S.score,
    k: S.kills,
    l: Math.max(0, Math.min(99, S.lives)),
    pl: P.kind,
  };
  if (P.ghost) m.gh = 1;
  // Endless enemies: this machine's flyer, [x, y, z, qx, qy, qz, qw].
  if (enemy && enemy.alive)
    m.e = [
      r2(enemy.pos.x),
      r2(enemy.pos.y),
      r2(enemy.pos.z),
      r4(enemy.q.x),
      r4(enemy.q.y),
      r4(enemy.q.z),
      r4(enemy.q.w),
    ];
  return m;
}

export function unpackState(m) {
  const num = (x, d = 0) => (Number.isFinite(x) ? x : d);
  const vec = (a, n) =>
    Array.isArray(a) && a.length === n && a.every(Number.isFinite) ? a : null;
  const p = vec(m.p, 3),
    q = vec(m.q, 4);
  if (!p || !q) return null;
  return {
    p,
    q,
    speed: num(m.v),
    thr: num(m.h),
    alive: m.a === 1,
    grounded: m.g === 1,
    dmg: num(m.d),
    score: num(m.sc),
    kills: num(m.k),
    lives: num(m.l, 3),
    ghost: m.gh === 1,
    plane: Number.isInteger(m.pl) && PLANES[m.pl] ? m.pl : 0,
    enemy: vec(m.e, 7),
  };
}

export const v3 = (v) => [r2(v.x), r2(v.y), r2(v.z)];
export const unit3 = (v) => [r4(v.x), r4(v.y), r4(v.z)];
