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

// match.js — a team game in progress: what this machine tells the others
// each frame, what it does with what it hears, and when the match is over.
//
// There is no host. Who decides what (net/protocol.js lists the messages):
//   - each machine flies its own plane and is the only judge of whether it
//     was hit or crashed; the others draw it from 20-a-second updates
//     (remote.js)
//   - shots and bombs are re-fired on every other machine for show; only
//     the plane they might hit, and the bomber's own machine for buildings,
//     count them
//   - in Endless enemies each machine flies the flyer at its seat; hits on
//     it are reported to that machine, which says when it falls and to whom
//
// Every machine works out for itself when the match is over, from what all
// of them have said (who is out, who has left, whose flag has fallen); they
// hear the same things, so they agree. Endless enemies is won on points,
// and a machine's last state update can be a kill behind, so its winner
// waits for everyone's final score ("fin").
//
//   Dogfight          three planes each; a team is out when all its players
//                     are; the last team flying wins
//   Bomb the flag     planes without end, while the team's flag stands; the
//                     last flag standing wins
//   Endless enemies   three planes each, then fly on as a ghost that can only
//                     bomb the town; over when every player is out of planes,
//                     and the team with the most points wins
//
// The lobby (net/lobby.js) makes the connections and starts the match;
// game.js calls in here every frame while one is on.

import { V } from "../util.js";
import { S, game } from "../state.js";
import { say } from "../msg.js";
import { boom } from "../effects.js";
import { sfx } from "../audio.js";
import { camera } from "../scene.js";
import { applyTarget, syncShadow, ghostly } from "../world.js";
import { P, crash, resetPlayer } from "../flight.js";
import { enemies, killEnemy, ownsEnemy, ensureEnemies } from "../ai.js";
import { fire, showBomb } from "../weapons.js";
import {
  remotes,
  addRemote,
  pushState,
  updRemotes,
  solidRemotes,
} from "../remote.js";
import { net, send, myTeam, teamOf, canHurt, isMode } from "./bus.js";
import { packState, unpackState } from "./protocol.js";
import { TEAM } from "./teams.js";
import { recordMatch, MAX_SCORE } from "../scores.js";

const SEND_EVERY_MS = 50;
const COLLIDE = 6.5; // the prototype's mid-air distance
const o = new V(),
  d = new V();

let lastSent = 0;
let ended = false;
let onEnd = () => {};
const out = new Set(); // seats out of planes (or knocked out)
const gone = new Set(); // seats that have left
const flagsDown = new Set(); // teams whose flag has fallen

// When the match ends each machine says its final score ("fin"). Endless
// enemies names its winner from them, and the group scoreboard files the
// match with them, once every player still here has sent one (or after
// FIN_WAIT_MS, with the last scores heard).
const FIN_WAIT_MS = 3000;
const fins = new Map(); // seat → final score
let finTimer = 0;
let counting = false; // Endless enemies: over, waiting for the final scores
let rec = null;
let onRecord = () => {};

const nameOf = (seat) => net.roster.get(seat)?.n || "Pilot";
const teamName = (t) => TEAM[t % TEAM.length].name;

// `finish({result, winner})` is game.js's end-of-match screen;
// `recorded(board, id)` shows the group's board with this match on it.
export function beginMatch(finish, recorded = () => {}) {
  lastSent = 0;
  ended = false;
  out.clear();
  gone.clear();
  flagsDown.clear();
  fins.clear();
  counting = false;
  window.clearTimeout(finTimer);
  onEnd = finish;
  onRecord = recorded;
  net.onFlag = flagFell;
  for (const p of net.roster.values())
    if (p.seat !== net.seat) addRemote(p.seat, p.team);
  if (isMode("endless")) ensureEnemies(Math.max(...net.roster.keys()) + 1);
  for (const e of enemies) e.respawnT = 3;
  if (rec) window.clearTimeout(rec.timer);
  // Taken now: leaving the lobby clears `net` before a late "fin" can land.
  rec =
    net.group && net.match && net.me
      ? {
          group: net.group,
          id: net.match,
          mode: net.mode,
          players: [...net.roster.values()].map((p) => ({ ...p })),
          mine: null,
          winner: null,
          done: false,
          timer: 0,
        }
      : null;
}

// ── Every frame ─────────────────────────────────────────────────────────────
// `gdt` is game time (scaled by the organiser's speed); `now` is real time.
export function matchFrame(now, gdt, live) {
  updRemotes(now, gdt);
  if (!live) return;
  if (isMode("endless")) othersEnemies(gdt);

  // Mid-air with another plane: each machine crashes its own.
  if (P.alive && !P.ghost)
    for (const r of solidRemotes())
      if (canHurt(r.seat) && P.pos.distanceTo(r.pos) < COLLIDE) {
        crash(P.pos, "Mid-air collision!");
        break;
      }

  if (now - lastSent >= SEND_EVERY_MS) {
    // On the beat, not on the frame: at 60 fps, "50 ms since the last one"
    // would wait for the fourth frame and send only 15 a second.
    lastSent = Math.max(lastSent + SEND_EVERY_MS, now - SEND_EVERY_MS);
    const mine = isMode("endless") ? enemies[net.seat] : null;
    send(packState(P, S, mine), true);
  }
}

// game.js calls this when this player's last plane is gone, instead of
// game over. In Endless enemies the player flies on as a ghost.
export function outOfPlanes() {
  if (isMode("endless")) {
    if (!P.ghost) {
      P.ghost = true;
      ghostly(P.obj, true);
      markOut(net.seat, true);
      say("Out of planes! Fly on as a ghost: bomb the town for your team", 4);
    }
    if (!ended) resetPlayer();
    return;
  }
  if (out.has(net.seat)) return;
  markOut(net.seat, true);
  say("Out of planes. Your team flies on.", 4);
}

function markOut(seat, announce = false) {
  if (out.has(seat)) return;
  out.add(seat);
  if (announce) send({ t: "out" });
  const r = remotes.get(seat);
  if (r) r.out = true;
  checkEnd();
}

// A team's flag is down (world.js): that team is out at once.
function flagFell(team) {
  if (!isMode("flag") || flagsDown.has(team)) return;
  flagsDown.add(team);
  for (const p of net.roster.values())
    if (p.team === team) {
      out.add(p.seat);
      const r = remotes.get(p.seat);
      if (r) r.out = true;
    }
  if (team === myTeam()) {
    S.lives = 0;
    if (P.alive) {
      boom(P.pos, true);
      P.alive = false;
      P.obj.visible = false;
      P.shadow.visible = false;
    }
    game.respawnT = Infinity;
    say("Your flag is down. Your team is out!", 4);
  } else say(teamName(team) + " is out!", 3);
  checkEnd();
}

// The teams still in it, by the rules of the mode.
function teamsIn() {
  const alive = new Set();
  for (const p of net.roster.values()) {
    if (gone.has(p.seat)) continue;
    if (isMode("flag") ? flagsDown.has(p.team) : out.has(p.seat)) continue;
    alive.add(p.team);
  }
  return alive;
}

function checkEnd() {
  if (ended || !net.on) return;
  if (isMode("endless")) {
    const flying = [...net.roster.values()].some(
      (p) => !gone.has(p.seat) && !out.has(p.seat),
    );
    if (!flying) end();
    return;
  }
  const alive = teamsIn();
  if (alive.size <= 1) end(alive.size ? [...alive][0] : null);
}

// The match is over here. `winner` is a team, or null for a draw; Endless
// enemies leaves it out, to be settled from the final scores.
function end(winner) {
  if (ended) return;
  ended = true;
  send({ t: "fin", sc: S.score });
  if (winner !== undefined) return report(winner);
  counting = true;
  onEnd({ result: "counting" });
  if (!settle()) finTimer = window.setTimeout(() => settle(true), FIN_WAIT_MS);
}

function report(winner, team = undefined) {
  const result =
    winner === null ? "draw" : winner === myTeam() ? "won" : "lost";
  onEnd({ result, winner, team });
  if (!rec) return;
  rec.mine = S.score;
  rec.winner = winner;
  if (!file()) rec.timer = window.setTimeout(() => file(true), FIN_WAIT_MS);
}

// Everyone still here has sent a final score.
const allIn = () =>
  [...net.roster.values()].every(
    (p) => p.seat === net.seat || gone.has(p.seat) || fins.has(p.seat),
  );
const finalScore = (seat) =>
  seat === net.seat
    ? S.score
    : (fins.get(seat) ?? remotes.get(seat)?.score ?? 0);

// Endless enemies: the team with the most points, from the final scores
// (or, `late`, from what has been heard).
function settle(late = false) {
  if (!counting || (!late && !allIn())) return false;
  counting = false;
  window.clearTimeout(finTimer);
  const totals = new Array(net.teams).fill(0);
  for (const p of net.roster.values()) totals[p.team] += finalScore(p.seat);
  const best = Math.max(...totals);
  const top = totals.flatMap((s, t) => (s === best ? [t] : []));
  report(top.length === 1 ? top[0] : null, totals[myTeam()]);
  return true;
}

// Someone left. In a match they are out of it for good.
export function peerLeft(seat) {
  if (game.state !== "play" || gone.has(seat)) return;
  gone.add(seat);
  const r = remotes.get(seat);
  if (r) {
    r.gone = r.out = true;
    r.alive = false;
  }
  // Their flyer goes with them.
  const e = enemies[seat];
  if (e && isMode("endless")) hide(e);
  say(nameOf(seat) + " left the match", 2.5);
  checkEnd();
}

// ── What the others say ─────────────────────────────────────────────────────
export function matchMessage(m, from) {
  // Final scores come after the match, either side of our own end.
  if (m.t === "fin") return gotFin(m, from);
  if (game.state !== "play" || !net.roster.has(from)) return;
  switch (m.t) {
    case "s": {
      const s = unpackState(m);
      if (!s) return;
      pushState(from, s, window.performance.now());
      if (isMode("endless")) theirEnemy(from, s.enemy);
      return;
    }
    case "f":
      if (vec(m.o, o) && vec(m.d, d) && Number.isFinite(m.s))
        fire(o, d, m.s, "r", from);
      return;
    case "b":
      if (vec(m.p, o) && vec(m.v, d)) showBomb(o, d);
      return;
    case "tg":
      return applyTarget(m.i, m.d);
    case "down":
      if (vec(m.p, o)) boom(o.clone(), true);
      if (m.by === net.seat) {
        if (teamOf(from) === myTeam())
          say("You shot down " + nameOf(from) + ", your teammate!", 2);
        else {
          S.score += 100;
          S.kills++;
          say("Shot down " + nameOf(from) + "!  +100", 2);
        }
      } else if (Number.isInteger(m.by) && net.roster.has(m.by))
        say(nameOf(m.by) + " shot down " + nameOf(from), 1.6);
      else say(nameOf(from) + " crashed", 1.6);
      return;
    case "out":
      if (!out.has(from)) say(nameOf(from) + " is out of planes", 2.5);
      if (isMode("endless")) {
        const r = remotes.get(from);
        if (r) r.ghost = true;
      }
      return markOut(from);
    case "ef":
      if (vec(m.o, o) && vec(m.d, d) && Number.isFinite(m.s)) {
        fire(o, d, m.s, "e");
        sfx.egun(camera.position.distanceTo(o));
      }
      return;
    case "eh":
      return hitMine(m, from);
    case "ek":
      return theirKill(m, from);
  }
}

// ── Endless enemies: the flyers ─────────────────────────────────────────────
// Ours, hit by another player's rounds: its owner (this machine) decides.
function hitMine({ i }, from) {
  const e = enemies[i];
  if (!isMode("endless") || !e || !e.alive || !ownsEnemy(e)) return;
  if (--e.hp <= 0) killEnemy(e, false, from);
}

// Another machine's flyer is down, and maybe by this player's hand.
function theirKill({ i, by }, from) {
  const e = enemies[i];
  if (!e || i !== from) return;
  if (e.alive) {
    boom(e.pos, false);
    hide(e);
  }
  if (by === net.seat) {
    S.score += 100;
    S.kills++;
    say("Enemy down!  +100", 1.4);
  }
}

function hide(e) {
  e.alive = false;
  e.obj.visible = false;
  e.shadow.visible = false;
}

// Another machine's flyer, from its owner's state update. Eased towards,
// which is smooth enough for planes that are not ours to fly; one the owner
// stops mentioning for a second is put away.
function theirEnemy(seat, a) {
  const e = enemies[seat];
  if (!e || !a) return;
  if (!e.netP) e.netP = new V();
  if (!e.netQ) e.netQ = e.q.clone();
  e.netP.set(a[0], a[1], a[2]);
  e.netQ.set(a[3], a[4], a[5], a[6]);
  if (!e.alive) {
    e.alive = true;
    e.hp = 3;
    e.pos.copy(e.netP);
    e.q.copy(e.netQ);
    e.obj.visible = true;
  }
  e.seen = window.performance.now();
}

function othersEnemies(dt) {
  const now = window.performance.now(),
    k = 1 - Math.exp(-dt * 12);
  for (const [i, e] of enemies.entries()) {
    if (i === net.seat || !e.alive || !e.netP) continue;
    if (now - e.seen > 1000) {
      hide(e);
      continue;
    }
    e.pos.lerp(e.netP, k);
    e.q.slerp(e.netQ, k);
    e.obj.position.copy(e.pos);
    e.obj.quaternion.copy(e.q);
    e.obj.userData.prop.rotation.z += 50 * dt;
    syncShadow(e.shadow, e.pos, true);
    if (P.alive && !P.ghost && P.pos.distanceTo(e.pos) < COLLIDE) {
      send({ t: "eh", i });
      crash(P.pos, "Mid-air collision!");
    }
  }
}

// ── The group scoreboard ────────────────────────────────────────────────────
function gotFin(m, from) {
  if (!Number.isInteger(m.sc) || m.sc < 0 || m.sc > MAX_SCORE) return;
  if (!net.roster.has(from)) return;
  fins.set(from, m.sc);
  if (counting) settle();
  else if (rec && rec.mine !== null) file();
}

// Files the match once every player still here has given a final score
// (or, `late`, with what is known). True when filed.
function file(late = false) {
  if (!rec || rec.done || rec.mine === null) return false;
  if (!late && !allIn()) return false;
  rec.done = true;
  window.clearTimeout(rec.timer);
  const entry = {
    id: rec.id,
    at: Date.now(),
    m: "free",
    p: rec.players.map((p) => [
      p.h,
      p.n,
      p.seat === net.seat ? rec.mine : finalScore(p.seat),
      p.team,
    ]),
    w: rec.winner,
  };
  const board = recordMatch(
    rec.group,
    rec.players.map((p) => p.h),
    rec.mode,
    entry,
  );
  onRecord(board, entry.id);
  return true;
}

function vec(a, into) {
  if (!Array.isArray(a) || a.length !== 3 || !a.every(Number.isFinite))
    return false;
  into.fromArray(a);
  return true;
}
