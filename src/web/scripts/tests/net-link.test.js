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
// net-link.test.js — the mesh on its own, with a stand-in server socket and
// data channels: running numbers, repeats and stale updates dropped, sure
// messages resent when a direct channel dies, and who came first.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mesh } from "../net/link.js";
import { MAX_MESSAGE } from "../../../server/room.js";

class FakeWS {
  readyState = 1;
  bufferedAmount = 0;
  sent = [];
  send(text) {
    this.sent.push(JSON.parse(text));
  }
  close() {}
  recv(m) {
    this.onmessage({ data: JSON.stringify(m) });
  }
}
const channel = (label) => ({
  label,
  readyState: "connecting",
  sent: [],
  send(text) {
    this.sent.push(JSON.parse(text));
  },
  close() {},
});
// Enough of WebRTC for the offerer to make its channels; the handshake
// never finishes, and the test opens the channels by hand.
class FakePC {
  createDataChannel(label) {
    return channel(label);
  }
  createOffer() {
    return new Promise(() => {});
  }
  close() {}
}
globalThis.window = { RTCPeerConnection: FakePC };

// Seat 0 with seat 1 reached directly.
function direct() {
  const ws = new FakeWS();
  const mesh = new Mesh(ws, { seat: 0, code: "ABCD", peers: [1] }, false);
  const got = [],
    paths = [];
  mesh.onmessage = (m, from, n) => got.push([m, from, n]);
  mesh.onpath = (seat, path) => paths.push(path);
  mesh.start();
  const peer = mesh.peers.get(1);
  for (const ch of Object.values(peer.ch)) {
    ch.readyState = "open";
    ch.onopen();
  }
  return { ws, mesh, peer, got, paths };
}

test("every message is numbered; sure ones are kept, and resent when the channel dies", () => {
  const { ws, mesh, peer, paths } = direct();
  assert.deepEqual(paths, ["direct"]);
  const sure = peer.ch.sure,
    fast = peer.ch.fast;
  mesh.send({ t: "f", s: 1 });
  mesh.send({ t: "s" }, true);
  mesh.send({ t: "out" });
  assert.deepEqual(sure.sent, [
    { t: "f", s: 1, sq: 1 },
    { t: "out", sq: 3 },
  ]);
  assert.deepEqual(fast.sent, [{ t: "s", fq: 2 }]);
  assert.equal(ws.sent.length, 0, "nothing through the server yet");
  // The sure channel dies with who knows what unsent.
  sure.onclose();
  assert.deepEqual(paths, ["direct", "relay"]);
  assert.deepEqual(
    ws.sent,
    [{ t: "g", m: { t: "rs", ms: [{ t: "out", sq: 3 }] }, to: [1] }],
    "the shot is not worth resending late; the out is",
  );
  // From now on, through the server, still numbered.
  mesh.send({ t: "down" });
  assert.deepEqual(ws.sent.at(-1), { t: "g", m: { t: "down", sq: 4 } });
  mesh.close();
});

test("repeats and stale state updates are dropped; the number goes to the game", () => {
  const { ws, mesh, got } = direct();
  const g = (m) => ws.recv({ t: "g", from: 1, m });
  g({ t: "f", sq: 5 });
  g({ t: "f", sq: 5 });
  g({
    t: "rs",
    ms: [
      { t: "f", sq: 5 },
      { t: "out", sq: 6 },
      { t: "rs", ms: [] },
    ],
  });
  assert.deepEqual(got, [
    [{ t: "f" }, 1, 5],
    [{ t: "out" }, 1, 6],
  ]);
  got.length = 0;
  g({ t: "s", fq: 10 });
  g({ t: "s", fq: 9 });
  g({ t: "s", fq: 11 });
  g({ t: "hi" });
  assert.deepEqual(got, [
    [{ t: "s" }, 1, 10],
    [{ t: "s" }, 1, 11],
    [{ t: "hi" }, 1, undefined],
  ]);
  // A sure message held up behind later ones still arrives.
  got.length = 0;
  g({ t: "f", sq: 3 });
  assert.equal(got.length, 1);
  mesh.close();
});

test("a big resend goes in bundles the server will carry", () => {
  const { ws, mesh, peer } = direct();
  for (let i = 0; i < 300; i++) mesh.send({ t: "tg", o: "x".repeat(200) });
  peer.ch.sure.onclose();
  assert.ok(ws.sent.length > 1, "more than one bundle");
  const all = ws.sent.flatMap((x) => x.m.ms);
  assert.equal(all.length, 300);
  assert.deepEqual(
    all.map((m) => m.sq),
    Array.from({ length: 300 }, (_, i) => i + 1),
    "in order",
  );
  for (const x of ws.sent) assert.ok(JSON.stringify(x).length <= MAX_MESSAGE);
  mesh.close();
});

test("the organiser is whoever came first, not the lowest seat", () => {
  const ws = new FakeWS();
  // Seat 2 made the room; seat 0 came next, after its first player left.
  const mesh = new Mesh(ws, { seat: 1, code: "ABCD", peers: [2, 0] }, true);
  mesh.start();
  assert.equal(mesh.organiser, 2);
  ws.recv({ t: "peer", seat: 3 });
  assert.deepEqual(mesh.order, [2, 0, 1, 3]);
  ws.recv({ t: "left", seat: 2 });
  assert.equal(mesh.organiser, 0);
  ws.recv({ t: "left", seat: 0 });
  assert.equal(mesh.organiser, 1, "now us");
  mesh.close();
});

test("a connection in trouble sends both ways until it recovers", () => {
  const { ws, mesh, peer } = direct();
  const sure = peer.ch.sure;
  mesh.send({ t: "down" });
  peer.pc.connectionState = "disconnected";
  peer.pc.onconnectionstatechange();
  assert.deepEqual(ws.sent, [
    { t: "g", m: { t: "rs", ms: [{ t: "down", sq: 1 }] }, to: [1] },
  ]);
  mesh.send({ t: "f" });
  assert.deepEqual(sure.sent.at(-1), { t: "f", sq: 2 });
  assert.deepEqual(ws.sent.at(-1), { t: "g", m: { t: "f", sq: 2 } });
  peer.pc.connectionState = "connected";
  peer.pc.onconnectionstatechange();
  ws.sent.length = 0;
  mesh.send({ t: "out" });
  assert.equal(ws.sent.length, 0, "direct alone again");
  assert.equal(peer.path, "direct");
  peer.pc.connectionState = "failed";
  peer.pc.onconnectionstatechange();
  assert.equal(peer.path, "relay");
  assert.deepEqual(ws.sent.at(-1).m.ms, [{ t: "out", sq: 3 }]);
  mesh.close();
});
