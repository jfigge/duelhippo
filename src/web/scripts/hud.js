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

// hud.js — the readouts card, warnings, gun reticle, radar and strip map.
//
// Classic mode draws the original's ground strip along the bottom; free mode
// draws a heading-up radar top right. Text readouts refresh at 10 Hz (cheap
// on phones); the reticle and the missile lock's box track every frame.

import { $, clamp, tv, basis } from "./util.js";
import { GEAR, HOME, EB, LANE, MSL, MAPS, UNLOCK } from "./constants.js";
import { camera } from "./scene.js";
import { S, game, mapOpen } from "./state.js";
import { tickMsg, say } from "./msg.js";
import { groundY, targets, hippos, fields } from "./world.js";
import { P, PB, aiming, idleAtHome } from "./flight.js";
import { sfx } from "./audio.js";
import { lock, locked, lockers, incoming } from "./missiles.js";
import { enemies } from "./ai.js";
import { remotes, teamScores } from "./remote.js";
import { net, isMode, myTeam } from "./net/bus.js";
import { TEAM } from "./net/teams.js";
import { run, COURSES, LIMITS, clock } from "./course.js";

let hudT = 0,
  warnT = 0,
  rc = null,
  sc = null;

export function initHud() {
  rc = $("radar").getContext("2d");
  sc = $("strip").getContext("2d");
  drawMascot();
}

// The plane just picked, in the top right corner for PLANE_TAG seconds: its
// name, role and what it carries.
const PLANE_TAG = 3;
let tagT = 0;
export function showPlane() {
  const [n, r, d] = $("planeTag").children;
  n.textContent = P.pt.name;
  r.textContent = P.pt.role;
  d.textContent = P.pt.blurb;
  $("planeTag").classList.add("on");
  tagT = PLANE_TAG;
}

// The box round what the sights are locking: it closes in as the lock
// builds, and says LOCK when it is made.
function lockBox() {
  const box = $("lock"),
    t = lock.tgt;
  if (!t || !aiming()) {
    box.style.display = "none";
    return;
  }
  // Drawing brings the camera's matrices up to date; headless, nothing draws.
  camera.updateMatrixWorld();
  tv.copy(t.pos).project(camera);
  if (tv.z >= 1) {
    box.style.display = "none";
    return;
  }
  const k = Math.min(1, lock.t / MSL.lock),
    size = Math.round(96 - 60 * k);
  box.style.display = "block";
  box.style.width = box.style.height = size + "px";
  box.style.transform = `translate(${(tv.x * 0.5 + 0.5) * window.innerWidth - size / 2}px,${(-tv.y * 0.5 + 0.5) * window.innerHeight - size / 2}px)`;
  box.classList.toggle("on", locked());
  box.firstChild.textContent = locked() ? "LOCK" : Math.floor(k * 100) + "%";
}

// A one-player game whose score has just earned a map says so, once. (It
// opens for good when the game ends and the score is recorded.)
const told = new Set();
function earned() {
  for (const id in UNLOCK)
    if (UNLOCK[id] && S.score > UNLOCK[id] && !mapOpen(id) && !told.has(id)) {
      told.add(id);
      say(`New map: ${MAPS[id]}! It opens when this flight ends`, 3);
    }
}

export function hud(dt) {
  tickMsg(dt);
  $("hud").classList.toggle("ads", game.state === "play" && aiming());
  if (tagT > 0 && (tagT -= dt) <= 0) $("planeTag").classList.remove("on");
  if (game.state !== "play") return;
  if (P.alive) {
    tv.copy(P.pos).addScaledVector(basis(P.q, PB).f, 260).project(camera);
    const r = $("ret");
    r.style.display = tv.z < 1 ? "block" : "none";
    r.style.transform = `translate(${(tv.x * 0.5 + 0.5) * window.innerWidth}px,${(-tv.y * 0.5 + 0.5) * window.innerHeight}px)`;
  } else $("ret").style.display = "none";
  lockBox();
  if ((hudT -= dt) > 0) return;
  hudT = 0.1;
  if (!net.on) earned();
  const alt = Math.max(0, P.pos.y - groundY(P.pos.x, P.pos.z, P.pos.y) - GEAR);
  $("hScore").textContent = S.score;
  $("hLives").textContent = isMode("flag")
    ? S.lives > 0
      ? "∞"
      : 0
    : P.ghost
      ? "GHOST"
      : Math.max(0, S.lives);
  $("hKills").textContent = S.kills;
  $("hSpd").textContent = Math.round(P.speed * 3.6);
  $("hAlt").textContent = Math.round(alt);
  $("hAmmo").textContent = Math.floor(P.ammo);
  $("hBombs").textContent = P.bombs;
  $("hPlane").textContent = P.pt.name;
  $("hMslRow").classList.toggle("hidden", !P.pt.missiles);
  $("hMsl").textContent = P.msl;
  // The obstacle course: the ring to fly next, and the clock.
  $("hCourseRow").classList.toggle("hidden", !run.on);
  if (run.on) {
    const RINGS = COURSES[run.level];
    $("hRing").textContent =
      `${Math.min(run.next + 1, RINGS.length)}/${RINGS.length}`;
    $("hTime").textContent = `${clock(run.t)} / ${clock(LIMITS[run.level])}`;
  }
  $("bMsl").classList.toggle("on", locked());
  $("planes").classList.toggle("hidden", !idleAtHome());
  if (net.on) teamPanel();
  $("bThr").style.width = P.thr * 100 + "%";
  $("bFuel").style.width = P.fuel + "%";
  $("bDmg").style.width = P.dmg + "%";
  $("thrFill").style.height = P.thr * 100 + "%";
  let w = "";
  const chased = P.alive && incoming(),
    lockedOn = P.alive && lockers.size > 0;
  if (P.alive) {
    if (chased) w = "MISSILE — break hard!";
    else if (P.spin)
      w =
        game.mode === "classic"
          ? "SPIN — push, throttle off"
          : "SPIN — push, throttle off, opposite rudder";
    else if (lockedOn) w = "LOCKED ON — shake them off";
    else if (P.fuel <= 0) w = "OUT OF FUEL — glide home";
    else if (P.fuel < 25) w = "LOW FUEL — return to base";
    else if (!P.grounded && P.speed < P.pt.stall) w = "STALL — nose down";
    else if (P.dmg >= 70 && P.dmg < 100) w = "HEAVY DAMAGE";
  }
  // Being locked, or chased, beeps: faster for a missile on its way.
  if ((chased || lockedOn) && (warnT -= 0.1) <= 0) {
    warnT = chased ? 0.2 : 0.6;
    sfx.warn();
  }
  $("warn").textContent = w;
  $("warn").classList.toggle("on", !!w);
  if (game.mode === "classic") drawStrip();
  else drawRadar();
}

function drawRadar() {
  const c = $("radar"),
    W = c.width,
    R = W / 2,
    range = 2400;
  rc.clearRect(0, 0, W, W);
  rc.fillStyle = "rgba(6,8,18,.66)";
  rc.beginPath();
  rc.arc(R, R, R - 2, 0, 7);
  rc.fill();
  rc.strokeStyle = "rgba(85,255,255,.35)";
  rc.lineWidth = 2;
  for (const k of [0.33, 0.66, 1]) {
    rc.beginPath();
    rc.arc(R, R, (R - 4) * k, 0, 7);
    rc.stroke();
  }
  const f = basis(P.q, PB).f,
    fl = Math.hypot(f.x, f.z) || 1,
    fx = f.x / fl,
    fz = f.z / fl;
  const dot = (x, z, col, s) => {
    const dx = x - P.pos.x,
      dz = z - P.pos.z,
      sx = ((dx * -fz + dz * fx) / range) * (R - 6),
      sy = (-(dx * fx + dz * fz) / range) * (R - 6);
    const d = Math.hypot(sx, sy),
      k = d > R - 8 ? (R - 8) / d : 1;
    rc.fillStyle = col;
    rc.fillRect(R + sx * k - s / 2, R + sy * k - s / 2, s, s);
  };
  if (net.on)
    for (const f of fields)
      dot(
        f.x,
        f.z,
        TEAM[f.team % TEAM.length].css,
        f.team === myTeam() ? 14 : 10,
      );
  else {
    dot(HOME.x, HOME.z, "#55ffff", 14);
    dot(EB.x, EB.z, "#ff55ff", 10);
  }
  // The obstacle course's next ring, and the one after.
  const RINGS = run.on ? COURSES[run.level] : [];
  if (run.on)
    for (let i = run.next + 1; i >= run.next; i--)
      if (RINGS[i])
        dot(
          RINGS[i].c.x,
          RINGS[i].c.z,
          i === run.next ? "#ffe66b" : "#55ffff",
          i === run.next ? 12 : 8,
        );
  for (const t of targets)
    if (t.alive)
      dot(
        t.x,
        t.z,
        t.kind === "flag" ? TEAM[t.side % TEAM.length].css : "#ffff55",
        7,
      );
  for (const e of enemies) if (e.alive) dot(e.pos.x, e.pos.z, "#ff55ff", 9);
  for (const r of remotes.values())
    if (r.alive)
      dot(
        r.pos.x,
        r.pos.z,
        r.ghost ? "#8a8a9a" : TEAM[r.team % TEAM.length].css,
        12,
      );
  rc.fillStyle = "#fff";
  rc.beginPath();
  rc.moveTo(R, R - 10);
  rc.lineTo(R - 7, R + 8);
  rc.lineTo(R + 7, R + 8);
  rc.fill();
}

// The original's ground map, along the bottom.
function drawStrip() {
  const c = $("strip"),
    W = c.width,
    H = c.height,
    x0 = LANE.min - 100,
    x1 = LANE.max + 100;
  const X = (x) => ((x - x0) / (x1 - x0)) * W,
    Y = (y) => H - 8 - clamp(y / 800, 0, 1) * (H - 16);
  sc.clearRect(0, 0, W, H);
  sc.fillStyle = "rgba(6,8,18,.66)";
  sc.fillRect(0, 0, W, H);
  sc.fillStyle = "#3c6e2c";
  sc.fillRect(0, H - 8, W, 8);
  sc.fillStyle = "#55ffff";
  sc.fillRect(
    X(HOME.x - HOME.hl),
    H - 8,
    X(HOME.x + HOME.hl) - X(HOME.x - HOME.hl),
    4,
  );
  sc.fillStyle = "#ff55ff";
  sc.fillRect(X(EB.x - EB.hl), H - 8, X(EB.x + EB.hl) - X(EB.x - EB.hl), 4);
  sc.fillStyle = "#ffff55";
  for (const t of targets) if (t.alive) sc.fillRect(X(t.x) - 3, H - 16, 6, 8);
  sc.fillStyle = "#b4afcf";
  for (const h of hippos) if (h.alive) sc.fillRect(X(h.x) - 2, H - 12, 5, 4);
  sc.fillStyle = "#ff55ff";
  for (const e of enemies)
    if (e.alive) sc.fillRect(X(e.pos.x) - 4, Y(e.pos.y) - 4, 8, 8);
  if (P.alive) {
    sc.fillStyle = "#fff";
    sc.fillRect(X(P.pos.x) - 5, Y(P.pos.y) - 5, 10, 10);
  }
}

// The HUD's team rows: each team's colour, score, and how many of its
// players are still flying (or, in Bomb the flag, whether its flag stands).
function teamPanel() {
  const scores = teamScores();
  const rows = [];
  for (let t = 0; t < net.teams; t++) {
    const seats = [...net.roster.values()].filter((p) => p.team === t);
    if (!seats.length) continue;
    const flying = seats.filter((p) =>
      p.seat === net.seat ? !P.ghost && S.lives > 0 : !remotes.get(p.seat)?.out,
    ).length;
    const flag = targets.find((x) => x.kind === "flag" && x.side === t);
    const state = isMode("flag")
      ? flag && flag.alive
        ? "FLAG"
        : "OUT"
      : flying
        ? `${flying}/${seats.length}`
        : "OUT";
    rows.push([t, scores[t], state]);
  }
  const box = $("hTeams");
  // Rebuilt only when it changes: it is read ten times a second.
  const key = JSON.stringify(rows);
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.replaceChildren(
    ...rows.map(([t, sc, st]) => {
      const row = document.createElement("div");
      row.className = "row" + (t === myTeam() ? " mine" : "");
      const name = document.createElement("span");
      name.textContent = TEAM[t % TEAM.length].name.toUpperCase();
      name.style.color = TEAM[t % TEAM.length].css;
      const score = document.createElement("b");
      score.textContent = sc;
      const tag = document.createElement("span");
      tag.textContent = st;
      row.append(name, score, tag);
      return row;
    }),
  );
}

// The hippo pilot for the title card (original art): ears, cyan goggles-eyes,
// nostrils and a red scarf, in the HUD's colours.
function drawMascot() {
  $("mascot").innerHTML = `<svg viewBox="0 0 140 124" aria-hidden="true">
    <ellipse cx="32" cy="20" rx="15" ry="14" fill="#9a95b8"/>
    <ellipse cx="108" cy="20" rx="15" ry="14" fill="#9a95b8"/>
    <ellipse cx="32" cy="22" rx="8" ry="7" fill="#ff9ec7"/>
    <ellipse cx="108" cy="22" rx="8" ry="7" fill="#ff9ec7"/>
    <rect x="8" y="16" width="124" height="90" rx="44" fill="#9a95b8"/>
    <rect x="16" y="62" width="108" height="40" rx="20" fill="#a9a4c6"/>
    <ellipse cx="50" cy="46" rx="11" ry="12" fill="#55ffff"/>
    <ellipse cx="90" cy="46" rx="11" ry="12" fill="#55ffff"/>
    <circle cx="53" cy="42" r="3.5" fill="#fff"/>
    <circle cx="93" cy="42" r="3.5" fill="#fff"/>
    <ellipse cx="34" cy="78" rx="8" ry="4.5" fill="#3a3550"/>
    <ellipse cx="106" cy="78" rx="8" ry="4.5" fill="#3a3550"/>
    <path d="M34 102 Q70 112 106 102 L104 114 Q70 122 36 114 Z" fill="#ff5555"/>
    <path d="M80 110 L92 124 L100 118 L90 108 Z" fill="#e04848"/>
  </svg>`;
}
