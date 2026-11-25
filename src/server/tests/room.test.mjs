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

// room.test.mjs — the room's rules, without Cloudflare.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALPHABET,
  makeCode,
  normaliseCode,
  admit,
  route,
  underLimit,
  acceptable,
  CLOSE,
  MAX_SEATS,
  MAX_PER_SECOND,
} from "../room.js";

test("codes are four letters nobody misreads", () => {
  for (const c of ["I", "L", "O", "U", "0", "1"])
    assert.ok(!ALPHABET.includes(c));
  let n = 0;
  const seq = () => [0, 0.5, 0.999, 0.25][n++ % 4];
  const code = makeCode(seq);
  assert.equal(code.length, 4);
  assert.ok([...code].every((c) => ALPHABET.includes(c)));
});

test("what a player types is forgiven its case and spaces, nothing else", () => {
  assert.equal(normaliseCode(" kq7f "), null, "7 is not in the alphabet");
  assert.equal(normaliseCode("kqzf"), "KQZF");
  assert.equal(normaliseCode("K Q Z F"), "KQZF");
  assert.equal(normaliseCode("KQZ"), null);
  assert.equal(normaliseCode("KQZFF"), null);
  assert.equal(normaliseCode("KQOF"), null);
  assert.equal(normaliseCode(undefined), null);
});

test("a room fills seat by seat, lowest free first, up to nine", () => {
  assert.deepEqual(admit("host", new Set()), { ok: true, seat: 0 });
  assert.equal(admit("host", new Set([3])).close, CLOSE.taken);
  assert.equal(admit("guest", new Set()).close, CLOSE.nogame);
  assert.deepEqual(admit("guest", new Set([0])), { ok: true, seat: 1 });
  assert.deepEqual(admit("guest", new Set([1, 2])), { ok: true, seat: 0 });
  const full = new Set(Array.from({ length: MAX_SEATS }, (_, i) => i));
  assert.equal(admit("guest", full).close, CLOSE.full);
  full.delete(4);
  assert.deepEqual(admit("guest", full), { ok: true, seat: 4 });
});

test("a handshake goes to its one seat, stamped with the sender", () => {
  const here = new Set([0, 1, 2]);
  const r = route(JSON.stringify({ t: "sig", to: 2, d: "x" }), 0, here);
  assert.deepEqual(r.to, [2]);
  assert.deepEqual(JSON.parse(r.text), { t: "sig", to: 2, d: "x", from: 0 });
  assert.equal(route(JSON.stringify({ t: "sig", to: 7 }), 0, here), null);
  assert.equal(route(JSON.stringify({ t: "sig", to: 0 }), 0, here), null);
});

test("a relayed game message fans out: to everyone else, or to the seats named", () => {
  const here = new Set([0, 1, 2, 5]);
  const all = route(JSON.stringify({ t: "g", m: { t: "s" } }), 1, here);
  assert.deepEqual(all.to, [0, 2, 5]);
  assert.deepEqual(JSON.parse(all.text), { t: "g", m: { t: "s" }, from: 1 });
  const some = route(
    JSON.stringify({ t: "g", m: { t: "f" }, to: [5, 1, 8] }),
    1,
    here,
  );
  assert.deepEqual(some.to, [5], "not back to the sender, not to empty seats");
  assert.equal(route("not json", 1, here), null);
  assert.equal(route(JSON.stringify({ t: "room" }), 1, here), null);
  assert.equal(route(JSON.stringify({ t: "g", m: 1 }), 0, new Set([0])), null);
});

test("a flood is cut off at the limit and forgiven the next second", () => {
  const c = {};
  let passed = 0;
  for (let i = 0; i < MAX_PER_SECOND + 30; i++)
    if (underLimit(c, 5_000)) passed++;
  assert.equal(passed, MAX_PER_SECOND);
  assert.ok(underLimit(c, 6_000));
});

test("only short text is carried", () => {
  assert.ok(acceptable('{"t":"g"}'));
  assert.ok(!acceptable(new ArrayBuffer(8)));
  assert.ok(!acceptable("x".repeat(9000)));
});
