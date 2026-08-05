"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const settingsSource = fs.readFileSync(path.join(root, "extension/shared/settings.js"), "utf8");
const localActionsSource = fs.readFileSync(path.join(root, "extension/shared/local_actions.js"), "utf8");
const commandPresetsSource = fs.readFileSync(path.join(root, "extension/shared/command_presets.js"), "utf8");
const protocolSource = fs.readFileSync(path.join(root, "extension/shared/protocol.js"), "utf8");
const backgroundSource = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
const sidebarHtml = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
const sidebarJs = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));

const context = {
  console,
  URL,
  Date,
  JSON,
  RegExp,
  Number,
  Object,
  Array,
  Set,
  String,
  Boolean,
  Uint32Array,
  crypto: require("node:crypto").webcrypto
};
context.globalThis = context;
vm.createContext(context);

vm.runInContext(settingsSource, context, { filename: "settings.js" });
const Settings = context.FCI_SETTINGS;
assert(Settings.SCHEMA_VERSION >= 12, `Phase 16 requires settings schema >= 12, got ${Settings.SCHEMA_VERSION}`);

vm.runInContext(localActionsSource, context, { filename: "local_actions.js" });
const LocalActions = context.FCI_LOCAL_ACTIONS;
const config = LocalActions.normalizeConfig({
  shell: {
    workingDirectory: "/tmp",
    command: "echo custom",
    mode: "background",
    requirePresetMatch: true,
    rememberHistory: true,
    historyLimit: 12,
    selectedPresetId: "safe",
    presets: [
      { id: "safe", name: "Safe", enabled: true, workingDirectory: "/tmp", command: "echo safe", mode: "background", confirmBeforeRun: false },
      { id: "safe", name: "Duplicate", enabled: false, workingDirectory: "/tmp", command: "echo duplicate", mode: "terminal" }
    ]
  }
});
assert.equal(config.shell.presets.length, 2);
assert.notEqual(config.shell.presets[0].id, config.shell.presets[1].id);
assert.equal(config.shell.historyLimit, 12);
assert.equal(config.shell.requirePresetMatch, false, "Phase 28 retires mandatory preset matching");
assert.equal(LocalActions.matchingPreset(config, { cwd: "/tmp", command: "echo safe", mode: "background" }).name, "Safe");
assert.equal(LocalActions.matchingPreset(config, { cwd: "/tmp", command: "echo custom", mode: "background" }), null);
const validation = LocalActions.validateConfig(config);
assert.equal(validation.ok, true, validation.errors.join(" | "));

vm.runInContext(commandPresetsSource, context, { filename: "command_presets.js" });
const CommandPresets = context.FCI_COMMAND_PRESETS;
assert(CommandPresets.SCHEMA_VERSION >= 1);
const globalStore = CommandPresets.normalizeStore({
  presets: [{ id: "global-safe", name: "Global safe", workingDirectory: "/tmp", command: "echo safe", mode: "background" }]
});
assert.equal(globalStore.presets.length, 1);
assert.equal(globalStore.presets[0].name, "Global safe");
assert.equal(CommandPresets.normalizePreset({ name: "Direct" }).name, "Direct");

const protocolContext = { globalThis: {} };
vm.runInNewContext(protocolSource, protocolContext, { filename: "protocol.js" });
assert(protocolContext.globalThis.FCI_PROTOCOL.VERSION >= 8);
assert.equal(protocolContext.globalThis.FCI_PROTOCOL.MESSAGE.CLEAR_SHELL_HISTORY, "FCI_CLEAR_SHELL_HISTORY");

for (const token of ["normalizeShellHistory", "syncShellHistory", "shellHistory", "CLEAR_SHELL_HISTORY"]) {
  assert(backgroundSource.includes(token), `background missing ${token}`);
}

for (const id of [
  "shellPresetSelect",
  "loadShellPresetButton",
  "newShellPresetButton",
  "updateShellPresetButton",
  "deleteShellPresetButton",
  "shellHistorySelect",
  "rememberShellHistory",
  "clearShellHistoryButton"
]) {
  assert(sidebarHtml.includes(`id="${id}"`), `sidebar HTML missing ${id}`);
}
assert.doesNotMatch(sidebarHtml, /id="shellPresetName"/, "Preset names are requested only by New preset");
assert.doesNotMatch(sidebarHtml, /id="requireShellPresetMatch"/, "Mandatory preset matching was retired in Phase 28");
assert.match(sidebarHtml, /shared\/command_presets\.js/);

for (const token of [
  "commandPresetStore",
  "renderShellHistory",
  "newShellPreset",
  "loadSelectedShellHistory",
  "MESSAGE.CLEAR_SHELL_HISTORY"
]) {
  assert(sidebarJs.includes(token), `sidebar JS missing ${token}`);
}
assert.match(sidebarJs, /prompt\("Preset name:", ""\)/);
assert.doesNotMatch(sidebarJs, /elements\.shellPresetName\.value\.trim/);

const parts = manifest.version.split(".").map(Number);
assert(parts[0] > 0 || parts[1] >= 16, `Phase 16 requires version >= 0.16.0, got ${manifest.version}`);
console.log("PASS: Phase 16 command-preset compatibility, global preset UI and per-tab command history");
