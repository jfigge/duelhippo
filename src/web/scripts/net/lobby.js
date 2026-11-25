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

// lobby.js — the Team game screen: make or join a room, pick teams and a
// game, count down, start; and after a match, play again or leave.
//
// Whoever makes the room gets a code to give their friends; up to eight more
// type it in. There is no host in the game itself, but someone has to set it
// up: the organiser, who is whoever has the lowest seat in the room (so if
// they leave, the next one takes over). The organiser picks the team layout,
// the game and friendly fire, and keeps the roster of who is on which team;
// everyone else asks to change team, and sees the organiser's setup. Every
// player says hello to every other with their protocol version, hash and
// name, and the hashes of everyone on the roster name the group's scoreboard
// (scores.js), whose copies are swapped and merged as the roster settles.

import { $ } from "../util.js";
import { net } from "./bus.js";
import { serverUrl, serverHint } from "./config.js";
import { Mesh } from "./link.js";
import { PROTO } from "./protocol.js";
import { matchMessage, peerLeft } from "./match.js";
import {
  LAYOUTS,
  layout,
  MODES,
  TEAM,
  autoTeam,
  fitRoster,
  startable,
} from "./teams.js";
import {
  player,
  setName,
  matchName,
  cleanName,
  playerHash,
  groupId,
  groupBoard,
  mergeGroup,
  isHash,
  newMatchId,
  isMatchId,
} from "../scores.js";
import { renderGroup } from "../scoreboard.js";

const LOBBY = new Set(["hi", "setup", "team", "board", "go", "bad", "bye"]);
const COUNT_FROM = 3;

let act = null; // { startMatch, toTitle, speed }, from game.js
let link = null;
let playing = false;
let counting = false;
const people = new Map(); // seat → {h, n}: everyone who has said hello
let setup = blank();
let shownGroup = null;

function blank() {
  return { layout: "2x1", mode: "dogfight", ff: false, speed: 1, roster: [] };
}

const show = (id) => {
  for (const p of ["onMenu", "onEnter", "onRoom", "onCount"])
    $(p).classList.toggle("hidden", p !== id);
};
// A failed connection, with a pointer to `make server` on a dev build.
const failed = (err) =>
  status(
    err.message +
      (/reach the game server/.test(err.message) ? serverHint() : ""),
    true,
  );
const status = (text, bad = false) => {
  $("onMsg").textContent = text || "";
  $("onMsg").classList.toggle("bad", bad);
};

export function initLobby(actions) {
  act = actions;
  $("bOnline").addEventListener("click", openLobby);
  $("onHost").addEventListener("click", host);
  $("onJoin").addEventListener("click", () => {
    show("onEnter");
    status("");
    $("onCode").value = "";
    $("onCode").focus();
  });
  $("onGo").addEventListener("click", join);
  $("onCode").addEventListener("keydown", (e) => {
    if (e.key === "Enter") join();
  });
  $("onCode").addEventListener("input", () => {
    $("onCode").value = $("onCode")
      .value.toUpperCase()
      .replace(/[^A-Z]/g, "");
  });
  $("onName").value = player().name;
  $("onName").addEventListener("input", () => setName($("onName").value));
  $("onName").addEventListener("blur", () => {
    $("onName").value = player().name;
  });
  const sel = $("onLayout");
  for (const l of LAYOUTS) {
    const o = document.createElement("option");
    o.value = l.id;
    o.textContent =
      l.size === 1
        ? `${l.teams} solo players`
        : `${l.teams} teams of ${l.size}`;
    sel.append(o);
  }
  sel.addEventListener("change", () => organise({ layout: sel.value }));
  for (const b of document.querySelectorAll("[data-gmode]"))
    b.addEventListener("click", () => organise({ mode: b.dataset.gmode }));
  $("onFF").addEventListener("click", () => organise({ ff: !setup.ff }));
  $("onStart").addEventListener("click", go);
  $("onBack").addEventListener("click", leave);
}

export function openLobby() {
  $("title").classList.add("hidden");
  $("over").classList.add("hidden");
  $("online").classList.remove("hidden");
  show("onMenu");
  $("onLink").textContent = "";
  status(serverUrl() ? "" : "Team games aren't available in this build.", true);
  $("onHost").disabled = $("onJoin").disabled = !serverUrl();
}

// ── Making and joining a room ───────────────────────────────────────────────
async function host() {
  status("Making a room…");
  try {
    connected(await Mesh.open(serverUrl(), null, opts()));
  } catch (err) {
    return failed(err);
  }
  status("Give your friends this code. Up to nine can play.");
}

async function join() {
  const code = $("onCode").value.trim().toUpperCase();
  if (code.length !== 4) return status("Room codes are four letters.", true);
  status("Joining " + code + "…");
  try {
    connected(await Mesh.open(serverUrl(), code, opts()));
  } catch (err) {
    return failed(err);
  }
  status("Connecting to the others…");
}

// ?relay in the address forces the server relay, to test it.
const opts = () => ({ relayOnly: /[?&]relay\b/.test(window.location.search) });

function connected(m) {
  link = net.link = m;
  net.seat = m.seat;
  people.clear();
  people.set(m.seat, whoAmI());
  setup = blank();
  setup.speed = act.speed();
  setup.roster = [{ seat: m.seat, team: 0 }];
  shownGroup = null;
  m.onmessage = (msg, from) =>
    LOBBY.has(msg.t) ? lobbyMessage(msg, from) : matchMessage(msg, from);
  m.onpeer = (seat) =>
    m.send({ t: "hi", v: PROTO, ...whoAmI() }, false, [seat]);
  m.onpath = () => refresh();
  m.onleft = (seat) => gone(seat);
  m.onclose = (why) => {
    if (playing) for (const s of people.keys()) if (s !== net.seat) peerLeft(s);
    status(why, true);
    show("onMenu");
    link = net.link = null;
  };
  show("onRoom");
  $("onCodeShow").textContent = m.code;
  m.start();
  refresh();
}

const whoAmI = () => ({ h: playerHash(), n: matchName() });
const organiser = () => Math.min(link.seat, ...(link ? link.peers.keys() : []));
const amOrganiser = () => !!link && organiser() === link.seat;

function gone(seat) {
  people.delete(seat);
  if (playing) return peerLeft(seat);
  if (amOrganiser()) {
    setup.roster = setup.roster.filter((p) => p.seat !== seat);
    publish();
  }
  refresh();
}

// ── Messages ────────────────────────────────────────────────────────────────
function lobbyMessage(m, from) {
  switch (m.t) {
    case "hi":
      if (m.v !== PROTO) {
        link.send(
          {
            t: "bad",
            text: "Someone here has a different version of Duel Hippo. Update to play.",
          },
          false,
          [from],
        );
        return status("A player has a different version of Duel Hippo.", true);
      }
      people.set(from, {
        h: isHash(m.h) ? m.h : null,
        n: cleanName(m.n) || "Pilot",
      });
      if (amOrganiser()) {
        if (playing || counting)
          link.send(
            { t: "bad", text: "That game has already started." },
            false,
            [from],
          );
        else if (!setup.roster.some((p) => p.seat === from)) {
          setup.roster.push({
            seat: from,
            team: autoTeam(setup.roster, layout(setup.layout)),
          });
          publish();
        }
      }
      return refresh();
    case "setup":
      if (from !== organiser() || m.v !== PROTO || playing || counting) return;
      setup = cleanSetup(m);
      return refresh();
    case "team":
      if (!amOrganiser() || playing || counting) return;
      return moveTo(from, m.team);
    case "board":
      if (shownGroup && m.g === shownGroup.id) {
        mergeGroup(shownGroup.id, shownGroup.members, m);
        showBoard();
      }
      return;
    case "go":
      if (from !== organiser() || playing || counting) return;
      net.match = isMatchId(m.id) ? m.id : null;
      return countdown();
    case "bad":
      status(m.text, true);
      if (!playing) {
        link.close();
        link = net.link = null;
        show("onMenu");
      }
      return;
    case "bye":
      return gone(from);
  }
}

// What the organiser sent, checked.
function cleanSetup(m) {
  const lay = layout(m.layout) || layout("2x1");
  const roster = Array.isArray(m.roster)
    ? m.roster
        .filter(
          (r) =>
            Array.isArray(r) &&
            Number.isInteger(r[0]) &&
            Number.isInteger(r[1]) &&
            r[1] >= -1 &&
            r[1] < lay.teams,
        )
        .map(([seat, team]) => ({ seat, team }))
    : [];
  return {
    layout: lay.id,
    mode: MODES[m.mode] ? m.mode : "dogfight",
    ff: m.ff === true,
    speed: [0.25, 0.5, 0.75, 1].includes(m.speed) ? m.speed : 1,
    roster,
  };
}

// ── The organiser's controls ────────────────────────────────────────────────
function organise(change) {
  if (!amOrganiser() || counting) return;
  Object.assign(setup, change);
  if (change.layout)
    setup.roster = fitRoster(setup.roster, layout(setup.layout));
  publish();
  refresh();
}

function moveTo(seat, team) {
  const lay = layout(setup.layout);
  if (!Number.isInteger(team) || team < 0 || team >= lay.teams) return;
  const here = setup.roster.filter((p) => p.team === team && p.seat !== seat);
  if (here.length >= lay.size) return;
  const p = setup.roster.find((q) => q.seat === seat);
  if (!p) return;
  p.team = team;
  publish();
  refresh();
}

function publish() {
  if (!amOrganiser()) return;
  setup.speed = act.speed();
  link.send({
    t: "setup",
    v: PROTO,
    layout: setup.layout,
    mode: setup.mode,
    ff: setup.ff,
    speed: setup.speed,
    roster: setup.roster.map((p) => [p.seat, p.team]),
  });
}

function pickTeam(team) {
  if (counting || playing) return;
  if (amOrganiser()) moveTo(link.seat, team);
  else link.send({ t: "team", team }, false, [organiser()]);
}

// ── On screen ───────────────────────────────────────────────────────────────
function refresh() {
  if (!link) return;
  // A new organiser (the old one left) takes the roster over as it stands.
  if (amOrganiser()) {
    const lay = layout(setup.layout);
    const known = [link.seat, ...link.peers.keys()].filter((s) =>
      people.has(s),
    );
    const kept = setup.roster.filter((p) => known.includes(p.seat));
    for (const s of known)
      if (!kept.some((p) => p.seat === s))
        kept.push({ seat: s, team: autoTeam(kept, lay) });
    if (kept.length !== setup.roster.length) {
      setup.roster = kept;
      publish();
    }
  }
  const lay = layout(setup.layout);
  const boss = amOrganiser();
  $("onLayout").value = setup.layout;
  $("onLayout").disabled = !boss;
  for (const b of document.querySelectorAll("[data-gmode]")) {
    b.classList.toggle("on", b.dataset.gmode === setup.mode);
    b.disabled = !boss;
  }
  $("onFF").textContent = setup.ff ? "FRIENDLY FIRE ON" : "FRIENDLY FIRE OFF";
  $("onFF").classList.toggle("on", setup.ff);
  $("onFF").disabled = !boss;
  $("onDesc").textContent =
    describe() + (boss ? "" : " · The organiser sets the game.");

  // The teams, each a box to tap to join it.
  const grid = $("onTeams");
  grid.replaceChildren();
  for (let t = 0; t < lay.teams; t++) {
    const c = TEAM[t % TEAM.length];
    const box = document.createElement("button");
    box.className = "team";
    box.style.borderColor = c.css;
    const h = document.createElement("b");
    h.textContent = lay.size === 1 ? c.name : `${c.name} team`;
    h.style.color = c.css;
    box.append(h);
    const members = setup.roster.filter((p) => p.team === t);
    for (const p of members) {
      const s = document.createElement("span");
      s.textContent =
        (people.get(p.seat)?.n || "…") + (p.seat === link.seat ? " (you)" : "");
      if (p.seat === organiser()) s.className = "boss";
      box.append(s);
    }
    for (let i = members.length; i < lay.size; i++) {
      const s = document.createElement("span");
      s.className = "free";
      s.textContent = "open";
      box.append(s);
    }
    box.addEventListener("click", () => pickTeam(t));
    grid.append(box);
  }

  const n = link.paths();
  $("onLink").textContent =
    link.peers.size === 0
      ? ""
      : [
          n.direct && `${n.direct} DIRECT`,
          n.relay && `${n.relay} VIA SERVER`,
          n.connecting && `${n.connecting} CONNECTING`,
        ]
          .filter(Boolean)
          .join(" · ");

  const ready =
    startable(setup.roster, lay) &&
    link.settled &&
    setup.roster.every((p) => people.has(p.seat));
  $("onStart").classList.toggle("hidden", !boss);
  $("onStart").disabled = !ready || counting;
  syncBoard();
}

const describe = () =>
  MODES[setup.mode] +
  " · Free flight" +
  (setup.ff ? " · Friendly fire" : "") +
  (setup.speed < 1 ? ` · ${Math.round(setup.speed * 100)}% speed` : "");

// The group is everyone on the roster; its board follows the roster.
function syncBoard() {
  const hs = setup.roster.map((p) => people.get(p.seat)?.h);
  if (hs.length < 2 || hs.some((h) => !h) || new Set(hs).size !== hs.length) {
    shownGroup = null;
    $("onBoard").classList.add("hidden");
    return;
  }
  const id = groupId(hs);
  if (shownGroup?.id !== id) {
    shownGroup = { id, members: hs };
    link.send({ t: "board", g: id, ...groupBoard(id) });
  }
  showBoard();
}

function showBoard() {
  if (!shownGroup) return;
  renderGroup(
    $("onBoard"),
    groupBoard(shownGroup.id),
    setup.mode,
    playerHash(),
  );
  $("onBoard").classList.remove("hidden");
}

// ── Starting ────────────────────────────────────────────────────────────────
// The organiser starts a match (and every rematch) with a fresh id.
function go() {
  if (!amOrganiser() || counting) return;
  publish();
  net.match = newMatchId();
  link.send({ t: "go", id: net.match });
  countdown();
}

// 3, 2, 1 on every machine, then the match.
function countdown() {
  counting = true;
  $("title").classList.add("hidden");
  $("over").classList.add("hidden");
  $("online").classList.remove("hidden");
  show("onCount");
  status(describe());
  let n = COUNT_FROM;
  const tick = () => {
    if (!link) return (counting = false);
    if (n === 0) {
      counting = false;
      $("online").classList.add("hidden");
      return begin();
    }
    $("onCount").textContent = n--;
    setTimeout(tick, 1000);
  };
  tick();
}

function begin() {
  const lay = layout(setup.layout);
  net.mode = setup.mode;
  net.ff = setup.ff;
  net.teams = lay.teams;
  net.roster.clear();
  for (const p of setup.roster) {
    if (!people.has(p.seat) || p.team < 0) continue;
    net.roster.set(p.seat, {
      seat: p.seat,
      team: p.team,
      ...people.get(p.seat),
    });
  }
  net.me = people.get(link.seat);
  const hs = [...net.roster.values()].map((p) => p.h);
  net.group =
    hs.every(Boolean) && new Set(hs).size === hs.length ? groupId(hs) : null;
  playing = true;
  act.startMatch(setup);
}

// ── After a match ───────────────────────────────────────────────────────────
// Only the organiser restarts; everyone else waits for its "go". Anyone who
// left is gone from the roster by then.
export function matchEnded() {
  playing = false;
  if (link && amOrganiser()) {
    setup.roster = setup.roster.filter((p) => people.has(p.seat));
    publish();
  }
  return (
    !!link &&
    !link.closed &&
    amOrganiser() &&
    startable(setup.roster, layout(setup.layout))
  );
}

export function rematch() {
  if (link) go();
}

// Back to the title screen from anywhere, closing the connection.
export function leave() {
  if (link) {
    link.send({ t: "bye" });
    link.close();
  }
  link = net.link = null;
  playing = counting = false;
  net.me = net.group = net.match = null;
  people.clear();
  $("online").classList.add("hidden");
  act.toTitle();
}
