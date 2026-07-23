#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
const css = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.css"), "utf8");
const sidebar = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
const alert = fs.readFileSync(path.join(root, "extension/content/alert.js"), "utf8");
const activation = fs.readFileSync(path.join(root, "extension/content/activation.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));

for (const id of ["tabPrimaryQuickButton", "tabStopQuickButton", "refreshButton", "targetClickQuickButton"]) {
  assert(html.includes(`id="${id}"`), `missing compact heading control ${id}`);
}
assert(html.includes('aria-label="Refresh status"'));
assert(html.includes('aria-label="Simulate a user click on the current target"'));
assert(css.includes('.card[data-collapsed="true"] .collapsed-only'));
assert(css.includes('.group-heading-actions'));
assert(sidebar.includes('function runPrimaryTabAction()'));
assert(sidebar.includes('elements.tabPrimaryQuickButton.textContent = quickAction.icon'));
assert(sidebar.includes('elements.targetClickQuickButton.addEventListener("click", () => testTargetAction(true))'));
assert(/VERSION:\s*[5-9]/.test(alert));
assert(alert.includes('monitorSpinTimer = scheduler.setInterval'));
assert(alert.includes('shouldSpinMonitorTitle(runtime, mode)'));
assert(/const RUNTIME_VERSION = (1[1-9]|[2-9][0-9]);/.test(activation));
assert.match(manifest.version, /^0\.(?:1[4-9]|[2-9][0-9])\.[0-9]+$/);

console.log("PASS: Phase 14 v0.14.1 compact collapsed controls and monitor title spinner");
