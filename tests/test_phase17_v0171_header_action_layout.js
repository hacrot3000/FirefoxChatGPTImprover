#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
const css = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.css"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));

function sectionByGroupId(groupId) {
  const startToken = `<section class="card" data-group-id="${groupId}"`;
  const start = html.indexOf(startToken);
  assert(start >= 0, `missing section ${groupId}`);
  const end = html.indexOf("</section>", start);
  assert(end > start, `unterminated section ${groupId}`);
  return html.slice(start, end + "</section>".length);
}

function assertHeadingActionOrder(section, actionIds, helpLabel) {
  const headingStart = section.indexOf('<div class="section-title-row">');
  const headingEnd = section.indexOf("</div>\n      </div>", headingStart);
  assert(headingStart >= 0 && headingEnd > headingStart, "missing heading row");
  const heading = section.slice(headingStart, headingEnd + 14);
  assert(heading.includes('class="group-heading-actions"'));
  assert(heading.includes('class="help-menu heading-help-menu"'));
  let previous = -1;
  for (const id of actionIds) {
    const index = heading.indexOf(`id="${id}"`);
    assert(index > previous, `${id} must appear in the shared heading action group`);
    previous = index;
  }
  const helpIndex = heading.indexOf(`aria-label="${helpLabel}"`);
  assert(helpIndex > previous, "Help must be the rightmost heading action");
}

const tabs = sectionByGroupId("tabs");
assertHeadingActionOrder(
  tabs,
  ["tabPrimaryQuickButton", "tabStopQuickButton", "refreshButton"],
  "Tabs and sessions help"
);
assert.equal((tabs.match(/Tabs and sessions help/g) || []).length, 1);

const target = sectionByGroupId("target");
assertHeadingActionOrder(
  target,
  ["targetClickQuickButton"],
  "New target element help"
);
assert.equal((target.match(/New target element help/g) || []).length, 1);

assert(!html.includes("help-menu-tab"));
assert(css.includes(".group-heading-actions > .heading-help-menu"));
assert(css.includes("order: 999"));
assert(css.includes("margin-left: auto"));
assert(css.includes("top: calc(100% + 4px)"));

const parts = manifest.version.split(".").map(Number);
assert(parts[0] > 0 || parts[1] > 17 || (parts[1] === 17 && parts[2] >= 1));

console.log("PASS: Phase 17 v0.17.1 shared header action groups keep Help rightmost without overlap");
