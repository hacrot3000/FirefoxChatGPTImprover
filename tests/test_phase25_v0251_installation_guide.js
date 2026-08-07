"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
const css = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.css"), "utf8");
const sidebar = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));

const patchToolUrl = "https://github.com/hacrot3000/FirefoxChatGPTImprover/raw/refs/heads/main/tools/python_patch_tool_v3_package.zip";
const nativeHostUrl = "https://github.com/hacrot3000/FirefoxChatGPTImprover/tree/main/native-host";

assert.match(html, /data-group-id="installation-guide"/);
assert.match(html, /id="installationGuideHeading">Setup and installation</);
assert.ok(html.includes(`href="${patchToolUrl}"`));
assert.ok(html.includes(`href="${nativeHostUrl}"`));
assert.equal((html.match(/target="_blank"/g) || []).length >= 2, true);
assert.equal((html.match(/rel="noopener noreferrer"/g) || []).length >= 2, true);
assert.match(html, /\.\/tools\/run_python_patches\.sh/);
assert.match(html, /python3 \.\/native-host\/native_host\.py --self-test/);
assert.match(html, /\.\/native-host\/install_native_host\.sh/);
assert.match(html, /Check Native Host/);
assert.match(html, /Do not use <code>sudo<\/code>/);
const orderMatch = /const SIDEBAR_GROUP_ORDER = Object\.freeze\(\[([\s\S]*?)\]\);/.exec(sidebar);
assert.ok(orderMatch, "Missing runtime sidebar group-order registry");
const runtimeOrder = [...orderMatch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
assert.ok(runtimeOrder.indexOf("shell") < runtimeOrder.indexOf("save"));
assert.ok(runtimeOrder.indexOf("save") < runtimeOrder.indexOf("installation-guide"));
assert.match(css, /\.installation-guide-item/);
assert.match(css, /\.guide-link-button/);
assert.match(css, /\.guide-command/);
{
  const parts = String(manifest.version || "").split(".").map(Number);
  assert.ok(parts.length === 3 && parts.every(Number.isInteger));
  assert.ok(parts[0] > 0 || parts[1] > 25 || (parts[1] === 25 && parts[2] >= 1));
}

console.log("PASS: Phase 25 v0.25.1 installation-guide group, links and initialization instructions");
