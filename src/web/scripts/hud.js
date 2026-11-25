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
// on phones); the reticle tracks every frame.

import { $, clamp, tv, basis } from "./util.js";
import { STALL, GEAR, HOME, EB, LANE } from "./constants.js";
import { camera } from "./scene.js";
import { S, game } from "./state.js";
import { tickMsg } from "./msg.js";
import { groundY, targets, hippos, fields } from "./world.js";
import { P, PB } from "./flight.js";
import { enemies } from "./ai.js";
import { remotes, teamScores } from "./remote.js";
import { net, isMode, myTeam } from "./net/bus.js";
import { TEAM } from "./net/teams.js";

let hudT = 0,
  rc = null,
  sc = null;

export function initHud() {
  rc = $("radar").getContext("2d");
  sc = $("strip").getContext("2d");
  drawMascot();
}

export function hud(dt) {
  tickMsg(dt);
  if (game.state !== "play") return;
  if (P.alive) {
    tv.copy(P.pos).addScaledVector(basis(P.q, PB).f, 260).project(camera);
    const r = $("ret");
    r.style.display = tv.z < 1 ? "block" : "none";
    r.style.transform = `translate(${(tv.x * 0.5 + 0.5) * window.innerWidth}px,${(-tv.y * 0.5 + 0.5) * window.innerHeight}px)`;
  } else $("ret").style.display = "none";
  if ((hudT -= dt) > 0) return;
  hudT = 0.1;
  const alt = Math.max(0, P.pos.y - groundY(P.pos.x, P.pos.z) - GEAR);
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
  if (net.on) teamPanel();
  $("bThr").style.width = P.thr * 100 + "%";
  $("bFuel").style.width = P.fuel + "%";
  $("bDmg").style.width = P.dmg + "%";
  $("thrFill").style.height = P.thr * 100 + "%";
  let w = "";
  if (P.alive) {
    if (P.fuel <= 0) w = "OUT OF FUEL — glide home";
    else if (P.fuel < 25) w = "LOW FUEL — return to base";
    else if (!P.grounded && P.speed < STALL) w = "STALL — nose down";
    else if (P.dmg >= 70 && P.dmg < 100) w = "HEAVY DAMAGE";
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

// Pixel-hippo pilot for the title card (original art).
function drawMascot() {
  const art = [
    "..11......11..",
    ".1221....1221.",
    ".111111111111.",
    "11113311331111",
    "11113311331111",
    "11111111111111",
    ".111111111111.",
    ".144111111441.",
    ".111111111111.",
    "..1111111111..",
    "...55555555...",
    "....55..55....",
  ];
  const pal = {
    1: "#9a95b8",
    2: "#ff9ec7",
    3: "#55ffff",
    4: "#3a3550",
    5: "#ff5555",
  };
  let s = "";
  art.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (pal[ch])
        s += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${pal[ch]}"/>`;
    }),
  );
  $("mascot").innerHTML =
    `<svg viewBox="0 0 14 12" shape-rendering="crispEdges" aria-hidden="true">${s}</svg>`;
}
