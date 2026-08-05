"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const phase16 = fs.readFileSync(path.join(root, "tests/test_phase16_command_presets_history.js"), "utf8");
const html = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));

const version = manifest.version.split(".").map(Number);
assert.ok(version[0] > 0 || version[1] > 28 || (version[1] === 28 && version[2] >= 4));
assert.match(phase16, /Phase 28 retires mandatory preset matching/);
assert.match(phase16, /global preset UI and per-tab command history/);
assert(phase16.includes('assert.doesNotMatch(sidebarHtml, /id="shellPresetName"/'));
assert(phase16.includes('assert.doesNotMatch(sidebarHtml, /id="requireShellPresetMatch"/'));
assert.doesNotMatch(phase16, /background-enforced allowlist/);
const v0283 = fs.readFileSync(path.join(root, "tests/test_phase28_v0283_volatile_draft_priority.js"), "utf8");
assert.doesNotMatch(v0283, /assert\.equal\(manifest\.version, "0\.28\.3"\)/);
assert.match(v0283, /manifestParts\[2\] >= 3/);
assert.doesNotMatch(html, /id="shellPresetName"/);
assert.doesNotMatch(html, /id="requireShellPresetMatch"/);
for (const id of ["shellPresetSelect", "newShellPresetButton", "updateShellPresetButton", "loadShellPresetButton"]) {
  assert(html.includes(`id="${id}"`), `missing current preset control ${id}`);
}

console.log("PASS: Phase 28 v0.28.4 historical Phase 16 test follows the current global-preset workflow");
