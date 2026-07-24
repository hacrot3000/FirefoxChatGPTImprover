#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const root = path.resolve(__dirname, "..");
const context = vm.createContext({
  console,
  crypto: webcrypto,
  URL,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval
});
context.globalThis = context;

for (const relative of [
  "extension/shared/protocol.js",
  "extension/shared/settings.js",
  "extension/content/alert.js"
]) {
  vm.runInContext(fs.readFileSync(path.join(root, relative), "utf8"), context, { filename: relative });
}

const Alert = context.FCI_ALERT_ENGINE;
const Settings = context.FCI_SETTINGS;
assert(Alert.VERSION >= 6);
assert.equal(
  Alert.stripManagedTitleDecorations("[READY] [RUNNING] ⠋ Internal AI", ["READY", "RUNNING"]),
  "Internal AI"
);
assert.equal(
  Alert.stripManagedTitleDecorations("⠋ ⠙ [⚠ AI READY] [⚠ AI READY] Chat", ["⚠ AI READY"]),
  "Chat"
);
assert.equal(
  Alert.stripManagedTitleDecorations("RUNNING - READY: Page", ["READY", "RUNNING"]),
  "Page"
);
assert.equal(Alert.stripManagedTitleDecorations("[Project] Title", ["READY"]), "[Project] Title");

const defaultStore = Settings.defaultStore();
assert.equal(defaultStore.profiles[0].name, "Default");
assert.equal(defaultStore.profiles[0].config.rules[0].name, "Rule 1");
const migrated = Settings.normalizeConfig({
  rules: [{ id: "legacy-rule", name: "Quy tắc 1", enabled: true }]
});
assert.equal(migrated.rules[0].name, "Rule 1");

const sidebarHtml = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
const sidebarJs = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
const sidebarCss = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.css"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));

function versionAtLeast(actual, minimum) {
  const parse = (value) => String(value).split(".").map((part) => Number(part));
  const actualParts = parse(actual);
  const minimumParts = parse(minimum);
  assert.equal(actualParts.length, 3, `Invalid semantic version: ${actual}`);
  assert(actualParts.every(Number.isInteger), `Invalid semantic version: ${actual}`);
  for (let index = 0; index < 3; index += 1) {
    if (actualParts[index] > minimumParts[index]) return true;
    if (actualParts[index] < minimumParts[index]) return false;
  }
  return true;
}
assert(
  versionAtLeast(manifest.version, "0.15.2"),
  `Phase 15 v0.15.2 feature contract requires manifest version >= 0.15.2, got ${manifest.version}`
);
assert(sidebarHtml.includes('<html lang="en">'));
assert(sidebarHtml.includes('id="ruleRuntimeDetails"'));
assert(sidebarHtml.includes('id="ruleRuntimeBadge"'));
assert(!sidebarHtml.includes('class="compact-help"'));
assert(sidebarCss.includes('.rule-runtime-details'));
assert(sidebarCss.includes('.card[data-collapsed="true"] > .help-menu { display: block; }'));
assert(sidebarJs.includes('"Not running"'));
assert(sidebarJs.includes('"Expand section"'));

const uiSources = [
  "extension/sidebar/sidebar.html",
  "extension/sidebar/sidebar.js",
  "extension/content/monitor.js",
  "extension/content/picker.js",
  "extension/content/target.js",
  "extension/background/background.js",
  "extension/manifest.json"
].map((relative) => fs.readFileSync(path.join(root, relative), "utf8")).join("\n");
const vietnameseUiWords = /\b(chưa|đã|đang|không|hiện|ẩn|tổng|chu kỳ|trạng thái|quy tắc|bản sao|mặc định|yêu cầu|hợp lệ|khớp|phù hợp|cấu hình|lưu|xóa|dừng|kích hoạt|tạm dừng|tiếp tục|kiểm tra|chọn|người dùng|trợ giúp|giá trị|phép|phân biệt|tồn tại|chứa|xác nhận|nhật ký)\b/iu;
assert.equal(vietnameseUiWords.test(uiSources), false);

console.log("PASS: Phase 15 v0.15.2 English UI, title de-duplication, rule runtime disclosure and help popovers");
