"use strict";
const fs = require("fs");
const assert = require("assert");
const manifest = JSON.parse(fs.readFileSync("extension/manifest.json", "utf8"));
const protocol = fs.readFileSync("extension/shared/protocol.js", "utf8");
const background = fs.readFileSync("extension/background/background.js", "utf8");
const sidebar = fs.readFileSync("extension/sidebar/sidebar.js", "utf8");
assert(Number(manifest.version.split('.')[1]) >= 6, `Phase 06 contract requires version >=0.6.0, got ${manifest.version}`);
assert(manifest.permissions.includes("nativeMessaging"));
for (const token of ["GET_NATIVE_STATUS", "RUN_SHELL", "STOP_SHELL", "CLEAR_SHELL_OUTPUT"]) {
  assert(protocol.includes(token), `missing protocol token ${token}`);
}
assert(background.includes("Content scripts are not allowed to control Native Messaging"));
assert(background.includes("browser.runtime.connectNative(NATIVE_HOST_NAME)"));
assert(sidebar.includes("commandConfirmation"));
assert(sidebar.includes("MESSAGE.RUN_SHELL"));
console.log("PASS: Phase 06 extension/native messaging contract");
