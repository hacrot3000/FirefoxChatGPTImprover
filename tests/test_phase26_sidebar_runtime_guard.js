"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const guardSource = fs.readFileSync(path.join(root, "extension/shared/sidebar_runtime_guard.js"), "utf8");
const sidebarSource = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
const html = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
const css = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.css"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.disabled = false;
    this.textContent = "";
    this.value = "";
    this.className = "";
    this.listeners = new Map();
    this.attributes = new Map();
    this.parentElement = null;
    this._id = "";
  }
  get id() { return this._id; }
  set id(value) {
    this._id = String(value || "");
    if (this._id) this.ownerDocument.byId.set(this._id, this);
  }
  append(...children) {
    for (const child of children) {
      if (!child) continue;
      child.parentElement = this;
      this.children.push(child);
    }
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  click() { return this.listeners.get("click")?.({ target: this }); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  select() {}
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    if (this.id) this.ownerDocument.byId.delete(this.id);
  }
}

class FakeDocument {
  constructor() {
    this.byId = new Map();
    this.readyState = "complete";
    this.documentElement = new FakeElement("html", this);
    this.body = new FakeElement("body", this);
    this.documentElement.append(this.body);
  }
  createElement(tagName) { return new FakeElement(tagName, this); }
  getElementById(id) { return this.byId.get(id) || null; }
  addEventListener() {}
  execCommand(command) { return command === "copy"; }
}

const document = new FakeDocument();
const globalListeners = new Map();
let reloadCount = 0;
let clipboardText = "";
const context = {
  console,
  document,
  Date,
  Error,
  JSON,
  Object,
  Promise,
  String,
  setTimeout(callback) { callback(); return 1; },
  location: { href: "moz-extension://test/sidebar/sidebar.html", reload() { reloadCount += 1; } },
  navigator: { userAgent: "phase26-test", clipboard: { async writeText(text) { clipboardText = text; } } },
  browser: { runtime: { getManifest() { return { version: "0.26.0" }; } } },
  addEventListener(type, listener) { globalListeners.set(type, listener); }
};
context.globalThis = context;
vm.createContext(context);
assert.doesNotThrow(() => vm.runInContext(guardSource, context, { filename: "sidebar_runtime_guard.js" }));

const guard = context.FCI_SIDEBAR_RUNTIME_GUARD;
assert.ok(guard, "runtime guard must export its API before other sidebar dependencies load");
assert.equal(guard.version, "0.26.0");
assert.ok(document.getElementById("fciSidebarRuntimeRecovery"));
assert.equal(document.getElementById("fciSidebarRuntimeRecovery").hidden, true);

guard.markStarting();
assert.equal(document.body.dataset.sidebarReady, "false");
assert.equal(document.body.dataset.sidebarStartup, "starting");
guard.report("local-actions", new Error("download is not defined"), { fatal: true });
assert.equal(document.getElementById("fciSidebarRuntimeRecovery").hidden, false);
assert.equal(document.body.dataset.sidebarStartup, "failed");
assert.match(document.getElementById("fciSidebarRuntimeDetails").textContent, /download is not defined/);

let retryCount = 0;
guard.setRetryHandler(() => { retryCount += 1; });
document.getElementById("fciSidebarRuntimeRetry").click();
document.getElementById("fciSidebarRuntimeReload").click();
assert.equal(reloadCount, 1);

globalListeners.get("unhandledrejection")({ reason: new Error("async bootstrap failed") });
assert.match(guard.diagnosticText(), /async bootstrap failed/);
assert.equal(guard.diagnostics().extensionVersion, "0.26.0");

(async () => {
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(retryCount, 1);
  await guard.copyDiagnostics();
  assert.match(clipboardText, /download is not defined/);
  guard.clearStage("local-actions");
  guard.clearStage("unhandled-rejection");
  guard.markReady();
  assert.equal(document.body.dataset.sidebarReady, "true");
  assert.equal(document.body.dataset.sidebarStartup, "ready");
  assert.equal(document.getElementById("fciSidebarRuntimeRecovery").hidden, true);

  const guardIndex = html.indexOf("../shared/sidebar_runtime_guard.js");
  const localActionsIndex = html.indexOf("../shared/local_actions.js");
  const sidebarIndex = html.indexOf("sidebar.js");
  assert.ok(guardIndex >= 0, "sidebar HTML must load the runtime guard");
  assert.ok(localActionsIndex < 0 || guardIndex < localActionsIndex, "runtime guard must load before local_actions.js");
  assert.ok(sidebarIndex < 0 || guardIndex < sidebarIndex, "runtime guard must load before sidebar.js");
  assert.match(sidebarSource, /const RuntimeGuard = globalThis\.FCI_SIDEBAR_RUNTIME_GUARD/);
  assert.match(sidebarSource, /RuntimeGuard\?\.report\("collapsible-groups"/);
  assert.match(sidebarSource, /RuntimeGuard\?\.report\("dashboard"/);
  assert.match(sidebarSource, /RuntimeGuard\?\.setRetryHandler/);
  assert.match(css, /\.sidebar-runtime-recovery/);
  {
    const parts = String(manifest.version || "").split(".").map(Number);
    assert.ok(parts.length === 3 && parts.every(Number.isInteger));
    assert.ok(parts[0] > 0 || parts[1] > 26 || (parts[1] === 26 && parts[2] >= 0));
  }
  console.log("PASS: Phase 26 preload runtime guard, visible diagnostics, retry/reload and recoverable dashboard bootstrap");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
