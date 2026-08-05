"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sidebar = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
const html = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
const css = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.css"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));

const version = manifest.version.split(".").map(Number);
assert.ok(version[0] > 0 || version[1] > 28 || (version[1] === 28 && version[2] >= 5));

assert.match(sidebar, /elements\.localActionDraftStatus\.textContent = ""/);
assert.match(sidebar, /elements\.localActionDraftStatus\.setAttribute\("aria-label", statusDetail\)/);
assert.doesNotMatch(sidebar, /textContent = detail \|\| "Current edits are active for this tab only/);

const statusTag = html.match(/<span id="localActionDraftStatus"[^>]*><\/span>/);
assert.ok(statusTag, "local-action draft status must be an empty span");
assert.match(statusTag[0], /class="native-status local-action-status-dot"/);
assert.match(statusTag[0], /hidden/);
assert.doesNotMatch(statusTag[0], />\s*Saved\s*</);
assert.doesNotMatch(statusTag[0], /Current edits are active/);

assert.match(css, /#localActionDraftStatus\.local-action-status-dot\s*\{/);
assert.match(css, /width:\s*8px/);
assert.match(css, /height:\s*8px/);
assert.match(css, /padding:\s*0/);
assert.match(css, /border:\s*0/);
assert.match(css, /#localActionDraftStatus\[hidden\]\s*\{\s*display:\s*none/);

console.log("PASS: Phase 28 v0.28.5 local-action draft state renders as one compact yellow status dot only");
