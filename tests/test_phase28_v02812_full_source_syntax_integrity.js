"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const extensionRoot = path.join(root, "extension");
const backgroundPath = path.join(extensionRoot, "background/background.js");
const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, "manifest.json"), "utf8"));
const background = fs.readFileSync(backgroundPath, "utf8");

for (const leaked of [
  "#28 exporting to image",
  "[DOCKER 5/7] Enforce warning-free tokumx_legacy compilation",
  "COMBINED_TEST_EXIT_CODE=0",
  "[system] [exited] returnCode=0"
]) {
  assert.ok(!background.includes(leaked), `background.js still contains terminal output: ${leaked}`);
}

assert.match(background, /function nativeDashboardState\(\)/);
assert.match(background, /function scheduleShellBroadcast\(tabId\)/);
assert.ok(
  background.indexOf("function nativeDashboardState()") < background.indexOf("function scheduleShellBroadcast(tabId)"),
  "background function order changed"
);

function collect(directory) {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (["node_modules", "patchs", "patched", "backup", "backups", "__pycache__", ".patch_runner_tmp"].includes(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...collect(full));
    else if (entry.isFile() && /\.(?:js|mjs|cjs)$/.test(entry.name)) output.push(full);
  }
  return output.sort();
}

const javascriptFiles = collect(root);
assert.ok(javascriptFiles.length > 0, "no JavaScript files found");
for (const file of javascriptFiles) {
  const checked = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  assert.equal(
    checked.status,
    0,
    `${path.relative(root, file)} failed node --check:\n${checked.stdout || ""}${checked.stderr || ""}`
  );
}

const checker = spawnSync("python3", [path.join(root, "tools/check_source_syntax.py")], {
  cwd: root,
  encoding: "utf8"
});
assert.equal(checker.status, 0, `${checker.stdout || ""}${checker.stderr || ""}`);

const parts = String(manifest.version || "").split(".").map(Number);
assert.ok(parts.length === 3 && parts.every(Number.isInteger));
assert.ok(parts[0] > 0 || parts[1] > 28 || (parts[1] === 28 && parts[2] >= 12));

console.log(`PASS: Phase 28 v0.28.12 full source syntax audit checked ${javascriptFiles.length} JavaScript files`);
