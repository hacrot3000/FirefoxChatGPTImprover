#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const html = read("extension/sidebar/sidebar.html");
const sidebar = read("extension/sidebar/sidebar.js");
const manifest = JSON.parse(read("extension/manifest.json"));

assert.ok(
  manifest.version.localeCompare("0.41.16", undefined, { numeric: true }) >= 0,
  `Phase 75 requires add-on version >= 0.41.16, got ${manifest.version}`
);

assert(html.includes('data-sidebar-feature="setup-guide">Setup and installation</label>'));
assert(html.includes('data-sidebar-feature="native-host-restart-help">Native Host after restart guide</label>'));

const restartIndex = html.indexOf('data-group-id="native-host-restart"');
const messageIndex = html.indexOf('id="messageBox"');
assert(restartIndex >= 0 && restartIndex < messageIndex, "Restart guide must remain the final normal sidebar group.");

assert(sidebar.includes('"setup-guide": Object.freeze({ groups: Object.freeze(["installation-guide"]) })'));
assert(sidebar.includes('"native-host-restart-help": Object.freeze({ groups: Object.freeze(["native-host-restart"]) })'));
assert(sidebar.includes('"native-host-restart-help"\n    ]),'), "Standard layout must include restart help.");

assert(sidebar.includes("const SIDEBAR_UI_SCHEMA_VERSION = 2;"));
assert(sidebar.includes("schemaVersion: SIDEBAR_UI_SCHEMA_VERSION"));
assert(sidebar.includes("const migrateRestartHelpVisibility = storedUiSchemaVersion < SIDEBAR_UI_SCHEMA_VERSION;"));
assert(sidebar.includes('visibleSidebarFeatures.add("native-host-restart-help");'));
assert(sidebar.includes("if (migrateRestartHelpVisibility) {\n      await persistSidebarUi();"));
assert(sidebar.includes('sidebarFeaturePreset = "custom";'), "Feature toggles must persist as Custom layout choices.");

console.log("PASS: Phase 75 v0.41.16 independently toggleable restart guide with one-time existing-layout migration");
