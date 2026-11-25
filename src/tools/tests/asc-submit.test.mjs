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

// asc-submit.test.mjs — the App Store submission script against a fake App
// Store Connect: the token Apple will accept, and the order of calls.

import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify, createPublicKey } from "node:crypto";
import { token, client, submit } from "../asc-submit.mjs";

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const keyPem = privateKey.export({ type: "pkcs8", format: "pem" });

test("the token is an ES256 JWT Apple can verify", () => {
  const jwt = token({
    keyPem,
    keyId: "KEY123",
    issuer: "iss-1",
    now: 1_700_000_000_000,
  });
  const [h, b, s] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url")), {
    alg: "ES256",
    kid: "KEY123",
    typ: "JWT",
  });
  const body = JSON.parse(Buffer.from(b, "base64url"));
  assert.equal(body.iss, "iss-1");
  assert.equal(body.aud, "appstoreconnect-v1");
  assert.ok(
    body.exp - body.iat <= 20 * 60,
    "Apple refuses more than 20 minutes",
  );
  const sig = Buffer.from(s, "base64url");
  assert.equal(sig.length, 64, "raw r||s, not DER");
  assert.ok(
    verify(
      "sha256",
      Buffer.from(`${h}.${b}`),
      {
        key: createPublicKey(keyPem),
        dsaEncoding: "ieee-p1363",
      },
      sig,
    ),
  );
});

// A fake App Store Connect: routes keyed "METHOD path-prefix", answered in
// order, and every call recorded.
function fakeApple(routes) {
  const calls = [];
  const fetch = async (url, init) => {
    const path = url.replace("https://api.appstoreconnect.apple.com", "");
    calls.push(`${init.method} ${path.split("?")[0]}`);
    assert.match(init.headers.Authorization, /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    const key = Object.keys(routes).find((k) =>
      `${init.method} ${path}`.startsWith(k),
    );
    assert.ok(key, `unexpected ${init.method} ${path}`);
    const answers = routes[key];
    const a = answers.length > 1 ? answers.shift() : answers[0];
    return {
      ok: (a.status || 200) < 400,
      status: a.status || 200,
      text: async () => (a.body ? JSON.stringify(a.body) : ""),
    };
  };
  return { calls, call: client({ keyPem, keyId: "K", issuer: "I", fetch }) };
}

const APP = {
  data: [
    {
      id: "app1",
      attributes: { bundleId: "com.duelhippo.app", name: "Duel Hippo" },
    },
  ],
};
const build = (state) => ({
  body: { data: [{ id: "b1", attributes: { processingState: state } }] },
});
const quiet = { pollMs: 0, waitMs: 60_000, log: () => {} };

test("first release: waits for processing, creates the version, submits it", async () => {
  const { calls, call } = fakeApple({
    "GET /v1/apps?": [{ body: APP }],
    "GET /v1/builds": [
      { body: { data: [] } },
      build("PROCESSING"),
      build("VALID"),
    ],
    "GET /v1/apps/app1/appStoreVersions": [{ body: { data: [] } }],
    "POST /v1/appStoreVersions": [
      { body: { data: { id: "v1", attributes: {} } } },
    ],
    "PATCH /v1/appStoreVersions/v1/relationships/build": [{ status: 204 }],
    "GET /v1/reviewSubmissions": [{ body: { data: [] } }],
    "POST /v1/reviewSubmissions": [
      { body: { data: { id: "s1", attributes: {} } } },
    ],
    "POST /v1/reviewSubmissionItems": [{ body: { data: { id: "i1" } } }],
    "PATCH /v1/reviewSubmissions/s1": [{ body: { data: { id: "s1" } } }],
  });
  const out = await submit(call, {
    bundleId: "com.duelhippo.app",
    version: "0.1.0",
    build: "263282005",
    ...quiet,
  });
  assert.deepEqual(out, {
    app: "app1",
    build: "b1",
    version: "v1",
    submission: "s1",
  });
  assert.deepEqual(calls, [
    "GET /v1/apps",
    "GET /v1/builds",
    "GET /v1/builds",
    "GET /v1/builds",
    "GET /v1/apps/app1/appStoreVersions",
    "GET /v1/apps/app1/appStoreVersions",
    "POST /v1/appStoreVersions",
    "PATCH /v1/appStoreVersions/v1/relationships/build",
    "GET /v1/reviewSubmissions",
    "POST /v1/reviewSubmissions",
    "POST /v1/reviewSubmissionItems",
    "PATCH /v1/reviewSubmissions/s1",
  ]);
});

test("an unreleased earlier version is renamed, not duplicated", async () => {
  const { calls, call } = fakeApple({
    "GET /v1/apps?": [{ body: APP }],
    "GET /v1/builds": [build("VALID")],
    "GET /v1/apps/app1/appStoreVersions": [
      { body: { data: [] } },
      {
        body: { data: [{ id: "v0", attributes: { versionString: "0.1.0" } }] },
      },
    ],
    "PATCH /v1/appStoreVersions/v0/relationships/build": [{ status: 204 }],
    "PATCH /v1/appStoreVersions/v0": [
      { body: { data: { id: "v0", attributes: {} } } },
    ],
    "GET /v1/reviewSubmissions": [
      {
        body: {
          data: [{ id: "s0", attributes: { state: "READY_FOR_REVIEW" } }],
        },
      },
    ],
    "POST /v1/reviewSubmissionItems": [
      { status: 409, body: { errors: [{ title: "dup", detail: "already" }] } },
    ],
    "PATCH /v1/reviewSubmissions/s0": [{ body: { data: { id: "s0" } } }],
  });
  const out = await submit(call, {
    bundleId: "com.duelhippo.app",
    version: "0.1.1",
    build: "2",
    ...quiet,
  });
  assert.equal(out.version, "v0");
  assert.equal(out.submission, "s0");
  assert.ok(!calls.includes("POST /v1/appStoreVersions"), "no second version");
  assert.ok(
    !calls.includes("POST /v1/reviewSubmissions"),
    "the open submission is reused",
  );
});

test("no app record: says to create it, changes nothing", async () => {
  const { calls, call } = fakeApple({
    "GET /v1/apps?": [{ body: { data: [] } }],
  });
  await assert.rejects(
    submit(call, {
      bundleId: "com.duelhippo.app",
      version: "0.1.0",
      build: "1",
      ...quiet,
    }),
    /Create it there first/,
  );
  assert.deepEqual(calls, ["GET /v1/apps"]);
});

test("Apple's reasons for refusing are passed on", async () => {
  const { call } = fakeApple({
    "GET /v1/apps?": [{ body: APP }],
    "GET /v1/builds": [build("VALID")],
    "GET /v1/apps/app1/appStoreVersions": [
      {
        body: {
          data: [
            {
              id: "v1",
              attributes: { appStoreState: "PREPARE_FOR_SUBMISSION" },
            },
          ],
        },
      },
    ],
    "PATCH /v1/appStoreVersions/v1/relationships/build": [{ status: 204 }],
    "GET /v1/reviewSubmissions": [{ body: { data: [] } }],
    "POST /v1/reviewSubmissions": [
      { body: { data: { id: "s1", attributes: {} } } },
    ],
    "POST /v1/reviewSubmissionItems": [{ body: { data: { id: "i1" } } }],
    "PATCH /v1/reviewSubmissions/s1": [
      {
        status: 409,
        body: {
          errors: [{ title: "Missing screenshots", detail: "iPhone 6.9-inch" }],
        },
      },
    ],
  });
  await assert.rejects(
    submit(call, {
      bundleId: "com.duelhippo.app",
      version: "0.1.0",
      build: "1",
      ...quiet,
    }),
    /Missing screenshots: iPhone 6\.9-inch/,
  );
});

test("dry run reads and changes nothing", async () => {
  const { calls, call } = fakeApple({
    "GET /v1/apps?": [{ body: APP }],
    "GET /v1/builds": [build("VALID")],
    "GET /v1/apps/app1/appStoreVersions": [{ body: { data: [] } }],
  });
  await submit(call, {
    bundleId: "com.duelhippo.app",
    version: "0.1.0",
    build: "1",
    dryRun: true,
    ...quiet,
  });
  assert.ok(calls.every((c) => c.startsWith("GET ")));
});
