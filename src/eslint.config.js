// eslint.config.js — one flat config for every tree in src/.

"use strict";

const js = require("@eslint/js");
const globals = require("globals");

const rules = {
  "no-unused-vars": [
    "warn",
    { argsIgnorePattern: "^_", ignoreRestSiblings: true },
  ],
};

module.exports = [
  {
    ignores: [
      "node_modules/**",
      "www/**",
      "ios/**",
      "../dist/**",
      "server/.wrangler/**",
    ],
  },
  js.configs.recommended,
  {
    // The game: browser ES modules.
    files: ["web/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.browser,
    },
    rules,
  },
  {
    // Its tests run under Node, with jsdom windows.
    files: ["web/scripts/tests/**/*.js"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    // Electron main process and preload: CommonJS on Node.
    files: ["app/**/*.js", "eslint.config.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: globals.node,
    },
    rules,
  },
  {
    // The match server: a Cloudflare Worker (ES modules, service-worker-style
    // globals), and its tests under Node.
    files: ["server/**/*.js", "server/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.serviceworker, WebSocketPair: "readonly" },
    },
    rules,
  },
  {
    files: ["server/tests/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
  {
    // Build tooling.
    files: ["tools/**/*.mjs", "vite.config.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.node,
    },
    rules,
  },
];
