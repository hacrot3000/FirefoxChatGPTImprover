"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const background = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
const activation = fs.readFileSync(path.join(root, "extension/content/activation.js"), "utf8");
const localActions = fs.readFileSync(path.join(root, "extension/shared/local_actions.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));

function functionBlock(source, name) {
  const candidates = [`async function ${name}(`, `function ${name}(`];
  const starts = candidates.map((candidate) => source.indexOf(candidate)).filter((value) => value >= 0);
  assert.ok(starts.length > 0, `missing function ${name}`);
  const start = Math.min(...starts);
  const signatureEnd = source.indexOf(") {", start);
  assert.ok(signatureEnd >= 0, `missing function body ${name}`);
  const brace = source.indexOf("{", signatureEnd);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = brace; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

const showBlock = functionBlock(background, "showDownloadCompletion");
const startBlock = functionBlock(background, "startDownloadShellForJob");
const nativeDownloadBlock = functionBlock(background, "handleNativeDownloadMessage");
const recoverBlock = functionBlock(background, "recoverDownloadJob");
const overlayBlock = functionBlock(activation, "showDownloadCompletionOverlay");

assert.match(background, /Phase 28 v0\.28\.8: same-tab download jobs survive session-token rollover/);
assert.doesNotMatch(showBlock, /job\.sessionToken !== session\.sessionToken/);
assert.match(showBlock, /Number\(job\.tabId\) !== Number\(session\.tabId\)/);
assert.match(showBlock, /LocalActions\.downloadShellReadiness\(job\)/);
assert.match(showBlock, /shellReady:\s*shellReadiness\.ready/);
assert.match(showBlock, /manualFallback:\s*Boolean\(shellReadiness\.manualFallback\)/);
assert.doesNotMatch(startBlock, /job\.sessionToken !== session\.sessionToken/);
assert.match(startBlock, /Number\(job\.tabId\) !== Number\(session\.tabId\)/);
assert.match(nativeDownloadBlock, /job\.sessionToken = session\.sessionToken/);
assert.match(nativeDownloadBlock, /broadcast\("download-shell-available", tabId\)/);
assert.match(nativeDownloadBlock, /broadcast\("download-shell-fallback-available", tabId\)/);
assert.doesNotMatch(nativeDownloadBlock, /Automatic shell execution was skipped because the original download session is no longer current/);
assert.match(recoverBlock, /activeInMemory/);
assert.match(recoverBlock, /sameCapture/);

assert.match(activation, /Phase 28 v0\.28\.8: popup shell readiness follows run state, not editor mode/);
assert.match(activation, /const RUNTIME_VERSION = 20/);
assert.match(overlayBlock, /const shellRunId = String\(payload\.shellRunId \|\| ""\)/);
assert.match(overlayBlock, /const shellReady = Boolean\(declaredReady && !shellBusy && !shellAlreadyStarted\)/);
assert.match(overlayBlock, /shellButton\.disabled = !shellReady/);
assert.match(overlayBlock, /manualFallback/);
assert.doesNotMatch(overlayBlock, /shellMode !== "manual"/);
assert.doesNotMatch(overlayBlock, /Shell command starting automatically/);
assert.match(localActions, /Automatic execution has not created a run ID; manual execution is available/);

const parts = String(manifest.version || "").split(".").map(Number);
assert.ok(parts.length === 3 && parts.every(Number.isInteger));
assert.ok(parts[0] > 0 || parts[1] > 28 || (parts[1] === 28 && parts[2] >= 8));

console.log("PASS: Phase 28 v0.28.8 same-tab session rebind and page-popup Execute readiness");
