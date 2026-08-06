#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "extension/shared/browser_compat.js"), "utf8");

function event() {
  const listeners = new Set();
  return {
    listeners,
    addListener(listener) { listeners.add(listener); },
    removeListener(listener) { listeners.delete(listener); },
    hasListener(listener) { return listeners.has(listener); },
    hasListeners() { return listeners.size > 0; }
  };
}

(async () => {
  const firefoxBrowser = {
    runtime: { getBrowserInfo: async () => ({ name: "Firefox" }) },
    sidebarAction: { open: async () => {} },
    sessions: { setTabValue: async () => {} }
  };
  const firefoxContext = vm.createContext({ console, browser: firefoxBrowser, chrome: { runtime: {} } });
  firefoxContext.globalThis = firefoxContext;
  vm.runInContext(source, firefoxContext, { filename: "browser_compat.js" });
  assert.equal(firefoxContext.browser, firefoxBrowser, "Firefox namespace must remain untouched");
  assert.equal(firefoxContext.FCI_BROWSER_COMPAT.platform, "firefox");

  const onMessage = event();
  const storage = new Map();
  const openedPanels = [];
  const createdTabs = [];
  const chrome = {
    runtime: {
      id: "aganahagmocgjhcglbjdeidlpecdhgfj",
      onMessage,
      getURL: (value) => `chrome-extension://id/${value}`,
      getManifest: () => ({ version: "0.38.0" })
    },
    storage: {
      session: {
        async get(key) { return storage.has(key) ? { [key]: storage.get(key) } : {}; },
        async set(values) { for (const [key, value] of Object.entries(values)) storage.set(key, value); },
        async remove(key) { storage.delete(key); }
      }
    },
    tabs: {
      async query() { return [{ id: 91, windowId: 7, active: true }]; },
      async create(options) { createdTabs.push(options); return { id: 92, ...options }; }
    },
    sidePanel: {
      async open(options) { openedPanels.push(options); }
    },
    sessions: {},
    commands: {
      onCommand: event(),
      resetNames: [],
      async getAll() { return [{ name: "fci-open-side-panel", shortcut: "Ctrl+Shift+Y" }]; },
      async reset(name) { this.resetNames.push(name); }
    }
  };
  const context = vm.createContext({
    console,
    chrome,
    navigator: { userAgent: "Mozilla/5.0 Chrome/147.0.0.0 Safari/537.36" },
    setTimeout,
    clearTimeout,
    Promise,
    Proxy,
    WeakMap,
    Object,
    Number,
    String,
    Error
  });
  context.globalThis = context;
  vm.runInContext(source, context, { filename: "browser_compat.js" });

  assert.equal(context.FCI_BROWSER_COMPAT.platform, "chromium");
  assert.equal(context.FCI_BROWSER_COMPAT.emulated, true);
  await context.browser.sessions.setTabValue(91, "session-key", { active: true });
  assert.deepEqual(await context.browser.sessions.getTabValue(91, "session-key"), { active: true });
  await context.browser.sessions.removeTabValue(91, "session-key");
  assert.equal(await context.browser.sessions.getTabValue(91, "session-key"), null);

  await context.browser.sidebarAction.open();
  assert.equal(JSON.stringify(openedPanels), JSON.stringify([{ tabId: 91 }]));
  const commandList = await context.browser.commands.getAll();
  assert.equal(commandList[0].name, "_execute_sidebar_action");
  await context.browser.commands.reset("_execute_sidebar_action");
  assert.equal(chrome.commands.resetNames[0], "fci-open-side-panel");
  await context.browser.commands.openShortcutSettings();
  assert.equal(JSON.stringify(createdTabs), JSON.stringify([{ url: "chrome://extensions/shortcuts" }]));
  const info = await context.browser.runtime.getBrowserInfo();
  assert.equal(info.name, "Chromium");
  assert.equal(info.version, "147.0.0.0");

  let response;
  const listener = async (message) => ({ ok: true, echo: message.value });
  context.browser.runtime.onMessage.addListener(listener);
  assert.equal(onMessage.listeners.size, 1);
  const rawListener = [...onMessage.listeners][0];
  const keepOpen = rawListener({ value: 42 }, {}, (value) => { response = value; });
  assert.equal(keepOpen, true, "Promise responses must keep the Chrome message channel open");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(JSON.stringify(response), JSON.stringify({ ok: true, echo: 42 }));
  context.browser.runtime.onMessage.removeListener(listener);
  assert.equal(onMessage.listeners.size, 0);

  const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));
  assert(Number(manifest.version.split(".")[1]) >= 38, `expected Phase 38+ manifest, got ${manifest.version}`);
  assert.equal(manifest.background.scripts[0], "shared/browser_compat.js");
  const background = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
  assert.match(background, /OPEN_SIDEBAR:\s*"fci-open-side-panel"/);
  assert.match(background, /"shared\/browser_compat\.js",\s*\n\s*"shared\/protocol\.js"/);
  assert.match(background, /files:\s*\["shared\/browser_compat\.js", "shared\/protocol\.js", "content\/prompt_fill\.js"\]/);
  const html = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
  assert.ok(html.indexOf("browser_compat.js") < html.indexOf("sidebar_runtime_guard.js"));
  const worker = fs.readFileSync(path.join(root, "extension/background/chromium_service_worker.js"), "utf8");
  assert.match(worker, /importScripts\(/);
  assert.ok(worker.indexOf("browser_compat.js") < worker.indexOf("protocol.js"));
  assert.ok(worker.indexOf("protocol.js") < worker.indexOf("background.js"));

  console.log("PASS: Phase 38 browser namespace, Promise messaging, side panel and tab-session compatibility");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
