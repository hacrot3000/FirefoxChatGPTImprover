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
const manifest = JSON.parse(read("extension/manifest.json"));

assert.ok(manifest.version.localeCompare("0.41.8", undefined, { numeric: true }) >= 0);

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert(start >= 0, `Missing ${signature}`);
  const next = source.indexOf("\n  function ", start + signature.length);
  return source.slice(start, next >= 0 ? next : source.length);
}

// Terminal routes must not retain browser download IDs or Native Host move IDs.
const routingFunction = extractFunction(background, "function clearDownloadRoutingKeys");
const routingSandbox = { Map, Set, globalThis: null };
routingSandbox.globalThis = routingSandbox;
vm.createContext(routingSandbox);
vm.runInContext(`const downloadMoveToTab = new Map([[17, 4], [\"move-4\", 4], [99, 8]]);\nconst managedDownloadIds = new Set([17, 99]);\n${routingFunction}\nclearDownloadRoutingKeys({ downloadId: 17, moveId: \"move-4\" });\nthis.keys = [...downloadMoveToTab.keys()];\nthis.managedIds = [...managedDownloadIds.values()];`, routingSandbox);
assert.deepEqual(Array.from(routingSandbox.keys), [99]);
assert.deepEqual(Array.from(routingSandbox.managedIds), [99]);
assert.match(background, /clearDownloadRoutingKeys\(job, moveId\);[\s\S]*browser\.downloads\.erase/);
assert.match(background, /if \(delta\.error\?\.current\)[\s\S]*clearDownloadRoutingKeys\(job, delta\.id\);/);

// Completion UI must be emitted once after shell state settles, not replaced twice.
assert.equal((background.match(/await showDownloadCompletion\(tabId, job, session\);/g) || []).length, 1);
const movedStart = background.indexOf('if (message.event === "download_moved")');
const movedEnd = background.indexOf('\n    Object.assign(job, {\n      status: "error"', movedStart);
const movedBranch = background.slice(movedStart, movedEnd);
assert(movedBranch.indexOf('if (job.shellExecutionMode === "automatic")') < movedBranch.indexOf('await showDownloadCompletion(tabId, job, session);'));

// Recovery must drop any stale armed capture before validating persisted state.
const restore = extractFunction(background, "function restoreArmedDownloadCapture");
const clearPos = restore.indexOf("clearDownloadCaptureExpiryTimer(tabId);");
const deletePos = restore.indexOf("downloadCaptures.delete(tabId);");
const expiryPos = restore.indexOf("const expiresAtMs");
assert(clearPos >= 0 && deletePos > clearPos && expiryPos > deletePos);

// Audit cleanup: no redundant same-node append and no unreachable duplicate return.
assert.equal((sidebar.match(/elements\.ruleStatisticsRows\.append\(row\);/g) || []).length, 1);
assert(!sidebar.includes("return shellLogState;\n      return shellLogState;"));

console.log("PASS: Phase 67 v0.41.8 closes managed-download terminal lifecycle races/leaks without starting a new feature group");
