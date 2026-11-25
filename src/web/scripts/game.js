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

// game.js — game flow (title → play → over), the per-frame update, and boot.
//
// boot() is the one entry point. It takes the renderer factory as a
// parameter so the tests can run the real game loop headless with a stand-in
// renderer; main.js passes three.js's WebGLRenderer.
//
// The order of the steps inside update() and frame() is the prototype's and
// matters: later steps read what earlier ones wrote this frame.

import * as THREE from "three";
import { $, setLabel } from "./util.js";
import {
  BEST_KEY,
  INVERT_KEY,
  SPEEDS,
  SPEED_KEY,
  MAPS,
  MAP_KEY,
} from "./constants.js";
import { scene, camera } from "./scene.js";
import { S, game, opt } from "./state.js";
import { sfx } from "./audio.js";
import { updParticles } from "./effects.js";
import { say } from "./msg.js";
import {
  syncShadow,
  buildTargets,
  targets,
  hippos,
  updTown,
  updHippos,
  buildFields,
  clearFields,
  flagDefs,
  fields,
} from "./world.js";
import {
  P,
  resetPlayer,
  updPlayer,
  flip,
  wear,
  pickPlane,
  idleAtHome,
} from "./flight.js";
import { enemies, spawnEnemy, updEnemy, hostEnemy } from "./ai.js";
import { bullets, bombs, dropBomb, updBullets, updBombs } from "./weapons.js";
import {
  updLock,
  updMissiles,
  fireMissile,
  clearMissiles,
} from "./missiles.js";
import { isTouch, releaseKeys, bindInput } from "./input.js";
import { updCamera } from "./camera.js";
import { hud, initHud, showPlane } from "./hud.js";
import { remotes, clearRemotes, teamScores } from "./remote.js";
import { net, myTeam, isMode } from "./net/bus.js";
import { beginMatch, matchFrame, outOfPlanes } from "./net/match.js";
import { TEAM, MODES } from "./net/teams.js";
import { PLANES } from "./constants.js";
import { useMap } from "./maps.js";
import { initLobby, matchEnded, rematch, leave } from "./net/lobby.js";
import { initScoreboard, soloOver, renderGroup } from "./scoreboard.js";

let renderer = null;

// How long a full-screen transition may hide the page (measured on macOS
// Electron: ~525 ms), with margin.
const FULLSCREEN_BLINK_MS = 1500;

// ── World update ────────────────────────────────────────────────────────────
function update(dt) {
  if (P.alive) updPlayer(dt);
  else if ((game.respawnT -= dt) <= 0) {
    if (S.lives > 0) {
      resetPlayer();
      say("New plane on the runway", 2);
    } else if (net.on) outOfPlanes();
    else return gameOver();
  }
  syncShadow(P.shadow, P.pos, P.alive);

  // The AI flyers: a one-player game's. In Endless enemies each machine
  // flies one, and draws the others' (net/match.js); the other team games
  // have none.
  if (!net.on) {
    const maxE = Math.min(5, 2 + Math.floor(S.kills / 4) + S.wave);
    S.spawnT -= dt;
    if (S.spawnT <= 0 && enemies.filter((e) => e.alive).length < maxE) {
      spawnEnemy();
      S.spawnT = 5;
    }
    for (const e of enemies) if (e.alive) updEnemy(e, dt);
  } else if (isMode("endless")) hostEnemy(dt);
  if (S.rebuildT > 0 && (S.rebuildT -= dt) <= 0) {
    buildTargets();
    say("The enemy rebuilt their town!", 2.5);
  }

  updBullets(dt);
  updBombs(dt);
  // Missiles: only the plane types after the Kite carry them, so in a Kite
  // game these find nothing to do.
  updLock(dt);
  updMissiles(dt);
  updTown(dt);
  updHippos(dt);
  updParticles(dt);
}

// ── Game flow ───────────────────────────────────────────────────────────────
// Change plane (1–4), and name the new one in the corner for a moment.
function choosePlane(k) {
  if (pickPlane(k)) showPlane();
}
// The next or previous type (< and >, the picker's arrows, a swipe), round
// and round. A swipe is `quiet`: it is easily made by accident, so away from
// the runway it does nothing rather than explain.
function stepPlane(d, quiet = false) {
  if (quiet && !idleAtHome()) return;
  choosePlane((P.kind + d + PLANES.length) % PLANES.length);
}

export function startGame(m) {
  game.mode = m;
  // The map: a match's, else the player's; Classic is always the
  // Countryside, the prototype's.
  useMap(net.on ? net.map : m === "classic" ? "field" : opt.map);
  sfx.init();
  sfx.resume();
  document.body.dataset.mode = game.mode;
  Object.assign(S, {
    score: 0,
    kills: 0,
    wave: 0,
    // Bomb the flag: planes without end while the flag stands.
    lives: isMode("flag") ? 99 : 3,
    rebuildT: 0,
    spawnT: 3,
    flown: PLANES.map(() => 0),
  });
  clearMissiles();
  for (const e of enemies) {
    e.alive = false;
    e.obj.visible = false;
    e.shadow.visible = false;
  }
  for (const b of bullets) {
    b.on = false;
    b.m.visible = false;
  }
  for (const b of bombs) {
    b.on = false;
    b.m.visible = false;
    if (b.snd) b.snd.stop();
  }
  for (const h of hippos) {
    h.alive = true;
    h.g.visible = true;
  }
  // A team game's targets: the town for Endless enemies, the flags for Bomb
  // the flag, nothing for a dogfight.
  buildTargets(
    !net.on || isMode("endless") ? undefined : isMode("flag") ? flagDefs() : [],
  );
  resetPlayer();
  game.camZoom = 0;
  camera.position.set(P.pos.x, 20, 90);
  game.state = "play";
  setPause(false);
  for (const id of ["title", "over"]) $(id).classList.add("hidden");
  $("hud").classList.remove("off");
  $("touchui").classList.toggle("hidden", !isTouch);
  say(
    net.on
      ? INTRO[net.mode]
      : isTouch
        ? "Push the throttle up, then pull back on the stick to lift off"
        : "W to throttle up, then Down arrow to lift off",
    4.5,
  );
  if (renderer) renderer.domElement.focus();
}

function gameOver() {
  overScreen(false);
  game.state = "over";
  P.obj.visible = false;
  recordScore();
  $("over").classList.remove("hidden");
  $("hud").classList.add("off");
  $("touchui").classList.add("hidden");
}

// The flight's score: the best score, the game-over figures and the board.
function recordScore() {
  if (S.score > S.best) {
    S.best = S.score;
    try {
      window.localStorage.setItem(BEST_KEY, S.best);
    } catch {
      // No storage: the best score lasts the session.
    }
  }
  $("oScore").textContent = S.score;
  $("oKills").textContent = S.kills;
  $("best").textContent = $("oBest").textContent = S.best;
  soloOver(S.score, game.mode, planeOfGame());
}

// The plane type a one-player game is filed under: the one flown longest, or
// (never off the ground) the one on the runway.
function planeOfGame() {
  const most = Math.max(...S.flown);
  return most > 0 ? S.flown.indexOf(most) : P.kind;
}

// Main menu, from the pause menu or the game-over screen. A flight left from
// the pause menu still counts, as Quit's does; a match is left as Quit
// leaves it.
function toMenu() {
  if (net.on) return leave();
  setPause(false);
  if (game.state === "play") recordScore();
  toTitle();
}

export function setPause(v) {
  // A match cannot stop for one player: the menu opens over a game that
  // carries on.
  $("menu").classList.toggle("hidden", net.on);
  if (net.on) {
    $("pTitle").textContent = "Match menu";
    $("pauseFoot").classList.add("hidden");
    $("pause").classList.toggle("hidden", !v);
    return;
  }
  $("pTitle").textContent = "Paused";
  $("pauseFoot").classList.remove("hidden");
  game.paused = v;
  $("pause").classList.toggle("hidden", !v);
  if (v) releaseKeys();
}

// ── Team games ──────────────────────────────────────────────────────────────
// The lobby (net/lobby.js) connects everyone and calls startMatch on every
// machine at once. Team games are all Free flight. The organiser's game
// speed is the match's; the player's own setting is put back afterwards, as
// are the player's own colours.
let ownSpeed = null;

const INTRO = {
  dogfight: "Take off and shoot the other teams down. Last team flying wins",
  flag: "Bomb the other teams' flags, and guard your own",
  endless: "Shoot down the magenta flyers. The team with the most points wins",
};

function startMatch({ speed }) {
  net.on = true;
  if (ownSpeed === null) ownSpeed = opt.speed;
  setSpeed(speed, false);
  clearRemotes();
  useMap(net.map);
  buildFields(net.teams);
  P.ghost = false;
  wear(myTeam());
  startGame("free");
  beginMatch(matchOver, showGroup);
  $("hTeams").classList.remove("hidden");
}

function matchOver({ result, winner, team }) {
  game.state = "over";
  P.obj.visible = false;
  overScreen(true);
  // Endless enemies counts everyone's final score before naming a winner.
  if (result === "counting") {
    $("oTitle").textContent = "Counting the scores…";
    $("oScore").textContent = S.score;
    $("oKills").textContent = S.kills;
    $("oThird").textContent = "Team";
    $("oBest").textContent = "…";
    $("oAgain").classList.add("hidden");
    $("oNote").textContent = "";
    $("over").classList.remove("hidden");
    $("hud").classList.add("off");
    $("touchui").classList.add("hidden");
    return;
  }
  const solo = [...net.roster.values()].every(
    (p) => p.team !== myTeam() || p.seat === net.seat,
  );
  $("oTitle").textContent =
    result === "draw"
      ? "It's a draw"
      : result === "won"
        ? solo
          ? "You win!"
          : "Your team wins!"
        : TEAM[winner % TEAM.length].name + " wins";
  $("oScore").textContent = S.score;
  $("oKills").textContent = S.kills;
  $("oThird").textContent = "Team";
  $("oBest").textContent = team ?? teamScores()[myTeam()] ?? S.score;
  const again = matchEnded();
  $("oAgain").classList.toggle("hidden", !again);
  $("oNote").textContent = again
    ? MODES[net.mode]
    : "The organiser can start another.";
  $("over").classList.remove("hidden");
  $("hud").classList.add("off");
  $("touchui").classList.add("hidden");
  setPause(false);
}

// The group's board, once this match is on it (net/match.js).
function showGroup(board, fresh) {
  if (game.state !== "over") return;
  renderGroup($("oGroup"), board, net.mode, net.me?.h, fresh);
  $("oGroup").classList.remove("hidden");
}

// The over card serves both: one player's best score, or a match result.
function overScreen(match) {
  $("overMp").classList.toggle("hidden", !match);
  $("overModes").classList.toggle("hidden", match);
  $("oGroup").classList.add("hidden");
  if (match) $("oSolo").classList.add("hidden");
  if (!match) {
    $("oTitle").textContent = "Out of planes";
    $("oThird").textContent = "Best";
  }
}

// Leaving a match, by choice or because it ended: back to a one-player title.
function toTitle() {
  net.on = false;
  net.mode = null;
  net.map = "field";
  net.seat = null;
  net.teams = 0;
  net.roster.clear();
  net.onFlag = null;
  if (ownSpeed !== null) setSpeed(ownSpeed, false);
  ownSpeed = null;
  clearRemotes();
  clearFields();
  useMap(opt.map);
  P.ghost = false;
  wear(-1);
  clearMissiles();
  for (const e of enemies) {
    e.alive = false;
    e.obj.visible = false;
    e.shadow.visible = false;
  }
  for (const b of bullets) {
    b.on = false;
    b.m.visible = false;
  }
  for (const b of bombs) {
    b.on = false;
    b.m.visible = false;
    if (b.snd) b.snd.stop();
  }
  buildTargets();
  P.obj.visible = false;
  P.alive = false;
  P.shadow.visible = false;
  game.state = "title";
  setPause(false);
  $("hTeams").classList.add("hidden");
  overScreen(false);
  for (const id of ["over", "pause"]) $(id).classList.add("hidden");
  $("hud").classList.add("off");
  $("touchui").classList.add("hidden");
  $("title").classList.remove("hidden");
}

// ── Maps ────────────────────────────────────────────────────────────────────
// The map for Free flight (and the organiser's first offer in a team game),
// remembered. The title screen shows it behind the menu straight away.
function setMap(id, persist = true) {
  if (!MAPS[id]) return;
  opt.map = id;
  if (persist)
    try {
      window.localStorage.setItem(MAP_KEY, id);
    } catch {
      // No storage: the choice lasts the session.
    }
  for (const b of document.querySelectorAll("[data-map]"))
    b.classList.toggle("on", b.dataset.map === id);
  if (game.state === "title") useMap(id);
}

// ── Game speed ──────────────────────────────────────────────────────────────
// Scales game time only: the simulation and the in-play camera slow down,
// while the HUD, its messages and the title screen keep real time.
// `persist` is false for a match's speed, which is the host's and lasts the
// match.
function setSpeed(v, persist = true) {
  opt.speed = v;
  if (persist)
    try {
      window.localStorage.setItem(SPEED_KEY, v);
    } catch {
      // No storage: the setting lasts the session.
    }
  const pct = Math.round(v * 100) + "%";
  for (const id of ["bSpeed", "bSpeedPause"]) setLabel($(id), "Speed", pct);
  $("hSpeed").textContent = pct;
  $("hSpeedRow").classList.toggle("hidden", v === 1);
}

// One step slower (-1) or faster (+1), stopping at the ends.
function stepSpeed(dir) {
  if (net.on) return say("The host sets the speed of a match", 1.5);
  const i = SPEEDS.indexOf(opt.speed);
  const next = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i + dir))];
  if (next !== opt.speed) setSpeed(next);
  if (game.state === "play")
    say("Game speed " + Math.round(opt.speed * 100) + "%", 1.2);
}

// The buttons cycle: slower and slower, then back to full speed.
function cycleSpeed() {
  if (net.on) return;
  const i = SPEEDS.indexOf(opt.speed);
  setSpeed(i <= 0 ? SPEEDS[SPEEDS.length - 1] : SPEEDS[i - 1]);
}

// ── Inverted pitch ──────────────────────────────────────────────────────────
// Each player's own choice, in a match as much as alone: readInput() flips
// the stick and the arrow keys alike.
function setInvert(v) {
  opt.invert = v;
  try {
    window.localStorage.setItem(INVERT_KEY, v ? "1" : "0");
  } catch {
    // No storage: the setting lasts the session.
  }
  for (const id of ["bInvert", "bInvertPause"])
    setLabel($(id), "Pitch", v ? "inverted" : "normal");
}

// The I key, in play.
function toggleInvert() {
  setInvert(!opt.invert);
  say(opt.invert ? "Pitch inverted" : "Pitch normal", 1.2);
}

// Going full screen hides the page for a moment: on macOS the window moves
// to its own Space, and Electron reports the page hidden for about half a
// second. The visibility handler below would read that as the player leaving
// and pause the game, so a transition the game starts itself is announced
// here first.
let fullscreenBlinkUntil = -1;

function toggleFull() {
  fullscreenBlinkUntil = window.performance.now() + FULLSCREEN_BLINK_MS;
  try {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  } catch {
    // No Fullscreen API (iOS WKWebView): the app is full screen already.
  }
}

function initUI() {
  document.querySelectorAll("[data-start]").forEach((b) =>
    b.addEventListener("click", () => {
      if (isTouch && !document.fullscreenElement) toggleFull();
      startGame(b.dataset.start);
    }),
  );
  $("resume").addEventListener("click", () => setPause(false));
  $("quit").addEventListener("click", () => {
    setPause(false);
    if (net.on) return leave();
    S.lives = 0;
    gameOver();
  });
  for (const id of ["menu", "oMenu"]) $(id).addEventListener("click", toMenu);
  $("oAgain").addEventListener("click", rematch);
  // The runway's plane picker: ‹ and › step through the types.
  $("pPrev").addEventListener("click", () => stepPlane(-1));
  $("pNext").addEventListener("click", () => stepPlane(1));
  $("oLeave").addEventListener("click", leave);
  initLobby({
    startMatch,
    toTitle,
    speed: () => opt.speed,
    map: () => opt.map,
  });
  for (const b of document.querySelectorAll("[data-map]"))
    b.addEventListener("click", () => setMap(b.dataset.map));
  setMap(opt.map, false);
  initScoreboard();
  $("bMute").addEventListener("click", () => {
    sfx.init();
    setLabel($("bMute"), "Sound", sfx.toggle() ? "off" : "on");
  });
  for (const id of ["bSpeed", "bSpeedPause"])
    $(id).addEventListener("click", cycleSpeed);
  setSpeed(opt.speed);
  for (const id of ["bInvert", "bInvertPause"])
    $(id).addEventListener("click", () => setInvert(!opt.invert));
  setInvert(opt.invert);
  $("best").textContent = S.best;
  document.body.classList.toggle("touch", isTouch);

  // Leaving the game (another tab, another app, a locked phone) pauses it.
  // A full-screen transition hides the page too, only briefly: one the game
  // started (F, or a start button on a touch screen) is ignored outright, and
  // a pause that comes back to a visible page within the same window — the
  // window menu's or the green button's transition — is taken back.
  let autoPausedAt = -1;
  document.addEventListener("visibilitychange", () => {
    const now = window.performance.now();
    if (document.hidden) {
      // A match goes on: it cannot wait for one player.
      if (now < fullscreenBlinkUntil || net.on) return;
      if (game.state === "play" && !game.paused) {
        setPause(true);
        autoPausedAt = now;
      }
    } else {
      if (
        autoPausedAt >= 0 &&
        now - autoPausedAt < FULLSCREEN_BLINK_MS &&
        game.paused
      )
        setPause(false);
      autoPausedAt = -1;
    }
  });
}

// ── Boot ────────────────────────────────────────────────────────────────────
// Returns false (and says why on the title card) when there is no WebGL.
export function boot({ createRenderer }) {
  try {
    renderer = createRenderer();
  } catch {
    $("titleBody").innerHTML =
      "<h2>3D graphics are switched off</h2><p>Duel Hippo needs WebGL. Try another browser or turn on hardware acceleration.</p>";
    return false;
  }
  // Linear output, to match colour management being off (see scene.js).
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouch ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.domElement.tabIndex = 0;
  $("view").appendChild(renderer.domElement);
  window.addEventListener("resize", () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  bindInput({
    startGame,
    setPause,
    toggleFull,
    dropBomb,
    flip,
    stepSpeed,
    toggleInvert,
    pickPlane: choosePlane,
    stepPlane,
    fireMissile,
  });
  initUI();
  initHud();

  // ── Main loop ─────────────────────────────────────────────────────────────
  // Variable step, capped at 50 ms, exactly as the prototype: the flight
  // model's numbers were tuned against it. Game speed scales the step after
  // the cap, so a slowed game takes smaller steps, never larger ones; at full
  // speed `gdt` is `dt` and the loop is the prototype's.
  let last = window.performance.now();
  function frame(now) {
    window.requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    const gdt = dt * opt.speed;
    last = now;
    const live = game.state === "play" && !game.paused;
    if (live) update(gdt);
    if (net.on) matchFrame(now, gdt, live);
    sfx.engine(P.thr, P.speed, live && P.alive);
    if (!game.paused) updCamera(game.state === "play" ? gdt : dt);
    renderer.render(scene, camera);
    hud(dt);
  }
  window.requestAnimationFrame(frame);

  // The prototype's debugging and playtest hook, kept under the same name.
  window.__duel = {
    P,
    S,
    enemies,
    targets,
    get state() {
      return game.state;
    },
    get mode() {
      return game.mode;
    },
    startGame,
    net,
    remotes,
    fields,
    camera,
  };
  return true;
}
