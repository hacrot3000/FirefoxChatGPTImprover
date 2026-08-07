#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const settingsSource = fs.readFileSync(path.join(root, "extension/shared/settings.js"), "utf8");
const snapshotsSource = fs.readFileSync(path.join(root, "extension/shared/settings_snapshots.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));
const sandbox = { console, Date, JSON, Math, URL, Uint32Array, crypto: crypto.webcrypto, globalThis: null };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(settingsSource, sandbox, { filename: "settings.js" });
vm.runInContext(snapshotsSource, sandbox, { filename: "settings_snapshots.js" });
const Settings = sandbox.FCI_SETTINGS;
const Snapshots = sandbox.FCI_SETTINGS_SNAPSHOTS;
assert(Snapshots.VERSION >= 4);
assert.equal(Snapshots.MAX_SNAPSHOTS, 20, "Phase 63 must preserve the real Phase 62 bounded history size");
const base = Settings.defaultStore();
const automatic = Snapshots.makeSnapshot(base, "before_profile_save", "Automatic", {
  id: "auto-same-state", createdAt: "2026-08-07T06:00:00.000Z"
});
let result = Snapshots.addSnapshot({}, automatic);
assert.equal(result.added, true);
assert.equal(result.collection.snapshots.length, 1);
assert.equal(result.collection.snapshots[0].reason, "before_profile_save");
const manual = Snapshots.makeSnapshot(base, "manual", "Manual checkpoint", {
  id: "manual-same-state", createdAt: "2026-08-07T06:01:00.000Z"
});
result = Snapshots.addSnapshot(result.collection, manual);
assert.equal(result.added, true, "manual intent must not be deduplicated away by an automatic snapshot");
assert.equal(result.promoted, true);
assert.equal(result.collection.snapshots.length, 1, "promotion must not duplicate identical configuration");
assert.equal(result.snapshot.id, "manual-same-state");
assert.equal(result.collection.snapshots[0].id, "manual-same-state");
assert.equal(result.collection.snapshots[0].reason, "manual");
const autoAgain = Snapshots.makeSnapshot(base, "before_settings_import", "Automatic again", {
  id: "auto-after-manual", createdAt: "2026-08-07T06:02:00.000Z"
});
result = Snapshots.addSnapshot(result.collection, autoAgain);
assert.equal(result.added, false, "automatic duplicate must not replace/demote an existing manual snapshot");
assert.equal(result.promoted, false);
assert.equal(result.collection.snapshots[0].id, "manual-same-state");
const manualAgain = Snapshots.makeSnapshot(base, "manual", "Manual duplicate", {
  id: "manual-duplicate", createdAt: "2026-08-07T06:03:00.000Z"
});
result = Snapshots.addSnapshot(result.collection, manualAgain);
assert.equal(result.added, false, "manual duplicate of an existing manual point stays deduplicated");
assert.equal(result.promoted, false);
assert.equal(result.collection.snapshots.length, 1);
const parts = manifest.version.split(".").map(Number);
assert(parts[0] > 0 || parts[1] > 41 || (parts[1] === 41 && parts[2] >= 4));
console.log("PASS: Phase 63 promotes an identical automatic semantic recovery point to Manual without changing Phase 62 retention policy");
