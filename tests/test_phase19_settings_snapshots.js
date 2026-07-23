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
const protocolSource = fs.readFileSync(path.join(root, "extension/shared/protocol.js"), "utf8");
const backgroundSource = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
const sidebarHtml = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
const sidebarSource = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));

const sandbox = {
  console,
  Date,
  JSON,
  Math,
  URL,
  Uint32Array,
  crypto: crypto.webcrypto,
  globalThis: null
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(settingsSource, sandbox, { filename: "settings.js" });
vm.runInContext(snapshotsSource, sandbox, { filename: "settings_snapshots.js" });

const Settings = sandbox.FCI_SETTINGS;
const Snapshots = sandbox.FCI_SETTINGS_SNAPSHOTS;
assert(Snapshots && Snapshots.VERSION >= 1);
assert.equal(Snapshots.MAX_SNAPSHOTS, 20);

const base = Settings.defaultStore();
const first = Snapshots.makeSnapshot(base, "manual", "First", {
  id: "snapshot-first",
  createdAt: "2026-07-23T00:00:00.000Z"
});
let result = Snapshots.addSnapshot({}, first);
assert.equal(result.added, true);
assert.equal(result.collection.snapshots.length, 1);

const sameContent = Settings.normalizeStore(base);
sameContent.revision = 999;
sameContent.profiles[0].updatedAt = "2099-01-01T00:00:00.000Z";
result = Snapshots.addSnapshot(result.collection, Snapshots.makeSnapshot(sameContent, "manual", "Duplicate", {
  id: "snapshot-duplicate",
  createdAt: "2026-07-23T00:01:00.000Z"
}));
assert.equal(result.added, false, "revision/updatedAt-only changes must not create duplicate snapshots");
assert.equal(result.collection.snapshots.length, 1);

let collection = result.collection;
for (let index = 0; index < 25; index += 1) {
  const store = Settings.normalizeStore(base);
  store.profiles[0].name = `Profile ${index}`;
  const snapshot = Snapshots.makeSnapshot(store, "test", `Snapshot ${index}`, {
    id: `snapshot-${index}`,
    createdAt: new Date(Date.UTC(2026, 6, 23, 1, index)).toISOString()
  });
  collection = Snapshots.addSnapshot(collection, snapshot).collection;
}
assert.equal(collection.snapshots.length, 20);
assert.equal(collection.snapshots[0].label, "Snapshot 24");
assert.equal(collection.snapshots.at(-1).label, "Snapshot 5");

const removed = Snapshots.removeSnapshot(collection, collection.snapshots[0].id);
assert.equal(removed.snapshots.length, 19);
assert.equal(Snapshots.findSnapshot(removed, collection.snapshots[0].id), null);
const summary = Snapshots.summary(removed.snapshots[0]);
assert.equal(summary.profileCount, 1);
assert(!Object.hasOwn(summary, "store"));

const parts = manifest.version.split(".").map(Number);
assert(parts[0] > 0 || parts[1] >= 19, `Phase 19 requires version >= 0.19.0, got ${manifest.version}`);
assert(manifest.background.scripts.includes("shared/settings_snapshots.js"));
for (const message of ["CREATE_SETTINGS_SNAPSHOT", "RESTORE_SETTINGS_SNAPSHOT", "DELETE_SETTINGS_SNAPSHOT"]) {
  assert(protocolSource.includes(message));
}
assert(backgroundSource.includes("before_profile_save"));
assert(backgroundSource.includes("before_profile_delete"));
assert(backgroundSource.includes("before_settings_import"));
assert(backgroundSource.includes("before_snapshot_restore"));
assert(backgroundSource.includes("async function restoreSettingsSnapshot"));
assert(sidebarHtml.includes('id="settingsSnapshotSelect"'));
assert(sidebarHtml.includes('id="createSettingsSnapshotButton"'));
assert(sidebarHtml.includes('id="restoreSettingsSnapshotButton"'));
assert(sidebarHtml.includes('id="deleteSettingsSnapshotButton"'));
assert(sidebarSource.includes("renderSettingsSnapshots"));
assert(sidebarSource.includes("Current settings will be snapshotted first"));

console.log("PASS: Phase 19 bounded settings snapshots, automatic pre-change backups and sidebar restore/delete contract");
