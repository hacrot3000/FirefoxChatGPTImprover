#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
const js = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
const background = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
const localActionsSource = fs.readFileSync(path.join(root, "extension/shared/local_actions.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));
for (const id of ["localActionDraftStatus", "localActionSourceSummary", "revertLocalActionDraftButton"]) {
  assert(html.includes(`id="${id}"`), `missing ${id}`);
}
const sectionStart = html.indexOf('data-group-id="local-actions"');
const sectionEnd = html.indexOf('</section>', sectionStart);
const section = html.slice(sectionStart, sectionEnd);
assert(section.indexOf('id="localActionDraftStatus"') < section.indexOf('aria-label="Local action profile help"'));
assert(js.includes("confirmDiscardLocalActionDraft(\"switching tabs\")"));
assert(js.includes("confirmDiscardLocalActionDraft(\"switching local-action profiles\")"));
assert(js.includes("assertSavedLocalActionConfig(validation.config, response.savedProfile?.config"));
assert(js.includes("assertSavedLocalActionConfig(validation.config, response.savedSession?.effectiveLocalActions"));
assert(background.includes("savedSession: savedSession ? publicSession(savedSession, store, localStore) : null"));
const sandbox = { globalThis: {}, crypto: { getRandomValues(array) { array[0] = 1; array[1] = 2; return array; } } };
vm.createContext(sandbox);
vm.runInContext(localActionsSource, sandbox);
const LocalActions = sandbox.globalThis.FCI_LOCAL_ACTIONS;
assert.equal(LocalActions.configFingerprint({ download: { enabled: true, destinationDirectory: "/tmp" } }), LocalActions.configFingerprint(LocalActions.normalizeConfig({ download: { enabled: true, destinationDirectory: "/tmp" } })));
assert.notEqual(LocalActions.configFingerprint({ download: { enabled: true, destinationDirectory: "/tmp/a" } }), LocalActions.configFingerprint({ download: { enabled: true, destinationDirectory: "/tmp/b" } }));
const version = manifest.version.split(".").map(Number);
assert(version[0] > 0 || version[1] > 24 || (version[1] === 24 && version[2] >= 0));
console.log("PASS: Phase 24 verified local-action persistence, effective-source audit and unsaved-draft protection");
