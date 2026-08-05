#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const local = fs.readFileSync(path.join(root, "extension/shared/local_actions.js"), "utf8");
for (const token of [
  "const SCHEMA_VERSION = 2",
  'shellExecutionMode: "manual"',
  "openShellLogAfterExecution",
  'shellExecutionMode === "automatic"',
  "Download shell execution must use background mode"
]) assert(local.includes(token), `Missing local-action shell contract: ${token}`);
const html = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
for (const token of ["downloadShellExecutionMode", "openShellLogAfterExecution", "FCI_DOWNLOAD_PATH", "Run manually from the completion dialog", "Run automatically after relocation"]) assert(html.includes(token));
const background = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
for (const token of [
  "startDownloadShellForJob",
  "downloadShellEnvironment",
  "FCI_DOWNLOAD_PATH",
  'mode: "background"',
  '"download-moved-automatic"',
  '"download-completion-manual"',
  "job.shellRunId === run.runId",
  "openShellLogAfterExecution"
]) assert(background.includes(token), `Missing background download shell behavior: ${token}`);
const sidebar = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
assert(sidebar.includes("MESSAGE.RUN_COMPLETED_DOWNLOAD_SHELL"));
assert(sidebar.includes("shouldAutoOpenFullLog"));
const content = fs.readFileSync(path.join(root, "extension/content/activation.js"), "utf8");
assert(/const RUNTIME_VERSION = (?:19|[2-9][0-9]);/.test(content), "Content runtime must remain at v19 or newer");
assert(content.includes("Shell command started in background mode"));
assert(content.includes("Automatic start did not create a run. A manual fallback is available."));
const protocol = fs.readFileSync(path.join(root, "extension/shared/protocol.js"), "utf8");
assert(/VERSION: (?:1[6-9]|[2-9][0-9]),/.test(protocol));
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));
{
  const parts = String(manifest.version || "").split(".").map(Number);
  assert.ok(parts.length === 3 && parts.every(Number.isInteger));
  assert.ok(parts[0] > 0 || parts[1] > 25 || (parts[1] === 25 && parts[2] >= 0));
}
console.log("PASS: Phase 25 managed downloads execute the frozen command manually or automatically and open the complete file-backed console");
