#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const root = path.resolve(__dirname, "..");
const context = vm.createContext({ console, crypto: webcrypto, URL, setTimeout, clearTimeout });
context.globalThis = context;
vm.runInContext(fs.readFileSync(path.join(root, "extension/shared/protocol.js"), "utf8"), context);
vm.runInContext(fs.readFileSync(path.join(root, "extension/shared/settings.js"), "utf8"), context);
context.FCI_MONITOR_ENGINE = { inspectVisibility: () => ({ visible: true }) };
vm.runInContext(fs.readFileSync(path.join(root, "extension/content/target.js"), "utf8"), context);

const engine = context.FCI_TARGET_ENGINE;
assert(engine.VERSION >= 3);
const options = engine.targetObserverOptionsForConfig({
  target: {
    selector: { tag: "button", kind: "attribute", attributeName: "data-action", value: "continue" },
    fingerprintAttributes: ["data-message-id", "aria-label"]
  }
});
for (const attribute of ["data-action", "data-message-id", "aria-label", "disabled", "style", "class"]) {
  assert(options.attributeFilter.includes(attribute), `Thiếu target observer attribute ${attribute}`);
}
assert.equal(options.childList, true);
assert.equal(options.subtree, true);

console.log("PASS: Phase 07 target observer hardening contract");
