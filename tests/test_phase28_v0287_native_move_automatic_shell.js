"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const background = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
const localActions = fs.readFileSync(path.join(root, "extension/shared/local_actions.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));

function functionBlock(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing function ${name}`);
  const signatureEnd = source.indexOf(") {", start);
  assert.ok(signatureEnd >= 0, `missing function body ${name}`);
  const brace = source.indexOf("{", signatureEnd);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

const moveBlock = functionBlock(background, "moveCompletedDownload");
const nativeMessageBlock = functionBlock(background, "handleNativeMessage");
const nativeDownloadBlock = functionBlock(background, "handleNativeDownloadMessage");
const downloadStartBlock = functionBlock(background, "startDownloadShellForJob");

assert.match(moveBlock, /if \(job\.status !== "completed"\) \{\s*await handleNativeDownloadMessage\(response\);\s*\}/);
assert.match(nativeMessageBlock, /pending\.action === "move_download"/);
assert.match(nativeMessageBlock, /await handleNativeDownloadMessage\(correlatedMessage\)/);
assert.ok(
  nativeMessageBlock.indexOf("await handleNativeDownloadMessage(correlatedMessage)") < nativeMessageBlock.indexOf("pending.resolve(clone(correlatedMessage))"),
  "move completion must be consumed before the correlated request resolves"
);
assert.match(nativeMessageBlock, /const destinationPath =/);
assert.match(nativeMessageBlock, /"download_moved"/);
assert.match(nativeDownloadBlock, /download-move-response/);
assert.match(nativeDownloadBlock, /job\.status === "completed"[\s\S]*job\.moveId === moveId/);
assert.doesNotMatch(nativeDownloadBlock, /job\.shellExecutionMode === "automatic" \? "starting"/);
assert.match(nativeDownloadBlock, /job\.shellStatus = job\.shellExecutionMode === "disabled" \? "disabled" : "available"/);
assert.match(downloadStartBlock, /mode:\s*"background"/);
assert.match(background, /port\.postMessage\(\{ action: "run", runId, tabId, cwd, command, mode, environment: run\.environment \}\)/);
assert.doesNotMatch(background, /command\.split\([^\n]*&&/);
assert.match(localActions, /The frozen per-tab shell command is ready and will run in background mode/);

const parts = String(manifest.version || "").split(".").map(Number);
assert.ok(parts.length === 3 && parts.every(Number.isInteger));
assert.ok(parts[0] > 0 || parts[1] > 28 || (parts[1] === 28 && parts[2] >= 7));

console.log("PASS: Phase 28 v0.28.7 correlated move completion, automatic shell launch and compound-command preservation");
