#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");

const targetSource = fs.readFileSync(path.join(root, "extension/content/target.js"), "utf8");
const context = vm.createContext({
  console,
  setTimeout,
  clearTimeout,
  globalThis: null,
  FCI_SETTINGS: { defaultConfig: () => ({ target: {} }), normalizeConfig: (value) => value },
  FCI_MONITOR_ENGINE: {},
  FCI_PROTOCOL: {
    MONITOR_STATE: { MATCHED: "matched" },
    TARGET_STATE: { DISABLED: "disabled", WAITING: "waiting", ARMED: "armed", ACTED: "acted", PAUSED: "paused", ERROR: "error" }
  }
});
context.globalThis = context;
vm.runInContext(targetSource, context, { filename: "target.js" });
const target = context.FCI_TARGET_ENGINE;
assert.equal(target.effectiveDryRunForCapture(true, { armed: true }), false, "armed managed download must force a real target click");
assert.equal(target.effectiveDryRunForCapture(true, { armed: false, reason: "disabled" }), true, "ordinary dry-run must remain safe when capture is disabled");
assert.equal(target.effectiveDryRunForCapture(false, { armed: false }), false, "explicit real-click mode must remain a real click");
for (const token of [
  "requestedDryRun: Boolean(config.target.dryRun)",
  "captureResult = await onBeforeClick",
  "recordAction(effectiveDryRun)",
  "element.click()",
  "captureArmed: Boolean(captureResult?.armed)",
  "action.dryRun ? `dry-run:"
]) assert(targetSource.includes(token), `Missing capture-aware target contract: ${token}`);

const alertSource = fs.readFileSync(path.join(root, "extension/content/alert.js"), "utf8");
assert(alertSource.includes("setTimeout: (callback, delay) => setTimeout(callback, delay)"));
assert(alertSource.includes("setInterval: (callback, delay) => setInterval(callback, delay)"));
assert(!alertSource.includes("Reflect.apply(setTimeoutFunction, schedulerSource"));

const activation = fs.readFileSync(path.join(root, "extension/content/activation.js"), "utf8");
const runtimeMatch = activation.match(/const RUNTIME_VERSION = (\d+);/);
assert(runtimeMatch && Number(runtimeMatch[1]) >= 16);
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));
const version = manifest.version.split(".").map(Number);
assert(version[0] > 0 || version[1] > 24 || (version[1] === 24 && version[2] >= 2));
console.log("PASS: Phase 24 v0.24.2 managed capture overrides target dry-run for the armed action and browser timers use lexical Window binding");
