#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "extension/content/target.js"), "utf8");

function config(targetEnabled = true) {
  return {
    activeRuleId: "rule-download",
    target: {
      enabled: Boolean(targetEnabled),
      selector: { tag: "button", kind: "css", value: ".download", attributeName: "" },
      clickStrategy: "newest",
      visibleOnly: true,
      enabledOnly: true,
      dryRun: true,
      maxClicksPerCycle: 1,
      fingerprintAttributes: ["data-download-id"],
      pipeline: {
        enabled: false,
        preActionDelayMs: 0,
        postActionDelayMs: 0,
        verifyEnabled: false,
        verifySelector: { tag: "*", kind: "css", value: ".done", attributeName: "" },
        verifyExpectation: "exists",
        verifyTimeoutMs: 5000,
        verifyPollIntervalMs: 150
      }
    }
  };
}

function createHarness(captureResult) {
  let clickCount = 0;
  let captureCalls = 0;
  const runtimes = [];

  class FakeElement {
    constructor(tagName = "button") {
      this.tagName = tagName.toUpperCase();
      this.textContent = "Download";
      this.isConnected = true;
      this.disabled = false;
      this.style = {};
      this.attributes = new Map([["data-download-id", "current"]]);
    }
    getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
    hasAttribute(name) { return this.attributes.has(name); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    removeAttribute(name) { this.attributes.delete(name); }
    matches(selector) { return selector === ".download"; }
    querySelectorAll() { return []; }
    compareDocumentPosition() { return 0; }
    click() { clickCount += 1; }
    append() {}
    remove() {}
  }

  const target = new FakeElement();
  const head = { append() {} };
  const body = { append() {} };
  const documentElement = { append() {} };
  const document = {
    head,
    body,
    documentElement,
    querySelectorAll(selector) { return selector === ".download" ? [target] : []; },
    createElement(tagName) {
      const node = new FakeElement(tagName);
      node.id = "";
      node.remove = () => {};
      return node;
    }
  };

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Element: FakeElement,
    Node: { DOCUMENT_POSITION_PRECEDING: 2 },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    getComputedStyle() { return { pointerEvents: "auto" }; },
    document,
    FCI_SETTINGS: {
      defaultConfig: config,
      normalizeConfig(value) { return value; },
      selectorToCss() { return ".download"; }
    },
    FCI_MONITOR_ENGINE: {
      inspectVisibility() { return { visible: true }; }
    },
    FCI_PROTOCOL: {
      MONITOR_STATE: { MATCHED: "matched" },
      TARGET_STATE: {
        DISABLED: "disabled",
        WAITING: "waiting",
        ARMED: "armed",
        ACTED: "acted",
        PAUSED: "paused",
        ERROR: "error"
      }
    }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "target.js" });

  const automation = sandbox.FCI_TARGET_ENGINE.createTargetAutomation({
    onRuntime(runtime) { runtimes.push(runtime); },
    async onBeforeClick() {
      captureCalls += 1;
      return { ...captureResult };
    }
  });

  return {
    automation,
    get clickCount() { return clickCount; },
    get captureCalls() { return captureCalls; },
    runtimes,
    engine: sandbox.FCI_TARGET_ENGINE
  };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

(async () => {
  const armed = createHarness({ armed: true, reason: "armed" });
  assert.ok(armed.engine.VERSION >= 6, "Target Engine must include managed-current-target fallback.");
  armed.automation.start(config(), "test-baseline");
  assert.equal(armed.automation.snapshot().baselineCount, 1, "The current download target must begin as baseline.");
  armed.automation.handleMonitorRuntime({ monitorState: "matched", cycle: 1 });
  await flush();
  assert.equal(armed.captureCalls, 1, "MATCHED must probe managed capture once for the current baseline target.");
  assert.equal(armed.clickCount, 1, "An armed managed download must click the current baseline target automatically.");
  assert.equal(armed.automation.snapshot().clickedCount, 1);
  assert.match(String(armed.automation.snapshot().lastTargetAction), /^click:1$/);

  const managedOnly = createHarness({ armed: true, reason: "armed" });
  managedOnly.automation.start(config(false), "test-managed-only");
  assert.equal(managedOnly.automation.snapshot().targetState, "disabled", "Normal target processing may remain disabled before MATCHED.");
  managedOnly.automation.handleMonitorRuntime({ monitorState: "matched", cycle: 1 });
  await flush();
  assert.equal(managedOnly.captureCalls, 1, "Managed download must probe the configured current target even when normal new-target processing is disabled.");
  assert.equal(managedOnly.clickCount, 1, "Managed download enablement alone must be sufficient to trigger the configured current target after capture arms.");
  assert.equal(managedOnly.automation.snapshot().clickedCount, 1);
  assert.equal(managedOnly.automation.snapshot().targetState, "acted");

  const disabled = createHarness({ armed: false, reason: "disabled" });
  disabled.automation.start(config(), "test-baseline");
  disabled.automation.handleMonitorRuntime({ monitorState: "matched", cycle: 1 });
  await flush();
  assert.equal(disabled.captureCalls, 1);
  assert.equal(disabled.clickCount, 0, "Baseline semantics must remain unchanged when managed download is disabled.");
  assert.equal(disabled.automation.snapshot().clickedCount, 0);
  assert.equal(disabled.automation.snapshot().lastTargetAction, "managed-current-skip:disabled");

  disabled.automation.handleMonitorRuntime({ monitorState: "matched", cycle: 1 });
  await flush();
  assert.equal(disabled.captureCalls, 1, "Managed-current probe must run at most once per MATCHED cycle.");
  assert.equal(disabled.clickCount, 0);

  const rules = fs.readFileSync(path.join(root, "extension/content/rules.js"), "utf8");
  const activation = fs.readFileSync(path.join(root, "extension/content/activation.js"), "utf8");
  assert.match(rules, /FCI_RULE_ENGINE\?\.VERSION >= 4/);
  assert.match(rules, /VERSION: 4,/);
  assert.match(activation, /const RUNTIME_VERSION = 30;/);

  console.log("PASS: managed download alone auto-clicks the configured current/baseline target exactly once when capture is armed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
