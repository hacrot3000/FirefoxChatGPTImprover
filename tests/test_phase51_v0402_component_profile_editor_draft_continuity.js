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
assert(html.includes('id="newMonitorProfileButton" type="button">Save as new profile</button>'));
assert(html.includes('id="saveMonitorProfileButton" type="button">Save changes</button>'));
assert(html.includes('id="newTargetProfileButton" type="button">Save as new profile</button>'));
assert(html.includes('id="saveTargetProfileButton" type="button">Save changes</button>'));

assert(sidebar.includes("function captureComponentProfileEditorDraft()"));
assert(sidebar.includes("function restoreComponentProfileEditorDraft(snapshot)"));
assert(sidebar.includes('}, "", { reloadForm: false });'));
assert(sidebar.includes("const preserveComponentDraft = type === \"monitor\" || type === \"target\";"));
assert(sidebar.includes("{ reloadForm: !preserveComponentDraft }"));
assert(sidebar.includes("the current rule draft was preserved"));

const formReloadBlock = sidebar.slice(
  sidebar.indexOf("const FORM_RELOAD_MESSAGE_TYPES"),
  sidebar.indexOf("let passiveRefreshTimer")
);
assert(!formReloadBlock.includes("MESSAGE.CREATE_COMPONENT_PROFILE"));
assert(!formReloadBlock.includes("MESSAGE.SAVE_COMPONENT_PROFILE"));
assert(!formReloadBlock.includes("MESSAGE.DELETE_COMPONENT_PROFILE"));

const createStart = sidebar.indexOf("async function createComponentProfileFromRule(type)");
const saveStart = sidebar.indexOf("async function saveSelectedComponentProfile(type)");
const deleteStart = sidebar.indexOf("async function deleteSelectedComponentProfile(type)");
const customTitleStart = sidebar.indexOf("async function saveCustomTabTitle(title)");
assert(createStart > 0 && saveStart > createStart && deleteStart > saveStart && customTitleStart > deleteStart);
const createBody = sidebar.slice(createStart, saveStart);
const saveBody = sidebar.slice(saveStart, deleteStart);
const deleteBody = sidebar.slice(deleteStart, customTitleStart);
for (const [label, body] of [["create", createBody], ["save", saveBody], ["delete", deleteBody]]) {
  assert(body.includes("captureComponentProfileEditorDraft()"), `${label} must capture the Automation draft`);
  assert(body.includes("restoreComponentProfileEditorDraft(editorDraft)"), `${label} must restore the Automation draft`);
  assert(body.includes("reloadForm: false"), `${label} must not reload the Automation form`);
}
assert(createBody.includes("response.savedProfile.name"));
assert(saveBody.includes("renderComponentProfileOptions()"));
assert(deleteBody.includes("await persistSidebarUi()"));

console.log("PASS: Phase 51 component-profile library operations preserve the current Automation rule draft and keep the created/saved selection.");
