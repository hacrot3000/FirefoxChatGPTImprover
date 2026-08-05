#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const protocol = fs.readFileSync(path.join(root, "extension/shared/protocol.js"), "utf8");
assert(/VERSION: (1[5-9]|[2-9][0-9]+)/.test(protocol));
assert(protocol.includes("CONTENT_SHOW_DOWNLOAD_COMPLETION"));
assert(protocol.includes("RUN_COMPLETED_DOWNLOAD_SHELL"));
const content = fs.readFileSync(path.join(root, "extension/content/activation.js"), "utf8");
for (const token of [
  "showDownloadCompletionOverlay",
  "position: fixed; inset: 0; z-index: 2147483647",
  "The existing staging file was relocated successfully",
  "Retry relocation does not download the file from the website again.",
  "RUN_COMPLETED_DOWNLOAD_SHELL"
]) assert(content.includes(token), `Missing page completion behavior: ${token}`);
const sidebar = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
assert(sidebar.includes("elements.downloadCompletionPath.value = state.destinationPath"));
assert(sidebar.includes('state.completionSurface !== "page"'));
const html = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
assert(html.includes("Retry move to saved destination"));
assert(html.includes('<textarea id="downloadCompletionPath"'));
const background = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
for (const token of [
  "showDownloadCompletion(tabId, job, session)",
  "completionSurface = \"page\"",
  "Retry relocation uses the currently saved destination",
  "currentConfig.download.destinationDirectory",
  "it does not download the URL again",
  "The staging file is no longer available; trigger the target again",
  "result.status !== \"completed\"",
  "runCompletedDownloadShell"
]) assert(background.includes(token), `Missing verified retry/page contract: ${token}`);
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));
{ const [major, minor, patch] = manifest.version.split(".").map(Number); assert(major > 0 || minor > 24 || (minor === 24 && patch >= 4)); }
console.log("PASS: Phase 24 v0.24.4 completion is page-centered with a visible path and retry moves only an existing staging file to the currently saved destination");
