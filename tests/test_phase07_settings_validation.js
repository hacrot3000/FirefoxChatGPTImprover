#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const root = path.resolve(__dirname, "..");
const context = vm.createContext({ console, crypto: webcrypto, URL });
context.globalThis = context;
vm.runInContext(fs.readFileSync(path.join(root, "extension/shared/settings.js"), "utf8"), context);
const Settings = context.FCI_SETTINGS;

assert.equal(Settings.selectorToCss({ tag: "button", kind: "id", value: "composer-submit-button" }), "button#composer-submit-button");
assert.equal(Settings.selectorToCss({ tag: "button", kind: "class", value: ".primary send-button" }), "button.primary.send-button");
assert.equal(Settings.selectorToCss({ tag: "button", kind: "attribute", attributeName: "data-testid", value: "send-button" }), 'button[data-testid="send-button"]');

const visibilityOnly = Settings.validateConfig({
  monitor: {
    selector: { tag: "button", kind: "id", value: "composer-submit-button" },
    visibilityTransition: "hidden_to_visible",
    conditions: []
  }
});
assert.equal(visibilityOnly.ok, true, "Visibility-only config phải hợp lệ.");

const invalidRegex = Settings.validateConfig({
  monitor: {
    conditions: [{ enabled: true, attribute: "aria-label", operator: "regex", value: "[", caseSensitive: true }]
  }
});
assert.equal(invalidRegex.ok, false);
assert(invalidRegex.errors.some((item) => item.includes("regex is invalid")));

const allowed = Settings.normalizeConfig({ activation: { requireUrlMatch: true, urlPatterns: ["https://ai.example.local/*"] } });
assert.equal(Settings.urlAllowed(allowed, "https://ai.example.local/chat/1"), true);
assert.equal(Settings.urlAllowed(allowed, "https://other.example.local/chat/1"), false);

console.log("PASS: Phase 07 settings, selector, regex and URL validation");
