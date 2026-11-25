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

// asc-submit.mjs — put an uploaded iOS build up for App Store review, through
// the App Store Connect API. The Release workflow runs it after `make
// ios-upload`; it can be run by hand the same way:
//
//   APPLE_API_KEY=AuthKey_XXXX.p8 APPLE_API_KEY_ID=XXXX APPLE_API_ISSUER=… \
//     node tools/asc-submit.mjs --version 0.2.0 --build 263282005
//
// It does what the web console's "Add for Review" does, in order:
//   1. find the app by bundle id
//   2. wait for the build to finish processing (it arrives from the upload
//      as PROCESSING; Apple takes a few minutes to tens of minutes)
//   3. find the App Store version for --version, or create it
//   4. attach the build to that version
//   5. add the version to a review submission and submit it
//
// What it cannot do is fill in the store listing: the description,
// screenshots, keywords, privacy answers and age rating are set once in App
// Store Connect, and a version without them is refused at step 5 with
// Apple's own list of what is missing, which this prints.
//
// --dry-run stops after step 3 and changes nothing.

import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

const API = "https://api.appstoreconnect.apple.com";

// An App Store Connect token: an ES256 JWT, good for at most 20 minutes.
// Node signs ECDSA as DER by default; JWS wants the raw r||s form.
export function token({ keyPem, keyId, issuer, now = Date.now() }) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const iat = Math.floor(now / 1000);
  const head = b64({ alg: "ES256", kid: keyId, typ: "JWT" });
  const body = b64({
    iss: issuer,
    iat,
    exp: iat + 15 * 60,
    aud: "appstoreconnect-v1",
  });
  const sig = sign("sha256", Buffer.from(`${head}.${body}`), {
    key: createPrivateKey(keyPem),
    dsaEncoding: "ieee-p1363",
  });
  return `${head}.${body}.${sig.toString("base64url")}`;
}

// A small client: JSON in and out, Apple's error list turned into one
// readable message, and a fresh token whenever the old one is near expiry
// (the processing wait can outlast one).
export function client({ keyPem, keyId, issuer, fetch = globalThis.fetch }) {
  let jwt = null,
    made = 0;
  return async function call(method, path, data) {
    if (!jwt || Date.now() - made > 10 * 60 * 1000) {
      jwt = token({ keyPem, keyId, issuer });
      made = Date.now();
    }
    const res = await fetch(API + path, {
      method,
      headers: {
        Authorization: `Bearer ${jwt}`,
        ...(data ? { "Content-Type": "application/json" } : {}),
      },
      body: data ? JSON.stringify({ data }) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const why = (json.errors || [])
        .map((e) => `  - ${e.title}: ${e.detail}`)
        .join("\n");
      const err = new Error(`${method} ${path} → ${res.status}\n${why}`);
      err.status = res.status;
      throw err;
    }
    return json;
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function submit(call, opts) {
  const {
    log = (...a) => console.log(...a),
    bundleId,
    version,
    build,
    release = "AFTER_APPROVAL",
    dryRun = false,
    pollMs = 60_000,
    waitMs = 90 * 60_000,
  } = opts;

  // 1. The app. App Store Connect cannot create one through the API; it has
  // to exist (My Apps → +) before the first run.
  const apps = await call(
    "GET",
    `/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}`,
  );
  const app = apps.data.find((a) => a.attributes.bundleId === bundleId);
  if (!app)
    throw new Error(
      `No app with bundle id ${bundleId} in App Store Connect. Create it there first (My Apps → + → New App).`,
    );
  log(`App ${app.attributes.name} (${app.id})`);

  // 2. The build, once Apple has processed it.
  let found;
  for (const until = Date.now() + waitMs; ;) {
    const builds = await call(
      "GET",
      `/v1/builds?filter[app]=${app.id}&filter[version]=${encodeURIComponent(build)}` +
        `&filter[preReleaseVersion.version]=${encodeURIComponent(version)}`,
    );
    found = builds.data[0] || null;
    const state = found ? found.attributes.processingState : "NOT YET VISIBLE";
    if (state === "VALID") break;
    if (state === "FAILED" || state === "INVALID")
      throw new Error(
        `Build ${version} (${build}) is ${state} in App Store Connect.`,
      );
    if (Date.now() > until)
      throw new Error(
        `Build ${version} (${build}) still ${state} after ${waitMs / 60_000} min.`,
      );
    log(`Build ${version} (${build}): ${state}, checking again shortly`);
    await sleep(pollMs);
  }
  log(`Build ${version} (${build}) is processed (${found.id})`);

  // 3. The App Store version.
  const versions = await call(
    "GET",
    `/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS` +
      `&filter[versionString]=${encodeURIComponent(version)}`,
  );
  let asv = versions.data[0];
  if (dryRun) {
    log(
      asv
        ? `Version ${version} exists (${asv.id})`
        : `Version ${version} would be created`,
    );
    log("Dry run: nothing changed.");
    return { app: app.id, build: found.id, version: asv ? asv.id : null };
  }
  // Apple allows one editable version at a time. If an earlier one never
  // went out (still being prepared, or rejected), it is renamed to this one
  // rather than refused alongside it.
  if (!asv) {
    const editable = await call(
      "GET",
      `/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS` +
        "&filter[appStoreState]=PREPARE_FOR_SUBMISSION,DEVELOPER_REJECTED,REJECTED,METADATA_REJECTED",
    );
    if (editable.data[0]) {
      const old = editable.data[0];
      asv = (
        await call("PATCH", `/v1/appStoreVersions/${old.id}`, {
          type: "appStoreVersions",
          id: old.id,
          attributes: { versionString: version },
        })
      ).data;
      log(
        `Renamed unreleased version ${old.attributes.versionString} to ${version} (${asv.id})`,
      );
    }
  }
  if (!asv) {
    asv = (
      await call("POST", "/v1/appStoreVersions", {
        type: "appStoreVersions",
        attributes: {
          platform: "IOS",
          versionString: version,
          releaseType: release,
        },
        relationships: { app: { data: { type: "apps", id: app.id } } },
      })
    ).data;
    log(`Created version ${version} (${asv.id}), release ${release}`);
  } else
    log(`Version ${version} (${asv.id}) is ${asv.attributes.appStoreState}`);

  // 4. The build goes on the version.
  await call("PATCH", `/v1/appStoreVersions/${asv.id}/relationships/build`, {
    type: "builds",
    id: found.id,
  });
  log(`Attached build ${build}`);

  // 5. Review. A submission that is still being put together is reused; one
  // already with Apple means this version is too, and there is nothing to do.
  const open = await call(
    "GET",
    `/v1/reviewSubmissions?filter[app]=${app.id}&filter[platform]=IOS` +
      "&filter[state]=READY_FOR_REVIEW,WAITING_FOR_REVIEW,IN_REVIEW",
  );
  const busy = open.data.find((s) => s.attributes.state !== "READY_FOR_REVIEW");
  if (busy) {
    log(
      `A submission is already ${busy.attributes.state}; the new build is attached and waits for it.`,
    );
    return {
      app: app.id,
      build: found.id,
      version: asv.id,
      submission: busy.id,
    };
  }
  let sub = open.data[0];
  if (!sub)
    sub = (
      await call("POST", "/v1/reviewSubmissions", {
        type: "reviewSubmissions",
        attributes: { platform: "IOS" },
        relationships: { app: { data: { type: "apps", id: app.id } } },
      })
    ).data;
  try {
    await call("POST", "/v1/reviewSubmissionItems", {
      type: "reviewSubmissionItems",
      relationships: {
        reviewSubmission: { data: { type: "reviewSubmissions", id: sub.id } },
        appStoreVersion: { data: { type: "appStoreVersions", id: asv.id } },
      },
    });
  } catch (err) {
    // 409: the version is already an item of this submission (a re-run).
    if (err.status !== 409) throw err;
  }
  await call("PATCH", `/v1/reviewSubmissions/${sub.id}`, {
    type: "reviewSubmissions",
    id: sub.id,
    attributes: { submitted: true },
  });
  log(`Submitted ${version} (${build}) for App Store review.`);
  return { app: app.id, build: found.id, version: asv.id, submission: sub.id };
}

const IS_MAIN =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (IS_MAIN) {
  const { values } = parseArgs({
    options: {
      version: { type: "string" },
      build: { type: "string" },
      bundle: { type: "string", default: "com.duelhippo.app" },
      release: { type: "string", default: "AFTER_APPROVAL" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const { APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER } = process.env;
  if (
    !values.version ||
    !values.build ||
    !APPLE_API_KEY ||
    !APPLE_API_KEY_ID ||
    !APPLE_API_ISSUER
  ) {
    console.error(
      "usage: APPLE_API_KEY=<.p8 path> APPLE_API_KEY_ID=… APPLE_API_ISSUER=… \\\n" +
        "  node tools/asc-submit.mjs --version <x.y.z> --build <n> [--release MANUAL] [--dry-run]",
    );
    process.exit(2);
  }
  const call = client({
    keyPem: readFileSync(APPLE_API_KEY, "utf8"),
    keyId: APPLE_API_KEY_ID,
    issuer: APPLE_API_ISSUER,
  });
  submit(call, {
    bundleId: values.bundle,
    version: values.version,
    build: values.build,
    release: values.release,
    dryRun: values["dry-run"],
  }).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
