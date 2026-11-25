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

// protocol.js — what the two machines say to each other, and its shape.
//
// Messages are small JSON objects with a one-letter-ish type `t`. State
// updates are "fast" (net/link.js: may be lost, never resent); everything
// else is "sure". Every machine is the authority for its own plane, and the
// host for the AI flyers in co-op; hits are decided by whoever is hit (or,
// for buildings, whoever dropped the bomb) and reported to the other side.
//
// Lobby
//   hi     {v}                         guest → host, once connected
//   setup  {v, kind, mode, speed}      host → guest: the match on offer
//   go     {}                          host → guest: start (both count 3-2-1)
//   bad    {text}                      the versions differ: no match
// Play
//   s      packed state (below)        each side, 20 a second, fast
//   f      {o, d, s}                   I fired a round: origin, direction, speed
//   b      {p, v}                      I dropped a bomb: position, velocity
//   tg     {i, hp}                     building i now has hp (≤ 0: destroyed)
//   down   {p, by}                     my plane is down at p; by: "you" if you did it
//   out    {}                          I have no planes left
//   ef     {o, d, s}                   (co-op host) an AI flyer fired a round
//   eh     {i, kill}                   (co-op guest) I hit AI flyer i / flew into it
//   ek     {i, by}                     (co-op host) AI flyer i is down; by: "host" | "guest"
//   town   {side}                      (host) rebuild that side's buildings
//   bye    {}                          leaving the match

export const PROTO = 1;

const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(v * 10000) / 10000;

// The player's state, in about 150 bytes of JSON.
export function packState(P, S, enemies = null) {
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
    l: Math.max(0, S.lives),
  };
  // Co-op host: the AI flyers, [index, x, y, z, qx, qy, qz, qw] each.
  if (enemies)
    m.e = enemies.flatMap((e, i) =>
      e.alive
        ? [
            [
              i,
              r2(e.pos.x),
              r2(e.pos.y),
              r2(e.pos.z),
              r4(e.q.x),
              r4(e.q.y),
              r4(e.q.z),
              r4(e.q.w),
            ],
          ]
        : [],
    );
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
    enemies: Array.isArray(m.e) ? m.e.filter((e) => vec(e, 8)) : null,
  };
}

export const v3 = (v) => [r2(v.x), r2(v.y), r2(v.z)];
export const unit3 = (v) => [r4(v.x), r4(v.y), r4(v.z)];
