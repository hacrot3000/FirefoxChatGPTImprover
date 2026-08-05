"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const extensionRoot = path.join(root, "extension");
const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, "manifest.json"), "utf8"));
const buildkitProgress = /^\s*#\d+\s+(?:\d+(?:\.\d+)?s?(?:\s+.*)?|(?:DONE|CACHED|ERROR)(?:\s+.*)?|\[[^\]\r\n]+\](?:\s+.*)?)\s*$/m;

const representativeLeaks = [
  "#10 51.98",
  "#10 51.98 Configuring extension",
  "#7 DONE 0.4s",
  "#8 CACHED",
  "#9 ERROR process failed",
  "#3 [builder 2/4] RUN npm test"
];
for (const sample of representativeLeaks) {
  assert.match(sample, buildkitProgress, `BuildKit detector missed: ${sample}`);
}
assert.doesNotMatch("// #10 is an issue reference", buildkitProgress);
assert.doesNotMatch("const value = '#10 51.98';", buildkitProgress);

function collectJavaScript(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...collectJavaScript(fullPath));
    else if (entry.isFile() && entry.name.endsWith(".js")) result.push(fullPath);
  }
  return result.sort();
}

const files = collectJavaScript(extensionRoot);
assert.ok(files.length > 0, "no extension JavaScript files found");
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  assert.doesNotMatch(source, buildkitProgress, `${path.relative(root, file)} contains leaked BuildKit output`);
  const checked = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  assert.equal(
    checked.status,
    0,
    `${path.relative(root, file)} failed node --check:\n${checked.stdout || ""}${checked.stderr || ""}`
  );
}

const background = fs.readFileSync(path.join(extensionRoot, "background/background.js"), "utf8");
assert.match(background, /Phase 28 v0\.28\.8: same-tab download jobs survive session-token rollover/);
assert.match(background, /LocalActions\.downloadShellReadiness\(job\)/);

const parts = String(manifest.version || "").split(".").map(Number);
assert.ok(parts.length === 3 && parts.every(Number.isInteger));
assert.ok(parts[0] > 0 || parts[1] > 28 || (parts[1] === 28 && parts[2] >= 10));

console.log(`PASS: Phase 28 v0.28.10 extended BuildKit source sanitizer checked ${files.length} JavaScript files`);
