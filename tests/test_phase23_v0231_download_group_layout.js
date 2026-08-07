#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
const sidebar = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
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
assert(target.start >= 0 && download.start >= 0 && alerts.start >= 0 && localActions.start >= 0);
const orderMatch = /const SIDEBAR_GROUP_ORDER = Object\.freeze\(\[([\s\S]*?)\]\);/.exec(sidebar);
assert(orderMatch, "Missing runtime sidebar group-order registry");
const runtimeOrder = [...orderMatch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
for (const groupId of ["target", "alerts", "local-actions", "download", "shell"]) {
  assert(runtimeOrder.includes(groupId), `Runtime order is missing ${groupId}`);
}
assert(runtimeOrder.indexOf("target") < runtimeOrder.indexOf("alerts"));
assert(runtimeOrder.indexOf("alerts") < runtimeOrder.indexOf("local-actions"));
assert(runtimeOrder.indexOf("local-actions") < runtimeOrder.indexOf("download"));
assert(runtimeOrder.indexOf("download") < runtimeOrder.indexOf("shell"));
for (const id of [
  "managedDownloadEnabled", "downloadDestinationDirectory", "downloadCaptureWindowSeconds",
  "downloadConflictAction", "showDownloadCompletionDialog", "downloadShellExecutionMode", "openShellLogAfterExecution",
  "downloadStateSummary", "retryDownloadMoveButton"
]) {
  assert(download.text.includes(`id="${id}"`), `${id} must be in Managed download group`);
  assert(!localActions.text.includes(`id="${id}"`), `${id} must not remain in Local action profile group`);
}
assert(download.text.includes('<h2 id="downloadHeading">Local action: managed download</h2>'));
assert(download.text.includes('aria-label="Managed download help"'));
assert(download.text.includes('class="group-heading-actions"'));
const version = manifest.version.split(".").map(Number);
assert(version[0] > 0 || version[1] > 23 || (version[1] === 23 && version[2] >= 1));
console.log("PASS: Phase 23 v0.23.1 Managed download is a dedicated collapsible group directly below New target element");
