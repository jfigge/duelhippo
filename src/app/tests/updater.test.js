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

// updater.test.js — the parts of the auto-updater that run without Electron:
// loading it is inert, and the pre-release rule.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const updater = require("../updater");

test("loading the updater starts nothing", () => {
  assert.equal(typeof updater.initUpdater, "function");
  assert.equal(typeof updater.checkForUpdates, "function");
  assert.equal(typeof updater.quitAndInstall, "function");
});

test("a 0.x copy follows pre-releases; 1.0 on, stable releases only", () => {
  for (const v of ["0.9.0", "0.10.3", "0.0.1"])
    assert.equal(updater.prereleaseAllowed(v), true, v);
  for (const v of ["1.0.0", "2.3.4", "10.0.0"])
    assert.equal(updater.prereleaseAllowed(v), false, v);
});
