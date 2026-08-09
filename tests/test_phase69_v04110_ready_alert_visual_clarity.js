#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const manifest = JSON.parse(read("extension/manifest.json"));
const settingsSource = read("extension/shared/settings.js");
const alertSource = read("extension/content/alert.js");
const background = read("extension/background/background.js");
const sidebarCss = read("extension/sidebar/sidebar.css");
const sidebarHtml = read("extension/sidebar/sidebar.html");
const configTemplate = JSON.parse(read("config_template/ChatGPT.json"));

assert.ok(manifest.version.localeCompare("0.41.10", undefined, { numeric: true }) >= 0);
const alertGuardVersion = Number(alertSource.match(/FCI_ALERT_ENGINE\?\.VERSION >= (\d+)/)?.[1] || 0);
const alertExportVersion = Number(alertSource.match(/VERSION:\s*(\d+)/)?.[1] || 0);
assert(alertGuardVersion >= 14);
assert.equal(alertGuardVersion, alertExportVersion);
assert.match(settingsSource, /const SCHEMA_VERSION = 18;/, "settings storage schema must not be bumped for a presentation-only hotfix");
assert(sidebarHtml.includes('placeholder="RD"'));
assert(!sidebarHtml.includes('placeholder="⚠ RD"'));

const configRule = configTemplate?.profiles?.[0]?.config?.rules?.[0];
const templateAlerts = configTemplate?.profiles?.[0]?.config?.alerts || configRule?.alerts || {};
assert.equal(templateAlerts.titlePrefix, "RD");

function createDocument(title = "Project") {
  return {
    title,
    visibilityState: "visible",
    documentElement: {
      attrs: new Map(),
      getAttribute(name) { return this.attrs.get(name) || ""; },
      setAttribute(name, value) { this.attrs.set(name, String(value)); }
    },
    querySelector() { return null; },
    head: null,
    addEventListener() {},
    removeEventListener() {}
  };
}

const document = createDocument();
const intervals = [];
const sandbox = {
  console,
  crypto: webcrypto,
  URL,
  document,
  MutationObserver: class { observe() {} disconnect() {} },
  setTimeout() { return 1; },
  clearTimeout() {},
  setInterval(callback) { intervals.push(callback); return intervals.length; },
  clearInterval() {}
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(read("extension/shared/protocol.js"), sandbox, { filename: "protocol.js" });
vm.runInContext(settingsSource, sandbox, { filename: "settings.js" });
vm.runInContext(alertSource, sandbox, { filename: "alert.js" });

const Settings = sandbox.FCI_SETTINGS;
const Alert = sandbox.FCI_ALERT_ENGINE;
assert.equal(Settings.SCHEMA_VERSION, 18);
assert.equal(Settings.defaultConfig().alerts.titlePrefix, "RD");
assert.equal(Settings.normalizeConfig({ alerts: { titlePrefix: "⚠ AI READY" } }).alerts.titlePrefix, "RD");
assert.equal(Settings.normalizeConfig({ alerts: { titlePrefix: "⚠ RD" } }).alerts.titlePrefix, "RD");
assert.equal(Settings.normalizeConfig({ alerts: { titlePrefix: "⚠ CUSTOM" } }).alerts.titlePrefix, "⚠ CUSTOM");
assert.equal(Alert.compactReadyPrefix("⚠ AI READY"), "RD");
assert.equal(Alert.compactReadyPrefix("⚠ RD"), "RD");
assert.equal(Alert.compactReadyPrefix("READY"), "RD");
assert.equal(Alert.compactReadyPrefix("⚠ CUSTOM"), "⚠ CUSTOM");
assert.equal(Alert.hasDistinctTitleBlinkFrame("RD"), false);
assert.equal(Alert.hasDistinctTitleBlinkFrame("⚠ AI READY"), false);
assert.equal(Alert.hasDistinctTitleBlinkFrame("⚠ CUSTOM"), true);

const controller = Alert.createAlertController();
controller.apply({
  alerts: {
    titleBlink: true,
    titlePrefix: "⚠ AI READY",
    blinkIntervalMs: 500,
    badge: true,
    sidebar: true,
    notification: false,
    sound: { enabled: false },
    dismissOnUserActivity: false,
    activeTabTimeoutSeconds: 0
  }
}, {
  monitorState: "matched",
  cycle: 1,
  alertCycle: 1,
  alertActive: true,
  shellCommandState: "idle"
}, "active", "phase69-ready");
assert.equal(document.title, "[RD] Project");
assert.equal(controller.snapshot().titleBlinking, false);
assert.equal(intervals.length, 0, "legacy READY defaults must not create a warning-glyph blink interval");

assert.match(background, /session\.mode === MODE\.ERROR[\s\S]*applyBadge\(session\.tabId, "!", "#cf222e"\)/);
assert.match(background, /session\.runtime\?\.alertActive && config\.alerts\.badge[\s\S]*applyBadge\(session\.tabId, "RD", "#238636"\)/);

const alertCssStart = sidebarCss.indexOf('body[data-alert="active"] .app-header');
const alertCssEnd = sidebarCss.indexOf('.target-test-actions', alertCssStart);
const alertCss = sidebarCss.slice(alertCssStart, alertCssEnd);
assert(alertCssStart >= 0 && alertCssEnd > alertCssStart);
assert(alertCss.includes("var(--active)"));
assert(!alertCss.includes("var(--error)"));
assert(!/animation\s*:/.test(alertCss));

console.log("PASS: Phase 69 v0.41.10 removes warning/exclamation semantics from normal RD while preserving ! for real errors");
