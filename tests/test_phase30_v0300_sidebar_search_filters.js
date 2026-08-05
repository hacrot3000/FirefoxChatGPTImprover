#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
const js = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
const css = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.css"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));
assert(manifest.version.split(".").map(Number).reduce((a, v, i) => a + v * [1000000, 1000, 1][i], 0) >= 30000);
for (const id of [
  "tabSearch", "profileSearch", "monitorProfileSearch", "targetProfileSearch",
  "localActionProfileSearch", "shellPresetSearch", "shellHistorySearch"
]) assert(html.includes(`id="${id}"`), `missing ${id}`);
for (const key of [
  "tabs", "configurationProfiles", "monitorProfiles", "targetProfiles",
  "localActionProfiles", "commandPresets", "commandHistory"
]) assert(js.includes(`"${key}"`), `missing filter state ${key}`);
assert(js.includes("filteredWithSelection"));
assert(js.includes("current selection kept"));
assert(js.includes("selected; outside filter"));
assert(js.includes("bindListFilter(elements.tabSearch"));
assert(js.includes("void persistSidebarUi()"));
assert(css.includes("Phase 30 v0.30.0"));
assert(css.includes(".filter-result"));

const vm = require("vm");
const helperStart = js.indexOf("  function normalizeFilter(value)");
const helperEnd = js.indexOf("  function selectedShellPreset()", helperStart);
assert(helperStart >= 0 && helperEnd > helperStart, "filter helper block missing");
const sandbox = {};
vm.runInNewContext(js.slice(helperStart, helperEnd) + "\nthis.api = { normalizeFilter, filterMatches, filteredWithSelection, renderFilterResult };", sandbox);
assert.strictEqual(sandbox.api.normalizeFilter("  Naruto "), "naruto");
assert.strictEqual(sandbox.api.filterMatches("docker", "Naruto", "/server-dockerize"), true);
assert.strictEqual(sandbox.api.filterMatches("ble", "Naruto", "/server-dockerize"), false);
const filtered = sandbox.api.filteredWithSelection(
  [{ id: "ble", name: "BleToNfc" }, { id: "naruto", name: "Naruto server" }],
  "ble",
  "naruto",
  (item) => sandbox.api.filterMatches("ble", item.name)
);
assert.deepStrictEqual(Array.from(filtered.items, (item) => item.id), ["naruto", "ble"]);
assert.strictEqual(filtered.matchCount, 1);
assert.strictEqual(filtered.selectedKept, true);
const output = { dataset: {}, textContent: "" };
sandbox.api.renderFilterResult(output, { ...filtered, query: "ble" });
assert.strictEqual(output.dataset.state, "active");
assert(output.textContent.includes("1 of 2 match"));
assert(output.textContent.includes("current selection kept"));
console.log("PASS: Phase 30 v0.30.0 sidebar search/filter contracts");
