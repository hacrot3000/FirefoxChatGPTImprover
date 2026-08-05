#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));
function section(groupId) {
  const token = `<section class="card" data-group-id="${groupId}"`;
  const start = html.indexOf(token);
  assert(start >= 0, `missing ${groupId} group`);
  const end = html.indexOf("</section>", start);
  assert(end > start, `unterminated ${groupId} group`);
  return { start, text: html.slice(start, end + 10) };
}
const target = section("target");
const download = section("download");
const alerts = section("alerts");
const localActions = section("local-actions");
assert(target.start < download.start && download.start < alerts.start, "Managed download must be directly below New target element");
const between = html.slice(target.start + target.text.length, alerts.start);
assert.equal((between.match(/data-group-id=/g) || []).length, 1, "no other group may appear between target and alerts");
for (const id of [
  "managedDownloadEnabled", "downloadDestinationDirectory", "downloadCaptureWindowSeconds",
  "downloadConflictAction", "showDownloadCompletionDialog", "downloadShellExecutionMode", "openShellLogAfterExecution",
  "downloadStateSummary", "retryDownloadMoveButton"
]) {
  assert(download.text.includes(`id="${id}"`), `${id} must be in Managed download group`);
  assert(!localActions.text.includes(`id="${id}"`), `${id} must not remain in Local action profile group`);
}
assert(download.text.includes('aria-label="Managed download help"'));
assert(download.text.includes('class="group-heading-actions"'));
const version = manifest.version.split(".").map(Number);
assert(version[0] > 0 || version[1] > 23 || (version[1] === 23 && version[2] >= 1));
console.log("PASS: Phase 23 v0.23.1 Managed download is a dedicated collapsible group directly below New target element");
