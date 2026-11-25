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
// net-protocol.test.js — what has to hold for two builds to play: the
// protocol version moves with the maps and planes, and the largest message
// the lobby sends fits through the match server.

import { test } from "node:test";
import assert from "node:assert/strict";
import { PROTO } from "../net/protocol.js";
import { MAPS, PLANES } from "../constants.js";
import { mergeLists, BOARD_MODES, TOP } from "../scores.js";
import { MAX_MESSAGE } from "../../../server/room.js";

// Each protocol version's maps and planes, as ids. Two builds on the same
// version must fly the same worlds: change either list and the test fails
// until PROTO goes up and a line for it is added here.
const VERSIONS = {
  6: {
    maps: "field sky arctic canyon zeppelin sea night volcano storm city",
    planes: "kite hornet lancer brute",
  },
};

test("new maps or planes mean a new protocol version", () => {
  assert.equal(
    PROTO,
    Math.max(...Object.keys(VERSIONS).map(Number)),
    "PROTO is the newest version listed",
  );
  const now = VERSIONS[PROTO];
  assert.ok(now, `no maps and planes recorded for PROTO ${PROTO}`);
  assert.equal(
    Object.keys(MAPS).join(" "),
    now.maps,
    "MAPS changed: bump PROTO in net/protocol.js and record it here",
  );
  assert.equal(
    PLANES.map((p) => p.id).join(" "),
    now.planes,
    "PLANES changed: bump PROTO in net/protocol.js and record it here",
  );
});

test("one mode of the biggest group board fits through the server", () => {
  const hs = Array.from({ length: 9 }, (_, i) => String(i).repeat(64));
  // The longest of everything: ids, names, scores, team numbers.
  const entry = (k) => ({
    id: String(k).padStart(40, "x"),
    at: 1_800_000_000_000 + k,
    m: "free",
    p: hs.map((h, i) => [h, "Ŵ".repeat(12), 1_000_000, i % 8]),
    w: 7,
  });
  const list = mergeLists(
    "endless",
    Array.from({ length: TOP + 5 }, (_, k) => entry(k)),
    [],
    hs,
  );
  assert.equal(list.length, TOP, "a full board");
  const message = (m) =>
    JSON.stringify({ t: "g", m: { ...m, sq: 1_000_000 }, to: [1] });
  const one = message({ t: "board", g: "f".repeat(64), mode: "endless", list });
  assert.ok(
    one.length <= MAX_MESSAGE,
    `${one.length} characters over ${MAX_MESSAGE}`,
  );
  // All three in one message, as the lobby once sent them, would not.
  const all = message({
    t: "board",
    g: "f".repeat(64),
    ...Object.fromEntries(BOARD_MODES.map((m) => [m, list])),
  });
  assert.ok(all.length > MAX_MESSAGE, `${one.length}, ${all.length}`);
});
