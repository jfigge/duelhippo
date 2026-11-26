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
// up: the organiser, who is whoever has been in the room longest (so if
// they leave, the next to have come takes over, and a newcomer never does).
// The organiser picks the team layout, the game, the map and friendly fire,
// and keeps the roster of who is on which team; everyone else asks to
// change team, and sees the organiser's setup. Every
// player says hello to every other with their protocol version, hash and
// name, and the hashes of everyone on the roster name the group's scoreboard
// (scores.js), whose copies are swapped and merged as the roster settles.

import { $, setLabel, mapButton, mapButtons } from "../util.js";
import { net } from "./bus.js";
import { serverUrl, serverHint } from "./config.js";
import { Mesh } from "./link.js";
import { PROTO } from "./protocol.js";
import { MAPS } from "../constants.js";
import { mapOpen } from "../state.js";
import { matchMessage, peerLeft, abandonMatch, settleNow } from "./match.js";
import {
  LAYOUTS,
  layout,
  MODES,
  RULES,
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
  BOARD_MODES,
  isHash,
  newMatchId,
  isMatchId,
} from "../scores.js";
import { renderGroup } from "../scoreboard.js";

const LOBBY = new Set([
  "hi",
  "setup",
  "team",
  "board",
  "bq",
  "go",
  "bad",
  "bye",
]);
const COUNT_FROM = 3;

let act = null; // { startMatch, toTitle, speed, map, rosterChanged }, game.js
let link = null;
let playing = false;
let counting = false;
let connecting = false; // a room being made or joined: one at a time
let tries = 0; // counts attempts, so one given up on (Back) is dropped
const people = new Map(); // seat → {h, n}: everyone who has said hello
let setup = blank();
let shownGroup = null;
let rosterKey = ""; // the roster and organiser game.js last heard of
let quiet = false;
let lastOrganiser = null; // the organiser refresh() last saw
// seat → the last setup from someone not (yet, here) the organiser. A new
// organiser's first setup can arrive before the news that the old one has
// gone; it is used once that news comes.
const early = new Map();
// The organiser's latest setup while this machine was still in a match
// (and so not taking setups): applied when the match is over here.
let afterMatch = null;
// The match the countdown is for, fixed at its "go": seat, team and hello
// of each player, so a leave racing the countdown's end cannot give two
// machines different rosters (begin()).
let lineUp = [];
let countdowns = 0; // numbers each countdown, so an abandoned one stops

function blank() {
  return {
    layout: "2x1",
    mode: "dogfight",
    map: "field",
    ff: false,
    speed: 1,
    roster: [],
  };
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
  mapButtons($("onMaps"), "lmap");
  for (const b of document.querySelectorAll("[data-lmap]"))
    b.addEventListener("click", () => {
      if (mapOpen(b.dataset.lmap)) organise({ map: b.dataset.lmap });
    });
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
  status(
    serverUrl() ? "" : "Multi-player games aren't available in this build.",
    true,
  );
  $("onHost").disabled = $("onJoin").disabled = !serverUrl();
}

// ── Making and joining a room ───────────────────────────────────────────────
const host = () =>
  connect(
    null,
    "Making a room…",
    "Give your friends this code. Up to nine can play.",
  );

function join() {
  const code = $("onCode").value.trim().toUpperCase();
  if (code.length !== 4) return status("Room codes are four letters.", true);
  return connect(code, "Joining " + code + "…", "Connecting to the others…");
}

// A second click (or Enter) while the first is still connecting would open
// a second seat for the same player.
async function connect(code, doing, done) {
  if (connecting || link) return;
  connecting = true;
  const mine = ++tries;
  status(doing);
  let m;
  try {
    m = await Mesh.open(serverUrl(), code, opts());
  } catch (err) {
    if (mine === tries) failed(err);
    return;
  } finally {
    if (mine === tries) connecting = false;
  }
  // Given up on (Back) while it connected.
  if (mine !== tries) return m.close();
  connected(m);
  status(done);
}

// ?relay in the address forces the server relay, to test it.
const opts = () => ({ relayOnly: /[?&]relay\b/.test(window.location.search) });

function connected(m) {
  if (link && link !== m) link.close();
  link = net.link = m;
  net.seat = m.seat;
  people.clear();
  people.set(m.seat, whoAmI());
  setup = blank();
  setup.speed = act.speed();
  // The organiser's first offer is the map they fly alone.
  setup.map = act.map();
  setup.roster = [{ seat: m.seat, team: 0 }];
  shownGroup = null;
  rosterKey = "";
  lastOrganiser = null;
  early.clear();
  afterMatch = null;
  m.onmessage = (msg, from, n) =>
    LOBBY.has(msg.t) ? lobbyMessage(msg, from) : matchMessage(msg, from, n);
  m.onpeer = (seat) =>
    m.send({ t: "hi", v: PROTO, ...whoAmI() }, false, [seat]);
  m.onpath = (seat) => {
    // Boards sent while the path was still being found may not have
    // arrived; merging is idempotent, so they go again once it is.
    if (!playing) sendBoard([seat]);
    refresh();
  };
  m.onleft = (seat) => gone(seat);
  m.onclose = (why) => {
    if (link === m) dropped(why);
  };
  show("onRoom");
  $("onCodeShow").textContent = m.code;
  m.start();
  refresh();
}

const whoAmI = () => ({ h: playerHash(), n: matchName() });
const organiser = () => link.organiser;
export const amOrganiser = () => !!link && organiser() === link.seat;

// Our own connection to the server is gone. A match on now ends here with
// no result and nothing filed: losing the connection is nobody's win, and
// the others, whose server tells them we left, play on without us.
function dropped(why) {
  const inMatch = net.on;
  link = net.link = null;
  playing = counting = false;
  people.clear();
  net.me = net.group = net.match = null;
  if (inMatch) {
    abandonMatch();
    act.toTitle();
    openLobby();
  } else show("onMenu");
  status(why, true);
}

// Out of the room by our own choice (a different version, a map this build
// lacks, a match already on): back to the Team game menu, saying why. A
// setup kept from a match can do this as the match ends, with the over card
// up: that match is left as dropped() leaves one, a moment later, since
// game.js shows the card again once matchEnded() has returned.
function quitRoom(why) {
  if (link) link.close();
  link = net.link = null;
  playing = counting = false;
  people.clear();
  if (!net.on) {
    show("onMenu");
    return status(why, true);
  }
  net.me = net.group = net.match = null;
  window.setTimeout(() => {
    if (link || !net.on) return; // already left, or in a new room
    abandonMatch();
    act.toTitle();
    openLobby();
    status(why, true);
  }, 0);
}

function gone(seat) {
  people.delete(seat);
  // match.js ignores anyone who is not in the match; after it, a seat that
  // leaves before its final score is not waited for.
  if (net.on) peerLeft(seat);
  early.delete(seat);
  if (playing) return;
  // In the countdown the roster stands as sent with "go"; begin() leaves
  // out whoever has gone.
  if (amOrganiser() && !counting) {
    setup.roster = setup.roster.filter((p) => p.seat !== seat);
    publish();
  }
  refresh();
}

// ── Messages ────────────────────────────────────────────────────────────────
function lobbyMessage(m, from) {
  switch (m.t) {
    case "hi":
      if (m.v !== PROTO) return otherVersion(from);
      people.set(from, {
        h: isHash(m.h) ? m.h : null,
        n: cleanName(m.n) || "Pilot",
      });
      if (amOrganiser()) {
        if (playing || counting)
          link.send(
            {
              t: "bad",
              text: "That game has already started. Try again when it's over.",
            },
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
      if (m.v !== PROTO || counting) return;
      if (from !== organiser()) return void early.set(from, m);
      if (playing) return void (afterMatch = m);
      early.clear();
      if (takeSetup(m)) refresh();
      return;
    case "team":
      if (!amOrganiser() || playing || counting) return;
      return moveTo(from, m.team);
    // Someone has just worked the group out, and missed the copies sent
    // before they had.
    case "bq":
      if (shownGroup && m.g === shownGroup.id) sendBoard([from]);
      return;
    case "board":
      if (
        shownGroup &&
        m.g === shownGroup.id &&
        BOARD_MODES.includes(m.mode) &&
        Array.isArray(m.list)
      ) {
        mergeGroup(shownGroup.id, shownGroup.members, { [m.mode]: m.list });
        showBoard();
      }
      return;
    case "go":
      if (from !== organiser() || counting) return;
      // A rematch while this machine is still waiting for the last match's
      // final scores (the organiser has had them all): the last match is
      // settled now with what has been heard, or this player would miss the
      // next one and, never out of it, hold it up for everyone.
      if (playing) {
        settleNow();
        matchEnded();
        if (!link) return; // its setup was one this build cannot play
      }
      // A roster without us (the organiser started before our hello reached
      // it): no match for us; the organiser's "bad" or next setup follows.
      if (!setup.roster.some((p) => p.seat === link.seat && p.team >= 0))
        return;
      net.match = isMatchId(m.id) ? m.id : null;
      return countdown();
    // Only the organiser turns anyone away, so a newcomer on another build
    // cannot send everyone else home.
    case "bad":
      if (from !== organiser() || amOrganiser() || playing || counting) return;
      return quitRoom(String(m.text ?? "").slice(0, 200));
    case "bye":
      return gone(from);
  }
}

// A hello from a different version of the game. Whoever came last goes: a
// newcomer that finds the room on another version leaves on its own, and
// the organiser tells one that comes to ours why (an older build leaves on
// that). Everyone else just leaves them out.
function otherVersion(from) {
  if (link.order.indexOf(from) < link.order.indexOf(link.seat)) {
    return quitRoom(
      "This game is on a different version of Duel Hippo. Update to play.",
    );
  }
  if (amOrganiser())
    link.send(
      {
        t: "bad",
        text: "Someone here has a different version of Duel Hippo. Update to play.",
      },
      false,
      [from],
    );
}

// The organiser's setup, made ours; false (and out of the room) for one this
// build cannot play.
function takeSetup(m) {
  const next = cleanSetup(m);
  if (!next) {
    quitRoom(
      "The organiser picked a map this version of Duel Hippo doesn't have. Update to play.",
    );
    return false;
  }
  setup = next;
  return true;
}

// What the organiser sent, checked; null for a map this build lacks, which
// would build a different world here.
function cleanSetup(m) {
  if (!Object.hasOwn(MAPS, m.map)) return null;
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
    map: m.map,
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
    map: setup.map,
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
  if (lastOrganiser !== organiser()) {
    lastOrganiser = organiser();
    // A new organiser, its setup maybe already here.
    if (!amOrganiser() && early.has(lastOrganiser)) {
      const m = early.get(lastOrganiser);
      early.clear();
      if (!takeSetup(m)) return;
    }
  }
  // A new organiser (the old one left) takes the roster over as it stands;
  // never in a match or its countdown, whose roster everyone already has.
  if (amOrganiser() && !playing && !counting) {
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
  // The organiser offers the maps they have earned; the others see theirs.
  for (const b of document.querySelectorAll("[data-lmap]")) {
    const id = b.dataset.lmap;
    if (boss) mapButton(b, id, setup.map);
    else {
      b.textContent = MAPS[id];
      b.classList.toggle("on", id === setup.map);
      b.classList.remove("locked");
      b.disabled = true;
    }
  }
  setLabel($("onFF"), "Friendly fire", setup.ff ? "on" : "off");
  $("onFF").classList.toggle("on", setup.ff);
  $("onFF").disabled = !boss;
  $("onDesc").textContent =
    describe() + (boss ? "" : " · The organiser sets the game.");
  $("onRules").textContent = RULES[setup.mode];

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

  $("onStart").classList.toggle("hidden", !boss);
  $("onStart").disabled = !ready() || counting;
  syncBoard();
  noteRoster();
}

// A match can start: two teams or more, nobody without one, everyone's
// hello heard and every path settled.
const ready = () =>
  !!link &&
  startable(setup.roster, layout(setup.layout)) &&
  link.settled &&
  setup.roster.every((p) => people.has(p.seat));

// game.js's over card shows Play again to the organiser while a match can
// be made; it hears of every change that could alter that.
function noteRoster() {
  if (!link || playing || counting) return;
  const key = JSON.stringify([
    organiser(),
    setup.layout,
    setup.roster,
    [...people.keys()],
    link.settled,
  ]);
  if (key === rosterKey) return;
  rosterKey = key;
  if (!quiet) act.rosterChanged?.();
}

const describe = () =>
  MODES[setup.mode] +
  " · " +
  MAPS[setup.map] +
  " · Full 3D" +
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
    sendBoard();
    // And ask for theirs: copies sent before this machine knew the group
    // were dropped.
    link.send({ t: "bq", g: id });
  }
  showBoard();
}

// One mode a message: all three of a nine-player group's together would be
// over the server's MAX_MESSAGE (src/server/room.js) and never arrive.
function sendBoard(to = null) {
  if (!shownGroup || !link) return;
  const board = groupBoard(shownGroup.id);
  for (const mode of BOARD_MODES)
    if (board[mode].length)
      link.send(
        { t: "board", g: shownGroup.id, mode, list: board[mode] },
        false,
        to,
      );
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
  if (!amOrganiser() || counting || playing || !ready()) return;
  publish();
  net.match = newMatchId();
  link.send({ t: "go", id: net.match });
  countdown();
}

// 3, 2, 1 on every machine, then the match. One abandoned (Back, a lost
// connection) stops, even if a new room is open by its next tick.
function countdown() {
  counting = true;
  const mine = link,
    run = ++countdowns;
  lineUp = setup.roster
    .filter((p) => p.team >= 0)
    .map((p) => ({ seat: p.seat, team: p.team, who: people.get(p.seat) }));
  $("title").classList.add("hidden");
  $("over").classList.add("hidden");
  $("online").classList.remove("hidden");
  show("onCount");
  status(describe());
  let n = COUNT_FROM;
  const tick = () => {
    if (link !== mine || run !== countdowns || !counting) return;
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
  net.map = setup.map;
  net.ff = setup.ff;
  net.teams = lay.teams;
  net.roster.clear();
  for (const p of lineUp) {
    const who = people.get(p.seat) || p.who || { h: null, n: "Pilot" };
    net.roster.set(p.seat, { seat: p.seat, team: p.team, ...who });
  }
  net.me = people.get(link.seat);
  const hs = [...net.roster.values()].map((p) => p.h);
  net.group =
    hs.every(Boolean) && new Set(hs).size === hs.length ? groupId(hs) : null;
  playing = true;
  act.startMatch(setup);
  // Anyone who left during the countdown is in the match, and out of it.
  for (const p of lineUp)
    if (p.seat !== link.seat && !link.peers.has(p.seat)) peerLeft(p.seat);
}

// ── After a match ───────────────────────────────────────────────────────────
// Only the organiser restarts; everyone else waits for its "go". Anyone who
// left is gone from the roster by then. True when this player can start
// another now. game.js calls it again on every rosterChanged.
export function matchEnded() {
  if (playing) {
    playing = false;
    if (link && amOrganiser()) {
      setup.roster = setup.roster.filter((p) => people.has(p.seat));
      publish();
    }
    // The organiser's setups sent while we were still in the match.
    if (afterMatch && !amOrganiser()) {
      const m = afterMatch;
      afterMatch = null;
      if (!takeSetup(m)) return false;
    }
    afterMatch = null;
    // Catch the lobby up on what changed during the match, without telling
    // game.js, which is asking.
    quiet = true;
    try {
      refresh();
    } finally {
      quiet = false;
    }
  }
  return !!link && !link.closed && amOrganiser() && ready();
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
  if (net.on) abandonMatch();
  link = net.link = null;
  tries++;
  playing = counting = connecting = false;
  afterMatch = null;
  net.me = net.group = net.match = null;
  people.clear();
  $("online").classList.add("hidden");
  act.toTitle();
}
