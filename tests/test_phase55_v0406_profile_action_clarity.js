"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
const sidebar = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
const background = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));

function versionAtLeast(actual, minimum) {
  const a = String(actual).split(".").map(Number);
  const b = String(minimum).split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff) return diff > 0;
  }
  return true;
}

assert(versionAtLeast(manifest.version, "0.40.6"));
for (const label of ["Save as new profile", "Save changes", "Make default", "Delete profile"]) assert(html.includes(label));
assert(html.includes("Assign selected to tab"));
assert(html.includes("Apply selected to rule"));
assert(html.includes("Clear tab assignment"));
assert(html.includes("Remove tab override"));
assert(!html.includes('id="duplicateProfileButton"'));
assert(!sidebar.includes("duplicateProfileButton"));
assert(!sidebar.includes("async function duplicateSelectedProfile"));
assert(background.includes("function manualProfileName(collection, rawName, excludeId, label, fallbackName)"));
assert(background.includes('`${label} profile “${name}” already exists. Choose a different name.`'));
assert(background.includes('manualProfileName(store.profiles, name, null, "Automation", "New profile")'));
assert(background.includes('manualProfileName(store.profiles, name, null, "Local action", "New local actions")'));
assert(background.includes('profile.name = manualProfileName(collection, profile.name, profile.id, label, collection[index].name)'));
assert(background.includes('incoming.name = manualProfileName(store.profiles, incoming.name, incoming.id, "Automation", store.profiles[index].name)'));
assert((background.match(/manualProfileName[(]/g) || []).length >= 7);
console.log("PASS: Phase 55 removes redundant profile duplication, clarifies profile actions and rejects ambiguous duplicate names");
