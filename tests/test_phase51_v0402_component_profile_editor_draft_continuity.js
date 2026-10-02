"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));
const html = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
const sidebar = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");

const version = manifest.version.split(".").map(Number);
assert(version[0] > 0 || version[1] > 40 || (version[1] === 40 && version[2] >= 2), "Phase 51 requires add-on version 0.40.2 or newer");

for (const id of [
  "newRuleListProfileButton", "saveRuleListProfileButton",
  "newMonitorProfileButton", "saveMonitorProfileButton",
  "newTargetProfileButton", "saveTargetProfileButton",
  "newAlertProfileButton", "saveAlertProfileButton"
]) assert(html.includes(`id="${id}"`), `missing independent component profile action: ${id}`);

assert(sidebar.includes("function componentEditorSpec(type)"));
assert(sidebar.includes("async function createComponentProfileFromEditor(type)"));
assert(sidebar.includes("async function saveSelectedComponentProfile(type)"));
assert(sidebar.includes("async function deleteSelectedComponentProfile(type)"));
assert(sidebar.includes("function componentEditorDirty(type)"));
assert(sidebar.includes('const preserveComponentDraft = ["rule-list", "monitor", "target", "alerts"].includes(type);'));
assert(sidebar.includes("{ reloadForm: !preserveComponentDraft }"));
assert(sidebar.includes("The current rule draft was preserved.") || sidebar.includes("The current rule draft was preserved"));
assert(!sidebar.includes("function applyComponentProfileToRule(type)"));
assert(!sidebar.includes("function createComponentProfileFromRule(type)"));

const formReloadBlock = sidebar.slice(
  sidebar.indexOf("const FORM_RELOAD_MESSAGE_TYPES"),
  sidebar.indexOf("let passiveRefreshTimer")
);
assert(!formReloadBlock.includes("MESSAGE.CREATE_COMPONENT_PROFILE"));
assert(!formReloadBlock.includes("MESSAGE.SAVE_COMPONENT_PROFILE"));
assert(!formReloadBlock.includes("MESSAGE.DELETE_COMPONENT_PROFILE"));

const createStart = sidebar.indexOf("async function createComponentProfileFromEditor(type)");
const saveStart = sidebar.indexOf("async function saveSelectedComponentProfile(type)");
const defaultStart = sidebar.indexOf("async function setSelectedComponentProfileAsDefault(type)");
const deleteStart = sidebar.indexOf("async function deleteSelectedComponentProfile(type)");
assert(createStart > 0 && saveStart > createStart && defaultStart > saveStart && deleteStart > defaultStart);
const createBody = sidebar.slice(createStart, saveStart);
const saveBody = sidebar.slice(saveStart, defaultStart);
assert(createBody.includes("reloadForm: false"));
assert(saveBody.includes("reloadForm: false"));
assert(createBody.includes("spec.readValue()"));
assert(saveBody.includes("[spec.valueKey]: spec.readValue()"));
assert(saveBody.includes("renderComponentProfileOptions()"));

console.log("PASS: Phase 51 component-profile editor operations preserve drafts while Rule-list/Monitor/Target/Alert libraries remain independent.");
