#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const root = path.resolve(__dirname, "..");
const fakeElements = [];
const context = vm.createContext({
  console,
  crypto: webcrypto,
  URL,
  setTimeout,
  clearTimeout,
  document: {
    querySelectorAll() { return fakeElements; },
    createDocumentFragment() { return { querySelector() { return null; } }; }
  }
});
context.globalThis = context;
vm.runInContext(fs.readFileSync(path.join(root, "extension/shared/protocol.js"), "utf8"), context);
vm.runInContext(fs.readFileSync(path.join(root, "extension/shared/settings.js"), "utf8"), context);
context.FCI_MONITOR_ENGINE = {
  inspectVisibility(element) { return { visible: Boolean(element.visible) }; }
};
vm.runInContext(fs.readFileSync(path.join(root, "extension/content/target.js"), "utf8"), context);

const Settings = context.FCI_SETTINGS;
const Target = context.FCI_TARGET_ENGINE;
assert(Settings.SCHEMA_VERSION >= 9);
assert(Target.VERSION >= 4);

const migrated = Settings.normalizeConfig({
  target: {
    enabled: true,
    selector: { tag: "button", kind: "css", value: ".continue", attributeName: "" }
  }
});
assert.equal(migrated.target.pipeline.enabled, false);
assert.equal(migrated.target.pipeline.preActionDelayMs, 0);
assert.equal(migrated.target.pipeline.verifyExpectation, "exists");

const normalized = Settings.normalizeConfig({
  target: {
    pipeline: {
      enabled: true,
      preActionDelayMs: 200,
      postActionDelayMs: 300,
      verifyEnabled: true,
      verifySelector: { tag: "div", kind: "class", value: "done", attributeName: "" },
      verifyExpectation: "visible",
      verifyTimeoutMs: 2500,
      verifyPollIntervalMs: 75
    }
  }
});
assert.equal(normalized.target.pipeline.enabled, true);
assert.equal(normalized.target.pipeline.verifySelector.kind, "class");
assert.equal(normalized.target.pipeline.verifyExpectation, "visible");
assert.equal(normalized.target.pipeline.verifyPollIntervalMs, 75);

const invalidVerify = Settings.validateConfig({
  target: { pipeline: { verifyEnabled: true, verifySelector: { tag: "*", kind: "css", value: "" } } }
});
assert.equal(invalidVerify.ok, false);
assert(invalidVerify.errors.some((item) => item.includes("Verification selector")));

fakeElements.splice(0, fakeElements.length, { visible: true }, { visible: false });
let snapshot = Target.verificationSnapshot({
  verifySelector: { tag: "div", kind: "css", value: ".state", attributeName: "" },
  verifyExpectation: "visible"
});
assert.equal(snapshot.passed, true);
assert.equal(snapshot.count, 2);
assert.equal(snapshot.visibleCount, 1);

snapshot = Target.verificationSnapshot({
  verifySelector: { tag: "div", kind: "css", value: ".state", attributeName: "" },
  verifyExpectation: "hidden"
});
assert.equal(snapshot.passed, false);
fakeElements.splice(0, fakeElements.length, { visible: false });
snapshot = Target.verificationSnapshot({
  verifySelector: { tag: "div", kind: "css", value: ".state", attributeName: "" },
  verifyExpectation: "hidden"
});
assert.equal(snapshot.passed, true);
fakeElements.splice(0, fakeElements.length);
snapshot = Target.verificationSnapshot({
  verifySelector: { tag: "div", kind: "css", value: ".state", attributeName: "" },
  verifyExpectation: "not_exists"
});
assert.equal(snapshot.passed, true);

(async () => {
  fakeElements.splice(0, fakeElements.length);
  setTimeout(() => fakeElements.push({ visible: true }), 40);
  const result = await Target.waitForVerification({
    verifySelector: { tag: "div", kind: "css", value: ".state", attributeName: "" },
    verifyExpectation: "exists",
    verifyTimeoutMs: 500,
    verifyPollIntervalMs: 25
  });
  assert.equal(result.passed, true);
  assert.equal(result.cancelled, false);

  const sidebar = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
  for (const id of [
    "pipelineEnabled", "preActionDelayMs", "postActionDelayMs", "verifyEnabled",
    "verifyTag", "verifyKind", "verifyValue", "verifyPickerButton", "verifyTestButton",
    "verifyExpectation", "verifyTimeoutMs", "verifyPollIntervalMs", "pipelineRuntimeText"
  ]) {
    assert(sidebar.includes(`id="${id}"`), `missing Phase 12 control ${id}`);
  }
  const background = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
  assert(background.includes('["monitor", "target", "verify"]'));
  assert(background.includes('"target-pipeline"'));
  const picker = fs.readFileSync(path.join(root, "extension/content/picker.js"), "utf8");
  assert(picker.includes('["monitor", "target", "verify"]'));
  const targetSource = fs.readFileSync(path.join(root, "extension/content/target.js"), "utf8");
  for (const marker of ["runPipeline", "waitForVerification", "pipelineCancelled", "verify-pass", "verify-fail", "cancelPipeline"]) {
    assert(targetSource.includes(marker), `missing target pipeline marker ${marker}`);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));
  assert(Number(manifest.version.split(".")[1]) >= 12);
  console.log("PASS: Phase 12 target action pipeline delay/click/verify, cancellation and schema migration contract");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
