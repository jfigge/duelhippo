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

// teams.js — the shape of a team game: the layouts on offer, the teams'
// colours, where their airfields go, and who joins which team. Pure: no
// three.js, no DOM, so the lobby, the world and the tests can all share it.

import { CX } from "../constants.js";

// Teams × players per team. Nine players (three teams of three) is the most
// the match server seats.
export const LAYOUTS = [
  [4, 2],
  [4, 1],
  [3, 3],
  [3, 2],
  [3, 1],
  [2, 4],
  [2, 3],
  [2, 2],
  [2, 1],
  [8, 1],
  [7, 1],
  [6, 1],
  [5, 1],
].map(([teams, size]) => ({ id: `${teams}x${size}`, teams, size }));

export const layout = (id) => LAYOUTS.find((l) => l.id === id) || null;

export const MODES = {
  dogfight: "Dogfight",
  flag: "Bomb the flag",
  endless: "Endless enemies",
};

// Each team's plane colours, as makePlane takes them (body, wing, trim,
// dark), and the colour the HUD and lobby use. Team 0 wears the one-player
// plane's cyan. None is the enemy's magenta.
export const TEAM = [
  {
    name: "Cyan",
    plane: [0xf2f2ea, 0x3fd8e8, 0x55ffff, 0x14a0b4],
    css: "#55ffff",
  },
  {
    name: "Orange",
    plane: [0xf2efe6, 0xd2561a, 0xff7a2a, 0x8a3a10],
    css: "#ffaa4a",
  },
  {
    name: "Green",
    plane: [0xeef2e6, 0x5ad35a, 0x7aff7a, 0x2a8a2a],
    css: "#7aff7a",
  },
  {
    name: "Yellow",
    plane: [0xf2f2ea, 0xffd84a, 0xffff55, 0xb49a14],
    css: "#ffff55",
  },
  {
    name: "Red",
    plane: [0xf0e6e6, 0xe04a4a, 0xff6a6a, 0x8a1f1f],
    css: "#ff6a6a",
  },
  {
    name: "Blue",
    plane: [0xe6eaf2, 0x4a6ae0, 0x7a9aff, 0x1f2f8a],
    css: "#8aa8ff",
  },
  {
    name: "White",
    plane: [0x3a3a3a, 0xdedede, 0xffffff, 0x777777],
    css: "#ffffff",
  },
  {
    name: "Violet",
    plane: [0xefe6f2, 0xa06ae0, 0xc89aff, 0x5a2a8a],
    css: "#c89aff",
  },
];

// The airfields: one per team, evenly round a ring in the flat play area
// (half-width 2700 about CX, constants.js). The ring is turned so that no
// field lands on the classic lane along z = 0, where the old runways, the
// enemy town and the hippos are. Runways all point along x, as the landing
// rules expect.
export const RING = 1900;
const CLEAR_Z = 250;

export function fieldSpots(teams) {
  const step = (2 * Math.PI) / teams;
  let best = 0,
    bestClear = -1;
  for (let i = 0; i < 90; i++) {
    const off = (step * i) / 90;
    let clear = Infinity;
    for (let k = 0; k < teams; k++)
      clear = Math.min(clear, Math.abs(RING * Math.sin(off + k * step)));
    if (clear > bestClear + 1e-6) {
      bestClear = clear;
      best = off;
    }
  }
  return Array.from({ length: teams }, (_, k) => {
    const a = best + k * step;
    return {
      x: Math.round(CX + RING * Math.cos(a)),
      z: Math.round(RING * Math.sin(a)),
    };
  });
}
export const fieldsClearOfLane = (teams) =>
  fieldSpots(teams).every((f) => Math.abs(f.z) >= CLEAR_Z);

// A newcomer's team: the emptiest one with room, the first of those on a
// tie. `roster` is [{team}]; returns -1 when every team is full.
export function autoTeam(roster, lay) {
  let pick = -1,
    fewest = Infinity;
  for (let t = 0; t < lay.teams; t++) {
    const n = roster.filter((p) => p.team === t).length;
    if (n < lay.size && n < fewest) {
      fewest = n;
      pick = t;
    }
  }
  return pick;
}

// A roster fitted to a (new) layout: players keep their team where it
// still exists and has room; the rest are placed afresh. Seat order
// decides who keeps a place.
export function fitRoster(roster, lay) {
  const out = [];
  for (const p of [...roster].sort((a, b) => a.seat - b.seat)) {
    const n = out.filter((q) => q.team === p.team).length;
    const keep = p.team >= 0 && p.team < lay.teams && n < lay.size;
    out.push({ ...p, team: keep ? p.team : autoTeam(out, lay) });
  }
  return out;
}

// Ready to start: at least two teams with someone on them, and nobody left
// without a team.
export function startable(roster, lay) {
  if (!lay || roster.some((p) => p.team < 0 || p.team >= lay.teams))
    return false;
  return new Set(roster.map((p) => p.team)).size >= 2;
}
