"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const sidebarSource = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
const localActionsSource = fs.readFileSync(path.join(root, "extension/shared/local_actions.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));

const manifestParts = manifest.version.split(".").map(Number);
assert.ok(manifestParts[1] > 28 || (manifestParts[1] === 28 && manifestParts[2] >= 1));
assert.match(sidebarSource, /prompt\("Preset name:", ""\)/);
assert.match(sidebarSource, /Preset “\$\{name\}” created\. Enter its command settings, then click Save preset\./);
assert.match(sidebarSource, /CommandPresets\.upsert\(commandPresetStore/);
assert.match(sidebarSource, /option\.textContent = preset\.name/);
assert.match(sidebarSource, /elements\.updateShellPresetButton\.disabled = busy \|\| !preset/);
assert.match(sidebarSource, /elements\.loadShellPresetButton\.disabled = busy \|\| !commandPresetIsRunnable\(preset\)/);
assert.match(sidebarSource, /Save a valid Working directory and Command before applying this preset/);
assert.match(sidebarSource, /shellPresetName\?\.closest\("label"\)\?\.remove\(\)/);
assert.match(sidebarSource, /shellPresetEnabled\?\.closest\("label"\)\?\.remove\(\)/);
assert.match(sidebarSource, /requireShellPresetMatch\?\.closest\("label"\)\?\.remove\(\)/);
assert.match(sidebarSource, /useDirectTabCommandButton/);
assert.match(sidebarSource, /Direct command values are active immediately for this tab and are lost after reload unless applied or saved/);
assert.doesNotMatch(sidebarSource, /elements\.shellPresetName\.value\.trim/);
assert.doesNotMatch(localActionsSource, /The download shell command must match an enabled background command preset/);

const context = {
  console, Date, JSON, Number, Object, Array, Set, String, Boolean,
  crypto: { getRandomValues(array) { array.fill(11); return array; } }
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(localActionsSource, context, { filename: "local_actions.js" });
const api = context.FCI_LOCAL_ACTIONS;
const normalized = api.normalizeConfig({
  download: { enabled: true, destinationDirectory: "/tmp", shellExecutionMode: "manual" },
  shell: {
    workingDirectory: "/repo",
    command: "./run.sh",
    mode: "background",
    requirePresetMatch: true,
    presets: []
  }
});
assert.equal(normalized.shell.requirePresetMatch, false);
const validation = api.validateConfig(normalized);
assert.equal(validation.ok, true, validation.errors.join(" | "));

console.log("PASS: Phase 28 v0.28.1 prompt-created presets, selected-preset saving and unrestricted command execution");
