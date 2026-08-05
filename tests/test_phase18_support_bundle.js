"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));
const protocolSource = fs.readFileSync(path.join(root, "extension/shared/protocol.js"), "utf8");
const supportSource = fs.readFileSync(path.join(root, "extension/shared/support_bundle.js"), "utf8");
const backgroundSource = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
const sidebarHtml = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
const sidebarSource = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");

const sandbox = {
  URL,
  TextEncoder,
  Uint8Array,
  Uint32Array,
  DataView,
  Date,
  globalThis: null
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(supportSource, sandbox, { filename: "support_bundle.js" });
const Support = sandbox.FCI_SUPPORT_BUNDLE;
assert(Support && Support.VERSION >= 1);

const sanitized = Support.sanitizeValue({
  url: "https://user:pass@ai.company.local/chat/1?secret=yes#fragment",
  title: "Private chat title",
  sessionToken: "session-secret",
  command: "rm -rf /tmp/example",
  workingDirectory: "/home/private/project",
  nested: { cwd: "/tmp", output: [{ text: "secret shell output" }] },
  safe: "kept"
});
assert.strictEqual(sanitized.url, "https://ai.company.local/chat/1");
assert.strictEqual(sanitized.title, Support.OMITTED);
assert.strictEqual(sanitized.sessionToken, Support.REDACTED);
assert.strictEqual(sanitized.command, Support.REDACTED);
assert.strictEqual(sanitized.workingDirectory, Support.REDACTED);
assert.strictEqual(sanitized.nested.cwd, Support.REDACTED);
assert.strictEqual(sanitized.nested.output, Support.REDACTED);
assert.strictEqual(sanitized.safe, "kept");

const bundle = {
  formatVersion: 1,
  generatedAt: "2026-07-23T00:00:00.000Z",
  extension: { name: "Firefox ChatAI Assistant", version: "0.18.0" },
  environment: {},
  diagnostics: { sessionCount: 1 },
  privacy: { sanitized: true },
  settings: { schemaVersion: 13 },
  sessions: [{ tabId: 7, mode: "active" }],
  nativeHost: { connected: false },
  logs: { "tab-7-user.json": [{ event: "activated" }] }
};
const entries = Support.bundleEntries(bundle);
assert.deepStrictEqual(
  Array.from(entries, (entry) => entry.name),
  ["metadata.json", "settings.json", "sessions.json", "native-host.json", "logs/tab-7-user.json"]
);
const zip = Support.buildZip(entries, new Date("2026-07-23T00:00:00Z"));
assert(zip instanceof Uint8Array);
assert.strictEqual(new DataView(zip.buffer, zip.byteOffset, zip.byteLength).getUint32(0, true), 0x04034b50);
assert(Buffer.from(zip).includes(Buffer.from("metadata.json")));
assert(Buffer.from(zip).includes(Buffer.from("logs/tab-7-user.json")));
assert.strictEqual(new DataView(zip.buffer, zip.byteOffset + zip.byteLength - 22, 22).getUint32(0, true), 0x06054b50);

const version = manifest.version.split(".").map(Number);
assert(version[0] > 0 || version[1] >= 18, `Phase 18 requires version >= 0.18.0, got ${manifest.version}`);
assert(manifest.background.scripts.includes("shared/support_bundle.js"));
assert(protocolSource.includes("EXPORT_SUPPORT_BUNDLE"));
assert(backgroundSource.includes("async function buildSupportBundle()"));
assert(backgroundSource.includes("URL query strings and fragments"));
assert(!backgroundSource.includes("logs[`tab-${session.tabId}-shell-output"));
assert(sidebarHtml.includes('id="exportSupportBundleButton"'));
assert(sidebarHtml.includes('src="../shared/support_bundle.js"'));
assert(sidebarSource.includes("SupportBundle.buildZip"));
assert(sidebarSource.includes("firefox-chat-assistant-support-"));
assert(manifest.permissions.includes("downloads"));

console.log("PASS: Phase 18 sanitized support-bundle payload, local ZIP writer and sidebar/background export contract");
