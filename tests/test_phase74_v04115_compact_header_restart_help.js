#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const html = read("extension/sidebar/sidebar.html");
const sidebar = read("extension/sidebar/sidebar.js");
const css = read("extension/sidebar/sidebar.css");
const manifest = JSON.parse(read("extension/manifest.json"));

assert.ok(
  manifest.version.localeCompare("0.41.15", undefined, { numeric: true }) >= 0,
  `Phase 74 requires add-on version >= 0.41.15, got ${manifest.version}`
);

const restartMarker = 'data-group-id="native-host-restart"';
const restartIndex = html.indexOf(restartMarker);
const messageIndex = html.indexOf('id="messageBox"');
assert(restartIndex >= 0, "Native Host restart help must be a sidebar group.");
assert(messageIndex > restartIndex, "Native Host restart help must stay at the bottom of normal sidebar cards.");
assert(!html.includes('<aside class="card native-host-restart-note"'), "Restart help must use the standard collapsible section contract.");
assert(html.includes(">Native Host after restart</h2>"));
assert(html.includes('data-sidebar-feature="setup-guide">Setup and installation</label>'));
assert(html.includes('data-sidebar-feature="native-host-restart-help">Native Host after restart guide</label>'));

assert(sidebar.includes('"native-host-restart": true'), "Restart help must default to collapsed.");
assert(
  sidebar.includes('"save", "installation-guide", "native-host-restart"'),
  "Restart help must be the final ordered sidebar group."
);
assert(
  sidebar.includes('"native-host-restart-help": Object.freeze({ groups: Object.freeze(["native-host-restart"]) })'),
  "Restart help must have an independent visibility feature."
);

assert(
  css.includes("min-height: 24px; padding: 2px 8px"),
  "Internal app header must use the compact 24px/2px layout."
);
assert(
  css.includes("main { display: grid; gap: 8px; padding: 6px 8px 8px; }"),
  "Main content must reduce the blank space directly below the header."
);
assert(css.includes(".dialog-title-row > .icon-button"));
assert(css.includes(".working-session-header > .icon-button"));
assert(
  css.includes("width: 20px;\n  min-width: 20px;\n  height: 20px;\n  min-height: 20px;"),
  "Add-on-rendered close buttons must remain compact."
);

console.log("PASS: Phase 74 v0.41.15 compact sidebar header and collapsible/hideable bottom restart help");
