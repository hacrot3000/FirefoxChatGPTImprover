"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const moduleSource = fs.readFileSync(path.join(root, "extension/shared/command_presets.js"), "utf8");
const sidebarSource = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
const html = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
const css = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.css"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));

const context = {
  console, Date, JSON, Number, Object, Array, Set, String, Boolean,
  crypto: { getRandomValues(array) { array.fill(7); return array; } }
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(moduleSource, context, { filename: "command_presets.js" });
const api = context.FCI_COMMAND_PRESETS;
assert.equal(api.SCHEMA_VERSION, 1);
assert.match(api.STORAGE_KEY, /commandPresets/);

const legacy = {
  profiles: [{ config: { shell: { presets: [
    { id: "old", name: "Build", workingDirectory: "/repo", command: "./build.sh", mode: "background", confirmBeforeRun: false }
  ] } } }]
};
const migrated = api.mergeLegacy(api.defaultStore(), legacy);
assert.equal(migrated.presets.length, 1);
assert.equal(migrated.presets[0].name, "Build");
const duplicate = api.mergeLegacy(migrated, legacy);
assert.equal(duplicate.presets.length, 1);
const saved = api.upsert(migrated, { id: migrated.presets[0].id, name: "Build all", workingDirectory: "/repo", command: "./all.sh" });
assert.equal(saved.store.presets.length, 1);
assert.equal(saved.preset.name, "Build all");
assert.equal(api.remove(saved.store, saved.preset.id).presets.length, 0);

assert.match(html, /shared\/command_presets\.js/);
assert.match(sidebarSource, /const CommandPresets = globalThis\.FCI_COMMAND_PRESETS/);
assert.match(sidebarSource, /loadCommandPresetLibrary/);
assert.match(sidebarSource, /saveCommandPresetLibrary/);
assert.match(sidebarSource, /Apply to this tab/);
assert.match(sidebarSource, /Direct command for this tab/);
assert.match(sidebarSource, /scheduleTabCommandPersistence/);
assert.match(sidebarSource, /SAVE_TAB_LOCAL_ACTIONS/);
assert.match(sidebarSource, /readLocalActionProfileConfig/);
assert.match(css, /Phase 28/);
const manifestParts = manifest.version.split(".").map(Number);
assert.ok(manifestParts[0] > 0 || manifestParts[1] > 28 || (manifestParts[1] === 28 && manifestParts[2] >= 0));

console.log("PASS: Phase 28 independent global command presets and auto-saved direct tab commands");
