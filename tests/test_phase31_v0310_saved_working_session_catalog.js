#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const sandbox = { console, Date, JSON, Math, URL, Uint32Array, crypto: crypto.webcrypto, globalThis: null };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const file of [
  "extension/shared/settings.js",
  "extension/shared/local_actions.js",
  "extension/shared/working_session.js"
]) {
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), sandbox);
}

const Settings = sandbox.FCI_SETTINGS;
const LocalActions = sandbox.FCI_LOCAL_ACTIONS;
const Working = sandbox.FCI_WORKING_SESSION;
assert.equal(Working.VERSION, 4);
assert.equal(Working.CATALOG_VERSION, 1);
assert.equal(Working.CATALOG_STORAGE_KEY, "firefoxChatImprover.workingSessionCatalog.v1");

function bundle(url, title) {
  const config = Settings.defaultConfig();
  const profile = Settings.createProfile(`${title} profile`, config, `profile-${title.toLowerCase().replace(/\W+/g, "-")}`);
  const local = LocalActions.createProfile(`${title} local`, LocalActions.defaultConfig(), `local-${title.toLowerCase().replace(/\W+/g, "-")}`);
  return Working.build([{
    url,
    title,
    customTitle: title,
    pageTitle: `${title} page`,
    addOnActive: true,
    mode: "active",
    profileId: profile.id,
    profile,
    effectiveConfig: config,
    localActionProfileId: local.id,
    localActionProfile: local,
    effectiveLocalActions: local.config
  }], { extensionVersion: "0.31.0" });
}

const naruto = Working.createCatalogEntry("Naruto server", bundle("https://chatgpt.com/c/naruto", "Naruto"), { description: "Server Docker work" });
let catalog = Working.upsertCatalogEntry(Working.defaultCatalog(), naruto);
assert.equal(catalog.entries.length, 1);
assert.equal(Working.catalogSummary(catalog).entries[0].tabCount, 1);
assert.equal(Working.catalogSummary(catalog).entries[0].tabs[0].customTitle, "Naruto");

const duplicate = Working.duplicateCatalogEntry(catalog, naruto.id, "Naruto copy");
catalog = duplicate.catalog;
assert.equal(catalog.entries.length, 2);
assert.notEqual(duplicate.entry.id, naruto.id);
assert.equal(duplicate.entry.name, "Naruto copy");

catalog = Working.removeCatalogEntry(catalog, duplicate.entry.id);
assert.equal(catalog.entries.length, 1);
assert.equal(Working.catalogEntryById(catalog, naruto.id).description, "Server Docker work");

const exported = Working.stringifyCatalog(catalog);
assert.equal(Working.parseCatalog(exported).entries[0].name, "Naruto server");
assert.throws(() => Working.parseCatalog('{"format":"wrong","version":1,"entries":[]}'));

const importedCollision = Working.normalizeCatalog({
  entries: [Working.createCatalogEntry("Different session", bundle("https://chatgpt.com/c/ble", "BLE"), { id: naruto.id })]
});
const merged = Working.mergeCatalog(catalog, importedCollision);
assert.equal(merged.report.created, 1);
assert.equal(merged.report.renamed, 1);
assert.equal(merged.catalog.entries.length, 2);
assert(merged.catalog.entries.some((entry) => entry.name.includes("(imported)")));

const legacy = bundle("https://chatgpt.com/c/legacy", "Legacy");
legacy.version = 3;
assert.equal(Working.normalize(legacy).version, 4);

const protocol = fs.readFileSync(path.join(root, "extension/shared/protocol.js"), "utf8");
for (const name of [
  "SAVE_WORKING_SESSION_ENTRY", "RENAME_WORKING_SESSION_ENTRY", "DUPLICATE_WORKING_SESSION_ENTRY",
  "DELETE_WORKING_SESSION_ENTRY", "RESTORE_WORKING_SESSION_ENTRY", "EXPORT_WORKING_SESSION_ENTRY",
  "IMPORT_WORKING_SESSION_ENTRY", "EXPORT_WORKING_SESSION_CATALOG", "IMPORT_WORKING_SESSION_CATALOG"
]) assert(protocol.includes(name), `Missing protocol message ${name}`);

const background = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
for (const token of [
  "loadWorkingSessionCatalog", "saveWorkingSessionEntry", "restoreWorkingSessionEntry",
  "before_working_session_import", "workingSessionCatalog: WorkingSession.catalogSummary"
]) assert(background.includes(token), `Missing background token ${token}`);

const html = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
for (const id of [
  "workingSessionCatalogSearch", "workingSessionCatalogSelect", "newWorkingSessionEntryButton",
  "updateWorkingSessionEntryButton", "restoreWorkingSessionEntryButton", "exportWorkingSessionCatalogButton",
  "importWorkingSessionCatalogButton"
]) assert(html.includes(`id="${id}"`), `Missing sidebar control ${id}`);

const sidebar = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
for (const token of [
  "renderWorkingSessionCatalog", "openCatalogRestoreDialog", "catalog-create", "catalog-update",
  "catalog-restore", "selected; outside filter"
]) assert(sidebar.includes(token), `Missing sidebar token ${token}`);

const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));
assert.equal(manifest.version, "0.31.0");
console.log("PASS: Phase 31 v0.31.0 named saved working-session catalog, controlled restore and typed JSON import/export");
