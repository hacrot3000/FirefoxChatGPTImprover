#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const root = path.resolve(__dirname, "..");
const sidebar = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
const html = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
const css = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.css"), "utf8");
const background = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
const activation = fs.readFileSync(path.join(root, "extension/content/activation.js"), "utf8");
const alertSource = fs.readFileSync(path.join(root, "extension/content/alert.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));

assert.ok(manifest.version.localeCompare("0.28.15", undefined, { numeric: true }) >= 0);

// Preset editing must keep the selected preset and protect unsaved edits.
assert.doesNotMatch(sidebar, /Direct command for this tab/);
assert.doesNotMatch(sidebar, /function useDirectTabCommand/);
assert.match(sidebar, /let selectedShellPresetDirty = false/);
assert.match(sidebar, /function shellPresetEditorMatches/);
assert.match(sidebar, /function refreshSelectedPresetDirtyState/);
assert.match(sidebar, /if \(selectedShellPresetId && selectedShellPreset\(\)\)/);
assert.match(sidebar, /Save changes to preset/);
assert.match(sidebar, /updateShellPreset\(\{ quiet: true \}\)/);
assert.match(sidebar, /The edited values are still in the form/);
assert.match(sidebar, /elements\.updateShellPresetButton\.textContent = preset && selectedShellPresetDirty \? "Save changes" : "Save preset"/);

// Save configuration must behave as an ordinary group, not a floating footer.
assert.match(html, /<section class="card" data-group-id="save"/);
assert.doesNotMatch(html, /sticky-actions[^>]*data-group-id="save"/);
assert.doesNotMatch(css, /\.sticky-actions\s*\{[^}]*position:\s*sticky/);

// Command notice is icon-only and independent from the AI/mode status pill.
assert.match(html, /id="commandStatusIcon"/);
assert.match(sidebar, /const commandIcon = shellNotice\.status === "running" \? "⌘" : \(shellNotice\.status === "unread" \? "✓" : ""\)/);
assert.match(sidebar, /elements\.statusPill\.textContent = mode === MODE\.ACTIVE && runtime\.monitorState === "matched"[\s\S]*\? "RD"/);
assert.doesNotMatch(sidebar, /statusPill\.textContent[\s\S]{0,240}Command running/);
assert.match(background, /applyBadge\(session\.tabId, "⌘"/);
assert.match(background, /applyBadge\(session\.tabId, "✓"/);
assert.match(activation, /const RUNTIME_VERSION = (?:2[2-9]|[3-9][0-9])/);

// Reading data alone must not acknowledge it; successful display on the active tab does.
const readStart = background.indexOf("async function readShellLog");
const ackStart = background.indexOf("async function acknowledgeShellLog");
assert(readStart >= 0 && ackStart > readStart);
const readBody = background.slice(readStart, ackStart);
assert.doesNotMatch(readBody, /acknowledgeShellNotice/);
assert.match(background, /requireActiveTab = false/);
assert.match(background, /Number\(active\?\.id\) === Number\(session\.tabId\)/);
assert.match(background, /status: activeTabMatches \? "idle" : "viewed"/);
assert.match(background, /viewedAt: Settings\.nowIso\(\)/);
assert.match(sidebar, /requireActiveTab: true/);

const context = vm.createContext({ console, crypto: webcrypto, URL, setTimeout, clearTimeout, setInterval, clearInterval });
context.globalThis = context;
for (const relative of ["extension/shared/protocol.js", "extension/shared/settings.js", "extension/content/alert.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, relative), "utf8"), context, { filename: relative });
}
const Alert = context.FCI_ALERT_ENGINE;
assert(Alert.VERSION >= 8);
assert.equal(Alert.commandTitlePrefix({ shellCommandState: "running" }), "⌘");
assert.equal(Alert.commandTitlePrefix({ shellCommandState: "unread" }), "✓");
assert.equal(Alert.commandTitlePrefix({ shellCommandState: "idle" }), "");
assert.equal(Alert.stripManagedTitleDecorations("[⌘] Project", []), "Project");
assert.equal(Alert.stripManagedTitleDecorations("[✓] Project", []), "Project");

console.log("PASS: Phase 28 v0.28.15 editable presets, normal Save group and active-tab icon-only command notices");
