(() => {
  "use strict";

  const { MESSAGE, MODE, CONFIG_MODE } = globalThis.FCI_PROTOCOL;
  const Settings = globalThis.FCI_SETTINGS;
  const LocalActions = globalThis.FCI_LOCAL_ACTIONS;
  const SupportBundle = globalThis.FCI_SUPPORT_BUNDLE;
  const WorkingSession = globalThis.FCI_WORKING_SESSION;
  const SIDEBAR_UI_STORAGE_KEY = "firefoxChatImprover.sidebarUi.v1";
  const $ = (selector) => document.querySelector(selector);
  const elements = {
    body: document.body,
    statusPill: $("#statusPill"), tabSelect: $("#tabSelect"), tabId: $("#tabId"),
    modeText: $("#modeText"), configModeText: $("#configModeText"), profileText: $("#profileText"), tabUrl: $("#tabUrl"),
    monitorStateText: $("#monitorStateText"), monitorCountText: $("#monitorCountText"), monitorMatchedText: $("#monitorMatchedText"), monitorCycleText: $("#monitorCycleText"), ruleCountText: $("#ruleCountText"), matchedRuleCountText: $("#matchedRuleCountText"), monitorTransitionText: $("#monitorTransitionText"), alertStateText: $("#alertStateText"), targetStateText: $("#targetStateText"), baselineCountText: $("#baselineCountText"), candidateCountText: $("#candidateCountText"), targetActionCountText: $("#targetActionCountText"), lastTargetActionText: $("#lastTargetActionText"),
    activateButton: $("#activateButton"), pauseButton: $("#pauseButton"), resumeButton: $("#resumeButton"), stopButton: $("#stopButton"), refreshButton: $("#refreshButton"), tabPrimaryQuickButton: $("#tabPrimaryQuickButton"), tabStopQuickButton: $("#tabStopQuickButton"),
    profileSelect: $("#profileSelect"), profileName: $("#profileName"), assignProfileButton: $("#assignProfileButton"), newProfileButton: $("#newProfileButton"), duplicateProfileButton: $("#duplicateProfileButton"), deleteProfileButton: $("#deleteProfileButton"),
    ruleSelect: $("#ruleSelect"), ruleName: $("#ruleName"), ruleEnabled: $("#ruleEnabled"), newRuleButton: $("#newRuleButton"), duplicateRuleButton: $("#duplicateRuleButton"), deleteRuleButton: $("#deleteRuleButton"), ruleRuntimeSummary: $("#ruleRuntimeSummary"), ruleRuntimeBadge: $("#ruleRuntimeBadge"), ruleCommandEnabled: $("#ruleCommandEnabled"), ruleCommandPreset: $("#ruleCommandPreset"), ruleCommandTrigger: $("#ruleCommandTrigger"), ruleCommandAllowDryRun: $("#ruleCommandAllowDryRun"), ruleCommandStatus: $("#ruleCommandStatus"),
    autoProfileByUrl: $("#autoProfileByUrl"), routingEnabled: $("#routingEnabled"), routingPriority: $("#routingPriority"), requireUrlMatch: $("#requireUrlMatch"), urlPatterns: $("#urlPatterns"), testUrlRoutingButton: $("#testUrlRoutingButton"), useRoutedProfileButton: $("#useRoutedProfileButton"), urlRoutingResult: $("#urlRoutingResult"),
    monitorTag: $("#monitorTag"), monitorKind: $("#monitorKind"), monitorAttributeName: $("#monitorAttributeName"), monitorValue: $("#monitorValue"), monitorVisibilityTransition: $("#monitorVisibilityTransition"), matchStableMs: $("#matchStableMs"), resetStableMs: $("#resetStableMs"), monitorPickerButton: $("#monitorPickerButton"), monitorTestButton: $("#monitorTestButton"), monitorTestResult: $("#monitorTestResult"), conditionJoin: $("#conditionJoin"), addConditionButton: $("#addConditionButton"), conditionsList: $("#conditionsList"), conditionTemplate: $("#conditionTemplate"),
    targetEnabled: $("#targetEnabled"), targetTag: $("#targetTag"), targetKind: $("#targetKind"), targetAttributeName: $("#targetAttributeName"), targetValue: $("#targetValue"), targetPickerButton: $("#targetPickerButton"), targetTestButton: $("#targetTestButton"), targetTestResult: $("#targetTestResult"), targetDryRunTestButton: $("#targetDryRunTestButton"), targetClickTestButton: $("#targetClickTestButton"), targetClickQuickButton: $("#targetClickQuickButton"), clickStrategy: $("#clickStrategy"), maxClicksPerCycle: $("#maxClicksPerCycle"), visibleOnly: $("#visibleOnly"), enabledOnly: $("#enabledOnly"), dryRun: $("#dryRun"), fingerprintAttributes: $("#fingerprintAttributes"), pipelineEnabled: $("#pipelineEnabled"), preActionDelayMs: $("#preActionDelayMs"), postActionDelayMs: $("#postActionDelayMs"), verifyEnabled: $("#verifyEnabled"), verifyTag: $("#verifyTag"), verifyKind: $("#verifyKind"), verifyAttributeName: $("#verifyAttributeName"), verifyValue: $("#verifyValue"), verifyPickerButton: $("#verifyPickerButton"), verifyTestButton: $("#verifyTestButton"), verifyTestResult: $("#verifyTestResult"), verifyExpectation: $("#verifyExpectation"), verifyTimeoutMs: $("#verifyTimeoutMs"), verifyPollIntervalMs: $("#verifyPollIntervalMs"), pipelineRuntimeText: $("#pipelineRuntimeText"),
    titleBlink: $("#titleBlink"), titlePrefix: $("#titlePrefix"), blinkIntervalMs: $("#blinkIntervalMs"), badgeAlert: $("#badgeAlert"), sidebarAlert: $("#sidebarAlert"), notificationAlert: $("#notificationAlert"), dismissOnUserActivity: $("#dismissOnUserActivity"), activeTabTimeoutSeconds: $("#activeTabTimeoutSeconds"),
    logChannel: $("#logChannel"), activityLog: $("#activityLog"), copyLogsButton: $("#copyLogsButton"), exportSupportBundleButton: $("#exportSupportBundleButton"), clearLogsButton: $("#clearLogsButton"),
    localActionProfileSelect: $("#localActionProfileSelect"), localActionProfileName: $("#localActionProfileName"), localActionModeStatus: $("#localActionModeStatus"), localActionDraftStatus: $("#localActionDraftStatus"), localActionSourceSummary: $("#localActionSourceSummary"), assignLocalActionProfileButton: $("#assignLocalActionProfileButton"), newLocalActionProfileButton: $("#newLocalActionProfileButton"), saveLocalActionProfileButton: $("#saveLocalActionProfileButton"), deleteLocalActionProfileButton: $("#deleteLocalActionProfileButton"), localActionRoutingEnabled: $("#localActionRoutingEnabled"), localActionRoutingPriority: $("#localActionRoutingPriority"), localActionUrlPatterns: $("#localActionUrlPatterns"), managedDownloadEnabled: $("#managedDownloadEnabled"), downloadDestinationDirectory: $("#downloadDestinationDirectory"), downloadCaptureWindowSeconds: $("#downloadCaptureWindowSeconds"), downloadConflictAction: $("#downloadConflictAction"), showDownloadCompletionDialog: $("#showDownloadCompletionDialog"), executeShellAfterMove: $("#executeShellAfterMove"), downloadStateSummary: $("#downloadStateSummary"), retryDownloadMoveButton: $("#retryDownloadMoveButton"), saveTabLocalActionsButton: $("#saveTabLocalActionsButton"), resetTabLocalActionsButton: $("#resetTabLocalActionsButton"), revertLocalActionDraftButton: $("#revertLocalActionDraftButton"), downloadCompletionMessage: $("#downloadCompletionMessage"), downloadCompletionPath: $("#downloadCompletionPath"), downloadCompletionDialog: $("#downloadCompletionDialog"), executeShellAfterDownloadButton: $("#executeShellAfterDownloadButton"), acknowledgeDownloadButton: $("#acknowledgeDownloadButton"),
    shellPresetSelect: $("#shellPresetSelect"), shellPresetName: $("#shellPresetName"), shellPresetEnabled: $("#shellPresetEnabled"), loadShellPresetButton: $("#loadShellPresetButton"), newShellPresetButton: $("#newShellPresetButton"), updateShellPresetButton: $("#updateShellPresetButton"), deleteShellPresetButton: $("#deleteShellPresetButton"), requireShellPresetMatch: $("#requireShellPresetMatch"),
    workingDirectory: $("#workingDirectory"), shellCommand: $("#shellCommand"), shellMode: $("#shellMode"), confirmBeforeRun: $("#confirmBeforeRun"), rememberShellHistory: $("#rememberShellHistory"), shellHistoryLimit: $("#shellHistoryLimit"), shellHistorySelect: $("#shellHistorySelect"), loadShellHistoryButton: $("#loadShellHistoryButton"), clearShellHistoryButton: $("#clearShellHistoryButton"),
    nativeHostStatus: $("#nativeHostStatus"), shellRunStatus: $("#shellRunStatus"), shellRunPid: $("#shellRunPid"), shellRunId: $("#shellRunId"), shellOutput: $("#shellOutput"), checkNativeButton: $("#checkNativeButton"), runShellButton: $("#runShellButton"), stopShellButton: $("#stopShellButton"), clearShellOutputButton: $("#clearShellOutputButton"), openShellLogButton: $("#openShellLogButton"), runShellQuickButton: $("#runShellQuickButton"), stopShellQuickButton: $("#stopShellQuickButton"), openShellLogQuickButton: $("#openShellLogQuickButton"),
    shellLogDialog: $("#shellLogDialog"), shellLogDialogTitle: $("#shellLogDialogTitle"), shellLogMetadata: $("#shellLogMetadata"), shellLogViewer: $("#shellLogViewer"), shellLogPageInfo: $("#shellLogPageInfo"), closeShellLogDialogButton: $("#closeShellLogDialogButton"), shellLogFirstButton: $("#shellLogFirstButton"), shellLogPreviousButton: $("#shellLogPreviousButton"), shellLogNextButton: $("#shellLogNextButton"), shellLogLastButton: $("#shellLogLastButton"), copyShellLogSelectionButton: $("#copyShellLogSelectionButton"), copyShellLogPageButton: $("#copyShellLogPageButton"), copyShellLogAllButton: $("#copyShellLogAllButton"), refreshShellLogButton: $("#refreshShellLogButton"), deleteShellLogButton: $("#deleteShellLogButton"),
    saveProfileButton: $("#saveProfileButton"), saveTabButton: $("#saveTabButton"), resetTabButton: $("#resetTabButton"), exportButton: $("#exportButton"), importButton: $("#importButton"), saveWorkingSessionButton: $("#saveWorkingSessionButton"), importWorkingSessionButton: $("#importWorkingSessionButton"), clearHighlightsButton: $("#clearHighlightsButton"), importFile: $("#importFile"), importWorkingSessionFile: $("#importWorkingSessionFile"), settingsSnapshotSelect: $("#settingsSnapshotSelect"), createSettingsSnapshotButton: $("#createSettingsSnapshotButton"), restoreSettingsSnapshotButton: $("#restoreSettingsSnapshotButton"), deleteSettingsSnapshotButton: $("#deleteSettingsSnapshotButton"), settingsSnapshotInfo: $("#settingsSnapshotInfo"), workingSessionDialog: $("#workingSessionDialog"), workingSessionDialogTitle: $("#workingSessionDialogTitle"), workingSessionDialogDescription: $("#workingSessionDialogDescription"), workingSessionTabList: $("#workingSessionTabList"), workingSessionResult: $("#workingSessionResult"), confirmWorkingSessionButton: $("#confirmWorkingSessionButton"), cancelWorkingSessionButton: $("#cancelWorkingSessionButton"), closeWorkingSessionDialogButton: $("#closeWorkingSessionDialogButton"), messageBox: $("#messageBox")
  };

  const modeLabels = {
    [MODE.INACTIVE]: "Inactive",
    [MODE.ACTIVE]: "Running",
    [MODE.PAUSED]: "Paused",
    [MODE.ERROR]: "Error"
  };
  let dashboard = { currentTab: {}, sessions: [], store: Settings.defaultStore(), localActionStore: LocalActions.defaultStore(), nativeHost: { connected: false, runs: [], downloads: [] } };
  let selectedTabId = null;
  let selectedProfileId = null;
  let selectedLocalActionProfileId = null;
  let selectedRuleId = null;
  let formConfigDraft = Settings.defaultConfig();
  let shellPresetsDraft = [];
  let selectedShellPresetId = "";
  let localActionBaseline = { profileId: null, tabId: null, profileName: "", config: LocalActions.defaultConfig(), fingerprint: "" };
  let localActionDraftDirty = false;
  let busy = false;
  let activeTabRefreshSerial = 0;
  let collapsedGroups = {};
  let autoProfileByUrl = true;
  const manualProfileSelectionByTab = new Map();
  const pendingPickerResults = new Map();
  const lastShownDownloadCaptureByTab = new Map();
  const autoOpenedShellRunIds = new Set();
  const lastShellStatusByTab = new Map();
  const SHELL_LOG_PAGE_BYTES = 256 * 1024;
  let shellLogState = { tabId: null, logId: null, runId: null, offset: 0, nextOffset: 0, totalBytes: 0, eof: true, pageOffsets: [], pageIndex: -1, text: "" };
  const FORM_RELOAD_MESSAGE_TYPES = new Set([
    MESSAGE.GET_DASHBOARD, MESSAGE.ACTIVATE_CURRENT, MESSAGE.STOP_TAB,
    MESSAGE.ASSIGN_PROFILE, MESSAGE.SAVE_TAB_CONFIG, MESSAGE.RESET_TAB_CONFIG,
    MESSAGE.CREATE_PROFILE, MESSAGE.DUPLICATE_PROFILE, MESSAGE.SAVE_PROFILE,
    MESSAGE.DELETE_PROFILE, MESSAGE.IMPORT_SETTINGS, MESSAGE.CREATE_SETTINGS_SNAPSHOT,
    MESSAGE.CREATE_LOCAL_ACTION_PROFILE, MESSAGE.SAVE_LOCAL_ACTION_PROFILE,
    MESSAGE.DELETE_LOCAL_ACTION_PROFILE, MESSAGE.ASSIGN_LOCAL_ACTION_PROFILE,
    MESSAGE.SAVE_TAB_LOCAL_ACTIONS, MESSAGE.RESET_TAB_LOCAL_ACTIONS,
    MESSAGE.RESTORE_SETTINGS_SNAPSHOT, MESSAGE.DELETE_SETTINGS_SNAPSHOT
  ]);
  let passiveRefreshTimer = null;
  let passiveRefreshSerial = 0;
  let workingSessionMode = null;
  let pendingWorkingSessionBundle = null;

  function showMessage(text = "", level = "info") {
    elements.messageBox.textContent = text;
    elements.messageBox.dataset.level = level;
  }

  function currentLocalActionFingerprint(config = null, profileName = null) {
    const normalized = config ? LocalActions.normalizeConfig(config) : readLocalActionConfig();
    return JSON.stringify({
      profileId: selectedLocalActionProfileId || null,
      tabId: Number.isInteger(Number(selectedTabId)) ? Number(selectedTabId) : null,
      profileName: String(profileName ?? elements.localActionProfileName?.value ?? "").trim(),
      config: LocalActions.configFingerprint(normalized)
    });
  }

  function renderLocalActionDraftStatus() {
    const card = document.querySelector('section.card[data-group-id="local-actions"]');
    if (card) card.dataset.dirty = localActionDraftDirty ? "true" : "false";
    if (elements.localActionDraftStatus) {
      elements.localActionDraftStatus.dataset.state = localActionDraftDirty ? "warning" : "online";
      elements.localActionDraftStatus.textContent = localActionDraftDirty ? "Unsaved" : "Saved";
      elements.localActionDraftStatus.title = localActionDraftDirty
        ? "The displayed download or shell settings differ from persisted storage."
        : "The displayed local-action settings match persisted storage.";
    }
    if (elements.revertLocalActionDraftButton) {
      elements.revertLocalActionDraftButton.disabled = busy || !localActionDraftDirty;
    }
  }

  function captureLocalActionBaseline(rawConfig) {
    const config = LocalActions.normalizeConfig(rawConfig);
    const profileName = elements.localActionProfileName?.value?.trim() || "";
    localActionBaseline = {
      profileId: selectedLocalActionProfileId || null,
      tabId: Number.isInteger(Number(selectedTabId)) ? Number(selectedTabId) : null,
      profileName,
      config: LocalActions.clone(config),
      fingerprint: currentLocalActionFingerprint(config, profileName)
    };
    localActionDraftDirty = false;
    renderLocalActionDraftStatus();
  }

  function updateLocalActionDraftState() {
    if (!localActionBaseline.fingerprint) return;
    localActionDraftDirty = currentLocalActionFingerprint() !== localActionBaseline.fingerprint;
    renderLocalActionDraftStatus();
  }

  function confirmDiscardLocalActionDraft(action) {
    if (!localActionDraftDirty) return true;
    return confirm(`Discard unsaved local-action edits before ${action}?`);
  }

  function revertLocalActionDraft() {
    selectedLocalActionProfileId = localActionBaseline.profileId || selectedLocalActionProfileId;
    elements.localActionProfileSelect.value = selectedLocalActionProfileId || "";
    elements.localActionProfileName.value = localActionBaseline.profileName;
    writeLocalActionConfig(localActionBaseline.config);
    showMessage("Unsaved local-action edits reverted.", "success");
  }

  function assertSavedLocalActionConfig(expected, actual, label) {
    if (LocalActions.configFingerprint(expected) !== LocalActions.configFingerprint(actual)) {
      throw new Error(`${label}: Firefox storage returned different local-action data.`);
    }
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

  function localActionProfileById(profileId) {
    return LocalActions.profileById(dashboard.localActionStore, profileId) || dashboard.localActionStore.profiles[0];
  }

  function selectedDownloadState() {
    const downloads = Array.isArray(dashboard.nativeHost?.downloads) ? dashboard.nativeHost.downloads : [];
    return downloads.find((item) => Number(item.tabId) === Number(selectedTabId)) || {
      tabId: selectedTabId, status: "idle", destinationPath: "", error: null, captureId: null
    };
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

  function selectedShellLogDescriptor() {
    const run = selectedShellRun();
    if (run?.logId) {
      return { tabId: selectedTabId, logId: run.logId, runId: run.runId, logBytes: Number(run.logBytes) || 0, label: run.presetName || run.command || "Current command" };
    }
    const history = Array.isArray(selectedSession()?.shellHistory) ? selectedSession().shellHistory : [];
    const selectedId = elements.shellHistorySelect.value;
    const entry = history.find((item) => item.id === selectedId && item.logId) || history.find((item) => item.logId);
    return entry ? { tabId: selectedTabId, logId: entry.logId, runId: entry.runId, logBytes: Number(entry.logBytes) || 0, label: entry.presetName || entry.command || "Command history" } : null;
  }

  function decodeLogChunk(base64Value) {
    const binary = atob(String(base64Value || ""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new TextDecoder().decode(bytes);
  }

  function formatByteCount(value) {
    const bytes = Math.max(0, Number(value) || 0);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
  }

  async function loadShellLogPage(descriptor, options = {}) {
    if (!descriptor?.logId) throw new Error("No stored shell log is available for this tab.");
    const response = await browser.runtime.sendMessage({
      type: MESSAGE.READ_SHELL_LOG,
      tabId: descriptor.tabId,
      logId: descriptor.logId,
      offset: Math.max(0, Number(options.offset) || 0),
      maxBytes: SHELL_LOG_PAGE_BYTES,
      fromEnd: Boolean(options.fromEnd)
    });
    if (!response?.ok) throw new Error(response?.error || "Could not read the stored shell log.");
    const chunk = response.logChunk;
    shellLogState = {
      ...shellLogState,
      tabId: descriptor.tabId,
      logId: descriptor.logId,
      runId: descriptor.runId || null,
      offset: Number(chunk.offset) || 0,
      nextOffset: Number(chunk.nextOffset) || 0,
      totalBytes: Number(chunk.totalBytes) || 0,
      eof: Boolean(chunk.eof),
      text: decodeLogChunk(chunk.dataBase64)
    };
    const existingIndex = shellLogState.pageOffsets.indexOf(shellLogState.offset);
    if (existingIndex >= 0) {
      shellLogState.pageIndex = existingIndex;
    } else {
      shellLogState.pageOffsets.push(shellLogState.offset);
      shellLogState.pageOffsets.sort((a, b) => a - b);
      shellLogState.pageIndex = shellLogState.pageOffsets.indexOf(shellLogState.offset);
    }
    elements.shellLogViewer.value = shellLogState.text;
    elements.shellLogViewer.scrollTop = options.fromEnd ? elements.shellLogViewer.scrollHeight : 0;
    elements.shellLogPageInfo.textContent = `Bytes ${shellLogState.offset.toLocaleString()}–${shellLogState.nextOffset.toLocaleString()} of ${shellLogState.totalBytes.toLocaleString()} (${formatByteCount(shellLogState.totalBytes)}). Full log is stored by the Native Host.`;
    elements.shellLogFirstButton.disabled = shellLogState.offset <= 0;
    elements.shellLogPreviousButton.disabled = shellLogState.pageIndex <= 0;
    elements.shellLogNextButton.disabled = shellLogState.eof;
    elements.shellLogLastButton.disabled = shellLogState.eof;
    return shellLogState;
  }

  async function openShellLogDialog(descriptor = selectedShellLogDescriptor(), fromEnd = true) {
    if (!descriptor) {
      showMessage("No stored shell log is available for this tab.", "error");
      return;
    }
    shellLogState = { tabId: descriptor.tabId, logId: descriptor.logId, runId: descriptor.runId || null, offset: 0, nextOffset: 0, totalBytes: descriptor.logBytes || 0, eof: false, pageOffsets: [], pageIndex: -1, text: "" };
    elements.shellLogDialogTitle.textContent = descriptor.label || "Full command log";
    elements.shellLogMetadata.textContent = `Tab ${descriptor.tabId}${descriptor.runId ? ` · Run ${descriptor.runId}` : ""}`;
    elements.shellLogViewer.value = "Loading stored log…";
    if (!elements.shellLogDialog.open) elements.shellLogDialog.showModal();
    try {
      await loadShellLogPage(descriptor, { fromEnd });
    } catch (error) {
      elements.shellLogViewer.value = "";
      elements.shellLogPageInfo.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  async function copyTextValue(text, successText) {
    if (!text) throw new Error("There is no log text to copy.");
    await navigator.clipboard.writeText(text);
    showMessage(successText, "success");
  }

  async function copyAllShellLog() {
    if (!shellLogState.logId) throw new Error("No stored shell log is open.");
    if (shellLogState.totalBytes > 64 * 1024 * 1024 && !confirm(`This log is ${formatByteCount(shellLogState.totalBytes)}. Copying all may use substantial memory. Continue?`)) return;
    const parts = [];
    let offset = 0;
    while (true) {
      const response = await browser.runtime.sendMessage({ type: MESSAGE.READ_SHELL_LOG, tabId: shellLogState.tabId, logId: shellLogState.logId, offset, maxBytes: SHELL_LOG_PAGE_BYTES });
      if (!response?.ok) throw new Error(response?.error || "Could not read the full shell log.");
      const chunk = response.logChunk;
      parts.push(decodeLogChunk(chunk.dataBase64));
      const nextOffset = Number(chunk.nextOffset) || offset;
      if (chunk.eof || nextOffset <= offset) break;
      offset = nextOffset;
      elements.shellLogPageInfo.textContent = `Preparing full copy: ${formatByteCount(offset)} / ${formatByteCount(chunk.totalBytes)}…`;
    }
    await copyTextValue(parts.join(""), "Full command log copied.");
    elements.shellLogPageInfo.textContent = `Copied ${formatByteCount(shellLogState.totalBytes)} from the complete stored log.`;
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
    const logDescriptor = selectedShellLogDescriptor();
    elements.openShellLogButton.disabled = busy || !logDescriptor;
    elements.openShellLogQuickButton.disabled = busy || !logDescriptor;
    elements.runShellQuickButton.disabled = busy || !selectedSession() || shellIsActive(run);
    elements.stopShellQuickButton.disabled = busy || !shellIsActive(run);
    const previousStatus = lastShellStatusByTab.get(Number(selectedTabId));
    lastShellStatusByTab.set(Number(selectedTabId), run.status);
    if (["starting", "running", "stopping"].includes(previousStatus) && ["exited", "error"].includes(run.status) && run.logId && !autoOpenedShellRunIds.has(run.runId)) {
      autoOpenedShellRunIds.add(run.runId);
      queueMicrotask(() => void openShellLogDialog({ tabId: selectedTabId, logId: run.logId, runId: run.runId, logBytes: run.logBytes, label: run.presetName || run.command || "Completed command" }, true));
    }
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

  function renderRuleCommandPresetOptions(rule = null) {
    const currentValue = rule?.commandAction?.presetId || elements.ruleCommandPreset.value || "";
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = shellPresetsDraft.length ? "Select an enabled preset" : "No command presets configured";
    const options = shellPresetsDraft.map((preset) => {
      const option = document.createElement("option");
      option.value = preset.id;
      option.textContent = `${preset.enabled ? "●" : "○"} ${preset.name}${preset.confirmBeforeRun ? " · confirmation required" : ""}`;
      option.disabled = !preset.enabled || preset.confirmBeforeRun;
      return option;
    });
    elements.ruleCommandPreset.replaceChildren(empty, ...options);
    elements.ruleCommandPreset.value = options.some((option) => option.value === currentValue) ? currentValue : "";
    const selected = shellPresetsDraft.find((preset) => preset.id === currentValue) || null;
    const invalid = Boolean(rule?.commandAction?.enabled) && (!selected || !selected.enabled || selected.confirmBeforeRun);
    elements.ruleCommandStatus.dataset.state = invalid ? "error" : (rule?.commandAction?.enabled ? "ok" : "idle");
    elements.ruleCommandStatus.textContent = invalid
      ? "Select an enabled preset with confirmation disabled."
      : (rule?.commandAction?.enabled
        ? `Automatic command: ${selected?.name || "preset not selected"}.`
        : "Automatic command is disabled for this rule.");
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
      },
      commandAction: {
        enabled: elements.ruleCommandEnabled.checked,
        presetId: elements.ruleCommandPreset.value,
        trigger: elements.ruleCommandTrigger.value,
        allowDryRun: elements.ruleCommandAllowDryRun.checked
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
    elements.ruleCommandEnabled.checked = value.commandAction?.enabled === true;
    elements.ruleCommandTrigger.value = value.commandAction?.trigger || "on_match";
    elements.ruleCommandAllowDryRun.checked = value.commandAction?.allowDryRun === true;
    renderRuleCommandPresetOptions(value);
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
      target: parts.target,
      commandAction: parts.commandAction
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

  function commitSelectedShellPresetDraft() {
    const preset = selectedShellPreset();
    if (!preset) {
      return;
    }
    const updated = createShellPresetFromForm(elements.shellPresetName.value.trim() || preset.name, preset.id);
    shellPresetsDraft = shellPresetsDraft.map((item) => item.id === preset.id ? updated : item);
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
      }
    });
  }

  function writeLocalActionConfig(rawConfig) {
    const value = LocalActions.normalizeConfig(rawConfig);
    elements.localActionRoutingEnabled.checked = value.routing.enabled;
    elements.localActionRoutingPriority.value = String(value.routing.priority);
    elements.localActionUrlPatterns.value = value.routing.urlPatterns.join("\n");
    elements.managedDownloadEnabled.checked = value.download.enabled;
    elements.downloadDestinationDirectory.value = value.download.destinationDirectory;
    elements.downloadCaptureWindowSeconds.value = String(value.download.captureWindowSeconds);
    elements.downloadConflictAction.value = value.download.conflictAction;
    elements.showDownloadCompletionDialog.checked = value.download.showCompletionDialog;
    elements.executeShellAfterMove.checked = value.download.executeShellAfterMove;
    shellPresetsDraft = LocalActions.clone(value.shell.presets || []);
    selectedShellPresetId = value.shell.selectedPresetId || "";
    elements.requireShellPresetMatch.checked = value.shell.requirePresetMatch;
    elements.rememberShellHistory.checked = value.shell.rememberHistory;
    elements.shellHistoryLimit.value = String(value.shell.historyLimit);
    elements.workingDirectory.value = value.shell.workingDirectory;
    elements.shellCommand.value = value.shell.command;
    elements.shellMode.value = value.shell.mode;
    elements.confirmBeforeRun.checked = value.shell.confirmBeforeRun;
    renderShellPresetOptions();
    renderRuleCommandPresetOptions(ruleById(Settings.normalizeConfig(formConfigDraft), selectedRuleId));
    renderShellHistory();
    captureLocalActionBaseline(value);
  }

  function readLocalActionConfig() {
    commitSelectedShellPresetDraft();
    return LocalActions.normalizeConfig({
      routing: {
        enabled: elements.localActionRoutingEnabled.checked,
        priority: Number(elements.localActionRoutingPriority.value),
        urlPatterns: elements.localActionUrlPatterns.value.split(/\r?\n/)
      },
      download: {
        enabled: elements.managedDownloadEnabled.checked,
        destinationDirectory: elements.downloadDestinationDirectory.value,
        captureWindowSeconds: Number(elements.downloadCaptureWindowSeconds.value),
        conflictAction: elements.downloadConflictAction.value,
        showCompletionDialog: elements.showDownloadCompletionDialog.checked,
        executeShellAfterMove: elements.executeShellAfterMove.checked
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

  function renderLocalActionProfileOptions() {
    const store = dashboard.localActionStore || LocalActions.defaultStore();
    const session = selectedSession();
    const routed = LocalActions.routeProfile(store, session?.url || dashboard.currentTab?.url || "");
    if (!store.profiles.some((profile) => profile.id === selectedLocalActionProfileId)) {
      selectedLocalActionProfileId = session?.localActionProfileId || routed.profileId || store.defaultProfileId;
    }
    elements.localActionProfileSelect.replaceChildren(...store.profiles.map((profile) => {
      const suffix = profile.id === store.defaultProfileId ? " (default)" : "";
      return new Option(`${profile.name}${suffix}`, profile.id);
    }));
    elements.localActionProfileSelect.value = selectedLocalActionProfileId || "";
    const profile = localActionProfileById(selectedLocalActionProfileId);
    elements.localActionProfileName.value = profile?.name || "";
    const effectiveProfileName = session?.localActionProfileName || profile?.name || routed.profileName || "—";
    elements.localActionModeStatus.textContent = session
      ? `${session.localActionConfigMode === CONFIG_MODE.TAB ? "Tab-specific" : "Profile-based"} · ${effectiveProfileName}`
      : `${routed.matched ? "URL-routed" : "Default"} · ${effectiveProfileName}`;
    elements.localActionModeStatus.dataset.state = session?.localActionConfigMode === CONFIG_MODE.TAB ? "warning" : "online";
    if (session?.localActionConfigMode === CONFIG_MODE.TAB) {
      elements.localActionSourceSummary.dataset.state = "tab";
      elements.localActionSourceSummary.textContent = `Effective source: tab override for tab ${session.tabId}. Assigned profile “${effectiveProfileName}” remains the fallback.`;
    } else if (session) {
      elements.localActionSourceSummary.dataset.state = "profile";
      elements.localActionSourceSummary.textContent = `Effective source: assigned profile “${effectiveProfileName}” for tab ${session.tabId}.`;
    } else if (routed.matched) {
      const pattern = routed.candidates?.[0]?.bestPattern || "matching URL rule";
      elements.localActionSourceSummary.dataset.state = "route";
      elements.localActionSourceSummary.textContent = `Effective source: URL-routed profile “${effectiveProfileName}” via ${pattern}.`;
    } else {
      elements.localActionSourceSummary.dataset.state = "profile";
      elements.localActionSourceSummary.textContent = `Effective source: default local-action profile “${effectiveProfileName}”.`;
    }
    elements.assignLocalActionProfileButton.disabled = busy || !session;
    elements.saveTabLocalActionsButton.disabled = busy || !session;
    elements.resetTabLocalActionsButton.disabled = busy || !session || session.localActionConfigMode !== CONFIG_MODE.TAB;
    elements.deleteLocalActionProfileButton.disabled = busy || store.profiles.length <= 1;
    renderLocalActionDraftStatus();
  }

  function renderDownloadState() {
    const state = selectedDownloadState();
    const text = state.error
      ? `${state.status}: ${state.error}`
      : (state.destinationPath ? `${state.status}: ${state.destinationPath}` : state.status || "idle");
    elements.downloadStateSummary.dataset.state = state.error ? "error" : (state.status === "completed" ? "ok" : "idle");
    elements.downloadStateSummary.textContent = state.moveAttempt > 1 ? `${text} · attempt ${state.moveAttempt}` : text;
    elements.retryDownloadMoveButton.disabled = busy || !state.retryable || state.status !== "error";
    const config = selectedSession()?.effectiveLocalActions || localActionProfileById(selectedLocalActionProfileId)?.config || LocalActions.defaultConfig();
    if (state.status === "completed" && state.destinationPath && state.completionSurface !== "page" && config.download.showCompletionDialog && lastShownDownloadCaptureByTab.get(Number(selectedTabId)) !== (state.completionId || state.moveId || state.captureId)) {
      lastShownDownloadCaptureByTab.set(Number(selectedTabId), state.completionId || state.moveId || state.captureId);
      elements.downloadCompletionMessage.textContent = state.completionReason === "retry"
        ? "The existing staging file was relocated successfully. Retry did not download the file again."
        : "The managed download was moved successfully.";
      elements.downloadCompletionPath.value = state.destinationPath;
      if (!elements.downloadCompletionDialog.open) elements.downloadCompletionDialog.showModal();
    }
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
    const localStore = dashboard.localActionStore || LocalActions.defaultStore();
    const routedLocal = LocalActions.routeProfile(localStore, session?.url || dashboard.currentTab?.url || "");
    selectedLocalActionProfileId = session?.localActionProfileId ||
      (localStore.profiles.some((profile) => profile.id === selectedLocalActionProfileId) ? selectedLocalActionProfileId : null) ||
      routedLocal.profileId || localStore.defaultProfileId;
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
    const commandState = session?.runtime?.lastAutomationCommandRequest?.ruleId === rule.id
      ? (session.runtime.lastAutomationCommandError || session.runtime.automationCommandState || "idle")
      : (rule.commandAction?.enabled ? "armed" : "disabled");
    elements.ruleCommandStatus.dataset.state = session?.runtime?.lastAutomationCommandError ? "error" : (rule.commandAction?.enabled ? "ok" : "idle");
    elements.ruleCommandStatus.textContent = rule.commandAction?.enabled
      ? `Command action: ${commandState}.`
      : "Automatic command is disabled for this rule.";
  }

  function renderSettingsSnapshots() {
    const snapshots = Array.isArray(dashboard.settingsSnapshots) ? dashboard.settingsSnapshots : [];
    const previous = elements.settingsSnapshotSelect.value;
    elements.settingsSnapshotSelect.replaceChildren();
    if (!snapshots.length) {
      elements.settingsSnapshotSelect.add(new Option("No snapshots yet", ""));
      elements.settingsSnapshotInfo.textContent = "Automatic snapshots are created before profile save/delete and settings import.";
    } else {
      for (const snapshot of snapshots) {
        const stamp = new Date(snapshot.createdAt).toLocaleString();
        elements.settingsSnapshotSelect.add(new Option(`${stamp} · ${snapshot.label}`, snapshot.id));
      }
      elements.settingsSnapshotSelect.value = snapshots.some((snapshot) => snapshot.id === previous)
        ? previous
        : snapshots[0].id;
      const selected = snapshots.find((snapshot) => snapshot.id === elements.settingsSnapshotSelect.value) || snapshots[0];
      elements.settingsSnapshotInfo.textContent = `${selected.profileCount} profile(s), revision ${selected.revision}, reason: ${selected.reason}.`;
    }
    const hasSelection = Boolean(elements.settingsSnapshotSelect.value);
    elements.restoreSettingsSnapshotButton.disabled = busy || !hasSelection;
    elements.deleteSettingsSnapshotButton.disabled = busy || !hasSelection;
    elements.createSettingsSnapshotButton.disabled = busy;
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
    renderLocalActionProfileOptions();
    renderActivityLog();
    renderShellState();
    renderDownloadState();
    renderUrlRoutingPreview();
    renderRuleRuntimeSummary();
    renderSettingsSnapshots();

    const profile = profileById(selectedProfileId);
    if (loadForm) {
      elements.profileName.value = profile?.name || "";
      writeConfig(session?.effectiveConfig || profile?.config || Settings.defaultConfig());
      const localProfile = localActionProfileById(selectedLocalActionProfileId);
      writeLocalActionConfig(session?.effectiveLocalActions || localProfile?.config || LocalActions.defaultConfig());
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
      defaultProfileId: data.store?.defaultProfileId || null,
      localSessions: (Array.isArray(data.sessions) ? data.sessions : []).map((session) => [
        session.tabId, session.localActionProfileId, session.localActionConfigMode
      ]),
      localProfiles: (Array.isArray(data.localActionStore?.profiles) ? data.localActionStore.profiles : []).map((profile) => [profile.id, profile.name]),
      localDefaultProfileId: data.localActionStore?.defaultProfileId || null,
      snapshotIds: (Array.isArray(data.settingsSnapshots) ? data.settingsSnapshots : []).map((snapshot) => snapshot.id)
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
    return LocalActions.normalizeCommandPreset({
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
    showMessage(`Loaded preset “${preset.name}”. Save the local-action profile or tab override to persist changes.`, "success");
  }

  function newShellPreset() {
    const name = elements.shellPresetName.value.trim() || prompt("New command preset name:", "Command preset");
    if (!name) return;
    const preset = createShellPresetFromForm(name);
    shellPresetsDraft.push(preset);
    selectedShellPresetId = preset.id;
    renderShellPresetOptions();
    renderRuleCommandPresetOptions(ruleById(Settings.normalizeConfig(formConfigDraft), selectedRuleId));
    showMessage("Command preset added to the draft. Save the local-action profile or tab override to persist it.", "success");
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
    renderRuleCommandPresetOptions(ruleById(Settings.normalizeConfig(formConfigDraft), selectedRuleId));
    showMessage("Command preset updated in the draft. Save the local-action profile or tab override to persist it.", "success");
  }

  function deleteShellPreset() {
    const preset = selectedShellPreset();
    if (!preset || !confirm(`Delete command preset “${preset.name}”?`)) return;
    shellPresetsDraft = shellPresetsDraft.filter((item) => item.id !== preset.id);
    selectedShellPresetId = "";
    renderShellPresetOptions();
    renderRuleCommandPresetOptions(ruleById(Settings.normalizeConfig(formConfigDraft), selectedRuleId));
    showMessage("Command preset deleted from the draft. Save the local-action profile or tab override to persist it.", "success");
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

  async function saveLocalActionProfile() {
    const profile = localActionProfileById(selectedLocalActionProfileId);
    if (!profile) {
      showMessage("Select a local-action profile first.", "error");
      return;
    }
    const validation = LocalActions.validateConfig(readLocalActionConfig());
    if (!validation.ok) {
      showMessage(validation.errors.join("\n"), "error");
      return;
    }
    const name = elements.localActionProfileName.value.trim() || profile.name;
    setBusy(true);
    try {
      const response = await browser.runtime.sendMessage({
        type: MESSAGE.SAVE_LOCAL_ACTION_PROFILE,
        profile: { ...profile, name, config: validation.config }
      });
      if (!response?.ok) throw new Error(response?.error || "Could not save the local-action profile.");
      assertSavedLocalActionConfig(validation.config, response.savedProfile?.config, "Save local-action profile");
      if (response.savedProfile?.name !== name) throw new Error("Save local-action profile: Firefox storage returned a different profile name.");
      dashboard = response.dashboard || dashboard;
      selectedLocalActionProfileId = response.savedProfile.id;
      renderSelectors(selectedTabId);
      elements.localActionProfileName.value = response.savedProfile.name;
      writeLocalActionConfig(response.savedProfile.config);
      renderDetails(false);
      showMessage(`Local-action profile “${response.savedProfile.name}” saved and verified.`, "success");
    } catch (error) {
      showMessage(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveTabLocalActions() {
    const session = selectedSession();
    if (!session) {
      showMessage("Activate the tab before saving a local-action override.", "error");
      return;
    }
    const validation = LocalActions.validateConfig(readLocalActionConfig());
    if (!validation.ok) {
      showMessage(validation.errors.join("\n"), "error");
      return;
    }
    setBusy(true);
    try {
      const response = await browser.runtime.sendMessage({
        type: MESSAGE.SAVE_TAB_LOCAL_ACTIONS,
        tabId: selectedTabId,
        config: validation.config
      });
      if (!response?.ok) throw new Error(response?.error || "Could not save tab-specific local actions.");
      assertSavedLocalActionConfig(validation.config, response.savedSession?.effectiveLocalActions, "Save tab local actions");
      dashboard = response.dashboard || dashboard;
      renderSelectors(selectedTabId);
      writeLocalActionConfig(response.savedSession.effectiveLocalActions);
      renderDetails(false);
      showMessage(`Local actions for tab ${selectedTabId} saved and verified.`, "success");
    } catch (error) {
      showMessage(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(false);
    }
  }

  function createLocalActionProfile() {
    const name = prompt("New local-action profile name:", "New local actions");
    if (!name) return;
    void request(MESSAGE.CREATE_LOCAL_ACTION_PROFILE, {
      name,
      baseProfileId: selectedLocalActionProfileId
    }, "Local-action profile created.");
  }

  function runShellAfterDownload() {
    if (elements.downloadCompletionDialog.open) elements.downloadCompletionDialog.close();
    runShellCommand();
  }

  function runShellCommand() {
    const session = selectedSession();
    if (!session) {
      showMessage("Activate the tab before running a command.", "error");
      return;
    }
    const shell = readLocalActionConfig().shell;
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
      if (response.localActionProfileId) {
        selectedLocalActionProfileId = response.localActionProfileId;
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
      target: Settings.clone((source || Settings.defaultRule()).target),
      commandAction: Settings.clone((source || Settings.defaultRule()).commandAction)
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
    const previousTabId = selectedTabId;
    const nextTabId = Number(elements.tabSelect.value);
    if (nextTabId !== Number(previousTabId) && !confirmDiscardLocalActionDraft("switching tabs")) {
      elements.tabSelect.value = String(previousTabId);
      return;
    }
    selectedTabId = nextTabId;
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
  for (const element of [elements.ruleCommandEnabled, elements.ruleCommandPreset, elements.ruleCommandTrigger, elements.ruleCommandAllowDryRun]) {
    element.addEventListener("change", () => {
      const rule = ruleById(Settings.normalizeConfig(formConfigDraft), selectedRuleId);
      renderRuleCommandPresetOptions({
        ...(rule || Settings.defaultRule()),
        commandAction: {
          enabled: elements.ruleCommandEnabled.checked,
          presetId: elements.ruleCommandPreset.value,
          trigger: elements.ruleCommandTrigger.value,
          allowDryRun: elements.ruleCommandAllowDryRun.checked
        }
      });
    });
  }
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
  function assertSavedConfig(expected, actual, label) {
    const expectedFingerprint = WorkingSession.configFingerprint(expected);
    const actualFingerprint = WorkingSession.configFingerprint(actual);
    if (expectedFingerprint !== actualFingerprint) {
      throw new Error(`${label}: Firefox storage returned different configuration data.`);
    }
  }

  async function saveProfileConfiguration() {
    const profile = profileById(selectedProfileId);
    if (!profile) {
      showMessage("Select a profile before saving.", "error");
      return;
    }
    const config = readConfig();
    const validation = Settings.validateConfig(config);
    if (!validation.ok) {
      showMessage(validation.errors.join("\n"), "error");
      return;
    }
    setBusy(true);
    try {
      const response = await browser.runtime.sendMessage({
        type: MESSAGE.SAVE_PROFILE,
        profile: { ...profile, name: elements.profileName.value.trim() || profile.name, config: validation.config }
      });
      if (!response?.ok) throw new Error(response?.error || "Could not save the profile.");
      assertSavedConfig(validation.config, response.savedProfile?.config, "Save profile");
      dashboard = response.dashboard || dashboard;
      selectedProfileId = response.savedProfile.id;
      formConfigDraft = Settings.normalizeConfig(response.savedProfile.config);
      writeConfig(formConfigDraft);
      renderSelectors(selectedTabId);
      renderDetails(false);
      showMessage(`Profile “${response.savedProfile.name}” saved and verified.`, "success");
    } catch (error) {
      showMessage(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveTabConfiguration() {
    const session = selectedSession();
    if (!session) {
      showMessage("Activate the tab before saving a tab-specific configuration.", "error");
      return;
    }
    const config = readConfig();
    const validation = Settings.validateConfig(config);
    if (!validation.ok) {
      showMessage(validation.errors.join("\n"), "error");
      return;
    }
    setBusy(true);
    try {
      const response = await browser.runtime.sendMessage({
        type: MESSAGE.SAVE_TAB_CONFIG,
        tabId: selectedTabId,
        config: validation.config
      });
      if (!response?.ok) throw new Error(response?.error || "Could not save the tab configuration.");
      assertSavedConfig(validation.config, response.savedSession?.effectiveConfig, "Save tab configuration");
      dashboard = response.dashboard || dashboard;
      formConfigDraft = Settings.normalizeConfig(response.savedSession.effectiveConfig);
      writeConfig(formConfigDraft);
      renderSelectors(selectedTabId);
      renderDetails(false);
      showMessage(`Configuration for tab ${selectedTabId} saved and verified.`, "success");
    } catch (error) {
      showMessage(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(false);
    }
  }

  function workingSessionRows() {
    return [...elements.workingSessionTabList.querySelectorAll('input[type="checkbox"][data-tab-id]')];
  }

  function renderWorkingSessionDialog(tabs, mode) {
    workingSessionMode = mode;
    elements.workingSessionDialogTitle.textContent = mode === "import" ? "Import working session" : "Save working session";
    elements.workingSessionDialogDescription.textContent = mode === "import"
      ? "The selected tabs will be opened and their saved add-on configuration will be restored."
      : "Active add-on tabs are selected by default. Select any additional tabs to include.";
    elements.confirmWorkingSessionButton.textContent = mode === "import" ? "Open and restore tabs" : "Save selected tabs";
    elements.workingSessionResult.textContent = "";
    elements.workingSessionTabList.replaceChildren(...tabs.map((tab, index) => {
      const label = document.createElement("label");
      label.className = "working-session-tab-row";
      label.dataset.addonActive = tab.addOnActive ? "true" : "false";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.tabId = String(tab.tabId ?? tab.sourceTabId ?? index);
      checkbox.checked = mode === "import" ? true : Boolean(tab.addOnActive);
      const content = document.createElement("span");
      const title = document.createElement("span");
      title.className = "working-session-tab-title";
      title.textContent = tab.title || "Untitled tab";
      const url = document.createElement("span");
      url.className = "working-session-tab-url";
      url.textContent = tab.url;
      const meta = document.createElement("span");
      meta.className = "working-session-tab-meta";
      meta.textContent = tab.addOnActive
        ? `Add-on ${tab.mode || "active"}; profile ${tab.profileName || tab.profile?.name || "unknown"}`
        : "Add-on inactive";
      content.append(title, url, meta);
      label.append(checkbox, content);
      return label;
    }));
    if (!elements.workingSessionDialog.open) {
      elements.workingSessionDialog.showModal();
    }
  }

  async function openSaveWorkingSessionDialog() {
    setBusy(true);
    try {
      const response = await browser.runtime.sendMessage({ type: MESSAGE.LIST_WORKING_SESSION_TABS });
      if (!response?.ok) throw new Error(response?.error || "Could not list open tabs.");
      pendingWorkingSessionBundle = null;
      renderWorkingSessionDialog(response.tabs || [], "export");
    } catch (error) {
      showMessage(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(false);
    }
  }

  async function confirmWorkingSession() {
    const selected = workingSessionRows().filter((item) => item.checked).map((item) => Number(item.dataset.tabId));
    if (!selected.length) {
      elements.workingSessionResult.textContent = "Select at least one tab.";
      return;
    }
    if (workingSessionMode === "export") {
      setBusy(true);
      try {
        const response = await browser.runtime.sendMessage({ type: MESSAGE.EXPORT_WORKING_SESSION, tabIds: selected });
        if (!response?.ok) throw new Error(response?.error || "Could not save the working session.");
        downloadBlob(new Blob([response.text], { type: "application/json" }), `firefox-chat-assistant-working-session-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
        elements.workingSessionDialog.close();
        showMessage(`Working session saved with ${response.tabCount} tab(s).`, "success");
      } catch (error) {
        elements.workingSessionResult.textContent = error instanceof Error ? error.message : String(error);
      } finally {
        setBusy(false);
      }
      return;
    }

    const selectedTabs = pendingWorkingSessionBundle.tabs.filter((_tab, index) => selected.includes(index));
    const bundle = WorkingSession.build(selectedTabs, pendingWorkingSessionBundle);
    const origins = WorkingSession.requiredOrigins(bundle);
    const permissionRequest = origins.length ? browser.permissions.request({ origins }) : Promise.resolve(true);
    setBusy(true);
    try {
      const granted = await permissionRequest;
      if (!granted) throw new Error("Site access was not granted for every restored tab.");
      const response = await browser.runtime.sendMessage({ type: MESSAGE.IMPORT_WORKING_SESSION, text: WorkingSession.stringify(bundle) });
      if (!response?.ok) throw new Error(response?.error || "Could not restore the working session.");
      if (response.dashboard) render(response.dashboard, true, response.report?.openedTabIds?.[0] || null);
      elements.workingSessionDialog.close();
      showMessage(`Working session restored: ${response.report.restored} restored, ${response.report.failed.length} failed.`, response.report.failed.length ? "error" : "success");
    } catch (error) {
      elements.workingSessionResult.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      setBusy(false);
    }
  }

  elements.localActionProfileSelect.addEventListener("change", () => {
    const previousProfileId = selectedLocalActionProfileId;
    const nextProfileId = elements.localActionProfileSelect.value;
    if (nextProfileId !== previousProfileId && !confirmDiscardLocalActionDraft("switching local-action profiles")) {
      elements.localActionProfileSelect.value = previousProfileId || "";
      return;
    }
    selectedLocalActionProfileId = nextProfileId;
    const profile = localActionProfileById(selectedLocalActionProfileId);
    elements.localActionProfileName.value = profile?.name || "";
    writeLocalActionConfig(profile?.config || LocalActions.defaultConfig());
    renderLocalActionProfileOptions();
  });
  elements.assignLocalActionProfileButton.addEventListener("click", () => {
    if (!confirmDiscardLocalActionDraft("applying another profile to this tab")) return;
    void request(MESSAGE.ASSIGN_LOCAL_ACTION_PROFILE, {
      tabId: selectedTabId, profileId: selectedLocalActionProfileId
    }, "Local-action profile applied to tab.");
  });
  elements.newLocalActionProfileButton.addEventListener("click", () => {
    if (confirmDiscardLocalActionDraft("creating a new local-action profile")) createLocalActionProfile();
  });
  elements.saveLocalActionProfileButton.addEventListener("click", () => void saveLocalActionProfile());
  elements.deleteLocalActionProfileButton.addEventListener("click", () => {
    const profile = localActionProfileById(selectedLocalActionProfileId);
    if (!profile || !confirmDiscardLocalActionDraft("deleting this local-action profile")) return;
    if (confirm(`Delete local-action profile “${profile.name}”?`)) {
      void request(MESSAGE.DELETE_LOCAL_ACTION_PROFILE, { profileId: profile.id }, "Local-action profile deleted.");
    }
  });
  elements.saveTabLocalActionsButton.addEventListener("click", () => void saveTabLocalActions());
  elements.resetTabLocalActionsButton.addEventListener("click", () => {
    if (!confirmDiscardLocalActionDraft("removing the tab override")) return;
    void request(MESSAGE.RESET_TAB_LOCAL_ACTIONS, {
      tabId: selectedTabId
    }, "This tab now uses its local-action profile.");
  });
  elements.revertLocalActionDraftButton.addEventListener("click", revertLocalActionDraft);
  elements.retryDownloadMoveButton.addEventListener("click", () => void request(MESSAGE.RETRY_DOWNLOAD_MOVE, {
    tabId: selectedTabId
  }, "Download relocation retry started."));
  elements.executeShellAfterDownloadButton.addEventListener("click", runShellAfterDownload);
  elements.acknowledgeDownloadButton.addEventListener("click", () => {
    if (elements.downloadCompletionDialog.open) elements.downloadCompletionDialog.close();
  });

  for (const element of [
    elements.localActionProfileName, elements.localActionRoutingEnabled, elements.localActionRoutingPriority,
    elements.localActionUrlPatterns, elements.managedDownloadEnabled, elements.downloadDestinationDirectory,
    elements.downloadCaptureWindowSeconds, elements.downloadConflictAction, elements.showDownloadCompletionDialog,
    elements.executeShellAfterMove, elements.shellPresetName, elements.shellPresetEnabled,
    elements.requireShellPresetMatch, elements.workingDirectory, elements.shellCommand, elements.shellMode,
    elements.confirmBeforeRun, elements.rememberShellHistory, elements.shellHistoryLimit
  ]) {
    element.addEventListener("input", updateLocalActionDraftState);
    element.addEventListener("change", updateLocalActionDraftState);
  }

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
  elements.runShellQuickButton.addEventListener("click", runShellCommand);
  elements.stopShellButton.addEventListener("click", stopShellCommand);
  elements.stopShellQuickButton.addEventListener("click", stopShellCommand);
  elements.clearShellOutputButton.addEventListener("click", () => void request(MESSAGE.CLEAR_SHELL_OUTPUT, { tabId: selectedTabId }, "Live output tail cleared. The full stored log is unchanged."));
  elements.openShellLogButton.addEventListener("click", () => void openShellLogDialog());
  elements.openShellLogQuickButton.addEventListener("click", () => void openShellLogDialog());
  elements.shellLogFirstButton.addEventListener("click", () => void loadShellLogPage(shellLogState, { offset: 0 }));
  elements.shellLogPreviousButton.addEventListener("click", () => {
    const offset = shellLogState.pageOffsets[Math.max(0, shellLogState.pageIndex - 1)] || 0;
    void loadShellLogPage(shellLogState, { offset });
  });
  elements.shellLogNextButton.addEventListener("click", () => void loadShellLogPage(shellLogState, { offset: shellLogState.nextOffset }));
  elements.shellLogLastButton.addEventListener("click", () => void loadShellLogPage(shellLogState, { fromEnd: true }));
  elements.refreshShellLogButton.addEventListener("click", () => void loadShellLogPage(shellLogState, { fromEnd: true }));
  elements.copyShellLogSelectionButton.addEventListener("click", () => {
    const text = elements.shellLogViewer.value.slice(elements.shellLogViewer.selectionStart, elements.shellLogViewer.selectionEnd);
    void copyTextValue(text, "Selected log text copied.").catch((error) => showMessage(error.message, "error"));
  });
  elements.copyShellLogPageButton.addEventListener("click", () => void copyTextValue(elements.shellLogViewer.value, "Current log page copied.").catch((error) => showMessage(error.message, "error")));
  elements.copyShellLogAllButton.addEventListener("click", () => void copyAllShellLog().catch((error) => showMessage(error.message, "error")));
  elements.deleteShellLogButton.addEventListener("click", () => {
    if (!shellLogState.logId || !confirm("Delete this stored command log from disk?")) return;
    void request(MESSAGE.DELETE_SHELL_LOG, { tabId: shellLogState.tabId, logId: shellLogState.logId }, "Stored command log deleted.").then((response) => {
      if (response?.ok && elements.shellLogDialog.open) elements.shellLogDialog.close();
    });
  });
  elements.refreshButton.addEventListener("click", () => void request(MESSAGE.GET_DASHBOARD));
  elements.tabPrimaryQuickButton.addEventListener("click", runPrimaryTabAction);
  elements.tabStopQuickButton.addEventListener("click", () => void request(MESSAGE.STOP_TAB, { tabId: selectedTabId }, "Tab stopped."));
  elements.activateButton.addEventListener("click", activateCurrentTab);
  elements.pauseButton.addEventListener("click", () => void request(MESSAGE.PAUSE_TAB, { tabId: selectedTabId }, "Tab paused."));
  elements.resumeButton.addEventListener("click", () => void request(MESSAGE.RESUME_TAB, { tabId: selectedTabId }, "Tab resumed."));
  elements.stopButton.addEventListener("click", () => void request(MESSAGE.STOP_TAB, { tabId: selectedTabId }, "Tab stopped."));
  elements.assignProfileButton.addEventListener("click", () => void request(MESSAGE.ASSIGN_PROFILE, { tabId: selectedTabId, profileId: selectedProfileId }, "Profile applied to tab."));
  elements.saveTabButton.addEventListener("click", () => void saveTabConfiguration());
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
  elements.saveProfileButton.addEventListener("click", () => void saveProfileConfiguration());
  function downloadBlob(blob, filename) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    globalThis.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  elements.exportSupportBundleButton.addEventListener("click", async () => {
    const response = await request(MESSAGE.EXPORT_SUPPORT_BUNDLE, {}, "Support bundle exported.");
    if (!response?.bundle) {
      return;
    }
    const bytes = SupportBundle.buildZip(SupportBundle.bundleEntries(response.bundle));
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadBlob(
      new Blob([bytes], { type: "application/zip" }),
      `firefox-chat-assistant-support-${response.bundle.extension?.version || "unknown"}-${stamp}.zip`
    );
  });

  elements.exportButton.addEventListener("click", async () => {
    const response = await request(MESSAGE.EXPORT_SETTINGS);
    if (!response?.text) return;
    downloadBlob(
      new Blob([response.text], { type: "application/json" }),
      `firefox-chat-improver-settings-${new Date().toISOString().slice(0, 10)}.json`
    );
  });
  elements.saveWorkingSessionButton.addEventListener("click", () => void openSaveWorkingSessionDialog());
  elements.importWorkingSessionButton.addEventListener("click", () => elements.importWorkingSessionFile.click());
  elements.confirmWorkingSessionButton.addEventListener("click", () => void confirmWorkingSession());
  elements.importWorkingSessionFile.addEventListener("change", async () => {
    const file = elements.importWorkingSessionFile.files?.[0];
    if (!file) return;
    try {
      pendingWorkingSessionBundle = WorkingSession.parse(await file.text());
      const tabs = pendingWorkingSessionBundle.tabs.map((tab, index) => ({ ...tab, tabId: index, addOnActive: tab.addOnActive }));
      renderWorkingSessionDialog(tabs, "import");
    } catch (error) {
      showMessage(error instanceof Error ? error.message : String(error), "error");
    } finally {
      elements.importWorkingSessionFile.value = "";
    }
  });
  elements.importButton.addEventListener("click", () => elements.importFile.click());
  elements.importFile.addEventListener("change", async () => {
    const file = elements.importFile.files?.[0];
    if (!file) return;
    const text = await file.text();
    await request(MESSAGE.IMPORT_SETTINGS, { text }, "Settings imported. The previous settings were saved as a recovery snapshot.");
    elements.importFile.value = "";
  });
  elements.settingsSnapshotSelect.addEventListener("change", renderSettingsSnapshots);
  elements.createSettingsSnapshotButton.addEventListener("click", () => {
    const label = prompt("Snapshot label:", "Manual snapshot");
    if (label !== null) {
      void request(MESSAGE.CREATE_SETTINGS_SNAPSHOT, { label }, "Settings snapshot created.");
    }
  });
  elements.restoreSettingsSnapshotButton.addEventListener("click", () => {
    const snapshotId = elements.settingsSnapshotSelect.value;
    const label = elements.settingsSnapshotSelect.selectedOptions[0]?.textContent || "selected snapshot";
    if (snapshotId && confirm(`Restore ${label}? Current settings will be snapshotted first.`)) {
      void request(MESSAGE.RESTORE_SETTINGS_SNAPSHOT, { snapshotId }, "Settings snapshot restored.");
    }
  });
  elements.deleteSettingsSnapshotButton.addEventListener("click", () => {
    const snapshotId = elements.settingsSnapshotSelect.value;
    const label = elements.settingsSnapshotSelect.selectedOptions[0]?.textContent || "selected snapshot";
    if (snapshotId && confirm(`Delete ${label}?`)) {
      void request(MESSAGE.DELETE_SETTINGS_SNAPSHOT, { snapshotId }, "Settings snapshot deleted.");
    }
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
