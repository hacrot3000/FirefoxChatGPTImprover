"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const localActionsSource = fs.readFileSync(path.join(root, "extension/shared/local_actions.js"), "utf8");
const sidebarSource = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));

const context = {
  console,
  Date,
  JSON,
  Number,
  Object,
  Array,
  Set,
  RegExp,
  String,
  Boolean,
  URL,
  crypto: {
    getRandomValues(array) {
      for (let index = 0; index < array.length; index += 1) array[index] = index + 1;
      return array;
    }
  }
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(localActionsSource, context, { filename: "local_actions.js" });

const api = context.FCI_LOCAL_ACTIONS;
assert.equal(typeof api.downloadShellOutcome, "function");

function state(overrides = {}) {
  return {
    tabId: 17,
    captureId: "capture-17",
    status: "completed",
    destinationPath: "/tmp/output/archive.zip",
    shellExecutionMode: "manual",
    shellStatus: "idle",
    shellRunId: null,
    shellReturnCode: null,
    shellError: null,
    configSnapshot: {
      download: {
        enabled: true,
        destinationDirectory: "/tmp/output",
        shellExecutionMode: "manual",
        openShellLogAfterExecution: true
      },
      shell: {
        workingDirectory: "/tmp/project",
        command: "./tools/process.sh",
        mode: "background",
        confirmBeforeRun: true,
        presets: []
      }
    },
    ...overrides
  };
}

const ready = api.downloadShellOutcome(state());
assert.equal(ready.phase, "ready");
assert.equal(ready.severity, "ok");
assert.match(ready.message, /frozen command ready/i);
assert.match(ready.details, /Working directory: \/tmp\/project/);
assert.match(ready.details, /Command: \.\/tools\/process\.sh/);
assert.match(ready.details, /Downloaded file: \/tmp\/output\/archive\.zip/);

const running = api.downloadShellOutcome(state({ shellStatus: "running", shellRunId: "run-17" }));
assert.equal(running.phase, "running");
assert.equal(running.launched, true);
assert.match(running.message, /launched/i);

const succeeded = api.downloadShellOutcome(state({ shellStatus: "exited", shellRunId: "run-17", shellReturnCode: 0 }));
assert.equal(succeeded.phase, "succeeded");
assert.equal(succeeded.severity, "ok");
assert.match(succeeded.message, /rc=0/);

const failed = api.downloadShellOutcome(state({ shellStatus: "exited", shellRunId: "run-17", shellReturnCode: 2 }));
assert.equal(failed.phase, "failed");
assert.equal(failed.severity, "error");
assert.equal(failed.launched, true);
assert.match(failed.message, /add-on launched/i);
assert.match(failed.message, /rc=2/);
assert.match(failed.details, /Return code: 2/);

const fallback = api.downloadShellOutcome(state({ shellStatus: "error", shellError: "Native Host rejected the request." }));
assert.equal(fallback.phase, "ready");
assert.equal(fallback.severity, "warning");
assert.equal(fallback.launched, false);
assert.match(fallback.message, /manual execution is available/i);

const unavailable = api.downloadShellOutcome(state({ status: "moving" }));
assert.equal(unavailable.phase, "unavailable");
assert.equal(unavailable.severity, "idle");

assert.match(sidebarSource, /const shellOutcome = LocalActions\.downloadShellOutcome\(state\)/);
assert.match(sidebarSource, /downloadShellStateSummary\.dataset\.state = shellOutcome\.severity/);
assert.match(sidebarSource, /downloadShellStateSummary\.dataset\.outcome = shellOutcome\.phase/);
assert.match(sidebarSource, /downloadShellStateSummary\.title = shellOutcome\.details/);
{
  const parts = String(manifest.version || "").split(".").map(Number);
  assert.ok(parts.length === 3 && parts.every(Number.isInteger));
  assert.ok(parts[0] > 0 || parts[1] > 27 || (parts[1] === 27 && parts[2] >= 0));
}

console.log("PASS: Phase 27 post-download shell outcome audit and non-zero exit provenance");
