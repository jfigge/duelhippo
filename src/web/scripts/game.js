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
import { $ } from "./util.js";
import { BEST_KEY, SPEEDS, SPEED_KEY } from "./constants.js";
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
} from "./world.js";
import { P, resetPlayer, updPlayer, flip } from "./flight.js";
import { enemies, spawnEnemy, updEnemy } from "./ai.js";
import { bullets, bombs, dropBomb, updBullets, updBombs } from "./weapons.js";
import { isTouch, releaseKeys, bindInput } from "./input.js";
import { updCamera } from "./camera.js";
import { hud, initHud } from "./hud.js";

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
    } else return gameOver();
  }
  syncShadow(P.shadow, P.pos, P.alive);

  const maxE = Math.min(5, 2 + Math.floor(S.kills / 4) + S.wave);
  S.spawnT -= dt;
  if (S.spawnT <= 0 && enemies.filter((e) => e.alive).length < maxE) {
    spawnEnemy();
    S.spawnT = 5;
  }
  for (const e of enemies) if (e.alive) updEnemy(e, dt);
  if (S.rebuildT > 0 && (S.rebuildT -= dt) <= 0) {
    buildTargets();
    say("The enemy rebuilt their town!", 2.5);
  }

  updBullets(dt);
  updBombs(dt);
  updTown(dt);
  updHippos(dt);
  updParticles(dt);
}

// ── Game flow ───────────────────────────────────────────────────────────────
export function startGame(m) {
  game.mode = m;
  sfx.init();
  sfx.resume();
  document.body.dataset.mode = game.mode;
  Object.assign(S, {
    score: 0,
    kills: 0,
    wave: 0,
    lives: 3,
    rebuildT: 0,
    spawnT: 3,
  });
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
  buildTargets();
  resetPlayer();
  game.camZoom = 0;
  camera.position.set(P.pos.x, 20, 90);
  game.state = "play";
  setPause(false);
  for (const id of ["title", "over"]) $(id).classList.add("hidden");
  $("hud").classList.remove("off");
  $("touchui").classList.toggle("hidden", !isTouch);
  say(
    isTouch
      ? "Push the throttle up, then pull back on the stick to lift off"
      : "W to throttle up, then Down arrow to lift off",
    4.5,
  );
  if (renderer) renderer.domElement.focus();
}

function gameOver() {
  game.state = "over";
  P.obj.visible = false;
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
  $("over").classList.remove("hidden");
  $("hud").classList.add("off");
  $("touchui").classList.add("hidden");
}

export function setPause(v) {
  game.paused = v;
  $("pause").classList.toggle("hidden", !v);
  if (v) releaseKeys();
}

// ── Game speed ──────────────────────────────────────────────────────────────
// Scales game time only: the simulation and the in-play camera slow down,
// while the HUD, its messages and the title screen keep real time.
function setSpeed(v) {
  opt.speed = v;
  try {
    window.localStorage.setItem(SPEED_KEY, v);
  } catch {
    // No storage: the setting lasts the session.
  }
  const pct = Math.round(v * 100) + "%";
  for (const id of ["bSpeed", "bSpeedPause"])
    $(id).textContent = "SPEED " + pct;
  $("hSpeed").textContent = pct;
  $("hSpeedRow").classList.toggle("hidden", v === 1);
}

// One step slower (-1) or faster (+1), stopping at the ends.
function stepSpeed(dir) {
  const i = SPEEDS.indexOf(opt.speed);
  const next = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i + dir))];
  if (next !== opt.speed) setSpeed(next);
  if (game.state === "play")
    say("Game speed " + Math.round(opt.speed * 100) + "%", 1.2);
}

// The buttons cycle: slower and slower, then back to full speed.
function cycleSpeed() {
  const i = SPEEDS.indexOf(opt.speed);
  setSpeed(i <= 0 ? SPEEDS[SPEEDS.length - 1] : SPEEDS[i - 1]);
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
    S.lives = 0;
    gameOver();
  });
  $("bMute").addEventListener("click", () => {
    sfx.init();
    $("bMute").textContent = sfx.toggle() ? "SOUND OFF" : "SOUND ON";
  });
  for (const id of ["bSpeed", "bSpeedPause"])
    $(id).addEventListener("click", cycleSpeed);
  setSpeed(opt.speed);
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
      if (now < fullscreenBlinkUntil) return;
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

  bindInput({ startGame, setPause, toggleFull, dropBomb, flip, stepSpeed });
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
  };
  return true;
}
