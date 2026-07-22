#!/usr/bin/env node
"use strict";

const fs = require("fs");
const vm = require("vm");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "../extension/content/target.js"), "utf8");
const context = {
  console,
  setTimeout,
  clearTimeout,
  globalThis: null,
  FCI_SETTINGS: { defaultConfig: () => ({ target: {} }), normalizeConfig: (value) => value },
  FCI_MONITOR_ENGINE: {},
  FCI_PROTOCOL: {
    MONITOR_STATE: { MATCHED: "matched" },
    TARGET_STATE: { DISABLED: "disabled", WAITING: "waiting", ARMED: "armed", ACTED: "acted", PAUSED: "paused", ERROR: "error" }
  }
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: "target.js" });
const engine = context.FCI_TARGET_ENGINE;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function mockElement(tag, attributes = {}, text = "") {
  return {
    tagName: tag.toUpperCase(),
    textContent: text,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null;
    }
  };
}

assert(engine.VERSION === 1, "Target engine version phải là 1.");
assert(engine.newSlotCount(3, 2, 0) === 1, "Một target vượt baseline phải tạo một slot mới.");
assert(engine.newSlotCount(2, 2, 0) === 0, "React re-render cùng số lượng không được tạo candidate.");
assert(engine.newSlotCount(4, 2, 1) === 1, "Target đã xử lý phải được trừ khỏi slot còn lại.");
assert(engine.newSlotCount(1, 3, 0) === 0, "Không được tạo slot âm.");

const first = mockElement("button", { "data-message-id": "m1", "aria-label": "Continue" }, "Tiếp tục");
const rerender = mockElement("button", { "data-message-id": "m1", "aria-label": "Continue" }, "Tiếp tục");
const second = mockElement("button", { "data-message-id": "m2", "aria-label": "Continue" }, "Tiếp tục");
const attrs = ["data-message-id", "aria-label"];
assert(engine.elementFingerprint(first, attrs) === engine.elementFingerprint(rerender, attrs), "Node render lại cùng identity logic phải có cùng fingerprint.");
assert(engine.elementFingerprint(first, attrs) !== engine.elementFingerprint(second, attrs), "Message ID khác phải tạo fingerprint khác.");

const fallbackA = mockElement("button", {}, "  Try   again ");
const fallbackB = mockElement("button", {}, "Try again");
assert(engine.elementFingerprint(fallbackA, []) === engine.elementFingerprint(fallbackB, []), "Fallback text phải chuẩn hóa whitespace.");

console.log("PASS Phase 04 target baseline/fingerprint logic");
