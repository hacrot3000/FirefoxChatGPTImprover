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
assert(Snapshots.VERSION >= 5);
assert.equal(Snapshots.MAX_SNAPSHOTS, 20);
const base = Settings.defaultStore();
const same = (reason, id, createdAt) => Snapshots.makeSnapshot(base, reason, id, { id, createdAt });

let normalized = Snapshots.normalizeCollection({ snapshots: [
  same("manual", "manual-old", "2026-08-07T06:00:00.000Z"),
  same("before_profile_save", "auto-new", "2026-08-07T06:01:00.000Z")
] });
assert.equal(normalized.snapshots.length, 1);
assert.equal(normalized.snapshots[0].id, "manual-old", "Manual must survive a newer automatic semantic duplicate during collection load");
assert.equal(normalized.snapshots[0].reason, "manual");

normalized = Snapshots.normalizeCollection({ snapshots: [
  same("before_profile_save", "auto-old", "2026-08-07T06:00:00.000Z"),
  same("manual", "manual-new", "2026-08-07T06:01:00.000Z")
] });
assert.equal(normalized.snapshots[0].id, "manual-new");

normalized = Snapshots.normalizeCollection({ snapshots: [
  same("before_profile_save", "auto-old-2", "2026-08-07T06:00:00.000Z"),
  same("before_settings_import", "auto-new-2", "2026-08-07T06:02:00.000Z")
] });
assert.equal(normalized.snapshots.length, 1);
assert.equal(normalized.snapshots[0].id, "auto-new-2", "Newest automatic duplicate must win within automatic class");

normalized = Snapshots.normalizeCollection({ snapshots: [
  same("manual", "manual-old-2", "2026-08-07T06:00:00.000Z"),
  same("manual", "manual-new-2", "2026-08-07T06:03:00.000Z")
] });
assert.equal(normalized.snapshots.length, 1);
assert.equal(normalized.snapshots[0].id, "manual-new-2", "Newest Manual duplicate must win within Manual class");

let result = Snapshots.addSnapshot(normalized, same("before_profile_delete", "auto-after-manual", "2026-08-07T06:04:00.000Z"));
assert.equal(result.added, false, "Phase 63 must still prevent automatic demotion after Phase 64 normalization");
assert.equal(result.collection.snapshots[0].reason, "manual");

const parts = manifest.version.split(".").map(Number);
assert(parts[0] > 0 || parts[1] > 41 || (parts[1] === 41 && parts[2] >= 5));
console.log("PASS: Phase 64 preserves Manual recovery intent during semantic collection compaction and keeps newest duplicates within each class");
