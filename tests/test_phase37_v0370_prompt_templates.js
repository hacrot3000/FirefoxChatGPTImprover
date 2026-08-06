#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

function storageMock() {
  const data = {};
  return {
    data,
    local: {
      async get(key) { return { [key]: data[key] }; },
      async set(values) { Object.assign(data, values); }
    }
  };
}

(async () => {
  const storage = storageMock();
  const context = vm.createContext({
    console,
    Date,
    Math,
    crypto: { randomUUID: () => "00000000-0000-4000-8000-000000000001" },
    browser: { storage }
  });
  context.globalThis = context;
  vm.runInContext(read("extension/shared/prompt_templates.js"), context, { filename: "prompt_templates.js" });
  const Templates = context.FCI_PROMPT_TEMPLATES;
  assert.equal(Templates.VERSION, 1);
  assert.equal(Templates.BUILTIN_TEMPLATES.length, 2);
  assert.match(Templates.BUILTIN_TEMPLATES[0].prompt, /CONTEXT ESTIMATE: 20–30% remaining/);
  assert.match(Templates.BUILTIN_TEMPLATES[0].prompt, /xuống dưới 10%/);
  assert.match(Templates.BUILTIN_TEMPLATES[1].prompt, /Hãy tạo ZIP handoff cần đầy đủ thông tin/);

  let result = await Templates.upsertCustom(context.browser, { name: "My prompt", prompt: "Custom text" });
  assert.equal(result.library.customCount, 1);
  assert.equal(result.library.templates.length, 3);
  assert.equal(result.template.source, "custom");
  assert.equal(result.template.editable, true);
  result = await Templates.upsertCustom(context.browser, { id: result.template.id, name: "Updated", prompt: "Updated text" });
  assert.equal(result.library.customCount, 1);
  assert.equal(result.template.name, "Updated");
  const deleted = await Templates.deleteCustom(context.browser, result.template.id);
  assert.equal(deleted.library.customCount, 0);
  await assert.rejects(() => Templates.deleteCustom(context.browser, "builtin-create-complete-handoff"), /cannot be deleted/);

  const manifest = JSON.parse(read("extension/manifest.json"));
  assert.equal(manifest.version, "0.37.0");
  assert(manifest.background.scripts.includes("shared/prompt_templates.js"));
  const protocolContext = vm.createContext({});
  protocolContext.globalThis = protocolContext;
  vm.runInContext(read("extension/shared/protocol.js"), protocolContext);
  assert.equal(protocolContext.FCI_PROTOCOL.VERSION, 25);
  for (const message of ["SAVE_PROMPT_TEMPLATE", "DELETE_PROMPT_TEMPLATE", "FILL_PROMPT_TEMPLATE", "CONTENT_FILL_PROMPT"]) {
    assert(protocolContext.FCI_PROTOCOL.MESSAGE[message], message);
  }

  const html = read("extension/sidebar/sidebar.html");
  for (const id of ["promptTemplateSelect", "promptTemplateName", "promptTemplateText", "fillPromptTemplateButton", "copyPromptTemplateButton", "newPromptTemplateButton", "savePromptTemplateButton", "deletePromptTemplateButton", "promptTemplateStatus"]) {
    assert(html.includes(`id="${id}"`), id);
  }
  assert(html.includes('data-group-id="prompt-templates"'));
  assert(html.includes('src="../shared/prompt_templates.js"'));

  const background = read("extension/background/background.js");
  for (const marker of [
    "PromptTemplates.upsertCustom",
    "promptTemplates,",
    "PromptTemplates.deleteCustom",
    "content/prompt_fill.js",
    "MESSAGE.CONTENT_FILL_PROMPT",
    "case MESSAGE.SAVE_PROMPT_TEMPLATE",
    "case MESSAGE.DELETE_PROMPT_TEMPLATE",
    "case MESSAGE.FILL_PROMPT_TEMPLATE",
    "Prompt filling is allowed only in the currently displayed tab"
  ]) assert(background.includes(marker), marker);

  const sidebar = read("extension/sidebar/sidebar.js");
  for (const marker of [
    "function renderPromptTemplates(",
    "async function saveCurrentPromptTemplate(",
    "async function fillCurrentPromptTemplate(",
    "navigator.clipboard.writeText(text)",
    "MESSAGE.FILL_PROMPT_TEMPLATE"
  ]) assert(sidebar.includes(marker), marker);

  // Execute the page helper against a tiny DOM model to verify that the last
  // visible writable candidate is selected and framework-facing events fire.
  class FakeHTMLElement {
    constructor(tagName = "div") {
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.shadowRoot = null;
      this.attributes = new Map();
      this.isConnected = true;
      this.hidden = false;
      this.events = [];
      this.focused = false;
      this.textContent = "";
      this.id = "";
    }
    getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getClientRects() { return this.hidden ? [] : [{}]; }
    focus() { this.focused = true; }
    dispatchEvent(event) { this.events.push(event.type); return true; }
    scrollIntoView() {}
  }
  class FakeInput extends FakeHTMLElement {
    constructor(type = "text") { super("input"); this.type = type; this.disabled = false; this.readOnly = false; this._value = ""; }
    get value() { return this._value; }
    set value(next) { this._value = String(next); }
    setSelectionRange(start, end) { this.selection = [start, end]; }
  }
  class FakeTextarea extends FakeHTMLElement {
    constructor() { super("textarea"); this.disabled = false; this.readOnly = false; this._value = ""; }
    get value() { return this._value; }
    set value(next) { this._value = String(next); }
    setSelectionRange(start, end) { this.selection = [start, end]; }
  }
  class FakeEvent { constructor(type) { this.type = type; } }
  class FakeInputEvent extends FakeEvent {}
  const first = new FakeTextarea();
  const hidden = new FakeInput("text"); hidden.hidden = true;
  const last = new FakeInput("search");
  const documentElement = new FakeHTMLElement("html");
  documentElement.children.push(first, hidden, last);
  let contentListener = null;
  const contentContext = vm.createContext({
    console,
    HTMLElement: FakeHTMLElement,
    HTMLInputElement: FakeInput,
    HTMLTextAreaElement: FakeTextarea,
    Event: FakeEvent,
    InputEvent: FakeInputEvent,
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    document: { documentElement, createRange: null },
    browser: { runtime: { onMessage: { addListener(listener) { contentListener = listener; } } } },
    FCI_PROTOCOL: { MESSAGE: { CONTENT_FILL_PROMPT: "FCI_CONTENT_FILL_PROMPT" } }
  });
  contentContext.globalThis = contentContext;
  vm.runInContext(read("extension/content/prompt_fill.js"), contentContext, { filename: "prompt_fill.js" });
  const fillResult = contentContext.FCI_PROMPT_FILL.fillLastPromptInput("filled prompt");
  assert.equal(fillResult.candidateCount, 2);
  assert.equal(fillResult.inputType, "search");
  assert.equal(first.value, "");
  assert.equal(last.value, "filled prompt");
  assert.deepEqual(last.events, ["input", "change"]);
  assert.equal(last.focused, true);
  assert.equal(typeof contentListener, "function");

  const content = read("extension/content/prompt_fill.js");
  for (const marker of [
    "function collectCandidates(",
    "candidates.at(-1)",
    "HTMLTextAreaElement.prototype",
    "HTMLInputElement.prototype",
    "new InputEvent(\"input\"",
    "new Event(\"change\"",
    "MESSAGE.CONTENT_FILL_PROMPT"
  ]) assert(content.includes(marker), marker);

  console.log("PASS: Phase 37 built-in/custom prompt templates, clipboard copy and active-tab last-input filling");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
