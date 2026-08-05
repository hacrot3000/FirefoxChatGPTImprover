#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const background = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));
for (const token of [
  "managedDownloadRequest",
  "cancelAndRestartCapturedDownload",
  "browser.downloads.cancel(item.id)",
  "browser.downloads.erase({ id: item.id })",
  "saveAs: false",
  "item?.byExtensionId === browser.runtime.id",
  "download-fallback-restart",
  "managed no-dialog restart failed"
]) assert(background.includes(token), `Missing no-dialog fallback contract: ${token}`);
const createdStart = background.indexOf("async function onBrowserDownloadCreated");
const createdEnd = background.indexOf("async function onBrowserDownloadChanged", createdStart);
const created = background.slice(createdStart, createdEnd);
assert(created.includes("cancelAndRestartCapturedDownload(capture, item)"));
assert(!created.includes('claimDownload(capture, item, "browser-download-fallback")'));
const version = manifest.version.split(".").map(Number);
assert(version[0] > 0 || version[1] > 24 || (version[1] === 24 && version[2] >= 1));
console.log("PASS: Phase 24 v0.24.1 page-created downloads are canceled and restarted through downloads.download(saveAs:false)");
