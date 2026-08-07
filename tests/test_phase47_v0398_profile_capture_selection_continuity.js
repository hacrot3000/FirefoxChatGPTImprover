"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sidebar = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
const background = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
const html = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));

function versionAtLeast(actual, minimum) {
  const a = String(actual).split(".").map(Number);
  const b = String(minimum).split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const left = a[i] || 0;
    const right = b[i] || 0;
    if (left !== right) return left > right;
  }
  return true;
}

assert(versionAtLeast(manifest.version, "0.39.8"));
assert(html.includes('id="newProfileButton" type="button">Save current as new</button>'));
assert(html.includes('id="saveProfileButton" type="button" class="primary">Save current values</button>'));
assert(html.includes('id="newLocalActionProfileButton" type="button">Save current as new</button>'));
assert(html.includes('id="saveLocalActionProfileButton" type="button" class="primary">Save current values</button>'));
assert(sidebar.includes("const profileEditorSelectionByTab = new Map();"));
assert(sidebar.includes("const localActionProfileEditorSelectionByTab = new Map();"));
assert(sidebar.includes("async function createProfileFromCurrentForm()"));
assert(sidebar.includes('assertSavedConfig(validation.config, response.savedProfile?.config, "Create profile")'));
assert(
  sidebar.includes("profileEditorSelectionByTab.set(Number(selectedTabId), selectedProfileId)") ||
  sidebar.includes("setTabProfileSelection(profileEditorSelectionByTab, selectedTabId, selectedProfileId)")
);
assert(sidebar.includes('elements.newProfileButton.addEventListener("click", () => void createProfileFromCurrentForm())'));
assert(sidebar.includes("async function createLocalActionProfileFromCurrentForm()"));
assert(sidebar.includes('assertSavedLocalActionConfig(validation.config, response.savedProfile?.config, "Create local-action profile")'));
assert(
  sidebar.includes("localActionProfileEditorSelectionByTab.set(Number(selectedTabId), selectedLocalActionProfileId)") ||
  sidebar.includes("setTabProfileSelection(localActionProfileEditorSelectionByTab, selectedTabId, selectedLocalActionProfileId)")
);
assert(sidebar.includes('elements.newLocalActionProfileButton.addEventListener("click", () => void createLocalActionProfileFromCurrentForm())'));
assert(!sidebar.includes('confirmDiscardLocalActionDraft("creating a new local-action profile")'));
assert(sidebar.includes("function readLocalActionProfileConfig() {\n    return LocalActions.normalizeConfig(readLocalActionConfig());"));
assert(!sidebar.includes("const persistedShell = LocalActions.normalizeConfig(profile?.config"));
assert(sidebar.includes("renderSelectors(selectedTabId);\n    renderDetails(true);"));
const editorPriority = sidebar.indexOf("profileEditorSelectionByTab.get(Number(selectedTabId))");
const editorCheck = sidebar.indexOf("profile.id === editorProfileId", editorPriority);
const sessionPriority = sidebar.indexOf("session?.profileId ||", editorCheck);
assert(editorPriority >= 0 && editorCheck > editorPriority && sessionPriority > editorCheck);
const localEditorPriority = sidebar.indexOf("localActionProfileEditorSelectionByTab.get(Number(selectedTabId))");
const localEditorCheck = sidebar.indexOf("profile.id === editorLocalActionProfileId", localEditorPriority);
const localSessionPriority = sidebar.indexOf("session?.localActionProfileId ||", localEditorCheck);
assert(localEditorPriority >= 0 && localEditorCheck > localEditorPriority && localSessionPriority > localEditorCheck);
assert(background.includes("async function createProfile(name, baseProfileId = null, rawConfig = null)"));
assert(background.includes("Settings.validateConfig(rawConfig || base?.config || Settings.defaultConfig())"));
assert(background.includes("createProfile(message.name, message.baseProfileId, message.config)"));
assert(background.includes("savedProfile: Settings.profileById(result.store, result.profileId)"));
assert(background.includes("async function createLocalActionProfile(name, baseProfileId = null, rawConfig = null)"));
assert(background.includes("LocalActions.validateConfig(rawConfig || base?.config || LocalActions.defaultConfig())"));
assert(background.includes("return { store: saved, profileId: profile.id };"));
assert(background.includes("createLocalActionProfile(message.name, message.baseProfileId, message.config)"));
assert(background.includes("savedProfile: LocalActions.profileById(result.store, result.profileId)"));
console.log("PASS: Phase 47 exact-source profile create/save captures the current form and preserves editor selection without reverting to Default");
