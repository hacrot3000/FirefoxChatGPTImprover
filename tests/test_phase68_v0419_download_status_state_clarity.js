#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const background = read("extension/background/background.js");
const sidebar = read("extension/sidebar/sidebar.js");
const css = read("extension/sidebar/sidebar.css");
const manifest = JSON.parse(read("extension/manifest.json"));

assert.ok(manifest.version.localeCompare("0.41.9", undefined, { numeric: true }) >= 0);

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert(start >= 0, `Missing ${signature}`);
  const next = source.indexOf("\n  function ", start + signature.length);
  return source.slice(start, next >= 0 ? next : source.length);
}

const sandbox = { globalThis: null };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(`${extractFunction(sidebar, "function downloadHeaderNotice")}\nthis.notice = downloadHeaderNotice;`, sandbox);

assert.deepEqual(
  ["armed", "downloading", "moving", "completed", "expired", "error"].map((status) => sandbox.notice({ status }).visible),
  [true, true, true, true, true, true]
);
assert.equal(sandbox.notice({ status: "armed" }).icon, "CK");
assert.equal(sandbox.notice({ status: "armed" }).state, "checking");
assert.match(sandbox.notice({ status: "armed" }).label, /checking/i);
assert.equal(sandbox.notice({ status: "downloading" }).icon, "DL");
assert.equal(sandbox.notice({ status: "downloading" }).state, "downloading");
assert.equal(sandbox.notice({ status: "moving" }).icon, "MV");
assert.equal(sandbox.notice({ status: "moving" }).state, "moving");
assert.equal(sandbox.notice({ status: "completed" }).icon, "✓");
assert.equal(sandbox.notice({ status: "completed" }).state, "completed");
assert.equal(sandbox.notice({ status: "expired" }).icon, "NO");
assert.equal(sandbox.notice({ status: "expired" }).state, "expired");
assert.equal(sandbox.notice({ status: "error", error: "move failed" }).icon, "×");
assert.equal(sandbox.notice({ status: "error", error: "move failed" }).state, "error");
assert.equal(sandbox.notice({ status: "error", error: "move failed" }).label, "move failed");

// Download badges are deliberately stable. Only the separate command-running
// indicator keeps the old pulse animation.
assert(css.includes('.command-status-icon[data-state="running"]'));
assert(!css.includes('.download-status-icon[data-state="running"]'));
assert(css.includes('.download-status-icon[data-state="checking"]'));
assert(css.includes('.download-status-icon[data-state="downloading"]'));
assert(css.includes('.download-status-icon[data-state="moving"]'));
assert(css.includes('.download-status-icon[data-state="expired"]'));
const headerCss = css.slice(0, css.indexOf("h1 {"));
assert(!/download-status-icon[^\n]*animation/.test(headerCss));

// Lifecycle leak hardening stays in the same managed-download feature.
const clearRouting = extractFunction(background, "function clearDownloadRoutingKeys");
assert(clearRouting.includes("managedDownloadIds.delete(extraKey)"));
assert(clearRouting.includes("managedDownloadIds.delete(job.downloadId)"));
assert.match(background, /if \(!Number\.isInteger\(tabId\)\) \{[\s\S]*managedDownloadIds\.delete\(delta\.id\);/);
assert.match(background, /job\.status === "downloading" && !Number\.isInteger\(job\.downloadId\)/);
assert.match(background, /Firefox no longer has the active browser download/);
assert.match(background, /native-shell-start-error/);
assert.match(background, /job\.shellStatus = "error";[\s\S]*download-shell-error/);

console.log("PASS: Phase 68 v0.41.9 makes ready/check/download/move/completed/no-download/error states visually distinct and closes related lifecycle leaks");
