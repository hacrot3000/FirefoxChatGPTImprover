#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));
const versionParts = manifest.version.split(".").map(Number);
assert(versionParts.length === 3 && versionParts.every(Number.isInteger));
assert(versionParts[0] > 0 || versionParts[1] > 22 || (versionParts[1] === 22 && versionParts[2] >= 0));
const protocol = fs.readFileSync(path.join(root, "extension/shared/protocol.js"), "utf8");
const protocolVersion = Number(/VERSION:\s*(\d+)/.exec(protocol)?.[1] || 0);
assert(protocolVersion >= 13);
assert(protocol.includes('READ_SHELL_LOG: "FCI_READ_SHELL_LOG"'));
assert(protocol.includes('DELETE_SHELL_LOG: "FCI_DELETE_SHELL_LOG"'));
const html = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
for (const id of ["runShellQuickButton", "stopShellQuickButton", "openShellLogQuickButton", "openShellLogButton", "shellLogDialog", "shellLogViewer", "copyShellLogSelectionButton", "copyShellLogPageButton", "copyShellLogAllButton"]) {
  assert(html.includes(`id="${id}"`), `missing ${id}`);
}
const shellSectionStart = html.indexOf('<section class="card" data-group-id="shell"');
const shellSectionEnd = html.indexOf('</section>', shellSectionStart);
const shellSection = html.slice(shellSectionStart, shellSectionEnd);
const headingStart = shellSection.indexOf('<div class="section-title-row">');
const actionsStart = shellSection.indexOf('<div class="group-heading-actions"');
assert(headingStart >= 0 && actionsStart > headingStart);
assert(shellSection.indexOf('<h2 id="shellHeading">Shell command</h2>', headingStart) < actionsStart);
assert(!shellSection.includes('class="shell-heading-title"'));
const actionsEnd = shellSection.indexOf('</div>', actionsStart);
const shellHeader = shellSection.slice(actionsStart, actionsEnd + 6);
assert(shellHeader.indexOf('id="nativeHostStatus"') < shellHeader.indexOf('id="runShellQuickButton"'));
assert(shellHeader.indexOf('id="runShellQuickButton"') < shellHeader.indexOf('class="help-menu heading-help-menu"'));
assert(shellHeader.indexOf('id="openShellLogQuickButton"') < shellHeader.indexOf('class="help-menu heading-help-menu"'));
const sidebar = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
for (const token of ["selectedShellLogDescriptor", "loadShellLogPage", "copyAllShellLog", "autoOpenedShellRunIds", "READ_SHELL_LOG", "DELETE_SHELL_LOG"]) assert(sidebar.includes(token));
const background = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
for (const token of ["nativeRequest", "pendingNativeRequests", "readShellLog", "deleteShellLog", "ownedShellLog", "SHELL_LOG_READ_MAX_BYTES"]) assert(background.includes(token));
const native = fs.readFileSync(path.join(root, "native-host/native_host.py"), "utf8");
for (const token of ["HOST_VERSION = \"0.9.0\"", "read_log_chunk", "delete_log_file", "dataBase64", "_append_log"]) assert(native.includes(token));
console.log("PASS: Phase 22 file-backed full shell logs, paged viewer, copy controls and collapsed header actions");
