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

// repair.js — fixing the plane in flight (F). Not part of the prototype.
//
// A plane hurt but still flying (its damage short of the 100 that stops the
// engine) can be patched up once a flight: after a countdown in the middle
// of the screen (3…, 2…, 1…, half a second each) comes a run of number
// keys, 1.75 s each (constants.js REPAIR). One wrong or late and the
// repair has failed; all of them and the damage is gone. Fuel and rounds
// are not touched. Either way that flight's repair is spent: landing (or a
// new plane) starts a new flight.
//
// While it runs the other planes hold their fire at this one: the flyers
// don't shoot at it (ai.js), and no plane's round or missile hurts it
// (weapons.js, missiles.js). Flak on the ground still does.
//
// The numbers come from crypto, never Math.random, whose draws are the
// prototype's. game.js runs it each frame in play (real time, as the HUD:
// its seconds are the same at any game speed), input.js gives it the keys.

import { $ } from "./util.js";
import { REPAIR } from "./constants.js";
import { game } from "./state.js";
import { P } from "./flight.js";
import { say } from "./msg.js";
import { sfx } from "./audio.js";

// `stage`: null (none under way), "count" or "keys". `seq` is the run of
// numbers, 0–9; `i` the next to press; `t` the time left on this stage.
export const fix = { stage: null, used: false, seq: [], i: 0, t: 0 };
export const repairing = () => fix.stage !== null;

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

// F: begin, if this flight's repair is still to use and there is something
// to mend. Says why not otherwise.
export function startRepair() {
  if (game.state !== "play" || !P.alive || repairing()) return;
  if (P.ghost) return;
  if (P.grounded)
    return say("Repairs are for the air; your hangar fixes you here", 1.6);
  if (P.dmg <= 0) return say("Nothing to fix", 1.2);
  if (P.dmg >= 100) return say("Too far gone to fix", 1.4);
  if (fix.used) return say("Patched up once already this flight", 1.6);
  fix.used = true;
  fix.stage = "count";
  fix.t = REPAIR.count * REPAIR.tick;
  fix.i = 0;
  fix.seq = Array.from({ length: runLength(P.dmg) }, () => pick(10));
  show();
}

// A number key while a repair is under way. Keys in the countdown are
// ignored: it is there to get ready.
export function repairKey(n) {
  if (fix.stage !== "keys") return;
  if (n !== fix.seq[fix.i]) return end(false, "wrong key");
  sfx.tick();
  if (++fix.i >= fix.seq.length) return end(true);
  fix.t = REPAIR.per;
  show();
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
  if (!repairing()) return;
  if (!P.alive || P.grounded || game.state !== "play" || P.ghost)
    return end(false, null);
  if (P.dmg >= 100) return end(false, "the engine's gone");
  if ((fix.t -= dt) > 0) return show();
  if (fix.stage === "count") {
    fix.stage = "keys";
    fix.t = REPAIR.per;
    return show();
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
// press, how far through, and a bar for the time left.
let drawn = "";
function show() {
  const el = $("repair");
  if (!el) return;
  let big = "",
    note = "";
  if (fix.stage === "count") {
    big = `${Math.ceil(fix.t / REPAIR.tick - 1e-9)}…`;
    note = `Repair: ${fix.seq.length} keys, ${REPAIR.per} s each`;
  } else if (fix.stage === "keys") {
    big = String(fix.seq[fix.i]);
    note = `${fix.i + 1} of ${fix.seq.length}`;
  }
  const now = fix.stage + big + note;
  if (now !== drawn) {
    drawn = now;
    el.classList.toggle("hidden", !fix.stage);
    el.querySelector("b").textContent = big;
    el.querySelector("small").textContent = note;
  }
  el.querySelector("u").style.width =
    fix.stage === "keys" ? `${Math.max(0, fix.t / REPAIR.per) * 100}%` : "0%";
}
