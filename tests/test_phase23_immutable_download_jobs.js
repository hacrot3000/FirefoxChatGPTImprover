#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const root = path.resolve(__dirname, "..");
const context = vm.createContext({ console, URL, Date, JSON, RegExp, crypto: webcrypto });
context.globalThis = context;
for (const file of ["extension/shared/settings.js", "extension/shared/local_actions.js", "extension/shared/protocol.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });
}
const Local = context.FCI_LOCAL_ACTIONS;
const Protocol = context.FCI_PROTOCOL;
assert(Protocol.VERSION >= 14);
assert.equal(Protocol.MESSAGE.RETRY_DOWNLOAD_MOVE, "FCI_RETRY_DOWNLOAD_MOVE");
const original = Local.normalizeConfig({
  download: { enabled: true, destinationDirectory: "/tmp/original", conflictAction: "fail", executeShellAfterMove: true },
  shell: { workingDirectory: "/tmp/work", command: "echo original", mode: "background", confirmBeforeRun: false,
    requirePresetMatch: true, presets: [{ id: "p1", name: "Allowed", enabled: true, workingDirectory: "/tmp/work", command: "echo original", mode: "background", confirmBeforeRun: false }] }
});
const snapshot = Local.createExecutionSnapshot(original);
original.download.destinationDirectory = "/tmp/changed";
original.shell.command = "echo changed";
assert.equal(snapshot.download.destinationDirectory, "/tmp/original");
assert.equal(snapshot.shell.command, "echo original");
assert.equal(Local.normalizeExecutionSnapshot(snapshot).shell.presets[0].command, "echo original");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));
const version = manifest.version.split(".").map(Number);
assert(version[0] > 0 || version[1] > 23 || (version[1] === 23 && version[2] >= 0));
const background = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
for (const token of [
  "configSnapshot", "jobExecutionConfig", "recoverDownloadJob", "retryDownloadMove",
  "captures.length === 1 ? captures[0] : null",
  "const sameCapture = Boolean(inMemoryJob?.captureId && inMemoryJob.captureId === storedJob.captureId)",
  "const activeInMemory = Boolean(sameCapture && [\"downloading\", \"moving\", \"completed\"].includes(inMemoryJob.status))",
  "if (session.sessionToken) job.sessionToken = session.sessionToken",
  "Number(job.tabId) !== Number(session.tabId)",
  "Recovered an interrupted relocation without replaying it automatically"
]) assert(background.includes(token), `Missing background contract: ${token}`);
assert(background.includes("destinationDirectory: config.download.destinationDirectory"));
assert(background.includes("conflictAction: config.download.conflictAction"));
const html = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
assert(html.includes('id="retryDownloadMoveButton"'));
const sidebar = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
assert(sidebar.includes("MESSAGE.RETRY_DOWNLOAD_MOVE"));
assert(sidebar.includes("!state.retryable"));
assert(!background.includes("job.sessionToken === session.sessionToken"), "Legacy strict session-token gate must not return; same-tab jobs survive navigation token rollover");
console.log("PASS: Phase 23 immutable per-download local-action snapshots, capture-bound same-tab attribution, session-token rollover recovery and explicit relocation retry contracts");
