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

// scoreboard.js — the scoreboards on screen: the one-player board (its own
// card, opened from the title and game-over cards), the initials it needs,
// and the two-player group board shown in the lobby and after a match.
//
// Names on a group board come from the other player's machine, so every row
// is built with textContent, never innerHTML.

import { $ } from "./util.js";
import { PLANES } from "./constants.js";
import { TEAM } from "./net/teams.js";
import {
  player,
  setInitials,
  hasBoard,
  readBoard,
  submitSolo,
  flushSolo,
  rankOf,
} from "./scores.js";

const MODE = { classic: "Classic", free: "Free" };
// A row's tag: its mode, and the plane it was flown in (older scores have
// none).
const tag = (e) => MODE[e.m] + (PLANES[e.pl] ? " · " + PLANES[e.pl].name : "");
let backTo = "title"; // the card the board was opened from

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function row(rank, name, score, tag, mine = false) {
  const li = el("li", mine ? "mine" : "");
  li.append(
    el("span", "rk", rank),
    el("span", "nm", name),
    el("b", "", String(score)),
    el("i", "", tag || ""),
  );
  return li;
}

// ── One player ──────────────────────────────────────────────────────────────
const place = (me, total) =>
  me ? `You are #${me.rank} of ${total} worldwide` : "";

function showBoard(data) {
  const list = $("scList");
  list.replaceChildren();
  if (!data.top.length) {
    $("scMsg").textContent = "No scores yet. Be the first!";
    return;
  }
  data.top.forEach((e, i) =>
    list.append(row(i + 1, e.n, e.sc, tag(e), data.me?.rank === i + 1)),
  );
  // Outside the top ten: the player's own row under a gap.
  if (data.me && data.me.rank > data.top.length) {
    list.append(el("li", "gap", "⋯"));
    list.append(row(data.me.rank, data.me.n, data.me.sc, tag(data.me), true));
  }
  $("scMsg").textContent = place(data.me, data.total);
}

async function refresh() {
  $("scList").replaceChildren();
  if (!hasBoard()) {
    $("scMsg").textContent = "This build has no scoreboard server.";
    return;
  }
  $("scMsg").textContent = "Loading…";
  const data = await flushSolo().catch(() => null);
  if (data && !data.pending) return showBoard(data);
  try {
    showBoard(await readBoard());
  } catch {
    $("scMsg").textContent = "Can't reach the scoreboard right now.";
  }
}

export function openScores(from) {
  backTo = from;
  $(from).classList.add("hidden");
  $("scores").classList.remove("hidden");
  $("scInitials").value = player().n;
  refresh();
}

function closeScores() {
  $("scores").classList.add("hidden");
  $(backTo).classList.remove("hidden");
}

// Initials: letters only, upper case, three of them.
function initialsField(input) {
  input.addEventListener("input", () => {
    input.value = input.value
      .toUpperCase()
      .replace(/[^A-Z]/g, "")
      .slice(0, 3);
  });
}

// The game-over card's line: where this score put the player, or why it
// hasn't gone yet.
function soloLine(data) {
  const ask = !!data?.pending && data.reason === "initials";
  $("oInit").classList.toggle("hidden", !ask);
  $("oRank").textContent = !data
    ? ""
    : !data.pending
      ? place(data.me, data.total)
      : data.reason === "initials"
        ? "Put your initials on the scoreboard:"
        : data.reason === "offline"
          ? "Saved. It goes on the scoreboard next time you're online."
          : "";
}

export function soloOver(score, mode, plane = null) {
  $("oSolo").classList.remove("hidden");
  $("oGroup").classList.add("hidden");
  $("oScores").classList.toggle("hidden", !hasBoard());
  if (!hasBoard()) return soloLine(null);
  $("oRank").textContent = "Sending your score…";
  $("oInit").classList.add("hidden");
  submitSolo(score, mode, plane).then(soloLine, () => soloLine(null));
}

async function saveInitials(input, then) {
  if (!setInitials(input.value)) {
    input.focus();
    return;
  }
  input.blur();
  then(await flushSolo().catch(() => null));
}

export function initScoreboard() {
  for (const id of ["scInitials", "oInitials"]) initialsField($(id));
  $("bScores").addEventListener("click", () => openScores("title"));
  $("oScores").addEventListener("click", () => openScores("over"));
  $("scBack").addEventListener("click", closeScores);
  $("scSave").addEventListener("click", () =>
    saveInitials($("scInitials"), () => refresh()),
  );
  $("oInitSave").addEventListener("click", () =>
    saveInitials($("oInitials"), soloLine),
  );
  for (const [input, button] of [
    ["scInitials", "scSave"],
    ["oInitials", "oInitSave"],
  ])
    $(input).addEventListener("keydown", (e) => {
      if (e.key === "Enter") $(button).click();
    });
  // Anything left unsent from last time goes now, quietly.
  if (hasBoard()) flushSolo().catch(() => {});
}

// ── Team games ──────────────────────────────────────────────────────────────
// `board` is a group's {dogfight, flag, endless}; `mode` picks which list;
// `mine` is this player's hash, `fresh` a match to mark as just played.
const TITLE = {
  dogfight: "Your best dogfights",
  flag: "Your best flag games",
  endless: "Your best endless games",
};

export function renderGroup(target, board, mode, mine, fresh = null) {
  target.replaceChildren();
  const list = board[mode] || [];
  target.append(el("h3", "", TITLE[mode] || "Your best games"));
  if (!list.length) {
    target.append(
      el(
        "p",
        "none",
        "No games together yet. This board starts with the first.",
      ),
    );
    return;
  }
  const ol = el("ol", "board team");
  list.forEach((e, i) => {
    const li = el("li", e.id === fresh ? "mine" : "");
    const who = el("span", "nm");
    // Team by team, the winners first and starred.
    const teams = [...new Set(e.p.map((p) => p[3]))].sort(
      (a, b) => (b === e.w) - (a === e.w) || a - b,
    );
    teams.forEach((t, k) => {
      const c = TEAM[t % TEAM.length];
      if (k) who.append(" · ");
      const tag = el("span", "", (t === e.w ? "★" : "") + c.name + ": ");
      tag.style.color = c.css;
      who.append(tag);
      e.p
        .filter((p) => p[3] === t)
        .forEach((p, j) =>
          who.append(
            el(
              "span",
              p[0] === mine ? "me" : "",
              (j ? ", " : "") + p[1] + " " + p[2],
            ),
          ),
        );
    });
    li.append(
      el("span", "rk", i + 1),
      who,
      el("b", "", String(rankOf(mode, e))),
      el("i", "", ""),
    );
    ol.append(li);
  });
  target.append(ol);
}
