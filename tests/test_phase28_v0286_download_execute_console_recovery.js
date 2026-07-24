"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const localActionsSource = fs.readFileSync(path.join(root, "extension/shared/local_actions.js"), "utf8");
const backgroundSource = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
const sidebarSource = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));

const context = { console, URL, Date, JSON, RegExp, Number, Object, Array, Set, String, Boolean, Uint32Array, crypto: require("node:crypto").webcrypto };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(localActionsSource, context, { filename: "local_actions.js" });
const LocalActions = context.FCI_LOCAL_ACTIONS;

function completedState(overrides = {}) {
  const config = LocalActions.createExecutionSnapshot(LocalActions.normalizeConfig({
    download: { enabled: true, shellExecutionMode: "manual" },
    shell: {
      workingDirectory: "/tmp",
      command: "printf 'hello\\n'",
      mode: "terminal",
      confirmBeforeRun: false
    }
  }));
  return {
    status: "completed",
    captureId: "capture-1",
    destinationPath: "/tmp/download.zip",
    configSnapshot: config,
    shellExecutionMode: "manual",
    shellStatus: "available",
    shellRunId: null,
    shellError: null,
    ...overrides
  };
}

const terminalManual = LocalActions.downloadShellReadiness(completedState());
assert.equal(terminalManual.ready, true, terminalManual.reason);
assert.equal(terminalManual.executionMode, "background");
assert.equal(terminalManual.manualFallback, false);
assert.equal(terminalManual.snapshot.shell.mode, "terminal", "immutable snapshot must remain unchanged");

const automaticFallback = LocalActions.downloadShellReadiness(completedState({
  shellExecutionMode: "automatic",
  shellStatus: "error",
  shellError: "Native Host launch failed before a run ID was created."
}));
assert.equal(automaticFallback.ready, true, automaticFallback.reason);
assert.equal(automaticFallback.manualFallback, true);
assert.match(automaticFallback.reason, /manual/i);

const duplicate = LocalActions.downloadShellReadiness(completedState({
  shellExecutionMode: "automatic",
  shellStatus: "error",
  shellRunId: "tab-1-existing",
  shellError: "Command exited with code 2."
}));
assert.equal(duplicate.ready, false);
assert.match(duplicate.reason, /already been started/i);

assert.match(backgroundSource, /config\.shell\.confirmBeforeRun && message\?\.payload\?\.confirmed/);
assert.doesNotMatch(backgroundSource, /job\.shellExecutionMode === "manual" && config\.shell\.confirmBeforeRun/);
assert.match(backgroundSource, /const shellRun = await runCompletedDownloadShell\(message, sender\);[\s\S]*return \{ ok: true, shellRun, dashboard: await dashboard\(\) \}/);
assert.match(backgroundSource, /mode:\s*"background"/);

for (const token of [
  "inlineShellOutputText",
  "inlineText",
  "Showing all output received by the add-on",
  "Stored log unavailable; showing all output received by the add-on",
  "run.logId || inlineShellOutputText(run)",
  "Native Host 0.10.0 or newer"
]) {
  assert(sidebarSource.includes(token), `sidebar missing ${token}`);
}
assert.match(sidebarSource, /copyTextValue\(shellLogState\.text \|\| shellLogState\.inlineText/);

const parts = manifest.version.split(".").map(Number);
assert.ok(parts[0] > 0 || parts[1] > 28 || (parts[1] === 28 && parts[2] >= 6));
console.log("PASS: Phase 28 v0.28.6 completed-download execute recovery and inline/full console fallback");
