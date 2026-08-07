"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));
const background = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
const sidebar = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");

function versionAtLeast(actual, minimum) {
  const a = String(actual).split(".").map(Number);
  const b = String(minimum).split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff) return diff > 0;
  }
  return true;
}
assert(versionAtLeast(manifest.version, "0.40.3"));
assert(background.includes("function uniqueImportedProfileName(existingProfiles, requestedName)"));
assert(background.includes("function mergeImportedProfilesSafely(existing, incoming, operations)"));
assert(background.includes("collisionCopies"));
assert(background.includes("Do not adopt the bundle's default profile and do not refresh active sessions."));
assert(!background.includes("function upsertProfiles(existing, incoming, normalize)"));

const exportStart = background.indexOf("async function exportProfileBundle(type)");
const exportEnd = background.indexOf("async function importProfileBundle(type, text)", exportStart);
assert(exportStart > 0 && exportEnd > exportStart);
const exportBody = background.slice(exportStart, exportEnd);
assert(
  exportBody.includes("defaultProfileId: store.defaultProfileId"),
  "profile export must retain defaultProfileId as bundle metadata"
);

const importStart = background.indexOf("async function importProfileBundle(type, text)");
const importEnd = background.indexOf("async function createProfile(name", importStart);
assert(importStart > 0 && importEnd > importStart);
const importBody = background.slice(importStart, importEnd);
assert(!importBody.includes("bundle.defaultProfileId"), "typed profile import must preserve the local default");
assert(!importBody.includes("refreshSessionsForStore"), "typed profile import must not mutate running Automation sessions");
assert(importBody.includes("Imported profile data must not erase per-tab working drafts or frozen download/shell values."));
assert(importBody.includes("existing profile IDs and running tabs."));
assert(sidebar.includes("Existing profiles, defaults and running tabs were unchanged."));
assert(sidebar.includes("identical skipped"));
assert(sidebar.includes("imported as copies"));

const helperStart = background.indexOf("  function uniqueImportedProfileName");
const helperEnd = background.indexOf("  async function exportProfileBundle", helperStart);
assert(helperStart > 0 && helperEnd > helperStart);
const helperSource = background.slice(helperStart, helperEnd);
const helpers = new Function("Settings", `${helperSource}\nreturn { uniqueImportedProfileName, mergeImportedProfilesSafely };`)({
  clone(value) { return JSON.parse(JSON.stringify(value)); }
});

let generated = 0;
const operations = {
  normalize(profile) { return JSON.parse(JSON.stringify(profile)); },
  fingerprint(profile) { return JSON.stringify(profile.config); },
  makeId() { generated += 1; return `generated-${generated}`; },
  create(profile, id, name) { return { id, name, config: JSON.parse(JSON.stringify(profile.config)) }; }
};
const existing = [
  { id: "p1", name: "Existing", config: { value: 1 } },
  { id: "p2", name: "Equivalent", config: { value: 2 } },
  { id: "p3", name: "Name clash", config: { value: 3 } }
];
const incoming = [
  { id: "p1", name: "Existing", config: { value: 1 } },
  { id: "foreign-equivalent", name: "Equivalent", config: { value: 2 } },
  { id: "p1", name: "Existing", config: { value: 9 } },
  { id: "p4", name: "Name clash", config: { value: 4 } },
  { id: "p5", name: "Unique", config: { value: 5 } }
];
const merged = helpers.mergeImportedProfilesSafely(existing, incoming, operations);
assert.deepEqual(existing, [
  { id: "p1", name: "Existing", config: { value: 1 } },
  { id: "p2", name: "Equivalent", config: { value: 2 } },
  { id: "p3", name: "Name clash", config: { value: 3 } }
], "the existing collection must not be mutated");
assert.equal(merged.created, 3);
assert.equal(merged.updated, 0);
assert.equal(merged.skipped, 2);
assert.equal(merged.collisionCopies, 1);
assert.equal(merged.renamed, 2);
assert.equal(merged.profiles.length, 6);
assert(merged.profiles.some((profile) => profile.id === "generated-1" && profile.name === "Existing (imported)" && profile.config.value === 9));
assert(merged.profiles.some((profile) => profile.id === "p4" && profile.name === "Name clash (imported)" && profile.config.value === 4));
assert(merged.profiles.some((profile) => profile.id === "p5" && profile.name === "Unique"));
assert.equal(merged.profiles.find((profile) => profile.id === "p1").config.value, 1, "the colliding local profile must remain unchanged");

console.log("PASS: Phase 52 profile-bundle imports preserve existing profiles/defaults/running tabs and add conflict-safe copies.");
