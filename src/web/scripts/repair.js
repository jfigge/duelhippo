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

// repair.js — fixing the plane in flight (F, or the touch screen's FIX).
// Not part of the prototype.
//
// A plane hurt but still flying (its damage short of the 100 that stops the
// engine) can be patched up once a flight: after a countdown in the middle
// of the screen (3…, 2…, 1…, half a second each) comes a run of number
// keys, 1.75 s each (constants.js REPAIR). From the FIX button, on a phone,
// the run is of moves of the phone instead, 3 s each: a shake up and down,
// back and forth or side to side, or a turn upright or back on its side
// (motion.js). One wrong or late and the repair has failed; all of them and the damage is gone. Fuel and rounds
// are not touched. Either way that flight's repair is spent: landing (or a
// new plane) starts a new flight.
//
// While it runs the other planes hold their fire at this one: the flyers
// don't shoot at it (ai.js), and no plane's round or missile hurts it
// (weapons.js, missiles.js). Flak on the ground still does.
//
// The numbers come from crypto, never Math.random, whose draws are the
// prototype's. game.js runs it each frame in play (real time, as the HUD:
// its seconds are the same at any game speed), input.js gives it the keys
// and the shakes.

import { $ } from "./util.js";
import { REPAIR } from "./constants.js";
import { game } from "./state.js";
import { P } from "./flight.js";
import { say } from "./msg.js";
import { sfx } from "./audio.js";
import { motion } from "./motion.js";

// `stage`: null (none under way), "count" or "steps". `mode` is "keys" or
// "moves"; `seq` the run, numbers 0–9 or moves (MOVES); `i` the next; `t`
// the time left on this stage; `upright` the way a turn is to leave the
// phone, set as the turn comes up; `since` how long this step has run.
export const fix = {
  stage: null,
  mode: "keys",
  used: false,
  seq: [],
  i: 0,
  t: 0,
  upright: false,
  since: 0,
};
export const repairing = () => fix.stage !== null;

// The moves of the phone, and how each is asked for.
const MOVES = ["updown", "backforth", "side", "turn"];
const ASK = {
  updown: ["↕", "Shake up and down"],
  backforth: ["⇄", "Shake back and forth"],
  side: ["↔", "Shake side to side"],
};
// A wrong shake this soon after a step begins is the last one's tail.
const GRACE = 0.3;
const stepTime = () => (fix.mode === "moves" ? REPAIR.move : REPAIR.per);

// A number in [0, n): crypto's, or the clock's where there is none.
let spare = 0;
function pick(n) {
  const c = globalThis.crypto;
  if (c?.getRandomValues) return c.getRandomValues(new Uint32Array(1))[0] % n;
  spare = (spare * 1103515245 + 12345 + Math.floor(performance.now())) >>> 0;
  return spare % n;
}

// How long the run is for damage `dmg`.
export const runLength = (dmg) =>
  Math.min(REPAIR.max, REPAIR.min + Math.round(dmg / REPAIR.step));

// Whether a repair can begin: the touch screen shows FIX only then.
export const canRepair = () =>
  game.state === "play" &&
  !game.paused &&
  P.alive &&
  !P.ghost &&
  !P.grounded &&
  P.dmg > 0 &&
  P.dmg < 100 &&
  !fix.used &&
  !repairing();

// F (keys), or FIX on a touch screen (`touch`: moves of the phone, which
// `allowed` says the player let the page read): begin, if this flight's
// repair is still to use and there is something to mend. Says why not
// otherwise.
export function startRepair(touch = false, allowed = true) {
  if (game.state !== "play" || !P.alive || repairing()) return;
  if (P.ghost) return;
  if (P.grounded)
    return say("Repairs are for the air; your hangar fixes you here", 1.6);
  if (P.dmg <= 0) return say("Nothing to fix", 1.2);
  if (P.dmg >= 100) return say("Too far gone to fix", 1.4);
  if (fix.used) return say("Patched up once already this flight", 1.6);
  // Turned down, the repair is not spent: it can be asked again.
  if (touch && !allowed)
    return say("Motion access is needed to repair by phone", 2);
  fix.used = true;
  fix.stage = "count";
  fix.mode = touch ? "moves" : "keys";
  fix.t = REPAIR.count * REPAIR.tick;
  fix.i = 0;
  fix.seq = Array.from({ length: runLength(P.dmg) }, () =>
    touch ? MOVES[pick(MOVES.length)] : pick(10),
  );
  show();
}

// The next step: its clock from full, and a turn told which way to go.
function step() {
  fix.t = stepTime();
  fix.since = 0;
  if (fix.mode === "moves") {
    motion.detector.reset();
    if (fix.seq[fix.i] === "turn") fix.upright = !motion.detector.upright();
  }
  show();
}
function done() {
  sfx.tick();
  if (++fix.i >= fix.seq.length) return end(true);
  step();
}

// A number key while a repair is under way. Keys in the countdown are
// ignored: it is there to get ready.
export function repairKey(n) {
  if (fix.stage !== "steps" || fix.mode !== "keys") return;
  if (n !== fix.seq[fix.i]) return end(false, "wrong key");
  done();
}

// A shake of the phone (motion.js) while a repair by phone is under way.
// One along the wrong line fails it; any during a turn is the turn itself.
export function repairMove(kind) {
  if (fix.stage !== "steps" || fix.mode !== "moves") return;
  const want = fix.seq[fix.i];
  if (want === "turn") return;
  if (kind === want) return done();
  if (fix.since >= GRACE) end(false, "wrong move");
}

function end(ok, why) {
  fix.stage = null;
  show();
  if (ok) {
    P.dmg = 0;
    say("Repaired! Flying like new", 2);
  } else if (why) say(`Repair failed: ${why}`, 2);
}

// Each frame in play, unpaused (game.js), `dt` real seconds.
export function updRepair(dt) {
  // On the ground the hangar mends; the next take-off is a new flight.
  if (P.grounded && P.alive) fix.used = false;
  if (!repairing()) return show();
  if (!P.alive || P.grounded || game.state !== "play" || P.ghost)
    return end(false, null);
  if (P.dmg >= 100) return end(false, "the engine's gone");
  fix.since += dt;
  // A turn is done once the phone is held the way asked.
  if (
    fix.stage === "steps" &&
    fix.mode === "moves" &&
    fix.seq[fix.i] === "turn" &&
    motion.detector.upright() === fix.upright
  )
    return done();
  if ((fix.t -= dt) > 0) return show();
  if (fix.stage === "count") {
    fix.stage = "steps";
    // No sensor gave a reading (a touch-screen laptop): its keys, then.
    if (fix.mode === "moves" && !motion.seen) {
      fix.mode = "keys";
      fix.seq = fix.seq.map(() => pick(10));
      say("No motion sensor: press the numbers", 2);
    }
    return step();
  }
  end(false, "too slow");
}

// A new game, or the title: nothing under way, the repair to use again.
export function resetRepair() {
  fix.stage = null;
  fix.used = false;
  show();
}

// The panel in the middle of the screen: the countdown, then the key to
// press or the move to make, how far through, and a bar for the time left.
// And the touch screen's FIX button, shown while a repair can begin.
let drawn = "",
  offered = null;
function show() {
  const can = canRepair(),
    b = $("bFix");
  if (b && can !== offered) b.classList.toggle("hidden", !(offered = can));
  // Nothing under way, and the panel already cleared: nothing to draw.
  if (!fix.stage && drawn === "null") return;
  const el = $("repair");
  if (!el) return;
  let big = "",
    note = "";
  const of = `${fix.i + 1} of ${fix.seq.length}`;
  if (fix.stage === "count") {
    big = `${Math.ceil(fix.t / REPAIR.tick - 1e-9)}…`;
    note = `Repair: ${fix.seq.length} ${fix.mode}, ${stepTime()} s each`;
  } else if (fix.stage === "steps" && fix.mode === "keys") {
    big = String(fix.seq[fix.i]);
    note = of;
  } else if (fix.stage === "steps") {
    const m = fix.seq[fix.i];
    const [glyph, words] =
      m === "turn"
        ? [
            "⟳",
            fix.upright
              ? "Turn the phone upright"
              : "Turn the phone on its side",
          ]
        : ASK[m];
    big = glyph;
    note = `${words} · ${of}`;
  }
  const now = fix.stage + big + note;
  if (now !== drawn) {
    drawn = now;
    el.classList.toggle("hidden", !fix.stage);
    el.querySelector("b").textContent = big;
    el.querySelector("small").textContent = note;
  }
  el.querySelector("u").style.width =
    fix.stage === "steps" ? `${Math.max(0, fix.t / stepTime()) * 100}%` : "0%";
}
