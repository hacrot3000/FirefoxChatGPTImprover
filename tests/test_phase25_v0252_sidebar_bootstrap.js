"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const localActionsSource = fs.readFileSync(path.join(root, "extension/shared/local_actions.js"), "utf8");
const sidebarSource = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
const css = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.css"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));

const context = {
  console,
  Date,
  JSON,
  Number,
  Object,
  Array,
  Set,
  RegExp,
  String,
  Boolean,
  URL,
  crypto: {
    getRandomValues(array) {
      for (let index = 0; index < array.length; index += 1) array[index] = index + 1;
      return array;
    }
  }
};
context.globalThis = context;
vm.createContext(context);
assert.doesNotThrow(() => vm.runInContext(localActionsSource, context, { filename: "local_actions.js" }));

const api = context.FCI_LOCAL_ACTIONS;
assert.ok(api, "FCI_LOCAL_ACTIONS must be exported");
const defaults = api.defaultConfig();
assert.equal(defaults.download.shellExecutionMode, "manual");
assert.equal(defaults.download.executeShellAfterMove, false);
assert.equal(defaults.shell.mode, "background");
assert.doesNotThrow(() => api.defaultStore());
assert.doesNotThrow(() => api.normalizeStore(null));

assert.doesNotMatch(
  localActionsSource.slice(localActionsSource.indexOf("function defaultConfig"), localActionsSource.indexOf("function normalizeCommandPreset")),
  /\bdownload\.|\bshell\./,
  "defaultConfig must not reference migration variables that only exist in normalizeConfig"
);
assert.match(sidebarSource, /async function bootstrapSidebar\(\)/);
assert.match(sidebarSource, /document\.body\.dataset\.sidebarReady = "true"/);
assert.match(sidebarSource, /await request\(MESSAGE\.GET_DASHBOARD\)/);
assert.match(sidebarSource, /"installation-guide": true/);
assert.match(sidebarSource, /save: true/);
assert.match(css, /body\[data-sidebar-ready="true"\] \.sticky-actions \{ position: sticky/);
assert.match(css, /body:not\(\[data-sidebar-ready="true"\]\) \.sticky-actions \{ position: static/);
assert.equal(manifest.version, "0.25.2");

console.log("PASS: Phase 25 v0.25.2 local-action runtime bootstrap, dashboard startup and sticky Save fail-safe");
