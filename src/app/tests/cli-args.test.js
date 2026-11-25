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

// cli-args.test.js — the Electron shell's flag parsing.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseArgs } = require("../cli-args");

test("no flags: packaged mode, no DevTools", () => {
  assert.deepEqual(parseArgs(["electron", "."]), {
    devUrl: null,
    devTools: false,
  });
});

test("--dev-url takes a local dev server", () => {
  assert.equal(
    parseArgs(["--dev-url=http://localhost:5173/"]).devUrl,
    "http://localhost:5173/",
  );
  assert.equal(
    parseArgs(["--dev-url=http://127.0.0.1:5173"]).devUrl,
    "http://127.0.0.1:5173",
  );
});

test("--dev-url refuses anything that is not local", () => {
  for (const url of [
    "https://example.com/",
    "http://localhost.evil.com/",
    "file:///etc/passwd",
    "javascript:alert(1)",
  ])
    assert.equal(parseArgs([`--dev-url=${url}`]).devUrl, null, url);
});

test("--devtools", () => {
  assert.equal(parseArgs(["--devtools"]).devTools, true);
});
