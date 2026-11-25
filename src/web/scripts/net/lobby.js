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

// lobby.js — the Two player screen: host or join, connect, count down,
// start; and after a match, play again or leave.
//
// The host picks the match (duel or co-op, Classic or Free flight) and gets a
// room code; the guest types it in. Once the two are connected the guest
// says hello with its protocol version, the host answers with the match, and
// the host's START counts both machines down together.

import { $ } from "../util.js";
import { net } from "./bus.js";
import { serverUrl, serverHint } from "./config.js";
import { Link } from "./link.js";
import { PROTO } from "./protocol.js";
import { matchMessage, peerGone } from "./match.js";

const LOBBY = new Set(["hi", "setup", "go", "bad", "bye"]);
const COUNT_FROM = 3;

let act = null; // { startMatch, toTitle }, from game.js
let link = null;
let setup = { kind: "duel", mode: "classic", speed: 1 };
let playing = false;

const show = (id) => {
  for (const p of ["onMenu", "onSetup", "onEnter", "onRoom", "onCount"])
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
  $("onHost").addEventListener("click", () => {
    show("onSetup");
    status("");
  });
  $("onJoin").addEventListener("click", () => {
    show("onEnter");
    status("");
    $("onCode").value = "";
    $("onCode").focus();
  });
  for (const b of document.querySelectorAll("[data-kind]"))
    b.addEventListener("click", () => pick("kind", b.dataset.kind));
  for (const b of document.querySelectorAll("[data-mmode]"))
    b.addEventListener("click", () => pick("mode", b.dataset.mmode));
  $("onCreate").addEventListener("click", host);
  $("onGo").addEventListener("click", join);
  $("onCode").addEventListener("keydown", (e) => {
    if (e.key === "Enter") join();
  });
  $("onCode").addEventListener("input", () => {
    $("onCode").value = $("onCode")
      .value.toUpperCase()
      .replace(/[^A-Z]/g, "");
  });
  $("onStart").addEventListener("click", () => {
    link.send({ t: "go" });
    countdown();
  });
  $("onBack").addEventListener("click", leave);
  pick("kind", setup.kind);
  pick("mode", setup.mode);
}

function pick(key, value) {
  setup[key] = value;
  const attr = key === "kind" ? "data-kind" : "data-mmode";
  for (const b of document.querySelectorAll(`[${attr}]`))
    b.classList.toggle("on", b.getAttribute(attr) === value);
}

export function openLobby() {
  $("title").classList.add("hidden");
  $("over").classList.add("hidden");
  $("online").classList.remove("hidden");
  show("onMenu");
  $("onLink").textContent = "";
  status(serverUrl() ? "" : "Two-player isn't available in this build.", true);
  $("onHost").disabled = $("onJoin").disabled = !serverUrl();
}

// ── Hosting ─────────────────────────────────────────────────────────────────
async function host() {
  status("Making a room…");
  try {
    connected(await Link.open(serverUrl(), null, opts()));
  } catch (err) {
    return failed(err);
  }
  setup.speed = act.speed();
  show("onRoom");
  $("onCodeShow").textContent = link.code;
  $("onStart").classList.remove("hidden");
  $("onStart").disabled = true;
  status("Give your friend this code. Waiting for them to join…");
}

// ── Joining ─────────────────────────────────────────────────────────────────
async function join() {
  const code = $("onCode").value.trim().toUpperCase();
  if (code.length !== 4) return status("Room codes are four letters.", true);
  status("Joining " + code + "…");
  try {
    connected(await Link.open(serverUrl(), code, opts()));
  } catch (err) {
    return failed(err);
  }
  show("onRoom");
  $("onCodeShow").textContent = link.code;
  $("onStart").classList.add("hidden");
  status("Connecting to the host…");
}

// ?relay in the address forces the server relay, to test it.
const opts = () => ({ relayOnly: /[?&]relay\b/.test(window.location.search) });

function connected(l) {
  link = net.link = l;
  net.role = l.role;
  l.onmessage = (m) => (LOBBY.has(m.t) ? lobbyMessage(m) : matchMessage(m));
  l.onpeer = () =>
    status(
      l.role === "host" ? "Your friend is here. Connecting…" : "Connecting…",
    );
  l.onpath = (path) => {
    $("onLink").textContent = path === "direct" ? "DIRECT LINK" : "VIA SERVER";
    if (l.role === "guest") l.send({ t: "hi", v: PROTO });
  };
  l.onleft = () => {
    if (playing) return peerGone();
    if (l.role === "host") {
      $("onStart").disabled = true;
      status("Your friend left. Waiting for someone else to join…");
    }
  };
  l.onclose = (why) => {
    if (playing) return peerGone();
    status(why, true);
    show("onMenu");
    link = net.link = null;
  };
  l.start();
}

function lobbyMessage(m) {
  if (m.t === "hi" && link.role === "host") {
    if (m.v !== PROTO) {
      link.send({
        t: "bad",
        text: "Your friend has a different version of Duel Hippo. Update both to play.",
      });
      return status("Your friend has a different version of Duel Hippo.", true);
    }
    link.send({ t: "setup", v: PROTO, ...setup });
    $("onStart").disabled = false;
    status(describe(setup) + " · Press START when you're both ready.");
  } else if (m.t === "setup" && link.role === "guest") {
    if (m.v !== PROTO)
      return status("The host has a different version of Duel Hippo.", true);
    setup = {
      kind: m.kind === "coop" ? "coop" : "duel",
      mode: m.mode === "free" ? "free" : "classic",
      speed: [0.25, 0.5, 0.75, 1].includes(m.speed) ? m.speed : 1,
    };
    status(describe(setup) + " · Waiting for the host to start…");
  } else if (m.t === "go") {
    if (link.role === "guest") countdown();
  } else if (m.t === "bad") status(m.text, true);
  else if (m.t === "bye") peerGone();
}

const describe = (s) =>
  (s.kind === "duel" ? "Duel" : "Co-op") +
  " · " +
  (s.mode === "free" ? "Free flight" : "Classic") +
  (s.speed < 1 ? ` · ${Math.round(s.speed * 100)}% speed` : "");

// 3, 2, 1 on both machines, then the match.
function countdown() {
  $("title").classList.add("hidden");
  $("over").classList.add("hidden");
  $("online").classList.remove("hidden");
  show("onCount");
  status(describe(setup));
  let n = COUNT_FROM;
  const tick = () => {
    if (!link) return;
    if (n === 0) {
      $("online").classList.add("hidden");
      playing = true;
      net.kind = setup.kind;
      return act.startMatch(setup);
    }
    $("onCount").textContent = n--;
    setTimeout(tick, 1000);
  };
  tick();
}

// ── After a match ───────────────────────────────────────────────────────────
// Only the host restarts; the guest waits for its "go".
export function matchEnded() {
  playing = false;
  return (
    link &&
    link.role === "host" &&
    link.path !== "closed" &&
    link.path !== "waiting"
  );
}

export function rematch() {
  if (!link) return;
  link.send({ t: "go" });
  countdown();
}

// Back to the title screen from anywhere, closing the connection.
export function leave() {
  if (link) {
    link.send({ t: "bye" });
    link.close();
  }
  link = net.link = null;
  playing = false;
  $("online").classList.add("hidden");
  act.toTitle();
}
