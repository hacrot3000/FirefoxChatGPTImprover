#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const background = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
for (const token of [
  "requestIdOverride = null",
  "message?.requestId || message?.moveId",
  "pendingNativeRequests.set(requestId, { resolve, reject, timer, action })",
  "}, 20000, moveId)",
  "await handleNativeDownloadMessage(response)",
  "Reinstall the Native Host from this add-on version, then retry relocation.",
  "Native Host request timed out after ${timeoutMs}ms"
]) assert(background.includes(token), `Missing correlated relocation contract: ${token}`);
const requestPos = background.indexOf('appendLog(session, "debug", "download-move-request"');
const awaitPos = background.indexOf('await nativeRequest("move_download"');
assert(requestPos >= 0 && awaitPos > requestPos, "moving state/log must be persisted before awaiting Native Host");
const native = fs.readFileSync(path.join(root, "native-host/native_host.py"), "utf8");
assert(/HOST_VERSION = "0\.(?:9\.[1-9][0-9]*|[1-9][0-9]+\.[0-9]+)"/.test(native));
assert(native.includes('"requestId": message.get("requestId")'));
assert(native.includes('"moveId": message.get("moveId")'));
const activation = fs.readFileSync(path.join(root, "extension/content/activation.js"), "utf8");
assert(/const RUNTIME_VERSION = (1[7-9]|[2-9][0-9]+);/.test(activation));
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));
{ const [major, minor, patch] = manifest.version.split(".").map(Number); assert(major > 0 || minor > 24 || (minor === 24 && patch >= 3)); }
console.log("PASS: Phase 24 v0.24.3 managed-download move requests are correlated, bounded by timeout and surface Native Host errors");
