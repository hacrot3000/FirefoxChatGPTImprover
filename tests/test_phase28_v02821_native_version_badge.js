#!/usr/bin/env node
"use strict";

const fs = require("fs");
const assert = require("assert");

const html = fs.readFileSync("extension/sidebar/sidebar.html", "utf8");
const css = fs.readFileSync("extension/sidebar/sidebar.css", "utf8");
const js = fs.readFileSync("extension/sidebar/sidebar.js", "utf8");
const manifest = JSON.parse(fs.readFileSync("extension/manifest.json", "utf8"));

assert.ok(manifest.version.localeCompare("0.28.21", undefined, { numeric: true }) >= 0);
assert.match(html, /id="nativeHostStatus" class="native-status native-host-status"/);
assert.match(html, /id="nativeHostStatus"[^>]+role="status"[^>]+aria-live="polite"/);
assert.match(css, /\.native-host-status\s*\{[^}]*max-width:\s*none;/s);
assert.match(css, /\.native-host-status\s*\{[^}]*min-width:\s*max-content;/s);
assert.match(css, /\.native-host-status\s*\{[^}]*overflow:\s*visible;/s);
assert.match(js, /Native Host version: \${nativeVersion}/);
assert.match(js, /Last checked: \${native\.lastSeenAt}/);
assert.match(js, /nativeHostStatus\.setAttribute\("aria-label"/);
assert.doesNotMatch(js, /nativeHostStatus\.title = nativeNeedsUpdate[\s\S]{0,250}native\.lastSeenAt \|\| ""/);

console.log("PASS: Phase 28 v0.28.21 Native Host version badge remains fully visible and exposes version plus status in its tooltip.");
