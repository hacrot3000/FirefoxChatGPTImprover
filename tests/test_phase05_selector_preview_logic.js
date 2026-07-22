#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const context = vm.createContext({
  console,
  setTimeout,
  clearTimeout,
  FCI_SETTINGS: {
    defaultConfig: () => ({ monitor: { conditions: [], conditionJoin: "all" } }),
    normalizeConfig: (value) => value,
    selectorToCss: () => "button"
  },
  FCI_PROTOCOL: {
    MONITOR_STATE: {
      IDLE: "idle",
      WAITING: "waiting",
      MATCHED: "matched",
      PAUSED: "paused",
      ERROR: "error"
    }
  }
});
context.globalThis = context;

vm.runInContext(
  fs.readFileSync(path.join(root, "extension/content/monitor.js"), "utf8"),
  context,
  { filename: "extension/content/monitor.js" }
);

const engine = context.FCI_MONITOR_ENGINE;
assert.ok(engine.VERSION >= 3, "Monitor engine phải có selector condition preview v3.");
assert.equal(typeof engine.evaluateAttributeConditions, "function");

function element(attributes, text = "") {
  return {
    textContent: text,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null;
    }
  };
}

const stopButton = element({ "aria-label": "Stop answering", "data-testid": "stop-button" });
const sendButton = element({ "aria-label": "Send prompt", "data-testid": "send-button" });
const startVoice = {
  conditionJoin: "all",
  conditions: [{
    enabled: true,
    attribute: "aria-label",
    operator: "contains",
    value: "Start Voice",
    caseSensitive: false
  }]
};

assert.equal(engine.evaluateAttributeConditions(stopButton, startVoice).conditionsMatched, false);
assert.equal(engine.evaluateAttributeConditions(sendButton, startVoice).conditionsMatched, false);

const stopCondition = {
  ...startVoice,
  conditions: [{ ...startVoice.conditions[0], value: "Stop answer" }]
};
assert.equal(engine.evaluateAttributeConditions(stopButton, stopCondition).conditionsMatched, true);
assert.equal(engine.evaluateAttributeConditions(sendButton, stopCondition).conditionsMatched, false);

const noEnabledConditions = {
  conditionJoin: "all",
  conditions: [{ ...startVoice.conditions[0], enabled: false }]
};
assert.equal(engine.evaluateAttributeConditions(stopButton, noEnabledConditions).conditionsMatched, true);
assert.equal(engine.evaluateAttributeConditions(stopButton, noEnabledConditions).enabledConditionCount, 0);

const html = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
assert.ok(html.includes('class="help-menu"'), "Sidebar phải có help tooltip compact.");
assert.ok(!html.includes('class="hint"'), "Không được luôn hiển thị các đoạn hint dài.");
assert.ok(
  html.indexOf('id="monitorTestButton"') > html.indexOf('id="conditionsList"'),
  "Nút kiểm tra monitor phải nằm sau danh sách điều kiện."
);

const background = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
assert.ok(background.includes("monitorConfig:"), "Background phải chuyển monitor config vào selector preview.");

console.log("PASS: Phase 05 v0.5.1 selector preview/help tooltip logic");
