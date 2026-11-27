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
import { $, setLabel, mapButton, mapButtons } from "./util.js";
import {
  BEST_KEY,
  INVERT_KEY,
  TILT_KEY,
  SPEEDS,
  SPEED_KEY,
  MAPS,
  MAP_KEY,
  UNLOCK,
  COURSE,
  WEATHERS,
  WEATHER_NAMES,
  WEATHER_TAGS,
  WEATHER_KEY,
  LEVEL_NAMES,
  DIFFICULTY_KEY,
} from "./constants.js";
import { scene, camera } from "./scene.js";
import { S, game, opt, mapOpen, unlockAll, level } from "./state.js";
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
  land,
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
import { isTouch, releaseKeys, bindInput, setTilt } from "./input.js";
import { updCamera, stepCam } from "./camera.js";
import { updCockpit, cockpitOn, dash } from "./cockpit.js";
import {
  startRepair,
  repairKey,
  repairMove,
  repairing,
  updRepair,
  resetRepair,
} from "./repair.js";
import { hud, initHud, showPlane } from "./hud.js";
import { remotes, clearRemotes, teamScores } from "./remote.js";
import { net, myTeam, isMode } from "./net/bus.js";
import { beginMatch, matchFrame, outOfPlanes } from "./net/match.js";
import { TEAM, MODES } from "./net/teams.js";
import { PLANES } from "./constants.js";
import {
  useMap,
  startMap,
  mapNow,
  setWeather,
  weatherFixed,
  weatherNow,
} from "./maps.js";
import {
  run,
  startCourse,
  endCourse,
  updCourse,
  recordCourse,
  courseBest,
  levelOpen,
  LIMITS,
  clock,
} from "./course.js";
import { player } from "./scores.js";
import {
  initLobby,
  matchEnded,
  amOrganiser,
  rematch,
  leave,
} from "./net/lobby.js";
import { initScoreboard, soloOver, renderGroup } from "./scoreboard.js";
import { bindAbout } from "./about.js";

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
  if (!net.on && !run.on) {
    // Fewer at once on an easier level (constants.js DIFFICULTY).
    const maxE = Math.max(
      1,
      Math.min(5, 2 + Math.floor(S.kills / 4) + S.wave) + level().more,
    );
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
  // A map's weather, flak and moving targets; none on the Countryside.
  if (land.tick) land.tick(dt);
  // The obstacle course: the clock, and the rings flown.
  if (run.on) {
    const end = updCourse(dt);
    if (end) courseOver(end);
  }
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

// The last one-player start, as given ("course" for the obstacle course):
// what Enter starts again.
let lastStart = "classic";

export function startGame(m) {
  // Back on the title, the picker shows the map flown, not a locked one.
  if (viewMap) {
    viewMap = null;
    showMaps();
  }
  if (!net.on) lastStart = m;
  // The obstacle course is Free flight over the Countryside, with rings.
  const course = m === "course";
  if (course) m = "free";
  game.mode = m;
  // The map: a match's, else the player's; Classic (and the course) is
  // always the Countryside, the prototype's. The weather likewise: the
  // organiser's in a match.
  setWeather(net.on ? net.weather : opt.weather);
  game.level = net.on ? net.difficulty : opt.difficulty;
  useMap(net.on ? net.map : m === "classic" || course ? "field" : opt.map);
  sfx.init();
  sfx.resume();
  document.body.dataset.mode = game.mode;
  showWeather();
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
    course
      ? []
      : !net.on || isMode("endless")
        ? undefined
        : isMode("flag")
          ? flagDefs()
          : [],
  );
  resetPlayer();
  resetRepair();
  // The map's own per-game reset (its convoy, weather, wind); the
  // Countryside has none.
  startMap();
  if (course) startCourse(courseSize);
  else endCourse();
  game.camZoom = 0;
  // Level with the runway: on a raised one (Sky islands, Zeppelins) a camera
  // starting at 20 m would sweep up through the rock or the hull. On the
  // Countryside, the prototype's 20 m.
  camera.position.set(P.pos.x, land.height ? P.pos.y + 18 : 20, P.pos.z + 90);
  game.state = "play";
  setPause(false);
  for (const id of ["title", "over", "controls", "course", "settings"])
    $(id).classList.add("hidden");
  $("hud").classList.remove("off");
  $("touchui").classList.toggle("hidden", !isTouch);
  say(
    net.on
      ? INTRO[net.mode]
      : course
        ? `Take off and fly through the yellow ring. Then ${clock(LIMITS[courseSize])} for the rest`
        : isTouch
          ? "Push the throttle up, then pull back on the stick to lift off"
          : "W to throttle up, then Down arrow to lift off",
    4.5,
  );
  focusView();
}

// The keyboard's focus back on the scene, off whatever button started or
// resumed the game, so Space and the arrows fly rather than press it.
function focusView() {
  if (renderer) renderer.domElement.focus();
}

// Enter, off the play screen: fly again, from the title or the game-over
// card only, and never in a match (whose over card may still be settling
// the result, and whose next start is the organiser's).
function enterKey() {
  if (net.on) return;
  const shown = (id) => !$(id).classList.contains("hidden");
  if (!shown("title") && !shown("over")) return;
  if (
    ["course", "controls", "scores", "online", "pause", "settings"].some(shown)
  )
    return;
  startGame(lastStart);
}

function gameOver() {
  if (run.on) return courseOver("dead");
  overScreen(false);
  game.state = "over";
  P.obj.visible = false;
  recordScore();
  $("over").classList.remove("hidden");
  $("hud").classList.add("off");
  $("touchui").classList.add("hidden");
}

// ── The obstacle course ─────────────────────────────────────────────────────
// The level picked on the course screen (constants.js COURSE.levels).
let courseSize = 0;

// The course's screen, from the title: the levels (each opens when the one
// before is finished), the course's own table, and Fly.
function openCourse(focus = -1) {
  if (!levelOpen(courseSize)) courseSize = 0;
  $("cSizes").replaceChildren(
    ...COURSE.levels.map((z, i) => {
      const b = document.createElement("button"),
        name = document.createElement("b");
      name.textContent = z.name;
      const note = document.createElement("i");
      note.textContent = levelOpen(i)
        ? `${z.pts} a ring · ${clock(LIMITS[i])} to finish`
        : `Finish ${COURSE.levels[i - 1].name} first`;
      b.append(name, note);
      b.disabled = !levelOpen(i);
      b.classList.toggle("locked", !levelOpen(i));
      b.classList.toggle("on", i === courseSize);
      b.setAttribute("aria-pressed", String(i === courseSize));
      // Rebuilt on a pick: the focus goes back to the level picked.
      b.addEventListener("click", () => {
        courseSize = i;
        openCourse(i);
      });
      return b;
    }),
  );
  if (focus >= 0) $("cSizes").children[focus].focus();
  courseTable($("cBoard"), -1);
  $("title").classList.add("hidden");
  $("course").classList.remove("hidden");
}

// The course's table into `list`, `mine` (a rank) picked out.
function courseTable(list, mine) {
  const best = courseBest();
  if (!best.length) {
    const li = document.createElement("li");
    li.className = "gap";
    li.textContent = "No scores yet. Fly it!";
    list.replaceChildren(li);
    return;
  }
  list.replaceChildren(
    ...best.map((e, i) => {
      const li = document.createElement("li");
      if (i === mine) li.className = "mine";
      const cell = (tag, cls, text) => {
        const c = document.createElement(tag);
        c.className = cls;
        c.textContent = text;
        return c;
      };
      li.append(
        cell("span", "rk", i + 1),
        cell("span", "nm", e.n),
        cell(
          "i",
          "",
          COURSE.levels[e.z].name +
            (e.t === null ? " · unfinished" : ` · ${clock(e.t)}`),
        ),
        cell("b", "", e.s.toLocaleString("en")),
      );
      return li;
    }),
  );
}

// The course is over, `how`: "done" (the last ring flown), "out" (of time),
// "dead" (out of planes) or "quit". Its own score sheet, table and any level
// it opened; nothing goes to the best score.
const COURSE_END = {
  done: "Course complete!",
  out: "Out of time",
  dead: "Out of planes",
  quit: "Course abandoned",
};
function courseOver(how) {
  const done = how === "done";
  game.state = "over";
  P.obj.visible = false;
  const { rank, opened } = recordCourse(player().n);
  overScreen(false);
  $("oTitle").textContent = COURSE_END[how];
  $("oScore").textContent = run.score.toLocaleString("en");
  $("oSecond").textContent = "Rings";
  $("oKills").textContent = `${run.next}/${COURSE.rings}`;
  $("oThird").textContent = done ? "Time" : "Level";
  $("oBest").textContent = done ? clock(run.t) : COURSE.levels[run.level].name;
  $("oUnlock").textContent = opened
    ? `Next level open: ${opened}. Closer rings, tighter turns, more points!`
    : done && run.bonus
      ? `Time bonus +${run.bonus.toLocaleString("en")}`
      : "";
  $("oUnlock").classList.toggle("hidden", !$("oUnlock").textContent);
  courseTable($("oCourse"), rank);
  $("oCourse").classList.remove("hidden");
  $("oCourseAgain").classList.remove("hidden");
  $("oSolo").classList.add("hidden");
  endCourse();
  $("over").classList.remove("hidden");
  // A short screen scrolls the table: bring this flight's row into view,
  // now that the card is shown (a hidden one can't scroll).
  $("oCourse").scrollTop = 0; // not the last flight's place
  $("oCourse").querySelector(".mine")?.scrollIntoView?.({ block: "nearest" });
  $("hud").classList.add("off");
  $("touchui").classList.add("hidden");
}

// The flight's score: the best score, the game-over figures and the board.
function recordScore() {
  const shut = Object.keys(MAPS).filter((id) => !mapOpen(id));
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
  // A map this game has earned.
  const won = shut.filter(mapOpen).map((id) => MAPS[id]);
  $("oUnlock").textContent = won.length
    ? `New map: ${won.join(" and ")}! Pick it on the title screen.`
    : "";
  $("oUnlock").classList.toggle("hidden", !won.length);
  showMaps();
  soloOver(S.score, game.mode, planeOfGame());
}

// The plane type a one-player game is filed under: the one flown longest, or
// (never off the ground) the one on the runway.
function planeOfGame() {
  const most = Math.max(...S.flown);
  return most > 0 ? S.flown.indexOf(most) : P.kind;
}

// Main menu, from the pause menu or the game-over screen. A flight left from
// the pause menu still counts, as Quit's does: a game's score, or a course
// run that reached its first ring (recordCourse). A match is left as Quit
// leaves it.
function toMenu() {
  if (net.on) return leave();
  setPause(false);
  if (game.state === "play") {
    if (run.on) recordCourse(player().n);
    else recordScore();
  }
  toTitle();
}

export function setPause(v) {
  // A match cannot stop for one player: the menu opens over a game that
  // carries on.
  $("menu").classList.toggle("hidden", net.on);
  if (net.on) {
    $("pTitle").textContent = "Match menu";
    $("pauseFoot").classList.add("hidden");
  } else {
    $("pTitle").textContent = "Paused";
    $("pauseFoot").classList.remove("hidden");
    game.paused = v;
  }
  $("pause").classList.toggle("hidden", !v);
  if (v) {
    if (!net.on) releaseKeys();
  } else if (game.state === "play") {
    // Coming back from another app (iOS leaves the sound "interrupted").
    sfx.resume();
    focusView();
  }
}

// P, Esc and the touch pause button: open or close the menu. Read from the
// menu itself, since in a match nothing pauses.
function togglePause() {
  setPause($("pause").classList.contains("hidden"));
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
  matchResult = false;
  // The last match's airfields go with the map they were laid on, before
  // the new map is in (buildFields clears with the map in use).
  clearFields();
  useMap(net.map);
  buildFields(net.teams);
  P.ghost = false;
  wear(myTeam());
  startGame("free");
  beginMatch(matchOver, showGroup);
  $("hTeams").classList.remove("hidden");
}

// Whether the over card shows a match's result (not "Settling the
// result…"): only then does it offer Play again.
let matchResult = false;

function matchOver({ result, winner, team }) {
  game.state = "over";
  P.obj.visible = false;
  overScreen(true);
  matchResult = result !== "counting";
  // Every mode settles the result from everyone's final report first.
  setPause(false);
  if (result === "counting") {
    $("oTitle").textContent = "Settling the result…";
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
  playAgain(matchEnded());
  $("over").classList.remove("hidden");
  $("hud").classList.add("off");
  $("touchui").classList.add("hidden");
}

// The over card's Play again: the organiser's, while the room can still make
// a match of more than one team (`again`, from the lobby). Anyone leaving,
// or the organiser changing, after the card is up refreshes it
// (rosterChanged).
function playAgain(again) {
  $("oAgain").classList.toggle("hidden", !again);
  $("oNote").textContent = again
    ? MODES[net.mode]
    : amOrganiser()
      ? "Waiting for the room before another match."
      : "The organiser can start another.";
}
function rosterChanged() {
  if (net.on && game.state === "over" && matchResult) playAgain(matchEnded());
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
  $("oSecond").textContent = "Kills";
  $("oCourse").classList.add("hidden");
  $("oCourseAgain").classList.add("hidden");
  if (match) $("oUnlock").classList.add("hidden");
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
  matchResult = false;
  net.mode = null;
  net.map = "field";
  net.weather = "sunny";
  net.seat = null;
  net.teams = 0;
  net.roster.clear();
  net.onFlag = null;
  if (ownSpeed !== null) setSpeed(ownSpeed, false);
  ownSpeed = null;
  clearRemotes();
  clearFields();
  endCourse();
  resetRepair();
  setWeather(opt.weather);
  game.level = opt.difficulty;
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
  // The title's backdrop: the map's town and weather fresh, as at a start
  // (on the same map useMap does nothing, and no map hook would run).
  startMap();
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
  if (!MAPS[id] || !mapOpen(id)) return;
  opt.map = id;
  viewMap = null;
  if (persist)
    try {
      window.localStorage.setItem(MAP_KEY, id);
    } catch {
      // No storage: the choice lasts the session.
    }
  showMaps();
  if (game.state === "title") useMap(id);
}

// The title's map buttons: the one picked, and those still to earn, with
// the score that opens them. Above them, the ‹ name › picker and its note:
// how many are open, and the score that opens the next; or, on a locked
// map, greyed, the score that opens it.
export function showMaps() {
  for (const b of document.querySelectorAll("[data-map]")) {
    mapButton(b, b.dataset.map, opt.map);
  }
  const ids = Object.keys(MAPS),
    open = ids.filter(mapOpen).length,
    next = ids.find((id) => !mapOpen(id)),
    shown = viewMap ?? opt.map,
    locked = !mapOpen(shown),
    name = $("mapName");
  name.textContent = MAPS[shown];
  name.classList.toggle("locked", locked);
  name.setAttribute("aria-disabled", String(locked));
  $("mapNote").textContent = locked
    ? `Locked · score over ${UNLOCK[shown].toLocaleString("en")} to open`
    : next
      ? `${open} of ${ids.length} open · ${MAPS[next]} at ${UNLOCK[next].toLocaleString("en")}`
      : `All ${ids.length} open`;
}

// ‹ and ›: every map in turn, round and round. An open one is picked; a
// locked one is only shown, greyed, and the last open pick stays the map
// a game starts on.
let viewMap = null;
function stepMap(dir) {
  const ids = Object.keys(MAPS),
    i = ids.indexOf(viewMap ?? opt.map),
    id = ids[(i + dir + ids.length) % ids.length];
  if (mapOpen(id)) return setMap(id);
  viewMap = id;
  showMaps();
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

// ── Tilt steering ───────────────────────────────────────────────────────────
// A touch screen's choice between the stick and tilting the phone
// (input.js), remembered, and each player's own in a match too. The switch
// is a tap, which is where iOS lets the page ask to read the tilt; refused,
// the stick stays.
function showTilt(v) {
  for (const id of ["bTilt", "bTiltPause"])
    setLabel($(id), "Steering", v ? "tilt" : "stick");
}
function toggleTilt() {
  const want = !opt.tilt;
  setTilt(want).then((v) => {
    try {
      window.localStorage.setItem(TILT_KEY, v ? "1" : "0");
    } catch {
      // No storage: the setting lasts the session.
    }
    showTilt(v);
    if (want && !v) say("Tilt steering needs motion access", 2);
    else if (game.state === "play")
      say(v ? "Tilt the phone to steer" : "Steering by the stick", 1.5);
  });
}

// ── Difficulty ──────────────────────────────────────────────────────────────
// How hard the enemy is (constants.js DIFFICULTY), remembered. The buttons
// on Settings and the pause menu step through the levels. A match's is the
// organiser's, and stays.
function setDifficulty(v, persist = true) {
  opt.difficulty = v;
  if (persist)
    try {
      window.localStorage.setItem(DIFFICULTY_KEY, v);
    } catch {
      // No storage: the setting lasts the session.
    }
  if (!net.on) game.level = v;
  for (const id of ["bLevel", "bLevelPause"])
    setLabel($(id), "Difficulty", LEVEL_NAMES[v]);
}
function cycleDifficulty() {
  if (net.on) return say("The organiser sets the difficulty of a match", 1.5);
  setDifficulty((opt.difficulty % 5) + 1);
}

// The I key, in play.
function toggleInvert() {
  setInvert(!opt.invert);
  say(opt.invert ? "Pitch inverted" : "Pitch normal", 1.2);
}

// ── Weather ─────────────────────────────────────────────────────────────────
// T, in play: the next weather (constants.js WEATHERS), remembered. Not in a
// match, whose weather the organiser picked, nor on a map with weather of
// its own.
function cycleWeather() {
  if (net.on) return say("The organiser chose the weather", 1.5);
  if (weatherFixed())
    return say(
      mapNow() === "sea" ? "Sea fog never lifts" : "The storm won't lift here",
      1.5,
    );
  const i = WEATHERS.indexOf(opt.weather);
  opt.weather = WEATHERS[(i + 1) % WEATHERS.length];
  try {
    window.localStorage.setItem(WEATHER_KEY, opt.weather);
  } catch {
    // No storage: the weather lasts the session.
  }
  setWeather(opt.weather);
  showWeather();
  say("Weather: " + WEATHER_NAMES[opt.weather], 1.2);
}

// The touch screen's weather button: the weather flown in, which on the
// Storm, the Sea or in a match may not be the player's own choice.
function showWeather() {
  const w = weatherNow(),
    b = $("bWx");
  b.textContent = WEATHER_TAGS[w];
  b.setAttribute("aria-label", "Weather: " + WEATHER_NAMES[w]);
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

// A start from a button: on a touch screen the game goes full screen too
// (a click is the gesture the Fullscreen API needs).
function startFromClick(m) {
  if (isTouch && !document.fullscreenElement) toggleFull();
  startGame(m);
}

function initUI() {
  document
    .querySelectorAll("[data-start]")
    .forEach((b) =>
      b.addEventListener("click", () => startFromClick(b.dataset.start)),
    );
  $("resume").addEventListener("click", () => setPause(false));
  $("quit").addEventListener("click", () => {
    setPause(false);
    if (net.on) return leave();
    if (run.on) return courseOver("quit");
    S.lives = 0;
    gameOver();
  });
  for (const id of ["menu", "oMenu"]) $(id).addEventListener("click", toMenu);
  // The obstacle course: its screen, and Fly.
  $("bCourse").addEventListener("click", () => openCourse());
  $("cBack").addEventListener("click", () => {
    $("course").classList.add("hidden");
    $("title").classList.remove("hidden");
  });
  for (const id of ["cFly", "oCourseAgain"])
    $(id).addEventListener("click", () => startFromClick("course"));
  // The controls: a screen of their own, off the title.
  $("bControls").addEventListener("click", () => {
    $("title").classList.add("hidden");
    $("controls").classList.remove("hidden");
  });
  $("ctBack").addEventListener("click", () => {
    $("controls").classList.add("hidden");
    $("title").classList.remove("hidden");
  });
  // Settings: the switches, a screen of their own like the controls.
  $("bSettings").addEventListener("click", () => {
    $("title").classList.add("hidden");
    $("settings").classList.remove("hidden");
  });
  $("setBack").addEventListener("click", () => {
    $("settings").classList.add("hidden");
    $("title").classList.remove("hidden");
  });
  // The map picker: ‹ and › step, the name opens every map's button.
  $("mapPrev").addEventListener("click", () => stepMap(-1));
  $("mapNext").addEventListener("click", () => stepMap(1));
  $("mapName").addEventListener("click", () => {
    const open = !$("maps").classList.toggle("hidden");
    $("mapName").setAttribute("aria-expanded", String(open));
  });
  // About opens over any screen; one from the desktop menu mid-game pauses
  // it first (a match carries on, as for its menu).
  bindAbout({
    beforeOpen: () => {
      if (game.state === "play") setPause(true);
    },
  });
  $("oAgain").addEventListener("click", () => {
    if (!$("oAgain").classList.contains("hidden")) rematch();
  });
  // The runway's plane picker: ‹ and › step through the types, and give the
  // keyboard back to the scene.
  $("pPrev").addEventListener("click", () => {
    stepPlane(-1);
    focusView();
  });
  $("pNext").addEventListener("click", () => {
    stepPlane(1);
    focusView();
  });
  $("oLeave").addEventListener("click", leave);
  initLobby({
    startMatch,
    toTitle,
    rosterChanged,
    speed: () => opt.speed,
    map: () => opt.map,
    weather: () => opt.weather,
    difficulty: () => opt.difficulty,
  });
  mapButtons($("maps"), "map");
  // Its own line, which no short-window rule hides.
  if (unlockAll) {
    const note = document.createElement("p");
    note.className = "pickNote testing";
    note.textContent = "Testing: every map and course level is open.";
    $("maps").after(note);
  }
  for (const b of document.querySelectorAll("[data-map]"))
    b.addEventListener("click", () => setMap(b.dataset.map));
  setWeather(opt.weather);
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
  for (const id of ["bTilt", "bTiltPause"])
    $(id).addEventListener("click", toggleTilt);
  showTilt(opt.tilt);
  document.body.classList.toggle("tilt", opt.tilt);
  for (const id of ["bLevel", "bLevelPause"])
    $(id).addEventListener("click", cycleDifficulty);
  setDifficulty(opt.difficulty, false);
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
      // Back on the page: wake the sound, which iOS may have interrupted
      // (in a match nothing pauses, so nothing else would).
      sfx.resume();
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
    enter: enterKey,
    togglePause,
    toggleFull,
    dropBomb,
    flip,
    stepSpeed,
    toggleInvert,
    pickPlane: choosePlane,
    stepPlane,
    fireMissile,
    stepCam,
    cycleWeather,
    fix: startRepair,
    repairing,
    repairKey,
    repairMove,
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
    // A repair's second is a real one, at any game speed.
    if (live) updRepair(dt);
    if (net.on) matchFrame(now, gdt, live);
    sfx.engine(P.thr, P.speed, live && P.alive);
    if (!game.paused) updCamera(game.state === "play" ? gdt : dt);
    updCockpit(dt);
    renderer.render(scene, camera);
    // The cockpit's dashboard, over the world with the depth cleared, so it
    // is never cut by the scenery or the world camera's near plane.
    if (cockpitOn()) {
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(dash.scene, dash.camera);
      renderer.autoClear = true;
    }
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
