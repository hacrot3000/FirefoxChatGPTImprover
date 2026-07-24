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
assert.equal(typeof api.downloadShellReadiness, "function");

function completedState(overrides = {}) {
  return {
    tabId: 17,
    captureId: "capture-17",
    status: "completed",
    destinationPath: "/tmp/output/archive.zip",
    shellExecutionMode: "manual",
    shellStatus: "idle",
    shellRunId: null,
    configSnapshot: {
      download: {
        enabled: true,
        destinationDirectory: "/tmp/output",
        shellExecutionMode: "manual",
        openShellLogAfterExecution: true
      },
      shell: {
        workingDirectory: "/tmp/project",
        command: "python3 process.py",
        mode: "background",
        confirmBeforeRun: true,
        presets: []
      }
    },
    ...overrides
  };
}

const ready = api.downloadShellReadiness(completedState());
assert.equal(ready.ready, true);
assert.equal(ready.mode, "manual");
assert.equal(ready.snapshot.shell.workingDirectory, "/tmp/project");
assert.equal(ready.snapshot.shell.command, "python3 process.py");

const missingCommand = completedState();
missingCommand.configSnapshot.shell.command = "  ";
assert.equal(api.downloadShellReadiness(missingCommand).ready, false);
assert.match(api.downloadShellReadiness(missingCommand).reason, /command/i);

const automatic = completedState({ shellExecutionMode: "automatic" });
automatic.configSnapshot.download.shellExecutionMode = "automatic";
const automaticFallback = api.downloadShellReadiness(automatic);
assert.equal(automaticFallback.ready, true);
assert.equal(automaticFallback.manualFallback, true);
assert.equal(automaticFallback.executionMode, "background");
assert.match(automaticFallback.reason, /manual/i);

assert.equal(api.downloadShellReadiness(completedState({ status: "moving" })).ready, false);
assert.equal(api.downloadShellReadiness(completedState({ shellRunId: "run-1", shellStatus: "exited" })).ready, false);

const runStart = sidebarSource.indexOf("async function runShellCommand()");
const runEnd = sidebarSource.indexOf("function stopShellCommand()", runStart);
assert.ok(runStart >= 0 && runEnd > runStart, "async manual shell function must exist");
const runBlock = sidebarSource.slice(runStart, runEnd);
const executeIndex = runBlock.indexOf("MESSAGE.RUN_SHELL");
if (sidebarSource.includes("Phase 28 v0.28.3")) {
  const volatileSyncIndex = runBlock.indexOf("syncVolatileLocalActionDraft");
  assert.ok(volatileSyncIndex >= 0 && executeIndex > volatileSyncIndex, "current volatile tab execution settings must be active before RUN_SHELL");
  assert.doesNotMatch(runBlock, /type: MESSAGE\.SAVE_TAB_LOCAL_ACTIONS/);
} else {
  const saveIndex = runBlock.indexOf("MESSAGE.SAVE_TAB_LOCAL_ACTIONS");
  assert.ok(saveIndex >= 0 && executeIndex > saveIndex, "tab execution settings must be persisted before RUN_SHELL");
  assert.match(runBlock, /buildTabExecutionConfig\(session, draftConfig\)/);
  assert.match(runBlock, /assertSavedLocalActionConfig\(executionConfig, savedConfig/);
}
assert.match(sidebarSource, /const shellAvailability = LocalActions\.downloadShellReadiness\(state\)/);
assert.match(sidebarSource, /executeShellAfterDownloadButton\.disabled = busy \|\| !shellAvailability\.ready/);
assert.match(sidebarSource, /const availability = LocalActions\.downloadShellReadiness\(state\)/);
{
  const parts = String(manifest.version || "").split(".").map(Number);
  assert.ok(parts.length === 3 && parts.every(Number.isInteger));
  assert.ok(parts[0] > 0 || parts[1] > 26 || (parts[1] === 26 && parts[2] >= 1));
}

console.log("PASS: Phase 26 v0.26.1 per-tab shell persistence and completed-download manual-execute readiness");
