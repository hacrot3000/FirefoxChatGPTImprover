(() => {
  "use strict";

  const { MESSAGE, MODE, CONFIG_MODE } = globalThis.FCI_PROTOCOL;
  const Settings = globalThis.FCI_SETTINGS;
  const SIDEBAR_UI_STORAGE_KEY = "firefoxChatImprover.sidebarUi.v1";
  const $ = (selector) => document.querySelector(selector);
  const elements = {
    body: document.body,
    statusPill: $("#statusPill"), tabSelect: $("#tabSelect"), tabId: $("#tabId"),
    modeText: $("#modeText"), configModeText: $("#configModeText"), profileText: $("#profileText"), tabUrl: $("#tabUrl"),
    monitorStateText: $("#monitorStateText"), monitorCountText: $("#monitorCountText"), monitorMatchedText: $("#monitorMatchedText"), monitorCycleText: $("#monitorCycleText"), ruleCountText: $("#ruleCountText"), matchedRuleCountText: $("#matchedRuleCountText"), monitorTransitionText: $("#monitorTransitionText"), alertStateText: $("#alertStateText"), targetStateText: $("#targetStateText"), baselineCountText: $("#baselineCountText"), candidateCountText: $("#candidateCountText"), targetActionCountText: $("#targetActionCountText"), lastTargetActionText: $("#lastTargetActionText"),
    activateButton: $("#activateButton"), pauseButton: $("#pauseButton"), resumeButton: $("#resumeButton"), stopButton: $("#stopButton"), refreshButton: $("#refreshButton"), tabPrimaryQuickButton: $("#tabPrimaryQuickButton"), tabStopQuickButton: $("#tabStopQuickButton"),
    profileSelect: $("#profileSelect"), profileName: $("#profileName"), assignProfileButton: $("#assignProfileButton"), newProfileButton: $("#newProfileButton"), duplicateProfileButton: $("#duplicateProfileButton"), deleteProfileButton: $("#deleteProfileButton"),
    ruleSelect: $("#ruleSelect"), ruleName: $("#ruleName"), ruleEnabled: $("#ruleEnabled"), newRuleButton: $("#newRuleButton"), duplicateRuleButton: $("#duplicateRuleButton"), deleteRuleButton: $("#deleteRuleButton"), ruleRuntimeSummary: $("#ruleRuntimeSummary"), ruleRuntimeBadge: $("#ruleRuntimeBadge"),
    autoProfileByUrl: $("#autoProfileByUrl"), routingEnabled: $("#routingEnabled"), routingPriority: $("#routingPriority"), requireUrlMatch: $("#requireUrlMatch"), urlPatterns: $("#urlPatterns"), testUrlRoutingButton: $("#testUrlRoutingButton"), useRoutedProfileButton: $("#useRoutedProfileButton"), urlRoutingResult: $("#urlRoutingResult"),
    monitorTag: $("#monitorTag"), monitorKind: $("#monitorKind"), monitorAttributeName: $("#monitorAttributeName"), monitorValue: $("#monitorValue"), monitorVisibilityTransition: $("#monitorVisibilityTransition"), matchStableMs: $("#matchStableMs"), resetStableMs: $("#resetStableMs"), monitorPickerButton: $("#monitorPickerButton"), monitorTestButton: $("#monitorTestButton"), monitorTestResult: $("#monitorTestResult"), conditionJoin: $("#conditionJoin"), addConditionButton: $("#addConditionButton"), conditionsList: $("#conditionsList"), conditionTemplate: $("#conditionTemplate"),
    targetEnabled: $("#targetEnabled"), targetTag: $("#targetTag"), targetKind: $("#targetKind"), targetAttributeName: $("#targetAttributeName"), targetValue: $("#targetValue"), targetPickerButton: $("#targetPickerButton"), targetTestButton: $("#targetTestButton"), targetTestResult: $("#targetTestResult"), targetDryRunTestButton: $("#targetDryRunTestButton"), targetClickTestButton: $("#targetClickTestButton"), targetClickQuickButton: $("#targetClickQuickButton"), clickStrategy: $("#clickStrategy"), maxClicksPerCycle: $("#maxClicksPerCycle"), visibleOnly: $("#visibleOnly"), enabledOnly: $("#enabledOnly"), dryRun: $("#dryRun"), fingerprintAttributes: $("#fingerprintAttributes"), pipelineEnabled: $("#pipelineEnabled"), preActionDelayMs: $("#preActionDelayMs"), postActionDelayMs: $("#postActionDelayMs"), verifyEnabled: $("#verifyEnabled"), verifyTag: $("#verifyTag"), verifyKind: $("#verifyKind"), verifyAttributeName: $("#verifyAttributeName"), verifyValue: $("#verifyValue"), verifyPickerButton: $("#verifyPickerButton"), verifyTestButton: $("#verifyTestButton"), verifyTestResult: $("#verifyTestResult"), verifyExpectation: $("#verifyExpectation"), verifyTimeoutMs: $("#verifyTimeoutMs"), verifyPollIntervalMs: $("#verifyPollIntervalMs"), pipelineRuntimeText: $("#pipelineRuntimeText"),
    titleBlink: $("#titleBlink"), titlePrefix: $("#titlePrefix"), blinkIntervalMs: $("#blinkIntervalMs"), badgeAlert: $("#badgeAlert"), sidebarAlert: $("#sidebarAlert"), notificationAlert: $("#notificationAlert"), dismissOnUserActivity: $("#dismissOnUserActivity"), activeTabTimeoutSeconds: $("#activeTabTimeoutSeconds"),
    logChannel: $("#logChannel"), activityLog: $("#activityLog"), copyLogsButton: $("#copyLogsButton"), clearLogsButton: $("#clearLogsButton"),
    shellPresetSelect: $("#shellPresetSelect"), shellPresetName: $("#shellPresetName"), shellPresetEnabled: $("#shellPresetEnabled"), loadShellPresetButton: $("#loadShellPresetButton"), newShellPresetButton: $("#newShellPresetButton"), updateShellPresetButton: $("#updateShellPresetButton"), deleteShellPresetButton: $("#deleteShellPresetButton"), requireShellPresetMatch: $("#requireShellPresetMatch"),
    workingDirectory: $("#workingDirectory"), shellCommand: $("#shellCommand"), shellMode: $("#shellMode"), confirmBeforeRun: $("#confirmBeforeRun"), rememberShellHistory: $("#rememberShellHistory"), shellHistoryLimit: $("#shellHistoryLimit"), shellHistorySelect: $("#shellHistorySelect"), loadShellHistoryButton: $("#loadShellHistoryButton"), clearShellHistoryButton: $("#clearShellHistoryButton"),
    nativeHostStatus: $("#nativeHostStatus"), shellRunStatus: $("#shellRunStatus"), shellRunPid: $("#shellRunPid"), shellRunId: $("#shellRunId"), shellOutput: $("#shellOutput"), checkNativeButton: $("#checkNativeButton"), runShellButton: $("#runShellButton"), stopShellButton: $("#stopShellButton"), clearShellOutputButton: $("#clearShellOutputButton"),
    saveProfileButton: $("#saveProfileButton"), saveTabButton: $("#saveTabButton"), resetTabButton: $("#resetTabButton"), exportButton: $("#exportButton"), importButton: $("#importButton"), clearHighlightsButton: $("#clearHighlightsButton"), importFile: $("#importFile"), messageBox: $("#messageBox")
  };

  const modeLabels = {
    [MODE.INACTIVE]: "Inactive",
    [MODE.ACTIVE]: "Running",
    [MODE.PAUSED]: "Paused",
    [MODE.ERROR]: "Error"
  };
  let dashboard = { currentTab: {}, sessions: [], store: Settings.defaultStore(), nativeHost: { connected: false, runs: [] } };
  let selectedTabId = null;
  let selectedProfileId = null;
  let selectedRuleId = null;
  let formConfigDraft = Settings.defaultConfig();
  let shellPresetsDraft = [];
  let selectedShellPresetId = "";
  let busy = false;
  let activeTabRefreshSerial = 0;
  let collapsedGroups = {};
  let autoProfileByUrl = true;
  const manualProfileSelectionByTab = new Map();
  const pendingPickerResults = new Map();
  const FORM_RELOAD_MESSAGE_TYPES = new Set([
    MESSAGE.GET_DASHBOARD, MESSAGE.ACTIVATE_CURRENT, MESSAGE.STOP_TAB,
    MESSAGE.ASSIGN_PROFILE, MESSAGE.SAVE_TAB_CONFIG, MESSAGE.RESET_TAB_CONFIG,
    MESSAGE.CREATE_PROFILE, MESSAGE.DUPLICATE_PROFILE, MESSAGE.SAVE_PROFILE,
    MESSAGE.DELETE_PROFILE, MESSAGE.IMPORT_SETTINGS
  ]);
  let passiveRefreshTimer = null;
  let passiveRefreshSerial = 0;

  function showMessage(text = "", level = "info") {
    elements.messageBox.textContent = text;
    elements.messageBox.dataset.level = level;
  }

  function persistSidebarUi() {
    return browser.storage.local.set({
      [SIDEBAR_UI_STORAGE_KEY]: {
        collapsedGroups: { ...collapsedGroups },
        autoProfileByUrl
      }
    });
  }

  function setGroupCollapsed(section, collapsed, persist = false) {
    const groupId = section?.dataset?.groupId;
    if (!groupId) {
      return;
    }
    const value = Boolean(collapsed);
    section.dataset.collapsed = value ? "true" : "false";
    const toggle = section.querySelector(":scope > .group-heading .group-toggle");
    if (toggle) {
      toggle.textContent = value ? "▸" : "▾";
      toggle.setAttribute("aria-expanded", value ? "false" : "true");
      toggle.title = value ? "Expand section" : "Collapse section";
      toggle.setAttribute("aria-label", `${value ? "Expand" : "Collapse"} section ${toggle.dataset.groupTitle || groupId}`);
    }
    collapsedGroups[groupId] = value;
    if (persist) {
      void persistSidebarUi();
    }
  }

  async function initializeCollapsibleGroups() {
    const result = await browser.storage.local.get(SIDEBAR_UI_STORAGE_KEY);
    const storedUi = result?.[SIDEBAR_UI_STORAGE_KEY] || {};
    const stored = storedUi.collapsedGroups;
    collapsedGroups = stored && typeof stored === "object" ? { ...stored } : {};
    autoProfileByUrl = storedUi.autoProfileByUrl !== false;
    elements.autoProfileByUrl.checked = autoProfileByUrl;

    for (const section of document.querySelectorAll("section.card[data-group-id]")) {
      const directChildren = [...section.children];
      let headingRow = directChildren.find((child) =>
        child.classList?.contains("section-title-row") && child.querySelector("h2")
      );
      const heading = headingRow?.querySelector("h2") || directChildren.find((child) => child.tagName === "H2");
      if (!heading) {
        continue;
      }
      if (!headingRow) {
        headingRow = document.createElement("div");
        headingRow.className = "section-title-row";
        section.insertBefore(headingRow, heading);
      }
      headingRow.classList.add("group-heading");

      const cluster = document.createElement("div");
      cluster.className = "group-title-cluster";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "compact group-toggle";
      toggle.dataset.groupTitle = heading.textContent.trim();
      if (heading.parentElement === headingRow) {
        heading.replaceWith(cluster);
      } else {
        headingRow.append(cluster);
      }
      cluster.append(toggle, heading);
      toggle.addEventListener("click", () => {
        setGroupCollapsed(section, section.dataset.collapsed !== "true", true);
      });
      setGroupCollapsed(section, Boolean(collapsedGroups[section.dataset.groupId]));
    }
  }

  function sessionById(tabId) {
    return dashboard.sessions.find((session) => session.tabId === Number(tabId)) || null;
  }

  function profileById(profileId) {
    return Settings.profileById(dashboard.store, profileId) || dashboard.store.profiles[0];
  }

  function selectedSession() {
    return sessionById(selectedTabId);
  }

  function selectedShellRun() {
    const runs = Array.isArray(dashboard.nativeHost?.runs) ? dashboard.nativeHost.runs : [];
    return runs.find((run) => Number(run.tabId) === Number(selectedTabId)) || {
      tabId: selectedTabId,
      runId: null,
      status: "idle",
      pid: null,
      output: [],
      error: null,
      returnCode: null
    };
  }

  function shellIsActive(run) {
    return ["starting", "running", "terminal", "stopping"].includes(run?.status);
  }

  function selectedShellPreset() {
    return shellPresetsDraft.find((preset) => preset.id === selectedShellPresetId) || null;
  }

  function renderShellPresetOptions() {
    const custom = document.createElement("option");
    custom.value = "";
    custom.textContent = "Custom command";
    const options = shellPresetsDraft.map((preset) => {
      const option = document.createElement("option");
      option.value = preset.id;
      option.textContent = `${preset.enabled ? "●" : "○"} ${preset.name}`;
      return option;
    });
    elements.shellPresetSelect.replaceChildren(custom, ...options);
    if (!shellPresetsDraft.some((preset) => preset.id === selectedShellPresetId)) {
      selectedShellPresetId = "";
    }
    elements.shellPresetSelect.value = selectedShellPresetId;
    const preset = selectedShellPreset();
    elements.shellPresetName.value = preset?.name || "";
    elements.shellPresetEnabled.checked = preset?.enabled !== false;
    elements.loadShellPresetButton.disabled = busy || !preset;
    elements.updateShellPresetButton.disabled = busy || !preset;
    elements.deleteShellPresetButton.disabled = busy || !preset;
  }

  function renderShellHistory() {
    const selectedHistoryId = elements.shellHistorySelect.value;
    const history = Array.isArray(selectedSession()?.shellHistory) ? selectedSession().shellHistory : [];
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = history.length ? "Select a recent command" : "No command history";
    const options = history.map((entry) => {
      const option = document.createElement("option");
      option.value = entry.id;
      const when = entry.startedAt ? new Date(entry.startedAt).toLocaleTimeString() : "";
      option.textContent = `${when} · ${entry.presetName || entry.command || "Command"} · ${entry.status || "requested"}`;
      return option;
    });
    elements.shellHistorySelect.replaceChildren(empty, ...options);
    if (history.some((entry) => entry.id === selectedHistoryId)) {
      elements.shellHistorySelect.value = selectedHistoryId;
    }
    elements.loadShellHistoryButton.disabled = busy || history.length === 0;
    elements.clearShellHistoryButton.disabled = busy || history.length === 0;
  }

  function loadShellValues(source) {
    if (!source) return;
    elements.workingDirectory.value = source.workingDirectory || source.cwd || "";
    elements.shellCommand.value = source.command || "";
    elements.shellMode.value = source.mode === "background" ? "background" : "terminal";
    elements.confirmBeforeRun.checked = source.confirmBeforeRun !== false;
  }

  function renderShellState() {
    const native = dashboard.nativeHost || {};
    const run = selectedShellRun();
    elements.nativeHostStatus.dataset.state = native.connected ? "online" : (native.lastError ? "error" : "offline");
    elements.nativeHostStatus.textContent = native.connected
      ? `Native ${native.hostVersion || "online"}`
      : (native.lastError ? "Native error" : "Native not checked");
    elements.nativeHostStatus.title = native.lastError || native.lastSeenAt || "";
    elements.shellRunStatus.textContent = run.error
      ? `${run.status}: ${run.error}`
      : (run.returnCode === null || run.returnCode === undefined
        ? (run.status || "idle")
        : `${run.status} (rc=${run.returnCode})`);
    elements.shellRunPid.textContent = Number.isInteger(run.pid) ? String(run.pid) : "—";
    elements.shellRunId.textContent = run.runId || "—";
    const output = Array.isArray(run.output) ? run.output : [];
    elements.shellOutput.textContent = output.length
      ? output.map((item) => `${item.stream === "stderr" ? "[stderr] " : (item.stream === "system" ? "[system] " : "")}${item.text}`).join("")
      : "No output yet.";
    elements.checkNativeButton.disabled = busy;
    elements.runShellButton.disabled = busy || !selectedSession() || shellIsActive(run);
    elements.stopShellButton.disabled = busy || !shellIsActive(run);
    elements.clearShellOutputButton.disabled = busy || output.length === 0;
    const preset = selectedShellPreset();
    elements.loadShellPresetButton.disabled = busy || !preset;
    elements.updateShellPresetButton.disabled = busy || !preset;
    elements.deleteShellPresetButton.disabled = busy || !preset;
    renderShellHistory();
  }

  function addConditionRow(condition = null) {
    const normalized = condition || {
      enabled: true, attribute: "aria-label", operator: "equals", value: "", caseSensitive: true
    };
    const row = elements.conditionTemplate.content.firstElementChild.cloneNode(true);
    row.querySelector('[data-field="enabled"]').checked = normalized.enabled;
    row.querySelector('[data-field="attribute"]').value = normalized.attribute;
    row.querySelector('[data-field="operator"]').value = normalized.operator;
    row.querySelector('[data-field="value"]').value = normalized.value;
    row.querySelector('[data-field="caseSensitive"]').checked = normalized.caseSensitive;
    row.querySelector('[data-action="remove-condition"]').addEventListener("click", () => {
      row.remove();
    });
    elements.conditionsList.append(row);
  }

  function ruleById(config, ruleId) {
    const normalized = Settings.normalizeConfig(config || formConfigDraft);
    return normalized.rules.find((rule) => rule.id === ruleId) || normalized.rules[0];
  }

  function renderRuleOptions() {
    const config = Settings.normalizeConfig(formConfigDraft);
    const preferred = config.rules.some((rule) => rule.id === selectedRuleId)
      ? selectedRuleId
      : config.activeRuleId;
    selectedRuleId = preferred || config.rules[0]?.id || null;
    elements.ruleSelect.replaceChildren(...config.rules.map((rule) => {
      const option = document.createElement("option");
      option.value = rule.id;
      option.textContent = `${rule.enabled ? "●" : "○"} ${rule.name}`;
      return option;
    }));
    elements.ruleSelect.value = selectedRuleId || "";
    elements.deleteRuleButton.disabled = config.rules.length <= 1;
  }

  function readRuleParts() {
    return {
      monitor: {
        selector: readSelector("monitor"),
        visibilityTransition: elements.monitorVisibilityTransition.value,
        matchStableMs: Number(elements.matchStableMs.value),
        resetStableMs: Number(elements.resetStableMs.value),
        conditionJoin: elements.conditionJoin.value,
        conditions: readConditions()
      },
      target: {
        enabled: elements.targetEnabled.checked,
        selector: readSelector("target"),
        clickStrategy: elements.clickStrategy.value,
        maxClicksPerCycle: Number(elements.maxClicksPerCycle.value),
        visibleOnly: elements.visibleOnly.checked,
        enabledOnly: elements.enabledOnly.checked,
        dryRun: elements.dryRun.checked,
        fingerprintAttributes: elements.fingerprintAttributes.value.split(","),
        pipeline: {
          enabled: elements.pipelineEnabled.checked,
          preActionDelayMs: Number(elements.preActionDelayMs.value),
          postActionDelayMs: Number(elements.postActionDelayMs.value),
          verifyEnabled: elements.verifyEnabled.checked,
          verifySelector: readSelector("verify"),
          verifyExpectation: elements.verifyExpectation.value,
          verifyTimeoutMs: Number(elements.verifyTimeoutMs.value),
          verifyPollIntervalMs: Number(elements.verifyPollIntervalMs.value)
        }
      }
    };
  }

  function writeRuleFields(rule) {
    const value = rule || Settings.defaultRule();
    elements.ruleName.value = value.name || "Rule";
    elements.ruleEnabled.checked = value.enabled !== false;
    elements.monitorTag.value = value.monitor.selector.tag;
    elements.monitorKind.value = value.monitor.selector.kind;
    elements.monitorAttributeName.value = value.monitor.selector.attributeName;
    elements.monitorValue.value = value.monitor.selector.value;
    elements.monitorVisibilityTransition.value = value.monitor.visibilityTransition;
    elements.matchStableMs.value = String(value.monitor.matchStableMs);
    elements.resetStableMs.value = String(value.monitor.resetStableMs);
    elements.conditionJoin.value = value.monitor.conditionJoin;
    elements.conditionsList.replaceChildren();
    value.monitor.conditions.forEach(addConditionRow);
    elements.targetEnabled.checked = value.target.enabled;
    elements.targetTag.value = value.target.selector.tag;
    elements.targetKind.value = value.target.selector.kind;
    elements.targetAttributeName.value = value.target.selector.attributeName;
    elements.targetValue.value = value.target.selector.value;
    elements.clickStrategy.value = value.target.clickStrategy;
    elements.maxClicksPerCycle.value = String(value.target.maxClicksPerCycle);
    elements.visibleOnly.checked = value.target.visibleOnly;
    elements.enabledOnly.checked = value.target.enabledOnly;
    elements.dryRun.checked = value.target.dryRun;
    elements.fingerprintAttributes.value = value.target.fingerprintAttributes.join(", ");
    elements.pipelineEnabled.checked = value.target.pipeline.enabled;
    elements.preActionDelayMs.value = String(value.target.pipeline.preActionDelayMs);
    elements.postActionDelayMs.value = String(value.target.pipeline.postActionDelayMs);
    elements.verifyEnabled.checked = value.target.pipeline.verifyEnabled;
    elements.verifyTag.value = value.target.pipeline.verifySelector.tag;
    elements.verifyKind.value = value.target.pipeline.verifySelector.kind;
    elements.verifyAttributeName.value = value.target.pipeline.verifySelector.attributeName;
    elements.verifyValue.value = value.target.pipeline.verifySelector.value;
    elements.verifyExpectation.value = value.target.pipeline.verifyExpectation;
    elements.verifyTimeoutMs.value = String(value.target.pipeline.verifyTimeoutMs);
    elements.verifyPollIntervalMs.value = String(value.target.pipeline.verifyPollIntervalMs);
  }

  function commitCurrentRuleDraft() {
    const config = Settings.normalizeConfig(formConfigDraft);
    const current = ruleById(config, selectedRuleId);
    if (!current) {
      return config;
    }
    const parts = readRuleParts();
    const updated = {
      ...current,
      name: elements.ruleName.value.trim() || current.name || "Rule",
      enabled: elements.ruleEnabled.checked,
      monitor: parts.monitor,
      target: parts.target
    };
    const rules = config.rules.map((rule) => rule.id === updated.id ? updated : rule);
    formConfigDraft = Settings.normalizeConfig({
      ...config,
      activeRuleId: updated.id,
      rules,
      monitor: updated.monitor,
      target: updated.target
    });
    selectedRuleId = updated.id;
    return formConfigDraft;
  }

  function writeConfig(config) {
    const value = Settings.normalizeConfig(config);
    formConfigDraft = value;
    selectedRuleId = value.activeRuleId;
    elements.routingEnabled.checked = value.activation.routingEnabled;
    elements.routingPriority.value = String(value.activation.routingPriority);
    elements.requireUrlMatch.checked = value.activation.requireUrlMatch;
    elements.urlPatterns.value = value.activation.urlPatterns.join("\n");
    renderRuleOptions();
    writeRuleFields(ruleById(value, selectedRuleId));
    elements.titleBlink.checked = value.alerts.titleBlink;
    elements.titlePrefix.value = value.alerts.titlePrefix;
    elements.blinkIntervalMs.value = String(value.alerts.blinkIntervalMs);
    elements.badgeAlert.checked = value.alerts.badge;
    elements.sidebarAlert.checked = value.alerts.sidebar;
    elements.notificationAlert.checked = value.alerts.notification;
    elements.dismissOnUserActivity.checked = value.alerts.dismissOnUserActivity;
    elements.activeTabTimeoutSeconds.value = String(value.alerts.activeTabTimeoutSeconds);
    shellPresetsDraft = Settings.clone(value.shell.presets || []);
    selectedShellPresetId = value.shell.selectedPresetId || "";
    elements.requireShellPresetMatch.checked = value.shell.requirePresetMatch;
    elements.rememberShellHistory.checked = value.shell.rememberHistory;
    elements.shellHistoryLimit.value = String(value.shell.historyLimit);
    elements.workingDirectory.value = value.shell.workingDirectory;
    elements.shellCommand.value = value.shell.command;
    elements.shellMode.value = value.shell.mode;
    elements.confirmBeforeRun.checked = value.shell.confirmBeforeRun;
    renderShellPresetOptions();
    renderShellHistory();
    renderRuleRuntimeSummary();
  }

  function readSelector(prefix) {
    return {
      tag: elements[`${prefix}Tag`].value,
      kind: elements[`${prefix}Kind`].value,
      attributeName: elements[`${prefix}AttributeName`].value,
      value: elements[`${prefix}Value`].value
    };
  }

  function writeSelector(kind, selector) {
    const normalized = selector && typeof selector === "object" ? selector : {};
    elements[`${kind}Tag`].value = normalized.tag || "*";
    elements[`${kind}Kind`].value = normalized.kind || "css";
    elements[`${kind}AttributeName`].value = normalized.attributeName || "";
    elements[`${kind}Value`].value = normalized.value || "";
  }

  function selectedPicker() {
    const pickers = Array.isArray(dashboard.pickers) ? dashboard.pickers : [];
    return pickers.find((picker) => Number(picker.tabId) === Number(selectedTabId)) || null;
  }

  function renderPickerButtons(currentIsSelected) {
    const picker = selectedPicker();
    for (const [kind, button] of [["monitor", elements.monitorPickerButton], ["target", elements.targetPickerButton], ["verify", elements.verifyPickerButton]]) {
      const active = picker?.kind === kind && picker?.status === "active";
      button.dataset.pickerActive = active ? "true" : "false";
      button.textContent = active ? "Cancel picker (Esc)" : "Pick on page";
      button.disabled = busy || !currentIsSelected || Boolean(picker && !active);
    }
  }

  function applyPickerResult(result) {
    if (!result || !Number.isInteger(Number(result.tabId))) {
      return;
    }
    const tabId = Number(result.tabId);
    dashboard.pickers = (Array.isArray(dashboard.pickers) ? dashboard.pickers : [])
      .filter((picker) => Number(picker.tabId) !== tabId);
    if (Number(selectedTabId) !== tabId) {
      pendingPickerResults.set(tabId, result);
      return;
    }
    if (result.cancelled) {
      showMessage("Element picker cancelled.");
      renderDetails(false);
      return;
    }
    writeSelector(result.kind, result.selector);
    const output = result.kind === "monitor"
      ? elements.monitorTestResult
      : (result.kind === "verify" ? elements.verifyTestResult : elements.targetTestResult);
    output.textContent = `Selected ${result.elementSummary || result.css}; the selector matches ${result.matchCount || 0} element(s).`;
    const kindLabel = result.kind === "monitor" ? "monitor element" : (result.kind === "verify" ? "verification element" : "target");
    showMessage(`Filled the ${kindLabel} selector: ${result.css}`, "success");
    renderDetails(false);
  }

  function applyPendingPickerResult() {
    const result = pendingPickerResults.get(Number(selectedTabId));
    if (!result) return;
    pendingPickerResults.delete(Number(selectedTabId));
    applyPickerResult(result);
  }

  function readConditions() {
    return [...elements.conditionsList.querySelectorAll(".condition-row")].map((row) => ({
      enabled: row.querySelector('[data-field="enabled"]').checked,
      attribute: row.querySelector('[data-field="attribute"]').value,
      operator: row.querySelector('[data-field="operator"]').value,
      value: row.querySelector('[data-field="value"]').value,
      caseSensitive: row.querySelector('[data-field="caseSensitive"]').checked
    }));
  }

  function readConfig() {
    const draft = commitCurrentRuleDraft();
    return Settings.normalizeConfig({
      ...draft,
      activeRuleId: selectedRuleId,
      activation: {
        routingEnabled: elements.routingEnabled.checked,
        routingPriority: Number(elements.routingPriority.value),
        requireUrlMatch: elements.requireUrlMatch.checked,
        urlPatterns: elements.urlPatterns.value.split(/\r?\n/)
      },
      alerts: {
        titleBlink: elements.titleBlink.checked,
        titlePrefix: elements.titlePrefix.value,
        blinkIntervalMs: Number(elements.blinkIntervalMs.value),
        badge: elements.badgeAlert.checked,
        sidebar: elements.sidebarAlert.checked,
        notification: elements.notificationAlert.checked,
        dismissOnUserActivity: elements.dismissOnUserActivity.checked,
        activeTabTimeoutSeconds: Number(elements.activeTabTimeoutSeconds.value)
      },
      shell: {
        workingDirectory: elements.workingDirectory.value,
        command: elements.shellCommand.value,
        mode: elements.shellMode.value,
        confirmBeforeRun: elements.confirmBeforeRun.checked,
        requirePresetMatch: elements.requireShellPresetMatch.checked,
        rememberHistory: elements.rememberShellHistory.checked,
        historyLimit: Number(elements.shellHistoryLimit.value),
        selectedPresetId: selectedShellPresetId,
        presets: shellPresetsDraft
      }
    });
  }

  function routingForSelectedUrl(includeDraft = false) {
    const currentIsSelected = Number(dashboard.currentTab?.tabId) === Number(selectedTabId);
    const session = selectedSession();
    const url = session?.url || (currentIsSelected ? dashboard.currentTab?.url : "") || "";
    if (!includeDraft || !selectedProfileId) {
      return Settings.routeProfile(dashboard.store, url);
    }
    const draftStore = Settings.clone(dashboard.store);
    const draftProfile = Settings.profileById(draftStore, selectedProfileId);
    if (draftProfile) {
      draftProfile.config = readConfig();
    }
    return Settings.routeProfile(draftStore, url);
  }

  function renderUrlRoutingPreview(includeDraft = false) {
    const routing = routingForSelectedUrl(includeDraft);
    const candidates = routing.candidates || [];
    if (!routing.url) {
      elements.urlRoutingResult.dataset.state = "none";
      elements.urlRoutingResult.textContent = "No URL is available to test.";
      return routing;
    }
    if (routing.matched) {
      const first = candidates[0];
      elements.urlRoutingResult.dataset.state = "match";
      elements.urlRoutingResult.textContent = `${candidates.length} profile(s) matched; selected “${routing.profileName}” (priority ${first.priority}, pattern ${first.bestPattern}).`;
    } else {
      elements.urlRoutingResult.dataset.state = routing.profileId ? "fallback" : "none";
      elements.urlRoutingResult.textContent = routing.profileId
        ? `No profile matched the URL; falling back to “${routing.profileName}”.`
        : "No profile matched the URL.";
    }
    return routing;
  }

  function renderSelectors(preferredTabId = null) {
    const oldTab = selectedTabId;
    elements.tabSelect.replaceChildren();
    const current = dashboard.currentTab;
    const currentSession = sessionById(current.tabId);
    if (Number.isInteger(current.tabId) && !currentSession) {
      const option = new Option(`[Current tab] ${current.title || current.url || current.tabId}`, String(current.tabId));
      option.dataset.inactive = "true";
      elements.tabSelect.add(option);
    }
    for (const session of dashboard.sessions) {
      const marker = session.tabId === current.tabId ? "★ " : "";
      elements.tabSelect.add(new Option(`${marker}[${session.mode}] ${session.title || session.url || session.tabId}`, String(session.tabId)));
    }
    const validIds = [...elements.tabSelect.options].map((option) => Number(option.value));
    const preferred = preferredTabId === null || preferredTabId === undefined
      ? null
      : Number(preferredTabId);
    selectedTabId = preferred !== null && validIds.includes(preferred)
      ? preferred
      : (validIds.includes(Number(oldTab))
        ? Number(oldTab)
        : (Number.isInteger(current.tabId) ? current.tabId : validIds[0] || null));
    if (selectedTabId !== null) {
      elements.tabSelect.value = String(selectedTabId);
    }

    const oldProfile = selectedProfileId;
    elements.profileSelect.replaceChildren();
    for (const profile of dashboard.store.profiles) {
      const suffix = profile.id === dashboard.store.defaultProfileId ? " (default)" : "";
      elements.profileSelect.add(new Option(`${profile.name}${suffix}`, profile.id));
    }
    const session = selectedSession();
    const manualProfileId = manualProfileSelectionByTab.get(Number(selectedTabId));
    const routedProfileId = autoProfileByUrl && !session
      ? Settings.routeProfile(dashboard.store, dashboard.currentTab?.url || "").profileId
      : null;
    selectedProfileId = session?.profileId ||
      (dashboard.store.profiles.some((profile) => profile.id === manualProfileId) ? manualProfileId : null) ||
      (dashboard.store.profiles.some((profile) => profile.id === routedProfileId) ? routedProfileId : null) ||
      (dashboard.store.profiles.some((profile) => profile.id === oldProfile) ? oldProfile : dashboard.store.defaultProfileId);
    elements.profileSelect.value = selectedProfileId;
  }

  function selectedLogs() {
    const session = selectedSession();
    const channel = elements.logChannel.value === "debug" ? "debug" : "user";
    return Array.isArray(session?.logs?.[channel]) ? session.logs[channel] : [];
  }

  function formatLogLine(entry) {
    const time = entry?.at ? new Date(entry.at).toLocaleTimeString("en-GB", { hour12: false }) : "--:--:--";
    const detail = entry?.detail ? ` | ${JSON.stringify(entry.detail)}` : "";
    return `[${time}] ${entry?.event || "event"}: ${entry?.message || ""}${detail}`;
  }

  function renderActivityLog() {
    elements.activityLog.replaceChildren();
    const logs = selectedLogs();
    if (!logs.length) {
      const item = document.createElement("li");
      item.className = "empty-log";
      item.textContent = "No events in this channel.";
      elements.activityLog.append(item);
      return;
    }
    for (const entry of logs.slice().reverse()) {
      const item = document.createElement("li");
      const time = document.createElement("time");
      time.dateTime = entry.at || "";
      time.textContent = entry.at ? new Date(entry.at).toLocaleTimeString("en-GB", { hour12: false }) : "--:--:--";
      const text = document.createElement("span");
      text.textContent = `${entry.event || "event"}: ${entry.message || ""}`;
      item.append(time, text);
      if (entry.detail) {
        const detail = document.createElement("code");
        detail.textContent = JSON.stringify(entry.detail);
        item.append(detail);
      }
      elements.activityLog.append(item);
    }
  }

  function renderRuleRuntimeSummary() {
    const config = Settings.normalizeConfig(formConfigDraft);
    const rule = ruleById(config, selectedRuleId);
    const session = selectedSession();
    const runtime = session?.runtime?.ruleRuntimes?.[rule?.id] || null;
    const setStatus = (state, badge, detail) => {
      elements.ruleRuntimeSummary.dataset.state = state;
      elements.ruleRuntimeSummary.textContent = detail;
      if (elements.ruleRuntimeBadge) {
        elements.ruleRuntimeBadge.dataset.state = state;
        elements.ruleRuntimeBadge.textContent = badge;
      }
    };
    if (!rule) {
      setStatus("none", "No rule", "No rules configured.");
      return;
    }
    if (!rule.enabled) {
      setStatus("disabled", "Disabled", `“${rule.name}” is disabled. No observer or action is running.`);
      return;
    }
    if (!runtime) {
      setStatus("idle", "Not running", `“${rule.name}” is not running in this tab.`);
      return;
    }
    const state = runtime.monitorState || "idle";
    const displayState = state === "matched" ? "MATCHED" : state.toUpperCase();
    setStatus(
      state === "matched" ? "matched" : state,
      displayState,
      `${rule.name}: ${state}; cycle ${runtime.cycle || 0}; monitor ${runtime.monitorMatchedCount || 0}/${runtime.monitorCount || 0}; ${runtime.candidateCount || 0} new target(s); ${runtime.lastTargetAction || runtime.lastReason || "monitoring"}.`
    );
  }

  function renderDetails(loadForm = true) {
    const session = selectedSession();
    const currentIsSelected = Number(dashboard.currentTab.tabId) === Number(selectedTabId);
    const mode = session?.mode || MODE.INACTIVE;
    const runtime = session?.runtime || {};
    elements.body.dataset.mode = mode;
    const sidebarAlertEnabled = Boolean(session?.effectiveConfig?.alerts?.sidebar);
    const alertActive = Boolean(runtime.alertActive);
    elements.body.dataset.alert = sidebarAlertEnabled && alertActive ? "active" : "inactive";
    elements.statusPill.textContent = sidebarAlertEnabled && alertActive ? "Condition matched" : (modeLabels[mode] || mode);
    elements.tabId.textContent = Number.isInteger(selectedTabId) ? String(selectedTabId) : "—";
    const recoveryState = runtime.recoveryState || "none";
    const recoverySuffix = recoveryState !== "none" && recoveryState !== "attached"
      ? ` · ${recoveryState}`
      : "";
    elements.modeText.textContent = `${modeLabels[mode] || mode}${recoverySuffix}`;
    elements.configModeText.textContent = session?.configMode === CONFIG_MODE.TAB ? "Tab-specific" : (session ? "Profile-based" : "No session");
    elements.profileText.textContent = session?.profileName || profileById(selectedProfileId)?.name || "—";
    const pendingState = runtime.pendingMonitorState;
    const remainingMs = pendingState && runtime.stabilityDueAt
      ? Math.max(0, new Date(runtime.stabilityDueAt).getTime() - Date.now())
      : 0;
    elements.monitorStateText.textContent = pendingState
      ? `${runtime.monitorState || "—"} → ${pendingState} (stabilizing for ${remainingMs} ms)`
      : (runtime.monitorState || "—");
    elements.monitorCountText.textContent = session ? `${runtime.monitorCount || 0} (visible ${runtime.monitorVisibleCount || 0}, hidden ${runtime.monitorHiddenCount || 0})` : "—";
    elements.monitorMatchedText.textContent = session ? String(runtime.monitorMatchedCount || 0) : "—";
    elements.monitorCycleText.textContent = session ? String(runtime.cycle || 0) : "—";
    elements.ruleCountText.textContent = session ? `${runtime.enabledRuleCount || 0}/${runtime.ruleCount || session.effectiveConfig?.rules?.length || 0}` : "—";
    elements.matchedRuleCountText.textContent = session ? String(runtime.matchedRuleCount || 0) : "—";
    elements.alertStateText.textContent = session
      ? (runtime.alertActive
        ? `ACTIVE cycle ${runtime.alertCycle || runtime.cycle || 0}${runtime.titleBlinking ? " / title blink" : ""}`
        : (runtime.alertDismissReason ? `dismissed (${runtime.alertDismissReason})` : "inactive"))
      : "—";
    elements.targetStateText.textContent = session ? (runtime.targetState || "disabled") : "—";
    elements.baselineCountText.textContent = session ? String(runtime.baselineCount || 0) : "—";
    elements.candidateCountText.textContent = session ? `${runtime.candidateCount || 0} / total ${runtime.targetTotalCount || 0}` : "—";
    elements.targetActionCountText.textContent = session ? `${runtime.handledCount || 0} (click ${runtime.clickedCount || 0}, dry-run ${runtime.dryRunCount || 0})` : "—";
    elements.lastTargetActionText.textContent = runtime.lastTargetError || runtime.lastTargetAction || "—";
    if (session) {
      const verify = runtime.verifyResult;
      const verifyText = verify?.skipped
        ? `verification skipped (${verify.reason || "unknown"})`
        : (verify ? `${verify.passed ? "PASS" : "FAIL"} ${verify.expectation || ""}; ${verify.count || 0} element, ${verify.visibleCount || 0} visible` : "not verified");
      elements.pipelineRuntimeText.textContent = `Pipeline: ${runtime.pipelineState || "idle"}${runtime.pipelineBusy ? " (running)" : ""}; ${verifyText}.`;
    } else {
      elements.pipelineRuntimeText.textContent = "";
    }
    elements.monitorTransitionText.textContent = runtime.pendingMonitorState
      ? `waiting for ${runtime.pendingMonitorState}; ${runtime.stabilityDelayMs || 0} ms`
      : (runtime.lastVisibilityTransition || runtime.lastTransition || runtime.lastReason || "—");
    elements.tabUrl.textContent = session?.url || (currentIsSelected ? dashboard.currentTab.url : "") || "—";
    const recoveryActionRequired = Boolean(session) && [
      "permission-required",
      "url-blocked",
      "failed",
      "navigation-pending"
    ].includes(recoveryState);
    elements.activateButton.textContent = recoveryActionRequired ? "Recover current tab" : "Activate current tab";
    elements.activateButton.disabled = busy || !currentIsSelected || (Boolean(session) && !recoveryActionRequired);
    elements.pauseButton.disabled = busy || mode !== MODE.ACTIVE;
    elements.resumeButton.disabled = busy || mode !== MODE.PAUSED;
    elements.stopButton.disabled = busy || !session;

    const quickAction = mode === MODE.ACTIVE
      ? { icon: "⏸", label: "Pause current tab" }
      : (mode === MODE.PAUSED
        ? { icon: "▶", label: "Resume current tab" }
        : { icon: "▶", label: recoveryActionRequired ? "Recover current tab" : "Activate current tab" });
    elements.tabPrimaryQuickButton.textContent = quickAction.icon;
    elements.tabPrimaryQuickButton.title = quickAction.label;
    elements.tabPrimaryQuickButton.setAttribute("aria-label", quickAction.label);
    elements.tabPrimaryQuickButton.disabled = busy || !currentIsSelected || (
      mode !== MODE.ACTIVE && mode !== MODE.PAUSED && Boolean(session) && !recoveryActionRequired
    );
    elements.tabStopQuickButton.disabled = busy || !session;
    elements.targetClickQuickButton.disabled = busy || !currentIsSelected;
    elements.assignProfileButton.disabled = busy || !session;
    elements.testUrlRoutingButton.disabled = busy || !currentIsSelected;
    elements.useRoutedProfileButton.disabled = busy || !currentIsSelected;
    elements.autoProfileByUrl.checked = autoProfileByUrl;
    elements.saveTabButton.disabled = busy || !session;
    elements.resetTabButton.disabled = busy || !session || session.configMode !== CONFIG_MODE.TAB;
    renderPickerButtons(currentIsSelected);
    elements.monitorTestButton.disabled = busy || !currentIsSelected;
    elements.targetTestButton.disabled = busy || !currentIsSelected;
    elements.verifyTestButton.disabled = busy || !currentIsSelected;
    elements.targetDryRunTestButton.disabled = busy || !currentIsSelected;
    elements.targetClickTestButton.disabled = busy || !currentIsSelected;
    elements.clearHighlightsButton.disabled = busy || !currentIsSelected;
    elements.copyLogsButton.disabled = busy || !session;
    elements.clearLogsButton.disabled = busy || !session;
    renderActivityLog();
    renderShellState();
    renderUrlRoutingPreview();
    renderRuleRuntimeSummary();

    const profile = profileById(selectedProfileId);
    if (loadForm) {
      elements.profileName.value = profile?.name || "";
      writeConfig(session?.effectiveConfig || profile?.config || Settings.defaultConfig());
    }
  }

  function dashboardStructureSignature(value) {
    const data = value || {};
    return JSON.stringify({
      currentTabId: Number.isInteger(data.currentTab?.tabId) ? data.currentTab.tabId : null,
      sessions: (Array.isArray(data.sessions) ? data.sessions : []).map((session) => [
        session.tabId, session.profileId, session.configMode
      ]),
      profiles: (Array.isArray(data.store?.profiles) ? data.store.profiles : []).map((profile) => [
        profile.id, profile.name
      ]),
      defaultProfileId: data.store?.defaultProfileId || null
    });
  }

  function renderRuntimeDashboard(nextDashboard) {
    if (!nextDashboard) {
      return;
    }
    const oldStructure = dashboardStructureSignature(dashboard);
    const oldTabId = selectedTabId;
    const oldProfileId = selectedProfileId;
    dashboard = nextDashboard;
    const structureChanged = oldStructure !== dashboardStructureSignature(dashboard);
    const selectedStillExists = Number(dashboard.currentTab?.tabId) === Number(selectedTabId) ||
      Boolean(sessionById(selectedTabId));
    if (structureChanged || !selectedStillExists) {
      renderSelectors(selectedStillExists ? selectedTabId : dashboard.currentTab?.tabId);
    }
    const contextChanged = Number(oldTabId) !== Number(selectedTabId) || oldProfileId !== selectedProfileId;
    renderDetails(contextChanged);
  }

  function render(nextDashboard, loadForm = true, preferredTabId = null) {
    if (nextDashboard) {
      dashboard = nextDashboard;
    }
    renderSelectors(preferredTabId);
    renderDetails(loadForm);
  }

  async function refreshDashboardPassive() {
    const refreshSerial = ++passiveRefreshSerial;
    try {
      const response = await browser.runtime.sendMessage({ type: MESSAGE.GET_DASHBOARD });
      if (refreshSerial !== passiveRefreshSerial || !response?.ok || !response.dashboard) {
        return;
      }
      renderRuntimeDashboard(response.dashboard);
    } catch (_error) {
      // Runtime updates are best-effort; an explicit user action will show errors.
    }
  }

  function schedulePassiveDashboardRefresh() {
    if (passiveRefreshTimer) {
      clearTimeout(passiveRefreshTimer);
    }
    passiveRefreshTimer = setTimeout(() => {
      passiveRefreshTimer = null;
      void refreshDashboardPassive();
    }, 120);
  }

  function hostPermissionPattern(rawUrl) {
    try {
      const url = new URL(rawUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return null;
      }
      return `${url.protocol}//${url.host}/*`;
    } catch (_error) {
      return null;
    }
  }

  function runPrimaryTabAction() {
    const session = selectedSession();
    const mode = session?.mode || MODE.INACTIVE;
    if (mode === MODE.ACTIVE) {
      void request(MESSAGE.PAUSE_TAB, { tabId: selectedTabId }, "Tab paused.");
      return;
    }
    if (mode === MODE.PAUSED) {
      void request(MESSAGE.RESUME_TAB, { tabId: selectedTabId }, "Tab resumed.");
      return;
    }
    activateCurrentTab();
  }

  function activateCurrentTab() {
    const current = dashboard.currentTab;
    if (!Number.isInteger(current?.tabId) || Number(current.tabId) !== Number(selectedTabId)) {
      showMessage("Select the current tab before activating it.", "error");
      return;
    }

    const activationTabId = current.tabId;
    const activeTabSerialAtStart = activeTabRefreshSerial;
    const origin = hostPermissionPattern(current.url);
    if (!origin) {
      showMessage("Only normal HTTP or HTTPS pages can be activated.", "error");
      return;
    }

    // Call permissions.request() directly inside the click handler so Firefox
    // recognizes this as a user action. Request only the current website.
    const permissionRequest = browser.permissions.request({ origins: [origin] });
    setBusy(true);
    showMessage(`Requesting access to ${origin}`);

    void permissionRequest.then(async (granted) => {
      if (!granted) {
        throw new Error("Site access was not granted, so the tab was not activated.");
      }
      const response = await browser.runtime.sendMessage({
        type: MESSAGE.ACTIVATE_CURRENT,
        tabId: activationTabId,
        profileId: (autoProfileByUrl && !manualProfileSelectionByTab.has(Number(activationTabId)))
          ? null
          : selectedProfileId
      });
      if (!response) {
        throw new Error("The background script did not respond.");
      }
      if (!response.ok) {
        throw new Error(response.error || "Could not activate the current tab.");
      }
      if (response.dashboard && activeTabSerialAtStart === activeTabRefreshSerial) {
        render(response.dashboard, true, activationTabId);
      }
      showMessage(`Site access granted and tab ${activationTabId} activated.`, "success");
    }).catch((error) => {
      showMessage(error instanceof Error ? error.message : String(error), "error");
    }).finally(() => {
      setBusy(false);
    });
  }

  function toggleElementPicker(kind) {
    const current = dashboard.currentTab;
    if (!Number.isInteger(current?.tabId) || Number(current.tabId) !== Number(selectedTabId)) {
      showMessage("Elements can be picked only in the currently displayed tab.", "error");
      return;
    }
    const tabId = current.tabId;
    const activePicker = selectedPicker();
    if (activePicker?.kind === kind) {
      setBusy(true);
      void browser.runtime.sendMessage({
        type: MESSAGE.CANCEL_ELEMENT_PICKER,
        tabId,
        reason: "sidebar-toggle"
      }).then((response) => {
        if (!response?.ok) throw new Error(response?.error || "Could not cancel the element picker.");
        if (response.dashboard) render(response.dashboard, false, tabId);
        showMessage("Element picker cancelled.", "success");
      }).catch((error) => {
        showMessage(error instanceof Error ? error.message : String(error), "error");
      }).finally(() => setBusy(false));
      return;
    }
    const origin = hostPermissionPattern(current.url);
    if (!origin) {
      showMessage("Elements can be picked only on normal HTTP or HTTPS pages.", "error");
      return;
    }
    const permissionRequest = browser.permissions.request({ origins: [origin] });
    setBusy(true);
    showMessage("Preparing the element picker…");
    void permissionRequest.then(async (granted) => {
      if (!granted) throw new Error("Site access was not granted.");
      const response = await browser.runtime.sendMessage({
        type: MESSAGE.START_ELEMENT_PICKER,
        tabId,
        kind
      });
      if (!response?.ok) throw new Error(response?.error || "Could not start the element picker.");
      if (response.dashboard) render(response.dashboard, false, tabId);
      showMessage("Hover the page, click the element to select it, or press Esc to cancel.", "success");
    }).catch((error) => {
      showMessage(error instanceof Error ? error.message : String(error), "error");
    }).finally(() => setBusy(false));
  }

  function selectorTestStat(label, value, kind, empty = false) {
    const item = document.createElement("span");
    item.className = "selector-test-stat";
    item.dataset.kind = kind;
    item.dataset.empty = empty ? "true" : "false";
    const caption = document.createElement("span");
    caption.textContent = label;
    const count = document.createElement("strong");
    count.textContent = String(value);
    item.append(caption, count);
    return item;
  }

  function renderSelectorTestResult(output, result, kind) {
    output.replaceChildren();
    const summary = document.createElement("span");
    summary.className = "selector-test-summary";
    const totalCount = Number(result.totalCount) || 0;
    const matchedCount = kind === "monitor"
      ? Number(result.conditionMatchedCount ?? result.selectedCount) || 0
      : Number(result.selectedCount) || 0;
    const expectation = kind === "verify" ? elements.verifyExpectation.value : null;
    const verifyPass = kind !== "verify" ? null : (
      expectation === "not_exists"
        ? totalCount === 0
        : (expectation === "hidden" ? totalCount > 0 && matchedCount === totalCount : matchedCount > 0)
    );
    summary.append(
      selectorTestStat("Selector matches", totalCount, "found", kind === "verify" && expectation === "not_exists" ? false : totalCount === 0),
      selectorTestStat(
        kind === "monitor" ? "Condition matches" : (kind === "verify" ? "Verification matches" : "Selected"),
        kind === "verify" ? (verifyPass ? "PASS" : "FAIL") : matchedCount,
        "matched",
        kind === "verify" ? !verifyPass : matchedCount === 0
      )
    );

    const detail = document.createElement("span");
    detail.className = "selector-test-detail";
    if (kind === "monitor") {
      const conditionText = Number(result.enabledConditionCount) > 0
        ? `${result.enabledConditionCount} enabled attribute condition(s)`
        : "no attribute conditions; every selector match passes the static check";
      detail.textContent = `Visible ${result.visibleCount}; hidden ${result.hiddenCount}; ${conditionText}. Dashed orange = selector-only match; green = condition match. Highlights remain for 8 seconds.`;
    } else {
      detail.textContent = `Visible ${result.visibleCount}; hidden ${result.hiddenCount}. Highlights remain for 8 seconds.`;
    }
    output.append(summary, detail);
  }

  function testSelector(kind) {
    const current = dashboard.currentTab;
    if (!Number.isInteger(current?.tabId) || Number(current.tabId) !== Number(selectedTabId)) {
      showMessage("Selectors can be tested only in the currently displayed tab.", "error");
      return;
    }

    const tabId = current.tabId;
    const origin = hostPermissionPattern(current.url);
    if (!origin) {
      showMessage("Selectors can be tested only on normal HTTP or HTTPS pages.", "error");
      return;
    }

    const output = kind === "monitor"
      ? elements.monitorTestResult
      : (kind === "verify" ? elements.verifyTestResult : elements.targetTestResult);
    const selector = readSelector(kind);
    const visibility = kind === "monitor"
      ? "any"
      : (kind === "verify"
        ? (elements.verifyExpectation.value === "visible" ? "visible" : (elements.verifyExpectation.value === "hidden" ? "hidden" : "any"))
        : (elements.visibleOnly.checked ? "visible" : "any"));

    output.textContent = "Testing…";
    const permissionRequest = browser.permissions.request({ origins: [origin] });
    setBusy(true);
    void permissionRequest.then(async (granted) => {
      if (!granted) {
        throw new Error("Site access was not granted.");
      }
      const response = await browser.runtime.sendMessage({
        type: MESSAGE.TEST_SELECTOR,
        tabId,
        selector,
        visibility,
        kind,
        config: kind === "monitor" ? readConfig() : null
      });
      if (!response?.ok) {
        throw new Error(response?.error || "Could not test the selector.");
      }
      renderSelectorTestResult(output, response.result, kind);
      const matchedCount = kind === "monitor"
        ? Number(response.result.conditionMatchedCount ?? response.result.selectedCount) || 0
        : Number(response.result.selectedCount) || 0;
      const expectation = elements.verifyExpectation.value;
      const verifyPass = kind !== "verify" ? null : (
        expectation === "not_exists"
          ? Number(response.result.totalCount) === 0
          : (expectation === "hidden"
            ? Number(response.result.totalCount) > 0 && matchedCount === Number(response.result.totalCount)
            : matchedCount > 0)
      );
      showMessage(
        kind === "monitor"
          ? `Found ${response.result.totalCount} element(s); ${matchedCount} match the conditions.`
          : (kind === "verify"
            ? `Verify ${expectation}: found ${response.result.totalCount}; ${matchedCount} match the visibility expectation; ${verifyPass ? "PASS" : "not satisfied"}.`
            : `Target selector tested: ${response.result.selectedCount}/${response.result.totalCount} element(s) selected.`),
        (kind === "verify" ? verifyPass : matchedCount > 0) ? "success" : "error"
      );
    }).catch((error) => {
      output.textContent = "Test failed.";
      showMessage(error instanceof Error ? error.message : String(error), "error");
    }).finally(() => {
      setBusy(false);
    });
  }

  function testTargetAction(click) {
    const current = dashboard.currentTab;
    if (!Number.isInteger(current?.tabId) || Number(current.tabId) !== Number(selectedTabId)) {
      showMessage("Targets can be tested only in the currently displayed tab.", "error");
      return;
    }
    if (click && !confirm("The test click will interact with the current target. Continue?")) {
      return;
    }
    void request(MESSAGE.TEST_TARGET_ACTION, {
      tabId: current.tabId,
      config: readConfig(),
      click: Boolean(click)
    }, click ? "Current target clicked for testing." : "Current target dry run completed.").then((response) => {
      if (response?.result) {
        elements.targetTestResult.textContent = `Total ${response.result.totalCount}; eligible ${response.result.eligibleCount}; handled ${response.result.selectedCount}; ${click ? "clicked" : "highlighted only"}.`;
      }
    });
  }

  function createShellPresetFromForm(name, id = null) {
    return Settings.normalizeShellPreset({
      id: id || Settings.makeId("command-preset"),
      name,
      enabled: elements.shellPresetEnabled.checked,
      workingDirectory: elements.workingDirectory.value,
      command: elements.shellCommand.value,
      mode: elements.shellMode.value,
      confirmBeforeRun: elements.confirmBeforeRun.checked
    }, shellPresetsDraft.length);
  }

  function loadSelectedShellPreset() {
    const preset = selectedShellPreset();
    if (!preset) {
      showMessage("Select a command preset first.", "error");
      return;
    }
    loadShellValues(preset);
    showMessage(`Loaded preset “${preset.name}”. Save the profile or tab configuration to persist changes.`, "success");
  }

  function newShellPreset() {
    const name = elements.shellPresetName.value.trim() || prompt("New command preset name:", "Command preset");
    if (!name) return;
    const preset = createShellPresetFromForm(name);
    shellPresetsDraft.push(preset);
    selectedShellPresetId = preset.id;
    renderShellPresetOptions();
    showMessage("Command preset added to the draft. Save the profile or tab configuration to persist it.", "success");
  }

  function updateShellPreset() {
    const preset = selectedShellPreset();
    if (!preset) {
      showMessage("Select a command preset first.", "error");
      return;
    }
    const updated = createShellPresetFromForm(elements.shellPresetName.value.trim() || preset.name, preset.id);
    shellPresetsDraft = shellPresetsDraft.map((item) => item.id === preset.id ? updated : item);
    renderShellPresetOptions();
    showMessage("Command preset updated in the draft. Save the profile or tab configuration to persist it.", "success");
  }

  function deleteShellPreset() {
    const preset = selectedShellPreset();
    if (!preset || !confirm(`Delete command preset “${preset.name}”?`)) return;
    shellPresetsDraft = shellPresetsDraft.filter((item) => item.id !== preset.id);
    selectedShellPresetId = "";
    renderShellPresetOptions();
    showMessage("Command preset deleted from the draft. Save the profile or tab configuration to persist it.", "success");
  }

  function loadSelectedShellHistory() {
    const id = elements.shellHistorySelect.value;
    const history = Array.isArray(selectedSession()?.shellHistory) ? selectedSession().shellHistory : [];
    const entry = history.find((item) => item.id === id);
    if (!entry) {
      showMessage("Select a command history entry first.", "error");
      return;
    }
    loadShellValues(entry);
    selectedShellPresetId = entry.presetId || "";
    renderShellPresetOptions();
    showMessage("Command history entry loaded into the editor.", "success");
  }

  function commandConfirmation(shell) {
    return `Run local command?

Working directory:
${shell.workingDirectory}

Mode: ${shell.mode}

Command:
${shell.command}`;
  }

  function runShellCommand() {
    const session = selectedSession();
    if (!session) {
      showMessage("Activate the tab before running a command.", "error");
      return;
    }
    const shell = readConfig().shell;
    if (!shell.workingDirectory.trim() || !shell.command.trim()) {
      showMessage("Working directory and command must not be empty.", "error");
      return;
    }
    if (shell.confirmBeforeRun && !confirm(commandConfirmation(shell))) {
      return;
    }
    void request(MESSAGE.RUN_SHELL, {
      tabId: selectedTabId,
      cwd: shell.workingDirectory,
      command: shell.command,
      mode: shell.mode
    }, shell.mode === "terminal" ? "Terminal launch requested." : "Background command started.");
  }

  function stopShellCommand() {
    const run = selectedShellRun();
    if (!shellIsActive(run)) {
      showMessage("This tab has no running command.", "error");
      return;
    }
    if (!confirm(`Stop the command for tab ${selectedTabId}?

${run.command || ""}`)) {
      return;
    }
    void request(MESSAGE.STOP_SHELL, { tabId: selectedTabId }, "Stop request sent.");
  }

  async function copySelectedLogs() {
    const text = selectedLogs().map(formatLogLine).join("\n");
    if (!text) {
      showMessage("The current log channel is empty.", "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      showMessage("Tab log copied.", "success");
    } catch (_error) {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.append(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
      showMessage("Tab log copied.", "success");
    }
  }

  async function refreshForActiveTab(preferredTabId) {
    const refreshSerial = ++activeTabRefreshSerial;
    try {
      const response = await browser.runtime.sendMessage({ type: MESSAGE.GET_DASHBOARD });
      if (refreshSerial !== activeTabRefreshSerial) {
        return;
      }
      if (!response) {
        throw new Error("The background script did not respond.");
      }
      if (!response.ok) {
        throw new Error(response.error || "Could not synchronize the current tab.");
      }
      const requestedTabId = Number(preferredTabId);
      const tabId = Number.isInteger(requestedTabId)
        ? requestedTabId
        : response.dashboard?.currentTab?.tabId;
      render(response.dashboard, true, tabId);
    } catch (error) {
      if (refreshSerial === activeTabRefreshSerial) {
        showMessage(error instanceof Error ? error.message : String(error), "error");
      }
    }
  }

  function setBusy(value) {
    busy = Boolean(value);
    renderDetails(false);
    elements.refreshButton.disabled = busy;
    elements.saveProfileButton.disabled = busy;
  }

  async function request(type, payload = {}, successText = "", options = {}) {
    setBusy(true);
    showMessage();
    try {
      const response = await browser.runtime.sendMessage({ type, ...payload });
      if (!response) {
        throw new Error("The background script did not respond.");
      }
      if (!response.ok) {
        throw new Error(response.error || "The operation failed.");
      }
      if (response.profileId) {
        selectedProfileId = response.profileId;
      }
      if (response.dashboard) {
        const reloadForm = options.reloadForm ?? FORM_RELOAD_MESSAGE_TYPES.has(type);
        if (reloadForm) {
          render(response.dashboard, true, options.preferredTabId ?? null);
        } else {
          renderRuntimeDashboard(response.dashboard);
        }
      }
      if (successText) {
        showMessage(successText, "success");
      }
      return response;
    } catch (error) {
      showMessage(error instanceof Error ? error.message : String(error), "error");
      return null;
    } finally {
      setBusy(false);
    }
  }

  function selectRuleForEditing(ruleId) {
    const current = readConfig();
    const rule = ruleById(current, ruleId);
    if (!rule) {
      return;
    }
    selectedRuleId = rule.id;
    formConfigDraft = Settings.normalizeConfig({
      ...current,
      activeRuleId: rule.id,
      monitor: rule.monitor,
      target: rule.target
    });
    renderRuleOptions();
    writeRuleFields(rule);
    renderRuleRuntimeSummary();
  }

  function addRule(duplicate = false) {
    const current = readConfig();
    const source = duplicate ? ruleById(current, selectedRuleId) : Settings.defaultRule();
    const id = Settings.makeId("rule");
    const defaultName = duplicate ? `${source?.name || "Rule"} - copy` : `Rule ${current.rules.length + 1}`;
    const name = prompt(duplicate ? "Rule copy name:" : "New rule name:", defaultName);
    if (!name) {
      return;
    }
    const nextRule = {
      ...(source || Settings.defaultRule()),
      id,
      name: name.trim() || defaultName,
      enabled: true,
      monitor: Settings.clone((source || Settings.defaultRule()).monitor),
      target: Settings.clone((source || Settings.defaultRule()).target)
    };
    formConfigDraft = Settings.normalizeConfig({
      ...current,
      activeRuleId: id,
      rules: [...current.rules, nextRule],
      monitor: nextRule.monitor,
      target: nextRule.target
    });
    selectedRuleId = id;
    renderRuleOptions();
    writeRuleFields(nextRule);
    renderRuleRuntimeSummary();
    showMessage(`Added rule “${nextRule.name}” to the draft. Save the profile or save for this tab to apply it.`, "success");
  }

  function deleteSelectedRule() {
    const current = readConfig();
    if (current.rules.length <= 1) {
      showMessage("A profile must contain at least one rule.", "error");
      return;
    }
    const rule = ruleById(current, selectedRuleId);
    if (!rule || !confirm(`Remove rule “${rule.name}” from the draft?`)) {
      return;
    }
    const index = current.rules.findIndex((item) => item.id === rule.id);
    const rules = current.rules.filter((item) => item.id !== rule.id);
    const nextRule = rules[Math.min(index, rules.length - 1)];
    formConfigDraft = Settings.normalizeConfig({
      ...current,
      activeRuleId: nextRule.id,
      rules,
      monitor: nextRule.monitor,
      target: nextRule.target
    });
    selectedRuleId = nextRule.id;
    renderRuleOptions();
    writeRuleFields(nextRule);
    renderRuleRuntimeSummary();
    showMessage(`Removed rule “${rule.name}” from the draft.`, "success");
  }

  elements.tabSelect.addEventListener("change", () => {
    selectedTabId = Number(elements.tabSelect.value);
    const session = selectedSession();
    selectedProfileId = session?.profileId || dashboard.store.defaultProfileId;
    elements.profileSelect.value = selectedProfileId;
    renderDetails(true);
    applyPendingPickerResult();
  });
  elements.ruleSelect.addEventListener("change", () => {
    selectRuleForEditing(elements.ruleSelect.value);
  });
  elements.ruleName.addEventListener("input", () => {
    const option = [...elements.ruleSelect.options].find((item) => item.value === selectedRuleId);
    if (option) {
      option.textContent = `${elements.ruleEnabled.checked ? "●" : "○"} ${elements.ruleName.value.trim() || "Rule"}`;
    }
  });
  elements.ruleEnabled.addEventListener("change", () => {
    elements.ruleName.dispatchEvent(new Event("input"));
    renderRuleRuntimeSummary();
  });
  elements.newRuleButton.addEventListener("click", () => addRule(false));
  elements.duplicateRuleButton.addEventListener("click", () => addRule(true));
  elements.deleteRuleButton.addEventListener("click", deleteSelectedRule);
  elements.profileSelect.addEventListener("change", () => {
    selectedProfileId = elements.profileSelect.value;
    if (Number.isInteger(Number(selectedTabId)) && !selectedSession()) {
      manualProfileSelectionByTab.set(Number(selectedTabId), selectedProfileId);
    }
    const profile = profileById(selectedProfileId);
    elements.profileName.value = profile?.name || "";
    writeConfig(profile?.config || Settings.defaultConfig());
  });
  elements.autoProfileByUrl.addEventListener("change", () => {
    autoProfileByUrl = elements.autoProfileByUrl.checked;
    if (autoProfileByUrl) {
      manualProfileSelectionByTab.delete(Number(selectedTabId));
      const routing = renderUrlRoutingPreview();
      if (!selectedSession() && routing.profileId) {
        selectedProfileId = routing.profileId;
        elements.profileSelect.value = selectedProfileId;
        const profile = profileById(selectedProfileId);
        elements.profileName.value = profile?.name || "";
        writeConfig(profile?.config || Settings.defaultConfig());
      }
    }
    void persistSidebarUi();
  });
  elements.testUrlRoutingButton.addEventListener("click", () => {
    const routing = renderUrlRoutingPreview(true);
    showMessage(routing.matched
      ? `The URL matches ${routing.candidates.length} profile(s); the preferred profile is ${routing.profileName}.`
      : `The URL does not match profile routing; ${routing.profileName ? `fallback ${routing.profileName}` : "no fallback"}.`,
    routing.matched ? "success" : "info");
  });
  elements.useRoutedProfileButton.addEventListener("click", () => {
    const routing = renderUrlRoutingPreview(true);
    if (!routing.profileId) {
      showMessage("No matching profile is available.", "error");
      return;
    }
    manualProfileSelectionByTab.delete(Number(selectedTabId));
    selectedProfileId = routing.profileId;
    elements.profileSelect.value = selectedProfileId;
    const profile = profileById(selectedProfileId);
    elements.profileName.value = profile?.name || "";
    writeConfig(profile?.config || Settings.defaultConfig());
    showMessage(`Selected profile “${routing.profileName}” by URL.`, "success");
  });
  elements.addConditionButton.addEventListener("click", () => addConditionRow());
  elements.monitorPickerButton.addEventListener("click", () => toggleElementPicker("monitor"));
  elements.monitorTestButton.addEventListener("click", () => testSelector("monitor"));
  elements.targetPickerButton.addEventListener("click", () => toggleElementPicker("target"));
  elements.targetTestButton.addEventListener("click", () => testSelector("target"));
  elements.verifyPickerButton.addEventListener("click", () => toggleElementPicker("verify"));
  elements.verifyTestButton.addEventListener("click", () => testSelector("verify"));
  elements.targetDryRunTestButton.addEventListener("click", () => testTargetAction(false));
  elements.targetClickTestButton.addEventListener("click", () => testTargetAction(true));
  elements.targetClickQuickButton.addEventListener("click", () => testTargetAction(true));
  elements.logChannel.addEventListener("change", renderActivityLog);
  elements.copyLogsButton.addEventListener("click", () => void copySelectedLogs());
  elements.clearLogsButton.addEventListener("click", () => {
    if (selectedSession() && confirm("Clear all user and debug logs for this tab?")) {
      void request(MESSAGE.CLEAR_SESSION_LOGS, { tabId: selectedTabId }, "Tab logs cleared.");
    }
  });
  elements.clearHighlightsButton.addEventListener("click", () => void request(MESSAGE.CLEAR_HIGHLIGHTS, { tabId: selectedTabId }, "Tab highlights cleared."));
  elements.shellPresetSelect.addEventListener("change", () => {
    selectedShellPresetId = elements.shellPresetSelect.value;
    renderShellPresetOptions();
  });
  elements.loadShellPresetButton.addEventListener("click", loadSelectedShellPreset);
  elements.newShellPresetButton.addEventListener("click", newShellPreset);
  elements.updateShellPresetButton.addEventListener("click", updateShellPreset);
  elements.deleteShellPresetButton.addEventListener("click", deleteShellPreset);
  elements.loadShellHistoryButton.addEventListener("click", loadSelectedShellHistory);
  elements.clearShellHistoryButton.addEventListener("click", () => {
    if (selectedSession() && confirm("Clear command history for this tab session?")) {
      void request(MESSAGE.CLEAR_SHELL_HISTORY, { tabId: selectedTabId }, "Tab command history cleared.");
    }
  });
  elements.checkNativeButton.addEventListener("click", () => void request(MESSAGE.GET_NATIVE_STATUS, {}, "Native Host status requested."));
  elements.runShellButton.addEventListener("click", runShellCommand);
  elements.stopShellButton.addEventListener("click", stopShellCommand);
  elements.clearShellOutputButton.addEventListener("click", () => void request(MESSAGE.CLEAR_SHELL_OUTPUT, { tabId: selectedTabId }, "Tab output cleared."));
  elements.refreshButton.addEventListener("click", () => void request(MESSAGE.GET_DASHBOARD));
  elements.tabPrimaryQuickButton.addEventListener("click", runPrimaryTabAction);
  elements.tabStopQuickButton.addEventListener("click", () => void request(MESSAGE.STOP_TAB, { tabId: selectedTabId }, "Tab stopped."));
  elements.activateButton.addEventListener("click", activateCurrentTab);
  elements.pauseButton.addEventListener("click", () => void request(MESSAGE.PAUSE_TAB, { tabId: selectedTabId }, "Tab paused."));
  elements.resumeButton.addEventListener("click", () => void request(MESSAGE.RESUME_TAB, { tabId: selectedTabId }, "Tab resumed."));
  elements.stopButton.addEventListener("click", () => void request(MESSAGE.STOP_TAB, { tabId: selectedTabId }, "Tab stopped."));
  elements.assignProfileButton.addEventListener("click", () => void request(MESSAGE.ASSIGN_PROFILE, { tabId: selectedTabId, profileId: selectedProfileId }, "Profile applied to tab."));
  elements.saveTabButton.addEventListener("click", () => void request(MESSAGE.SAVE_TAB_CONFIG, { tabId: selectedTabId, config: readConfig() }, "Tab-specific configuration saved."));
  elements.resetTabButton.addEventListener("click", () => void request(MESSAGE.RESET_TAB_CONFIG, { tabId: selectedTabId }, "The tab now uses its profile configuration."));
  elements.newProfileButton.addEventListener("click", () => {
    const name = prompt("New profile name:", "New profile");
    if (name) void request(MESSAGE.CREATE_PROFILE, { name, baseProfileId: selectedProfileId }, "Profile created.");
  });
  elements.duplicateProfileButton.addEventListener("click", () => {
    const base = profileById(selectedProfileId);
    const name = prompt("Copy name:", `${base?.name || "Profile"} - copy`);
    if (name) void request(MESSAGE.DUPLICATE_PROFILE, { profileId: selectedProfileId, name }, "Profile duplicated.");
  });
  elements.deleteProfileButton.addEventListener("click", () => {
    const profile = profileById(selectedProfileId);
    if (profile && confirm(`Delete profile “${profile.name}”?`)) {
      void request(MESSAGE.DELETE_PROFILE, { profileId: profile.id }, "Profile deleted.");
    }
  });
  elements.saveProfileButton.addEventListener("click", () => {
    const profile = profileById(selectedProfileId);
    if (!profile) return;
    void request(MESSAGE.SAVE_PROFILE, {
      profile: { ...profile, name: elements.profileName.value, config: readConfig() }
    }, "Profile saved and active tabs using it were updated.");
  });
  elements.exportButton.addEventListener("click", async () => {
    const response = await request(MESSAGE.EXPORT_SETTINGS);
    if (!response?.text) return;
    const blob = new Blob([response.text], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `firefox-chat-improver-settings-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });
  elements.importButton.addEventListener("click", () => elements.importFile.click());
  elements.importFile.addEventListener("change", async () => {
    const file = elements.importFile.files?.[0];
    if (!file) return;
    const text = await file.text();
    await request(MESSAGE.IMPORT_SETTINGS, { text }, "Settings imported.");
    elements.importFile.value = "";
  });

  browser.runtime.onMessage.addListener((message) => {
    if (message?.type === MESSAGE.PICKER_RESULT) {
      applyPickerResult(message);
      return undefined;
    }
    if (message?.type !== MESSAGE.DASHBOARD_CHANGED) {
      return undefined;
    }
    if (message.reason === "active-tab-changed") {
      elements.monitorTestResult.textContent = "";
      elements.targetTestResult.textContent = "";
      elements.verifyTestResult.textContent = "";
      void refreshForActiveTab(message.changedTabId);
    } else {
      schedulePassiveDashboardRefresh();
    }
    return undefined;
  });

  void initializeCollapsibleGroups().finally(() => {
    void request(MESSAGE.GET_DASHBOARD);
  });
})();
