"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sidebar = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
const background = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
const buildWrapper = fs.readFileSync(path.join(root, "tools/build_firefox_addon.sh"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));

const manifestParts = manifest.version.split(".").map(Number);
assert.ok(manifestParts[0] > 0 || manifestParts[1] > 28 || (manifestParts[1] === 28 && manifestParts[2] >= 3));

assert.match(sidebar, /function placeLocalActionProfileAfterConfigurationProfiles\(\)/);
assert.match(sidebar, /profileCard\.after\(localCard\)/);
assert.ok(sidebar.indexOf("placeLocalActionProfileAfterConfigurationProfiles();") < sidebar.indexOf("await initializeCollapsibleGroups();"));

assert.match(sidebar, /elements\.localActionDraftStatus\.textContent = ""/);
assert.match(sidebar, /Unsaved tab-only edits; lost after reload\./);
assert.match(sidebar, /elements\.localActionDraftStatus\.hidden = !dirty/);
assert.match(sidebar, /elements\.localActionModeStatus\.hidden = true/);
assert.match(sidebar, /elements\.localActionSourceSummary\.hidden = true/);
assert.doesNotMatch(sidebar, /textContent = localActionDraftDirty \? "Unsaved" : "Saved"/);

assert.match(sidebar, /volatile: true/);
assert.match(sidebar, /\n      clear\n/);
assert.match(sidebar, /function currentVolatileExecutionConfig\(\)/);
assert.match(sidebar, /commandPresetEditorMode === "tab" \? draft\.shell : base\.shell/);
assert.match(sidebar, /Direct command values are active immediately for this tab and are lost after reload unless applied or saved\./);
assert.doesNotMatch(sidebar, /Command changed; saving automatically/);
assert.doesNotMatch(sidebar, /direct command auto-save/);

const runStart = sidebar.indexOf("async function runShellCommand()");
const runEnd = sidebar.indexOf("function stopShellCommand()", runStart);
const runBlock = sidebar.slice(runStart, runEnd);
assert.ok(runBlock.includes("syncVolatileLocalActionDraft"));
assert.ok(runBlock.indexOf("syncVolatileLocalActionDraft") < runBlock.indexOf("MESSAGE.RUN_SHELL"));
assert.doesNotMatch(runBlock, /type: MESSAGE\.SAVE_TAB_LOCAL_ACTIONS/);

assert.match(background, /const volatileLocalActionDrafts = new Map\(\)/);
assert.match(background, /const volatileConfig = volatileLocalActionDrafts\.get\(Number\(session\?\.tabId\)\)/);
assert.ok(background.indexOf("volatileConfig") < background.indexOf("session.localActionConfigMode === CONFIG_MODE.TAB"));
assert.match(background, /message\.volatile === true/);
assert.match(background, /setVolatileLocalActionDraft/);
assert.match(background, /volatileLocalActionDrafts\.delete\(Number\(message\.tabId\)\)/);
assert.match(background, /message\.volatile === true/);

assert.match(buildWrapper, /release_firefox_addon\.py" --overwrite "\$@"/);

console.log("PASS: Phase 28 v0.28.3 source-shape-tolerant volatile local-action priority, compact status UI and repeatable same-version build");
