// license-header.mjs — stamp (or, with --check, require) the GPL header on
// every first-party source file.
//
// Scope: src/app, src/web (scripts and styles) and src/tools — JS, MJS and
// CSS. Generated and third-party trees (node_modules, www, ios) are not ours
// to stamp. A file "has" the header when it contains the "This file is part
// of Duel Hippo." line; anything else gets header.txt prepended.

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const HEADER = readFileSync(new URL("./header.txt", import.meta.url), "utf8");
const MARK = "This file is part of Duel Hippo.";
const ROOTS = ["app", "web/scripts", "web/styles", "tools", "server"];
// Installed and generated trees under the roots (src/server has its own).
const SKIP = new Set(["node_modules", ".wrangler"]);
const EXT = new Set([".js", ".mjs", ".cjs", ".css"]);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (EXT.has(path.extname(name))) yield p;
  }
}

const check = process.argv.includes("--check");
const missing = [];
for (const root of ROOTS)
  for (const file of walk(path.join(SRC, root))) {
    const text = readFileSync(file, "utf8");
    if (text.includes(MARK)) continue;
    missing.push(path.relative(SRC, file));
    if (!check) writeFileSync(file, HEADER + "\n" + text);
  }

if (check && missing.length) {
  console.error(
    `Missing the GPL header (run \`make license-headers\`):\n  ${missing.join("\n  ")}`,
  );
  process.exit(1);
}
if (!check && missing.length) console.log(`Stamped ${missing.length} file(s).`);
