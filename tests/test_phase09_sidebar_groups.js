#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
const js = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
const css = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.css"), "utf8");
const expectedGroups = ["tabs", "profiles", "activation", "rules", "monitor", "target", "alerts", "activity", "shell", "save"];
for (const group of expectedGroups) {
  assert(html.includes(`data-group-id="${group}"`), `missing collapsible group ${group}`);
}
assert.equal((html.match(/data-group-id=/g) || []).length, expectedGroups.length);
assert(js.includes("firefoxChatImprover.sidebarUi.v1"));
assert(js.includes("browser.storage.local.get"));
assert(js.includes("browser.storage.local.set"));
assert(js.includes("initializeCollapsibleGroups"));
assert(css.includes('.card[data-collapsed="true"] > :not(.group-heading):not(.help-menu)'));
assert(html.includes('id="dismissOnUserActivity"'));
assert(html.includes('id="activeTabTimeoutSeconds"'));
console.log("PASS: Phase 09 independently collapsible sidebar groups and alert acknowledgement controls");
