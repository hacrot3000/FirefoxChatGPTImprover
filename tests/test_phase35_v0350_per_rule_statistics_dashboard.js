#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));
assert.ok(Number(manifest.version.split(".")[1]) >= 35, "per-rule statistics must remain available after v0.35.0");
const context = vm.createContext({ console }); context.globalThis = context;
vm.runInContext(fs.readFileSync(path.join(root, "extension/shared/protocol.js"), "utf8"), context);
assert.ok(context.FCI_PROTOCOL.VERSION >= 24);
assert.equal(context.FCI_PROTOCOL.MESSAGE.RESET_RULE_STATISTICS, "FCI_RESET_RULE_STATISTICS");
const background = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
for (const pattern of [
  /RULE_STATISTICS_SCHEMA = 1/,
  /function updateRuleStatistics\(/,
  /monitorState === MONITOR_STATE\.MATCHED/,
  /statistics\.clickCount \+= clickDelta/,
  /verifyPassCount/,
  /returnCodeCounts/,
  /recordRuleCommandStatistics\(session, run, event\)/,
  /case MESSAGE\.RESET_RULE_STATISTICS/,
  /delete publicValue\.ruleStatisticsObserver/
]) assert.match(background, pattern);
const html = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
for (const id of ["statisticsRuleCount", "statisticsMatchCount", "statisticsClickCount", "statisticsVerifyCount", "statisticsCommandCount", "ruleStatisticsRows", "selectedRuleStatistics", "exportRuleStatisticsButton", "resetRuleStatisticsButton"]) assert(html.includes(`id="${id}"`), id);
assert(html.includes('data-group-id="rule-statistics"'));
const sidebar = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
for (const pattern of [/function renderRuleStatistics\(/, /average MATCHED→target/, /firefox-chat-improver-rule-statistics/, /MESSAGE\.RESET_RULE_STATISTICS/]) assert.match(sidebar, pattern);
const css = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.css"), "utf8");
assert.match(css, /\.rule-statistics-row/);
console.log("PASS: Phase 35 per-rule session statistics, timing diagnostics, return-code counts, reset and JSON export");
