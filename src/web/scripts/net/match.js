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

// match.js — a two-player match in progress: what this machine tells the
// other one each frame, and what it does with what it hears.
//
// Who decides what (net/protocol.js lists the messages):
//   - each machine flies its own plane and is the only judge of whether it
//     was hit or crashed; the other draws it from 20-a-second updates
//     (remote.js)
//   - shots and bombs are re-fired on the other machine for show; only the
//     plane they might hit, and the bomber's own machine for buildings,
//     count them
//   - in co-op the host flies the AI flyers, and the guest draws them from
//     the host's updates; the guest's hits on them are reported to the host
//
// The lobby (net/lobby.js) makes the connection and starts the match; game.js
// calls in here every frame while one is on.

import { V } from "../util.js";
import { S, game } from "../state.js";
import { say } from "../msg.js";
import { boom } from "../effects.js";
import { sfx } from "../audio.js";
import { camera } from "../scene.js";
import { applyTarget, rebuildSide, syncShadow } from "../world.js";
import { DUEL_TDEF } from "../constants.js";
import { P, crash } from "../flight.js";
import { enemies, killEnemy } from "../ai.js";
import { fire, showBomb } from "../weapons.js";
import { R, pushState, updRemote } from "../remote.js";
import { net, send, isHost, isGuest, isDuel, isCoop } from "./bus.js";
import { packState, unpackState } from "./protocol.js";

const SEND_EVERY_MS = 50;
const COLLIDE = 6.5; // the prototype's mid-air distance
const o = new V(),
  d = new V();

let lastSent = 0;
let out = false; // this machine has no planes left
let ended = false;
let onEnd = () => {};

// `finish(result)` is game.js's end-of-match screen.
export function beginMatch(finish) {
  lastSent = 0;
  out = ended = false;
  R.out = false;
  onEnd = finish;
  S.rebuild.host = S.rebuild.guest = 0;
}

// ── Every frame ─────────────────────────────────────────────────────────────
// `gdt` is game time (scaled by the host's speed); `now` is real time.
export function matchFrame(now, gdt, live) {
  updRemote(now, gdt);
  if (!live) return;
  if (isGuest() && isCoop()) guestEnemies(gdt);

  // Mid-air with the rival: each machine crashes its own plane.
  if (isDuel() && P.alive && R.alive && P.pos.distanceTo(R.pos) < COLLIDE)
    crash(P.pos, "Mid-air collision!");

  for (const side of ["host", "guest"])
    if (S.rebuild[side] > 0 && (S.rebuild[side] -= gdt) <= 0) {
      rebuildSide(side, DUEL_TDEF);
      say(
        side === net.role ? "Your town is rebuilt" : "Their town is rebuilt",
        2.5,
      );
    }

  if (now - lastSent >= SEND_EVERY_MS) {
    // On the beat, not on the frame: at 60 fps, "50 ms since the last one"
    // would wait for the fourth frame and send only 15 a second.
    lastSent = Math.max(lastSent + SEND_EVERY_MS, now - SEND_EVERY_MS);
    send(packState(P, S, isHost() && isCoop() ? enemies : null), true);
  }
}

// game.js calls this when the last plane is gone, instead of game over.
export function outOfPlanes() {
  if (out) return;
  out = true;
  send({ t: "out" });
  if (isDuel()) return end("lost");
  if (R.out) return end("over");
  say("Out of planes. Your wingman flies on.", 4);
}

function end(result) {
  if (ended) return;
  ended = true;
  onEnd(result);
}

// The other player went: the match cannot go on.
export function peerGone() {
  if (game.state === "play") end("left");
}

// ── What the other machine says ─────────────────────────────────────────────
export function matchMessage(m) {
  if (game.state !== "play") return;
  switch (m.t) {
    case "s": {
      const s = unpackState(m);
      if (!s) return;
      pushState(s, window.performance.now());
      if (isGuest() && isCoop() && s.enemies) hostEnemies(s.enemies);
      return;
    }
    case "f":
      if (vec(m.o, o) && vec(m.d, d) && Number.isFinite(m.s))
        fire(o, d, m.s, "r");
      return;
    case "b":
      if (vec(m.p, o) && vec(m.v, d)) showBomb(o, d);
      return;
    case "tg":
      return applyTarget(m.i, m.hp);
    case "down":
      if (vec(m.p, o)) boom(o.clone(), true);
      if (m.by === "you" && isDuel()) {
        S.score += 100;
        S.kills++;
        say("Rival shot down!  +100", 2);
      } else say(isDuel() ? "Your rival crashed" : "Your wingman is down", 1.6);
      return;
    case "out":
      R.out = true;
      if (isDuel()) return end("won");
      if (out) return end("over");
      say("Your wingman is out of planes", 3);
      return;
    case "ef":
      if (isGuest() && vec(m.o, o) && vec(m.d, d) && Number.isFinite(m.s)) {
        fire(o, d, m.s, "e");
        sfx.egun(camera.position.distanceTo(o));
      }
      return;
    case "eh":
      return isHost() && guestHit(m);
    case "ek":
      return isGuest() && hostKill(m);
  }
}

// Host: the guest hit a flyer, or flew into it.
function guestHit({ i, kill }) {
  const e = enemies[i];
  if (!e || !e.alive) return;
  if (kill || --e.hp <= 0) killEnemy(e, false, "guest");
}

// Guest: a flyer is down, and maybe by this player's hand.
function hostKill({ i, by }) {
  const e = enemies[i];
  if (!e || !e.alive) return;
  killEnemy(e, by === "guest");
  if (by === "host") say("Your wingman got one", 1.2);
}

// ── Co-op guest: the host's AI flyers ───────────────────────────────────────
// They arrive at 20 a second and are eased towards, which is smooth enough
// for planes that are not yours to fly. One the host stops mentioning for
// a second is put away (its "ek" will have said why).
function hostEnemies(list) {
  const now = window.performance.now();
  for (const [i, x, y, z, qx, qy, qz, qw] of list) {
    const e = enemies[i];
    if (!e) continue;
    if (!e.netP) e.netP = new V();
    if (!e.netQ) e.netQ = e.q.clone();
    e.netP.set(x, y, z);
    e.netQ.set(qx, qy, qz, qw);
    if (!e.alive) {
      e.alive = true;
      e.hp = 3;
      e.pos.copy(e.netP);
      e.q.copy(e.netQ);
      e.obj.visible = true;
    }
    e.seen = now;
  }
}

function guestEnemies(dt) {
  const now = window.performance.now(),
    k = 1 - Math.exp(-dt * 12);
  for (const [i, e] of enemies.entries()) {
    if (!e.alive || !e.netP) continue;
    if (now - e.seen > 1000) {
      e.alive = false;
      e.obj.visible = false;
      e.shadow.visible = false;
      continue;
    }
    e.pos.lerp(e.netP, k);
    e.q.slerp(e.netQ, k);
    e.obj.position.copy(e.pos);
    e.obj.quaternion.copy(e.q);
    e.obj.userData.prop.rotation.z += 50 * dt;
    syncShadow(e.shadow, e.pos, true);
    if (P.alive && P.pos.distanceTo(e.pos) < COLLIDE) {
      send({ t: "eh", i, kill: true });
      crash(P.pos, "Mid-air collision!");
    }
  }
}

function vec(a, into) {
  if (!Array.isArray(a) || a.length !== 3 || !a.every(Number.isFinite))
    return false;
  into.fromArray(a);
  return true;
}
