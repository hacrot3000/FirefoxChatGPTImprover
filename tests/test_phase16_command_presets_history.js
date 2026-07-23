const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const settingsSource = fs.readFileSync(path.join(root, "extension/shared/settings.js"), "utf8");
const protocolSource = fs.readFileSync(path.join(root, "extension/shared/protocol.js"), "utf8");
const backgroundSource = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
const sidebarHtml = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
const sidebarJs = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));

const context = { console, URL, Date, JSON, RegExp, crypto: require("node:crypto").webcrypto };
context.globalThis = context;
vm.runInNewContext(settingsSource, context, { filename: "settings.js" });
const Settings = context.FCI_SETTINGS;
assert(Settings.SCHEMA_VERSION >= 12, `Phase 16 requires settings schema >= 12, got ${Settings.SCHEMA_VERSION}`);
const config = Settings.normalizeConfig({ shell: {
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
}});
assert.equal(config.shell.presets.length, 2);
assert.notEqual(config.shell.presets[0].id, config.shell.presets[1].id);
assert.equal(config.shell.historyLimit, 12);
assert.equal(Settings.matchingShellPreset(config, { cwd: "/tmp", command: "echo safe", mode: "background" }).name, "Safe");
assert.equal(Settings.matchingShellPreset(config, { cwd: "/tmp", command: "echo custom", mode: "background" }), null);
assert(Settings.validateConfig(config).ok);

const protocolContext = { globalThis: {} };
vm.runInNewContext(protocolSource, protocolContext, { filename: "protocol.js" });
assert.equal(protocolContext.globalThis.FCI_PROTOCOL.VERSION, 8);
assert.equal(protocolContext.globalThis.FCI_PROTOCOL.MESSAGE.CLEAR_SHELL_HISTORY, "FCI_CLEAR_SHELL_HISTORY");

for (const token of [
  "requirePresetMatch", "matchingShellPreset(config", "normalizeShellHistory", "syncShellHistory",
  "shellHistory", "CLEAR_SHELL_HISTORY", "does not match an enabled command preset"
]) assert(backgroundSource.includes(token), `background missing ${token}`);
for (const id of [
  "shellPresetSelect", "shellPresetName", "requireShellPresetMatch", "shellHistorySelect",
  "rememberShellHistory", "clearShellHistoryButton"
]) assert(sidebarHtml.includes(`id="${id}"`), `sidebar HTML missing ${id}`);
for (const token of ["shellPresetsDraft", "renderShellHistory", "newShellPreset", "loadSelectedShellHistory", "MESSAGE.CLEAR_SHELL_HISTORY"])
  assert(sidebarJs.includes(token), `sidebar JS missing ${token}`);

const parts = manifest.version.split(".").map(Number);
assert(parts[0] > 0 || parts[1] >= 16, `Phase 16 requires version >= 0.16.0, got ${manifest.version}`);
console.log("PASS: Phase 16 command presets, background-enforced allowlist and per-tab command history");
