(() => {
  "use strict";

  const { MESSAGE, MODE, CONFIG_MODE } = globalThis.FCI_PROTOCOL;
  const Settings = globalThis.FCI_SETTINGS;
  const LocalActions = globalThis.FCI_LOCAL_ACTIONS;
  const CommandPresets = globalThis.FCI_COMMAND_PRESETS;
  const AlertSound = globalThis.FCI_ALERT_SOUND;
  // Phase 28 v0.28.3: volatile editor drafts are highest-priority runtime state.
  // Phase 28 v0.28.23: bind draft autosync to the originating tab/session and persist its working snapshot.
  // Phase 44 v0.39.5: Stop sends the current editor drafts so Start restores the same tab configuration.
  // Phase 45 v0.39.6: deliberate profile/routing choices override the stopped snapshot without silent fallback.
  // Phase 28 v0.28.1: prompt-created presets and unrestricted direct execution.
  const RuntimeGuard = globalThis.FCI_SIDEBAR_RUNTIME_GUARD;
  const SupportBundle = globalThis.FCI_SUPPORT_BUNDLE;
  const WorkingSession = globalThis.FCI_WORKING_SESSION;
  const LogArchive = globalThis.FCI_LOG_ARCHIVE;
  const PromptTemplates = globalThis.FCI_PROMPT_TEMPLATES;
  const SIDEBAR_UI_STORAGE_KEY = "firefoxChatImprover.sidebarUi.v1";
  const DEFAULT_COLLAPSED_GROUPS = Object.freeze({
    "keyboard-shortcuts": true,
    "prompt-templates": true,
    "working-sessions": true,
    activation: true,
    "rule-statistics": true,
    activity: true,
    "installation-guide": true,
    save: true
  });
  const SIDEBAR_GROUP_ORDER = Object.freeze([
    "tabs", "profiles", "activation", "rules", "monitor", "target", "alerts",
    "local-actions", "download", "shell", "working-sessions", "prompt-templates",
    "rule-statistics", "activity", "keyboard-shortcuts", "save", "installation-guide"
  ]);
  const SIDEBAR_FEATURES = Object.freeze({
    "automation-editor": Object.freeze({ groups: Object.freeze(["rules", "monitor", "target"]) }),
    "automation-profiles": Object.freeze({ groups: Object.freeze(["profiles"]) }),
    "automation-routing": Object.freeze({ groups: Object.freeze(["activation"]) }),
    alerts: Object.freeze({ groups: Object.freeze(["alerts"]) }),
    "local-action-profiles": Object.freeze({ groups: Object.freeze(["local-actions"]) }),
    "managed-downloads": Object.freeze({ groups: Object.freeze(["download"]) }),
    "shell-commands": Object.freeze({ groups: Object.freeze(["shell"]) }),
    "working-sessions": Object.freeze({ groups: Object.freeze(["working-sessions"]) }),
    "prompt-templates": Object.freeze({ groups: Object.freeze(["prompt-templates"]) }),
    "rule-diagnostics": Object.freeze({ groups: Object.freeze(["rule-statistics"]) }),
    "activity-log": Object.freeze({ groups: Object.freeze(["activity"]) }),
    "keyboard-shortcuts": Object.freeze({ groups: Object.freeze(["keyboard-shortcuts"]) }),
    "backup-recovery": Object.freeze({ groups: Object.freeze(["save"]) }),
    "setup-guide": Object.freeze({ groups: Object.freeze(["installation-guide"]) })
  });
  const SIDEBAR_FEATURE_DEPENDENCIES = Object.freeze({
    "automation-routing": Object.freeze(["automation-profiles"]),
    "rule-diagnostics": Object.freeze(["automation-editor"]),
    "managed-downloads": Object.freeze(["local-action-profiles"]),
    "shell-commands": Object.freeze(["local-action-profiles"])
  });
  const SIDEBAR_FEATURE_PRESETS = Object.freeze({
    simple: Object.freeze(["automation-editor", "alerts"]),
    standard: Object.freeze([
      "automation-editor", "automation-profiles", "alerts", "local-action-profiles",
      "managed-downloads", "shell-commands", "working-sessions", "backup-recovery"
    ]),
    full: Object.freeze(Object.keys(SIDEBAR_FEATURES))
  });
  const $ = (selector) => document.querySelector(selector);
  const elements = {
    body: document.body,
    statusPill: $("#statusPill"), downloadStatusIcon: $("#downloadStatusIcon"), commandStatusIcon: $("#commandStatusIcon"), tabSearch: $("#tabSearch"), tabSearchResult: $("#tabSearchResult"), tabSelect: $("#tabSelect"), tabId: $("#tabId"),
    modeText: $("#modeText"), configModeText: $("#configModeText"), profileText: $("#profileText"), tabUrl: $("#tabUrl"), commandNoticeText: $("#commandNoticeText"),
    monitorStateText: $("#monitorStateText"), monitorCountText: $("#monitorCountText"), monitorMatchedText: $("#monitorMatchedText"), monitorCycleText: $("#monitorCycleText"), ruleCountText: $("#ruleCountText"), matchedRuleCountText: $("#matchedRuleCountText"), monitorTransitionText: $("#monitorTransitionText"), alertStateText: $("#alertStateText"), targetStateText: $("#targetStateText"), baselineCountText: $("#baselineCountText"), candidateCountText: $("#candidateCountText"), targetActionCountText: $("#targetActionCountText"), lastTargetActionText: $("#lastTargetActionText"),
    activateButton: $("#activateButton"), pauseButton: $("#pauseButton"), resumeButton: $("#resumeButton"), stopButton: $("#stopButton"), refreshButton: $("#refreshButton"), customizeSidebarButton: $("#customizeSidebarButton"), tabPrimaryQuickButton: $("#tabPrimaryQuickButton"), tabStopQuickButton: $("#tabStopQuickButton"), customTabTitle: $("#customTabTitle"), saveCustomTabTitleButton: $("#saveCustomTabTitleButton"), clearCustomTabTitleButton: $("#clearCustomTabTitleButton"),
    promptTemplateSelect: $("#promptTemplateSelect"), promptTemplateName: $("#promptTemplateName"), promptTemplateText: $("#promptTemplateText"), fillPromptTemplateButton: $("#fillPromptTemplateButton"), copyPromptTemplateButton: $("#copyPromptTemplateButton"), newPromptTemplateButton: $("#newPromptTemplateButton"), savePromptTemplateButton: $("#savePromptTemplateButton"), deletePromptTemplateButton: $("#deletePromptTemplateButton"), promptTemplateStatus: $("#promptTemplateStatus"),
    profileSearch: $("#profileSearch"), profileSearchResult: $("#profileSearchResult"), profileSelect: $("#profileSelect"), profileName: $("#profileName"), automationProfileSourceSummary: $("#automationProfileSourceSummary"), assignProfileButton: $("#assignProfileButton"), newProfileButton: $("#newProfileButton"), setDefaultProfileButton: $("#setDefaultProfileButton"), deleteProfileButton: $("#deleteProfileButton"),
    ruleSelect: $("#ruleSelect"), ruleName: $("#ruleName"), ruleEnabled: $("#ruleEnabled"), newRuleButton: $("#newRuleButton"), duplicateRuleButton: $("#duplicateRuleButton"), deleteRuleButton: $("#deleteRuleButton"), ruleRuntimeSummary: $("#ruleRuntimeSummary"), ruleRuntimeBadge: $("#ruleRuntimeBadge"), ruleCommandEnabled: $("#ruleCommandEnabled"), ruleCommandPreset: $("#ruleCommandPreset"), ruleCommandTrigger: $("#ruleCommandTrigger"), ruleCommandAllowDryRun: $("#ruleCommandAllowDryRun"), ruleCommandStatus: $("#ruleCommandStatus"), statisticsRuleCount: $("#statisticsRuleCount"), statisticsMatchCount: $("#statisticsMatchCount"), statisticsClickCount: $("#statisticsClickCount"), statisticsVerifyCount: $("#statisticsVerifyCount"), statisticsCommandCount: $("#statisticsCommandCount"), ruleStatisticsRows: $("#ruleStatisticsRows"), selectedRuleStatistics: $("#selectedRuleStatistics"), ruleStatisticsStatus: $("#ruleStatisticsStatus"), exportRuleStatisticsButton: $("#exportRuleStatisticsButton"), resetRuleStatisticsButton: $("#resetRuleStatisticsButton"),
    autoProfileByUrl: $("#autoProfileByUrl"), autoActivateMatchingUrls: $("#autoActivateMatchingUrls"), routingEnabled: $("#routingEnabled"), routingPriority: $("#routingPriority"), requireUrlMatch: $("#requireUrlMatch"), urlPatterns: $("#urlPatterns"), testUrlRoutingButton: $("#testUrlRoutingButton"), useRoutedProfileButton: $("#useRoutedProfileButton"), grantAutoActivationAccessButton: $("#grantAutoActivationAccessButton"), runAutoActivationScanButton: $("#runAutoActivationScanButton"), urlRoutingResult: $("#urlRoutingResult"), autoActivationResult: $("#autoActivationResult"),
    monitorProfileSearch: $("#monitorProfileSearch"), monitorProfileSearchResult: $("#monitorProfileSearchResult"), monitorProfileSelect: $("#monitorProfileSelect"), monitorProfileName: $("#monitorProfileName"), applyMonitorProfileButton: $("#applyMonitorProfileButton"), newMonitorProfileButton: $("#newMonitorProfileButton"), saveMonitorProfileButton: $("#saveMonitorProfileButton"), setDefaultMonitorProfileButton: $("#setDefaultMonitorProfileButton"), deleteMonitorProfileButton: $("#deleteMonitorProfileButton"), monitorTag: $("#monitorTag"), monitorKind: $("#monitorKind"), monitorAttributeName: $("#monitorAttributeName"), monitorValue: $("#monitorValue"), monitorVisibilityTransition: $("#monitorVisibilityTransition"), matchStableMs: $("#matchStableMs"), resetStableMs: $("#resetStableMs"), monitorPickerButton: $("#monitorPickerButton"), monitorTestButton: $("#monitorTestButton"), monitorTestResult: $("#monitorTestResult"), conditionJoin: $("#conditionJoin"), addConditionButton: $("#addConditionButton"), conditionsList: $("#conditionsList"), conditionTemplate: $("#conditionTemplate"),
    targetProfileSearch: $("#targetProfileSearch"), targetProfileSearchResult: $("#targetProfileSearchResult"), targetProfileSelect: $("#targetProfileSelect"), targetProfileName: $("#targetProfileName"), applyTargetProfileButton: $("#applyTargetProfileButton"), newTargetProfileButton: $("#newTargetProfileButton"), saveTargetProfileButton: $("#saveTargetProfileButton"), setDefaultTargetProfileButton: $("#setDefaultTargetProfileButton"), deleteTargetProfileButton: $("#deleteTargetProfileButton"), targetEnabled: $("#targetEnabled"), targetTag: $("#targetTag"), targetKind: $("#targetKind"), targetAttributeName: $("#targetAttributeName"), targetValue: $("#targetValue"), targetPickerButton: $("#targetPickerButton"), targetTestButton: $("#targetTestButton"), targetTestResult: $("#targetTestResult"), targetDryRunTestButton: $("#targetDryRunTestButton"), targetClickTestButton: $("#targetClickTestButton"), targetClickQuickButton: $("#targetClickQuickButton"), clickStrategy: $("#clickStrategy"), maxClicksPerCycle: $("#maxClicksPerCycle"), visibleOnly: $("#visibleOnly"), enabledOnly: $("#enabledOnly"), dryRun: $("#dryRun"), fingerprintAttributes: $("#fingerprintAttributes"), pipelineEnabled: $("#pipelineEnabled"), preActionDelayMs: $("#preActionDelayMs"), postActionDelayMs: $("#postActionDelayMs"), verifyEnabled: $("#verifyEnabled"), verifyTag: $("#verifyTag"), verifyKind: $("#verifyKind"), verifyAttributeName: $("#verifyAttributeName"), verifyValue: $("#verifyValue"), verifyPickerButton: $("#verifyPickerButton"), verifyTestButton: $("#verifyTestButton"), verifyTestResult: $("#verifyTestResult"), verifyExpectation: $("#verifyExpectation"), verifyTimeoutMs: $("#verifyTimeoutMs"), verifyPollIntervalMs: $("#verifyPollIntervalMs"), pipelineRuntimeText: $("#pipelineRuntimeText"),
    titleBlink: $("#titleBlink"), titlePrefix: $("#titlePrefix"), blinkIntervalMs: $("#blinkIntervalMs"), badgeAlert: $("#badgeAlert"), sidebarAlert: $("#sidebarAlert"), notificationAlert: $("#notificationAlert"), soundAlertEnabled: $("#soundAlertEnabled"), soundAlertSettings: $("#soundAlertSettings"), soundAlertTone: $("#soundAlertTone"), soundAlertVolume: $("#soundAlertVolume"), soundAlertRepeatCount: $("#soundAlertRepeatCount"), soundAlertRepeatIntervalMs: $("#soundAlertRepeatIntervalMs"), testSoundAlertButton: $("#testSoundAlertButton"), soundAlertTestResult: $("#soundAlertTestResult"), dismissOnUserActivity: $("#dismissOnUserActivity"), activeTabTimeoutSeconds: $("#activeTabTimeoutSeconds"),
    logChannel: $("#logChannel"), activityLog: $("#activityLog"), copyLogsButton: $("#copyLogsButton"), exportSupportBundleButton: $("#exportSupportBundleButton"), clearLogsButton: $("#clearLogsButton"),
    localActionProfileSearch: $("#localActionProfileSearch"), localActionProfileSearchResult: $("#localActionProfileSearchResult"), localActionProfileSelect: $("#localActionProfileSelect"), localActionProfileName: $("#localActionProfileName"), localActionModeStatus: $("#localActionModeStatus"), localActionDraftStatus: $("#localActionDraftStatus"), localActionSourceSummary: $("#localActionSourceSummary"), assignLocalActionProfileButton: $("#assignLocalActionProfileButton"), clearLocalActionProfileBindingButton: $("#clearLocalActionProfileBindingButton"), newLocalActionProfileButton: $("#newLocalActionProfileButton"), saveLocalActionProfileButton: $("#saveLocalActionProfileButton"), setDefaultLocalActionProfileButton: $("#setDefaultLocalActionProfileButton"), deleteLocalActionProfileButton: $("#deleteLocalActionProfileButton"), localActionRoutingEnabled: $("#localActionRoutingEnabled"), localActionRoutingPriority: $("#localActionRoutingPriority"), localActionUrlPatterns: $("#localActionUrlPatterns"), managedDownloadEnabled: $("#managedDownloadEnabled"), downloadDestinationDirectory: $("#downloadDestinationDirectory"), downloadCaptureWindowSeconds: $("#downloadCaptureWindowSeconds"), downloadConflictAction: $("#downloadConflictAction"), showDownloadCompletionDialog: $("#showDownloadCompletionDialog"), downloadShellExecutionMode: $("#downloadShellExecutionMode"), openShellLogAfterExecution: $("#openShellLogAfterExecution"), downloadStateSummary: $("#downloadStateSummary"), downloadShellStateSummary: $("#downloadShellStateSummary"), retryDownloadMoveButton: $("#retryDownloadMoveButton"), saveTabLocalActionsButton: $("#saveTabLocalActionsButton"), resetTabLocalActionsButton: $("#resetTabLocalActionsButton"), revertLocalActionDraftButton: $("#revertLocalActionDraftButton"), downloadCompletionMessage: $("#downloadCompletionMessage"), downloadCompletionPath: $("#downloadCompletionPath"), downloadCompletionDialog: $("#downloadCompletionDialog"), executeShellAfterDownloadButton: $("#executeShellAfterDownloadButton"), acknowledgeDownloadButton: $("#acknowledgeDownloadButton"),
    shellPresetSearch: $("#shellPresetSearch"), shellPresetSearchResult: $("#shellPresetSearchResult"), shellPresetSelect: $("#shellPresetSelect"), shellPresetName: $("#shellPresetName"), shellPresetEnabled: $("#shellPresetEnabled"), loadShellPresetButton: $("#loadShellPresetButton"), newShellPresetButton: $("#newShellPresetButton"), updateShellPresetButton: $("#updateShellPresetButton"), deleteShellPresetButton: $("#deleteShellPresetButton"), requireShellPresetMatch: $("#requireShellPresetMatch"),
    workingDirectory: $("#workingDirectory"), shellCommand: $("#shellCommand"), shellMode: $("#shellMode"), confirmBeforeRun: $("#confirmBeforeRun"), rememberShellHistory: $("#rememberShellHistory"), shellHistoryLimit: $("#shellHistoryLimit"), shellHistorySearch: $("#shellHistorySearch"), shellHistorySearchResult: $("#shellHistorySearchResult"), shellHistorySelect: $("#shellHistorySelect"), loadShellHistoryButton: $("#loadShellHistoryButton"), clearShellHistoryButton: $("#clearShellHistoryButton"),
    nativeHostStatus: $("#nativeHostStatus"), shellRunStatus: $("#shellRunStatus"), shellRunPid: $("#shellRunPid"), shellRunId: $("#shellRunId"), shellOutput: $("#shellOutput"), checkNativeButton: $("#checkNativeButton"), runShellButton: $("#runShellButton"), stopShellButton: $("#stopShellButton"), clearShellOutputButton: $("#clearShellOutputButton"), openShellLogButton: $("#openShellLogButton"), runShellQuickButton: $("#runShellQuickButton"), stopShellQuickButton: $("#stopShellQuickButton"), openShellLogQuickButton: $("#openShellLogQuickButton"), nativeLogRetentionEnabled: $("#nativeLogRetentionEnabled"), nativeLogMaxAgeDays: $("#nativeLogMaxAgeDays"), nativeLogMaxTotalMiB: $("#nativeLogMaxTotalMiB"), nativeLogMaxFiles: $("#nativeLogMaxFiles"), nativeLogCleanupOnStartup: $("#nativeLogCleanupOnStartup"), nativeLogCleanupAfterCommand: $("#nativeLogCleanupAfterCommand"), saveNativeLogRetentionButton: $("#saveNativeLogRetentionButton"), runNativeLogCleanupButton: $("#runNativeLogCleanupButton"), nativeLogCleanupStatus: $("#nativeLogCleanupStatus"),
    shellLogDialog: $("#shellLogDialog"), shellLogDialogTitle: $("#shellLogDialogTitle"), shellLogMetadata: $("#shellLogMetadata"), shellLogViewer: $("#shellLogViewer"), shellLogPageInfo: $("#shellLogPageInfo"), closeShellLogDialogButton: $("#closeShellLogDialogButton"), shellLogFirstButton: $("#shellLogFirstButton"), shellLogPreviousButton: $("#shellLogPreviousButton"), shellLogNextButton: $("#shellLogNextButton"), shellLogLastButton: $("#shellLogLastButton"), copyShellLogSelectionButton: $("#copyShellLogSelectionButton"), copyShellLogPageButton: $("#copyShellLogPageButton"), copyShellLogAllButton: $("#copyShellLogAllButton"), exportShellLogArchiveButton: $("#exportShellLogArchiveButton"), refreshShellLogButton: $("#refreshShellLogButton"), deleteShellLogButton: $("#deleteShellLogButton"),
    workingSessionCatalogSearch: $("#workingSessionCatalogSearch"), workingSessionCatalogSearchResult: $("#workingSessionCatalogSearchResult"), workingSessionCatalogSelect: $("#workingSessionCatalogSelect"), workingSessionCatalogName: $("#workingSessionCatalogName"), workingSessionCatalogDescription: $("#workingSessionCatalogDescription"), workingSessionCatalogTabCount: $("#workingSessionCatalogTabCount"), workingSessionCatalogUpdatedAt: $("#workingSessionCatalogUpdatedAt"), workingSessionCatalogLastRestoredAt: $("#workingSessionCatalogLastRestoredAt"), newWorkingSessionEntryButton: $("#newWorkingSessionEntryButton"), updateWorkingSessionEntryButton: $("#updateWorkingSessionEntryButton"), restoreWorkingSessionEntryButton: $("#restoreWorkingSessionEntryButton"), renameWorkingSessionEntryButton: $("#renameWorkingSessionEntryButton"), duplicateWorkingSessionEntryButton: $("#duplicateWorkingSessionEntryButton"), deleteWorkingSessionEntryButton: $("#deleteWorkingSessionEntryButton"), exportWorkingSessionEntryButton: $("#exportWorkingSessionEntryButton"), importWorkingSessionEntryButton: $("#importWorkingSessionEntryButton"), exportWorkingSessionCatalogButton: $("#exportWorkingSessionCatalogButton"), importWorkingSessionCatalogButton: $("#importWorkingSessionCatalogButton"), importWorkingSessionEntryFile: $("#importWorkingSessionEntryFile"), importWorkingSessionCatalogFile: $("#importWorkingSessionCatalogFile"), workingSessionCatalogResult: $("#workingSessionCatalogResult"),
    saveProfileButton: $("#saveProfileButton"), saveTabButton: $("#saveTabButton"), resetTabButton: $("#resetTabButton"), exportButton: $("#exportButton"), importButton: $("#importButton"), exportConfigurationProfilesButton: $("#exportConfigurationProfilesButton"), importConfigurationProfilesButton: $("#importConfigurationProfilesButton"), exportMonitorProfilesButton: $("#exportMonitorProfilesButton"), importMonitorProfilesButton: $("#importMonitorProfilesButton"), exportTargetProfilesButton: $("#exportTargetProfilesButton"), importTargetProfilesButton: $("#importTargetProfilesButton"), exportLocalActionProfilesButton: $("#exportLocalActionProfilesButton"), importLocalActionProfilesButton: $("#importLocalActionProfilesButton"), profileImportFile: $("#profileImportFile"), clearHighlightsButton: $("#clearHighlightsButton"), importFile: $("#importFile"), settingsSnapshotSelect: $("#settingsSnapshotSelect"), createSettingsSnapshotButton: $("#createSettingsSnapshotButton"), restoreSettingsSnapshotButton: $("#restoreSettingsSnapshotButton"), deleteSettingsSnapshotButton: $("#deleteSettingsSnapshotButton"), settingsSnapshotInfo: $("#settingsSnapshotInfo"), sidebarFeaturesDialog: $("#sidebarFeaturesDialog"), sidebarFeaturePresetSelect: $("#sidebarFeaturePresetSelect"), sidebarFeatureStatus: $("#sidebarFeatureStatus"), resetSidebarFeaturesButton: $("#resetSidebarFeaturesButton"), closeSidebarFeaturesDialogButton: $("#closeSidebarFeaturesDialogButton"), workingSessionDialog: $("#workingSessionDialog"), workingSessionDialogTitle: $("#workingSessionDialogTitle"), workingSessionDialogDescription: $("#workingSessionDialogDescription"), workingSessionTabList: $("#workingSessionTabList"), workingSessionResult: $("#workingSessionResult"), confirmWorkingSessionButton: $("#confirmWorkingSessionButton"), cancelWorkingSessionButton: $("#cancelWorkingSessionButton"), closeWorkingSessionDialogButton: $("#closeWorkingSessionDialogButton"), shortcutOpenSidebar: $("#shortcutOpenSidebar"), shortcutToggleCurrentTab: $("#shortcutToggleCurrentTab"), shortcutAcknowledgeAlert: $("#shortcutAcknowledgeAlert"), shortcutRunTargetAction: $("#shortcutRunTargetAction"), shortcutOpenCommandLog: $("#shortcutOpenCommandLog"), shortcutStopCurrentTab: $("#shortcutStopCurrentTab"), refreshShortcutsButton: $("#refreshShortcutsButton"), manageShortcutsButton: $("#manageShortcutsButton"), resetShortcutsButton: $("#resetShortcutsButton"), shortcutStatus: $("#shortcutStatus"), messageBox: $("#messageBox")
  };

  const modeLabels = {
    [MODE.INACTIVE]: "Inactive",
    [MODE.ACTIVE]: "Running",
    [MODE.PAUSED]: "Paused",
    [MODE.ERROR]: "Error"
  };
  let dashboard = { currentTab: {}, sessions: [], store: Settings.defaultStore(), localActionStore: LocalActions.defaultStore(), workingSessionCatalog: WorkingSession.catalogSummary(WorkingSession.defaultCatalog()), keyboardCommands: [], promptTemplates: PromptTemplates.library(), pendingShortcutAction: null, nativeHost: { connected: false, runs: [], downloads: [] } };
  let selectedTabId = null;
  let selectedProfileId = null;
  let selectedMonitorProfileId = null;
  let selectedTargetProfileId = null;
  let selectedLocalActionProfileId = null;
  let selectedPromptTemplateId = null;
  let promptTemplateEditorMode = "selected";
  let pendingProfileImportType = null;
  let selectedRuleId = null;
  let formConfigDraft = Settings.defaultConfig();
  let commandPresetStore = CommandPresets.defaultStore();
  let shellPresetsDraft = [];
  let selectedShellPresetId = "";
  let commandPresetEditorMode = "tab";
  let selectedShellPresetDirty = false;
  let suppressTabCommandAutosave = false;
  let tabCommandSaveTimer = null;
  let tabCommandSaveSerial = 0;
  let volatileLocalActionSyncTimer = null;
  let volatileLocalActionSyncSerial = 0;
  let volatileTabCommandDirty = false;
  let localActionBaseline = { profileId: null, tabId: null, profileName: "", config: LocalActions.defaultConfig(), fingerprint: "" };
  let localActionDraftDirty = false;
  let nativeLogRetentionDirty = false;
  const soundPreviewPlayer = AlertSound?.createPlayer?.() || { play: async () => ({ started: false, reason: "Sound engine unavailable." }), stop() {} };
  let busy = false;
  let activeTabRefreshSerial = 0;
  let collapsedGroups = {};
  let sidebarFeaturePreset = "standard";
  let visibleSidebarFeatures = new Set(SIDEBAR_FEATURE_PRESETS.standard);
  let autoProfileByUrl = true;
  let listFilters = {
    tabs: "",
    configurationProfiles: "",
    monitorProfiles: "",
    targetProfiles: "",
    localActionProfiles: "",
    commandPresets: "",
    commandHistory: "",
    workingSessions: ""
  };
  const manualProfileSelectionByTab = new Map();
  const profileEditorSelectionByTab = new Map();
  const localActionProfileEditorSelectionByTab = new Map();
  const stoppedConfigBypassTabs = new Set();
  const tabProfileUiUrlByTab = new Map();
  const TAB_PROFILE_UI_STATE_LIMIT = 200;
  const pendingPickerResults = new Map();
  const lastShownDownloadCaptureByTab = new Map();
  const autoOpenedShellRunIds = new Set();
  const lastShellStatusByTab = new Map();
  const SHELL_LOG_PAGE_BYTES = 256 * 1024;
  const SHELL_LOG_EXPORT_WARNING_BYTES = 64 * 1024 * 1024;
  const SHELL_LOG_EXPORT_MAX_BYTES = 512 * 1024 * 1024;
  let shellLogState = { tabId: null, logId: null, runId: null, offset: 0, nextOffset: 0, totalBytes: 0, eof: true, pageOffsets: [], pageIndex: -1, text: "", inlineText: "", label: "", runMetadata: null, tabMetadata: null };
  let shellLogLoadEpoch = 0;
  let shellLogExportBusy = false;
  const FORM_RELOAD_MESSAGE_TYPES = new Set([
    MESSAGE.GET_DASHBOARD, MESSAGE.ACTIVATE_CURRENT, MESSAGE.STOP_TAB,
    MESSAGE.ASSIGN_PROFILE, MESSAGE.SAVE_TAB_CONFIG, MESSAGE.RESET_TAB_CONFIG,
    MESSAGE.CREATE_PROFILE, MESSAGE.DUPLICATE_PROFILE, MESSAGE.SAVE_PROFILE,
    MESSAGE.DELETE_PROFILE, MESSAGE.SET_DEFAULT_PROFILE, MESSAGE.IMPORT_PROFILE_BUNDLE, MESSAGE.SET_TAB_CUSTOM_TITLE,
    MESSAGE.PREVIEW_SETTINGS_IMPORT, MESSAGE.IMPORT_SETTINGS, MESSAGE.CREATE_SETTINGS_SNAPSHOT,
    MESSAGE.CREATE_LOCAL_ACTION_PROFILE, MESSAGE.SAVE_LOCAL_ACTION_PROFILE,
    MESSAGE.DELETE_LOCAL_ACTION_PROFILE, MESSAGE.SET_DEFAULT_LOCAL_ACTION_PROFILE, MESSAGE.ASSIGN_LOCAL_ACTION_PROFILE,
    MESSAGE.SAVE_TAB_LOCAL_ACTIONS, MESSAGE.RESET_TAB_LOCAL_ACTIONS,
    MESSAGE.RESTORE_SETTINGS_SNAPSHOT, MESSAGE.DELETE_SETTINGS_SNAPSHOT,
    MESSAGE.SAVE_WORKING_SESSION_ENTRY, MESSAGE.RENAME_WORKING_SESSION_ENTRY,
    MESSAGE.DUPLICATE_WORKING_SESSION_ENTRY, MESSAGE.DELETE_WORKING_SESSION_ENTRY,
    MESSAGE.RESTORE_WORKING_SESSION_ENTRY, MESSAGE.IMPORT_WORKING_SESSION_ENTRY,
    MESSAGE.IMPORT_WORKING_SESSION_CATALOG
  ]);
  let passiveRefreshTimer = null;
  let passiveRefreshSerial = 0;
  let workingSessionMode = null;
  let pendingWorkingSessionBundle = null;
  let pendingWorkingSessionEntryId = null;
  let selectedWorkingSessionEntryId = null;
  let workingSessionEditorEntryId = null;
  let lastHandledShortcutActionId = null;

  function showMessage(text = "", level = "info") {
    elements.messageBox.textContent = text;
    elements.messageBox.dataset.level = level;
    const isError = level === "error";
    elements.messageBox.setAttribute("role", isError ? "alert" : "status");
    elements.messageBox.setAttribute("aria-live", isError ? "assertive" : "polite");
    elements.messageBox.setAttribute("aria-atomic", "true");
  }

  function promptTemplateLibrary() {
    return dashboard.promptTemplates?.templates ? dashboard.promptTemplates : PromptTemplates.library();
  }

  function selectedPromptTemplate() {
    const templates = promptTemplateLibrary().templates || [];
    return templates.find((template) => template.id === selectedPromptTemplateId) || templates[0] || null;
  }

  function setPromptTemplateStatus(text = "", level = "info") {
    elements.promptTemplateStatus.textContent = text;
    elements.promptTemplateStatus.dataset.state = level;
  }

  function renderPromptTemplates(preferredId = null) {
    const library = promptTemplateLibrary();
    const templates = Array.isArray(library.templates) ? library.templates : [];
    const requested = preferredId || selectedPromptTemplateId;
    const selected = templates.find((template) => template.id === requested) || templates[0] || null;
    selectedPromptTemplateId = selected?.id || null;
    elements.promptTemplateSelect.replaceChildren(...templates.map((template) => {
      const option = document.createElement("option");
      option.value = template.id;
      option.textContent = `${template.source === "built-in" ? "Built-in" : "Custom"} · ${template.name}`;
      return option;
    }));
    elements.promptTemplateSelect.value = selectedPromptTemplateId || "";
    if (promptTemplateEditorMode !== "new") {
      elements.promptTemplateName.value = selected?.name || "";
      elements.promptTemplateText.value = selected?.prompt || "";
    }
    const editable = promptTemplateEditorMode === "new" || selected?.editable === true;
    elements.promptTemplateName.readOnly = !editable;
    elements.promptTemplateText.readOnly = !editable;
    elements.savePromptTemplateButton.disabled = !editable;
    elements.deletePromptTemplateButton.disabled = !selected?.editable;
    elements.fillPromptTemplateButton.disabled = !elements.promptTemplateText.value.trim() || !Number.isInteger(Number(selectedTabId));
    elements.copyPromptTemplateButton.disabled = !elements.promptTemplateText.value.trim();
    if (!elements.promptTemplateStatus.textContent) {
      setPromptTemplateStatus(`${library.builtInCount || 0} built-in and ${library.customCount || 0} custom template(s). Click Fill to use the current page input.`);
    }
  }

  function beginNewPromptTemplate() {
    promptTemplateEditorMode = "new";
    selectedPromptTemplateId = null;
    elements.promptTemplateSelect.value = "";
    elements.promptTemplateName.readOnly = false;
    elements.promptTemplateText.readOnly = false;
    elements.promptTemplateName.value = "";
    elements.promptTemplateText.value = "";
    elements.savePromptTemplateButton.disabled = false;
    elements.deletePromptTemplateButton.disabled = true;
    elements.promptTemplateName.focus();
    setPromptTemplateStatus("Enter a name and prompt, then save the new custom template.");
    void persistSidebarUi();
  }

  async function saveCurrentPromptTemplate() {
    const existing = selectedPromptTemplate();
    const template = {
      id: promptTemplateEditorMode === "new" ? null : (existing?.editable ? existing.id : null),
      name: elements.promptTemplateName.value,
      prompt: elements.promptTemplateText.value
    };
    const response = await request(MESSAGE.SAVE_PROMPT_TEMPLATE, { template }, "Custom prompt template saved.");
    if (!response) return;
    dashboard.promptTemplates = response.promptTemplates || response.dashboard?.promptTemplates || dashboard.promptTemplates;
    promptTemplateEditorMode = "selected";
    selectedPromptTemplateId = response.template?.id || selectedPromptTemplateId;
    setPromptTemplateStatus("Custom prompt template saved.", "success");
    renderPromptTemplates(selectedPromptTemplateId);
    void persistSidebarUi();
  }

  async function deleteCurrentPromptTemplate() {
    const template = selectedPromptTemplate();
    if (!template?.editable) return;
    if (!confirm(`Delete custom prompt template “${template.name}”?`)) return;
    const response = await request(MESSAGE.DELETE_PROMPT_TEMPLATE, { templateId: template.id }, "Custom prompt template deleted.");
    if (!response) return;
    dashboard.promptTemplates = response.promptTemplates || response.dashboard?.promptTemplates || dashboard.promptTemplates;
    promptTemplateEditorMode = "selected";
    selectedPromptTemplateId = null;
    setPromptTemplateStatus("Custom prompt template deleted.", "success");
    renderPromptTemplates();
    void persistSidebarUi();
  }

  async function copyCurrentPromptTemplate() {
    const text = elements.promptTemplateText.value;
    if (!text.trim()) return;
    await navigator.clipboard.writeText(text);
    setPromptTemplateStatus("Prompt copied to the clipboard.", "success");
  }

  async function fillCurrentPromptTemplate() {
    const response = await request(MESSAGE.FILL_PROMPT_TEMPLATE, {
      tabId: selectedTabId,
      templateId: selectedPromptTemplateId,
      text: elements.promptTemplateText.value
    });
    if (!response) return;
    const result = response.result || {};
    const label = result.contentEditable ? "contenteditable textbox" : `${result.tagName || "input"}${result.inputType ? `[type=${result.inputType}]` : ""}`;
    setPromptTemplateStatus(`Prompt filled into the last writable ${label}; ${result.candidateCount || 1} candidate(s) found.`, "success");
  }

  function localActionProfileScope(rawConfig) {
    const config = LocalActions.normalizeConfig(rawConfig);
    return { routing: config.routing, download: config.download };
  }

  function currentLocalActionFingerprint(config = null, profileName = null) {
    const normalized = config ? LocalActions.normalizeConfig(config) : readLocalActionConfig();
    return JSON.stringify({
      profileId: selectedLocalActionProfileId || null,
      tabId: Number.isInteger(Number(selectedTabId)) ? Number(selectedTabId) : null,
      profileName: String(profileName ?? elements.localActionProfileName?.value ?? "").trim(),
      config: localActionProfileScope(normalized)
    });
  }

  function hasVolatileLocalActionEdits() {
    return localActionDraftDirty || volatileTabCommandDirty;
  }

  function renderLocalActionDraftStatus(detail = "") {
    const dirty = hasVolatileLocalActionEdits();
    const card = document.querySelector('section.card[data-group-id="local-actions"]');
    if (card) card.dataset.dirty = dirty ? "true" : "false";
    if (elements.localActionDraftStatus) {
      elements.localActionDraftStatus.hidden = !dirty;
      elements.localActionDraftStatus.dataset.state = "warning";
      elements.localActionDraftStatus.textContent = "";
      const statusDetail = detail || "Unsaved tab-only working edits; isolated to this tab and preserved across background recovery.";
      elements.localActionDraftStatus.title = statusDetail;
      elements.localActionDraftStatus.setAttribute("aria-label", statusDetail);
    }
    if (elements.revertLocalActionDraftButton) {
      elements.revertLocalActionDraftButton.disabled = busy || !dirty;
    }
  }

  function captureLocalActionBaseline(rawConfig, options = {}) {
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
    if (!options.preserveCommandDirty) volatileTabCommandDirty = false;
    renderLocalActionDraftStatus();
  }

  function currentVolatileExecutionConfig() {
    const session = selectedSession();
    const base = LocalActions.normalizeConfig(session?.effectiveLocalActions || LocalActions.defaultConfig());
    const draft = readLocalActionConfig();
    return LocalActions.normalizeConfig({
      routing: draft.routing,
      download: draft.download,
      shell: commandPresetEditorMode === "tab" ? draft.shell : base.shell
    });
  }

  function localActionSyncContext(tabId = selectedTabId) {
    const session = sessionById(Number(tabId));
    if (!session) return null;
    return {
      tabId: Number(tabId),
      sessionToken: String(session.sessionToken || ""),
      localActionRevision: Math.max(0, Number(session.localActionRevision) || 0),
      localActionProfileId: String(session.localActionProfileId || ""),
      localActionConfigMode: session.localActionConfigMode === CONFIG_MODE.TAB ? CONFIG_MODE.TAB : CONFIG_MODE.PROFILE,
      pageUrl: String(session.url || "")
    };
  }

  function cancelScheduledVolatileLocalActionSync() {
    if (volatileLocalActionSyncTimer) clearTimeout(volatileLocalActionSyncTimer);
    volatileLocalActionSyncTimer = null;
    volatileLocalActionSyncSerial += 1;
  }

  async function syncVolatileLocalActionDraft(options = {}) {
    const context = options.context || localActionSyncContext();
    if (!context || !Number.isInteger(context.tabId)) return false;
    const clear = Boolean(options.clear);
    let config = options.config ? LocalActions.normalizeConfig(options.config) : currentVolatileExecutionConfig();
    if (!clear) {
      const validation = LocalActions.validateConfig(config);
      if (!validation.ok) {
        const message = `Current edits are not active yet: ${validation.errors.join(" ")}`;
        renderLocalActionDraftStatus(message);
        if (options.reportErrors) throw new Error(message);
        return false;
      }
      config = validation.config;
    }
    const serial = ++volatileLocalActionSyncSerial;
    const response = await browser.runtime.sendMessage({
      type: MESSAGE.SAVE_TAB_LOCAL_ACTIONS,
      tabId: context.tabId,
      config,
      context,
      volatile: true,
      clear
    });
    if (!response?.ok) {
      const message = response?.error || "Could not apply the current volatile local-action edits.";
      renderLocalActionDraftStatus(message);
      if (options.reportErrors) throw new Error(message);
      return false;
    }
    if (response.stale) {
      if (options.reportErrors) throw new Error("The tab context changed before the local-action draft could be applied.");
      return false;
    }
    if (serial !== volatileLocalActionSyncSerial) return false;
    dashboard = response.dashboard || dashboard;
    renderLocalActionDraftStatus();
    return true;
  }

  function scheduleVolatileLocalActionSync() {
    cancelScheduledVolatileLocalActionSync();
    const context = localActionSyncContext();
    if (!context) return;
    const clear = !hasVolatileLocalActionEdits();
    const config = clear ? LocalActions.defaultConfig() : currentVolatileExecutionConfig();
    volatileLocalActionSyncTimer = setTimeout(() => {
      volatileLocalActionSyncTimer = null;
      void syncVolatileLocalActionDraft({ context, config, clear });
    }, 140);
  }

  function discardVolatileLocalActionDraft(tabId) {
    const context = localActionSyncContext(tabId);
    cancelScheduledVolatileLocalActionSync();
    if (!context) return;
    void syncVolatileLocalActionDraft({ context, config: LocalActions.defaultConfig(), clear: true });
  }

  function updateLocalActionDraftState() {
    if (!localActionBaseline.fingerprint) return;
    localActionDraftDirty = currentLocalActionFingerprint() !== localActionBaseline.fingerprint;
    renderLocalActionDraftStatus();
    scheduleVolatileLocalActionSync();
  }

  function confirmDiscardLocalActionDraft(action) {
    if (!hasVolatileLocalActionEdits()) return true;
    return confirm(`Discard current volatile local-action edits before ${action}?`);
  }

  function revertLocalActionDraft() {
    selectedLocalActionProfileId = localActionBaseline.profileId || selectedLocalActionProfileId;
    elements.localActionProfileSelect.value = selectedLocalActionProfileId || "";
    elements.localActionProfileName.value = localActionBaseline.profileName;
    volatileTabCommandDirty = false;
    const context = localActionSyncContext(localActionBaseline.tabId);
    writeLocalActionConfig(localActionBaseline.config);
    if (context) void syncVolatileLocalActionDraft({ context, config: LocalActions.defaultConfig(), clear: true });
    showMessage("Current volatile local-action edits reverted.", "success");
  }

  function assertSavedLocalActionConfig(expected, actual, label) {
    if (LocalActions.configFingerprint(expected) !== LocalActions.configFingerprint(actual)) {
      throw new Error(`${label}: Firefox storage returned different local-action data.`);
    }
  }


  function tabProfileUiContextUrl(tabId) {
    const numericTabId = Number(tabId);
    const session = sessionById(numericTabId);
    if (session?.url) return String(session.url);
    if (Number(dashboard.currentTab?.tabId) === numericTabId) return String(dashboard.currentTab?.url || "");
    return "";
  }

  function serializeTabProfileMap(map) {
    return Object.fromEntries(
      [...map.entries()]
        .filter(([tabId, value]) => Number.isInteger(Number(tabId)) && String(value || ""))
        .slice(-TAB_PROFILE_UI_STATE_LIMIT)
        .map(([tabId, value]) => [String(Number(tabId)), String(value)])
    );
  }

  function restoreTabProfileMap(map, raw) {
    map.clear();
    for (const [tabId, value] of Object.entries(raw && typeof raw === "object" ? raw : {})) {
      const numericTabId = Number(tabId);
      if (Number.isInteger(numericTabId) && String(value || "")) map.set(numericTabId, String(value));
    }
  }

  function serializeTabProfileSet(set) {
    return [...set].filter((tabId) => Number.isInteger(Number(tabId))).slice(-TAB_PROFILE_UI_STATE_LIMIT).map(Number);
  }

  function restoreTabProfileSet(set, raw) {
    set.clear();
    for (const tabId of Array.isArray(raw) ? raw : []) {
      const numericTabId = Number(tabId);
      if (Number.isInteger(numericTabId)) set.add(numericTabId);
    }
  }

  function rememberTabProfileUiContext(tabId) {
    const numericTabId = Number(tabId);
    if (!Number.isInteger(numericTabId)) return;
    const url = tabProfileUiContextUrl(numericTabId);
    if (url) tabProfileUiUrlByTab.set(numericTabId, url);
  }

  function setTabProfileSelection(map, tabId, profileId) {
    const numericTabId = Number(tabId);
    if (!Number.isInteger(numericTabId)) return;
    if (profileId) map.set(numericTabId, String(profileId));
    else map.delete(numericTabId);
    rememberTabProfileUiContext(numericTabId);
  }

  function setStoppedConfigBypass(tabId, enabled) {
    const numericTabId = Number(tabId);
    if (!Number.isInteger(numericTabId)) return;
    if (enabled) stoppedConfigBypassTabs.add(numericTabId);
    else stoppedConfigBypassTabs.delete(numericTabId);
    rememberTabProfileUiContext(numericTabId);
  }

  function clearTabProfileUiState(tabId) {
    const numericTabId = Number(tabId);
    profileEditorSelectionByTab.delete(numericTabId);
    localActionProfileEditorSelectionByTab.delete(numericTabId);
    manualProfileSelectionByTab.delete(numericTabId);
    stoppedConfigBypassTabs.delete(numericTabId);
    tabProfileUiUrlByTab.delete(numericTabId);
  }

  function validateTabProfileUiContext(tabId) {
    const numericTabId = Number(tabId);
    if (!Number.isInteger(numericTabId)) return;
    const currentUrl = tabProfileUiContextUrl(numericTabId);
    const storedUrl = tabProfileUiUrlByTab.get(numericTabId) || "";
    if (storedUrl && currentUrl && storedUrl !== currentUrl) {
      clearTabProfileUiState(numericTabId);
      void persistSidebarUi();
    } else if (!storedUrl && currentUrl && (
      profileEditorSelectionByTab.has(numericTabId) ||
      localActionProfileEditorSelectionByTab.has(numericTabId) ||
      manualProfileSelectionByTab.has(numericTabId) ||
      stoppedConfigBypassTabs.has(numericTabId)
    )) {
      tabProfileUiUrlByTab.set(numericTabId, currentUrl);
      void persistSidebarUi();
    }
  }

  function persistSidebarUi() {
    return browser.storage.local.set({
      [SIDEBAR_UI_STORAGE_KEY]: {
        collapsedGroups: { ...collapsedGroups },
        featurePreset: sidebarFeaturePreset,
        visibleFeatures: [...visibleSidebarFeatures],
        autoProfileByUrl,
        selectedMonitorProfileId,
        selectedTargetProfileId,
        selectedWorkingSessionEntryId,
        selectedPromptTemplateId,
        listFilters: { ...listFilters },
        tabProfileUi: {
          contextUrls: serializeTabProfileMap(tabProfileUiUrlByTab),
          automationEditor: serializeTabProfileMap(profileEditorSelectionByTab),
          localActionEditor: serializeTabProfileMap(localActionProfileEditorSelectionByTab),
          manualAutomation: serializeTabProfileMap(manualProfileSelectionByTab),
          stoppedConfigBypass: serializeTabProfileSet(stoppedConfigBypassTabs)
        }
      }
    });
  }

  function normalizeSidebarFeatureSelection(rawFeatures, changedFeature = "", enabled = true) {
    const selected = new Set(
      (Array.isArray(rawFeatures) ? rawFeatures : [])
        .filter((featureId) => Object.prototype.hasOwnProperty.call(SIDEBAR_FEATURES, featureId))
    );
    if (changedFeature && Object.prototype.hasOwnProperty.call(SIDEBAR_FEATURES, changedFeature)) {
      if (enabled) selected.add(changedFeature);
      else selected.delete(changedFeature);
      if (!enabled) {
        for (const [featureId, dependencies] of Object.entries(SIDEBAR_FEATURE_DEPENDENCIES)) {
          if (dependencies.includes(changedFeature)) selected.delete(featureId);
        }
      }
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const featureId of [...selected]) {
        for (const dependency of SIDEBAR_FEATURE_DEPENDENCIES[featureId] || []) {
          if (!selected.has(dependency)) {
            selected.add(dependency);
            changed = true;
          }
        }
      }
    }
    return [...selected];
  }

  function applySidebarFeatureVisibility() {
    const visibleGroups = new Set(["tabs"]);
    for (const featureId of visibleSidebarFeatures) {
      for (const groupId of SIDEBAR_FEATURES[featureId]?.groups || []) visibleGroups.add(groupId);
    }
    const sections = [...document.querySelectorAll("section.card[data-group-id]")];
    for (const section of sections) section.hidden = !visibleGroups.has(section.dataset.groupId);
    const shown = sections.filter((section) => !section.hidden).length;
    if (elements.customizeSidebarButton) {
      elements.customizeSidebarButton.title = `Choose visible sidebar features (${shown} of ${sections.length} groups shown)`;
      elements.customizeSidebarButton.setAttribute("aria-label", elements.customizeSidebarButton.title);
    }
    if (elements.sidebarFeatureStatus) {
      elements.sidebarFeatureStatus.textContent = `Showing ${shown} of ${sections.length} sidebar groups. Hidden controls keep their data and runtime behavior.`;
    }
  }

  function renderSidebarFeatureControls() {
    if (!elements.sidebarFeaturePresetSelect) return;
    elements.sidebarFeaturePresetSelect.value = sidebarFeaturePreset;
    for (const checkbox of document.querySelectorAll("[data-sidebar-feature]")) {
      checkbox.checked = visibleSidebarFeatures.has(checkbox.dataset.sidebarFeature);
    }
    applySidebarFeatureVisibility();
  }

  function setSidebarFeaturePreset(preset, persist = true) {
    if (!Object.prototype.hasOwnProperty.call(SIDEBAR_FEATURE_PRESETS, preset)) preset = "standard";
    sidebarFeaturePreset = preset;
    visibleSidebarFeatures = new Set(normalizeSidebarFeatureSelection(SIDEBAR_FEATURE_PRESETS[preset]));
    renderSidebarFeatureControls();
    if (persist) void persistSidebarUi();
  }

  function setSidebarFeatureEnabled(featureId, enabled, persist = true) {
    visibleSidebarFeatures = new Set(normalizeSidebarFeatureSelection([...visibleSidebarFeatures], featureId, enabled));
    sidebarFeaturePreset = "custom";
    renderSidebarFeatureControls();
    if (persist) void persistSidebarUi();
  }

  function openSidebarFeaturesDialog() {
    renderSidebarFeatureControls();
    if (!elements.sidebarFeaturesDialog.open) elements.sidebarFeaturesDialog.showModal();
  }

  function organizeSidebarGroups() {
    const main = elements.messageBox?.parentElement;
    if (!main || !elements.messageBox) return;
    for (const groupId of SIDEBAR_GROUP_ORDER) {
      const section = main.querySelector(`:scope > section.card[data-group-id="${groupId}"]`);
      if (section) main.insertBefore(section, elements.messageBox);
    }
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

  function placeLocalActionProfileAfterConfigurationProfiles() {
    const localCard = document.querySelector('section.card[data-group-id="local-actions"]');
    const profileCard = elements.profileSelect?.closest("section.card");
    if (localCard && profileCard && localCard !== profileCard && profileCard.nextElementSibling !== localCard) {
      profileCard.after(localCard);
    }
  }

  async function initializeCollapsibleGroups() {
    const result = await browser.storage.local.get(SIDEBAR_UI_STORAGE_KEY);
    const storedUi = result?.[SIDEBAR_UI_STORAGE_KEY] || {};
    const stored = storedUi.collapsedGroups;
    collapsedGroups = stored && typeof stored === "object" ? { ...stored } : {};
    const requestedPreset = typeof storedUi.featurePreset === "string" ? storedUi.featurePreset : "standard";
    const hasStoredFeatures = Array.isArray(storedUi.visibleFeatures);
    if (requestedPreset === "custom") {
      sidebarFeaturePreset = "custom";
      visibleSidebarFeatures = new Set(normalizeSidebarFeatureSelection(hasStoredFeatures ? storedUi.visibleFeatures : SIDEBAR_FEATURE_PRESETS.standard));
    } else {
      sidebarFeaturePreset = Object.prototype.hasOwnProperty.call(SIDEBAR_FEATURE_PRESETS, requestedPreset) ? requestedPreset : "standard";
      visibleSidebarFeatures = new Set(normalizeSidebarFeatureSelection(hasStoredFeatures ? storedUi.visibleFeatures : SIDEBAR_FEATURE_PRESETS[sidebarFeaturePreset]));
    }
    autoProfileByUrl = storedUi.autoProfileByUrl !== false;
    selectedMonitorProfileId = typeof storedUi.selectedMonitorProfileId === "string" ? storedUi.selectedMonitorProfileId : null;
    selectedTargetProfileId = typeof storedUi.selectedTargetProfileId === "string" ? storedUi.selectedTargetProfileId : null;
    selectedWorkingSessionEntryId = typeof storedUi.selectedWorkingSessionEntryId === "string" ? storedUi.selectedWorkingSessionEntryId : null;
    selectedPromptTemplateId = typeof storedUi.selectedPromptTemplateId === "string" ? storedUi.selectedPromptTemplateId : null;
    const storedTabProfileUi = storedUi.tabProfileUi && typeof storedUi.tabProfileUi === "object" ? storedUi.tabProfileUi : {};
    restoreTabProfileMap(tabProfileUiUrlByTab, storedTabProfileUi.contextUrls);
    restoreTabProfileMap(profileEditorSelectionByTab, storedTabProfileUi.automationEditor);
    restoreTabProfileMap(localActionProfileEditorSelectionByTab, storedTabProfileUi.localActionEditor);
    restoreTabProfileMap(manualProfileSelectionByTab, storedTabProfileUi.manualAutomation);
    restoreTabProfileSet(stoppedConfigBypassTabs, storedTabProfileUi.stoppedConfigBypass);
    const storedFilters = storedUi.listFilters && typeof storedUi.listFilters === "object" ? storedUi.listFilters : {};
    listFilters = {
      tabs: String(storedFilters.tabs || ""),
      configurationProfiles: String(storedFilters.configurationProfiles || ""),
      monitorProfiles: String(storedFilters.monitorProfiles || ""),
      targetProfiles: String(storedFilters.targetProfiles || ""),
      localActionProfiles: String(storedFilters.localActionProfiles || ""),
      commandPresets: String(storedFilters.commandPresets || ""),
      commandHistory: String(storedFilters.commandHistory || ""),
      workingSessions: String(storedFilters.workingSessions || "")
    };
    elements.autoProfileByUrl.checked = autoProfileByUrl;
    elements.tabSearch.value = listFilters.tabs;
    elements.profileSearch.value = listFilters.configurationProfiles;
    elements.monitorProfileSearch.value = listFilters.monitorProfiles;
    elements.targetProfileSearch.value = listFilters.targetProfiles;
    elements.localActionProfileSearch.value = listFilters.localActionProfiles;
    elements.shellPresetSearch.value = listFilters.commandPresets;
    elements.shellHistorySearch.value = listFilters.commandHistory;
    elements.workingSessionCatalogSearch.value = listFilters.workingSessions;
    renderSidebarFeatureControls();

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
      const groupId = section.dataset.groupId;
      const hasStoredState = Object.prototype.hasOwnProperty.call(collapsedGroups, groupId);
      const initialCollapsed = hasStoredState
        ? Boolean(collapsedGroups[groupId])
        : Boolean(DEFAULT_COLLAPSED_GROUPS[groupId]);
      setGroupCollapsed(section, initialCollapsed);
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

  function monitorProfileById(profileId) {
    return Settings.monitorProfileById(dashboard.store, profileId) || dashboard.store.monitorProfiles?.[0] || null;
  }

  function targetProfileById(profileId) {
    return Settings.targetProfileById(dashboard.store, profileId) || dashboard.store.targetProfiles?.[0] || null;
  }

  function selectedTabMetadata() {
    const session = selectedSession();
    if (session) return session;
    return Number(dashboard.currentTab?.tabId) === Number(selectedTabId) ? dashboard.currentTab : null;
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

  function selectedShellNotice() {
    const source = selectedSession()?.shellNotice || {};
    return {
      tabId: Number(selectedTabId),
      runId: source.runId ? String(source.runId) : null,
      status: ["running", "unread", "viewed"].includes(source.status) ? source.status : "idle",
      command: String(source.command || ""),
      logId: source.logId ? String(source.logId) : null,
      logBytes: Math.max(0, Number(source.logBytes) || 0),
      returnCode: Number.isInteger(source.returnCode) ? source.returnCode : null,
      error: source.error ? String(source.error) : null
    };
  }

  function shellNoticeMarker(session) {
    const status = session?.shellNotice?.status;
    return status === "running" ? "⌘ " : (status === "unread" ? "✓· " : "");
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

  function normalizeFilter(value) {
    return String(value || "").trim().toLocaleLowerCase();
  }

  function filterMatches(query, ...parts) {
    const needle = normalizeFilter(query);
    if (!needle) return true;
    return parts.flat(Infinity).filter((part) => part !== null && part !== undefined)
      .map((part) => String(part).toLocaleLowerCase())
      .some((part) => part.includes(needle));
  }

  function filteredWithSelection(items, query, selectedId, searchable) {
    const needle = normalizeFilter(query);
    const matches = needle ? items.filter((item) => searchable(item, needle)) : [...items];
    const selected = items.find((item) => String(item.id) === String(selectedId)) || null;
    const selectedKept = Boolean(selected && !matches.some((item) => String(item.id) === String(selected.id)));
    return {
      items: selectedKept ? [selected, ...matches] : matches,
      matchCount: matches.length,
      totalCount: items.length,
      selectedKept
    };
  }

  function renderFilterResult(element, state) {
    if (!element) return;
    const active = Boolean(state.query);
    element.dataset.state = active ? (state.matchCount ? "active" : "empty") : "idle";
    element.textContent = !active
      ? `${state.totalCount} item${state.totalCount === 1 ? "" : "s"}`
      : `${state.matchCount} of ${state.totalCount} match${state.matchCount === 1 ? "" : "es"}${state.selectedKept ? " · current selection kept" : ""}`;
  }

  function selectedShellPreset() {
    return shellPresetsDraft.find((preset) => preset.id === selectedShellPresetId) || null;
  }

  function commandPresetIsRunnable(preset) {
    return Boolean(preset && preset.workingDirectory.startsWith("/") && preset.command.trim());
  }

  function renderShellPresetOptions() {
    const result = filteredWithSelection(
      shellPresetsDraft,
      listFilters.commandPresets,
      selectedShellPresetId,
      (preset) => filterMatches(listFilters.commandPresets, preset.name, preset.id, preset.command, preset.workingDirectory, preset.mode, preset.enabled ? "enabled" : "disabled")
    );
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = shellPresetsDraft.length
      ? (result.matchCount ? "Select a command preset" : "No command preset matches")
      : "No command presets yet";
    const options = result.items.map((preset) => {
      const option = document.createElement("option");
      option.value = preset.id;
      const kept = result.selectedKept && String(preset.id) === String(selectedShellPresetId) ? " (selected; outside filter)" : "";
      option.textContent = preset.name;
      if (kept) option.textContent += kept;
      return option;
    });
    elements.shellPresetSelect.replaceChildren(empty, ...options);
    if (!shellPresetsDraft.some((preset) => preset.id === selectedShellPresetId)) selectedShellPresetId = "";
    elements.shellPresetSelect.value = selectedShellPresetId;
    renderFilterResult(elements.shellPresetSearchResult, { ...result, query: listFilters.commandPresets });
    const preset = selectedShellPreset();
    elements.loadShellPresetButton.textContent = "Apply to this tab";
    elements.newShellPresetButton.textContent = "New preset";
    elements.updateShellPresetButton.textContent = "Save preset";
    elements.loadShellPresetButton.disabled = busy || !commandPresetIsRunnable(preset);
    elements.loadShellPresetButton.title = !preset
      ? "Select a command preset first."
      : (commandPresetIsRunnable(preset) ? "Apply the saved preset to this tab." : "Save a valid Working directory and Command before applying this preset.");
    elements.updateShellPresetButton.disabled = busy || !preset;
    elements.updateShellPresetButton.textContent = preset && selectedShellPresetDirty ? "Save changes" : "Save preset";
    elements.updateShellPresetButton.title = preset
      ? (selectedShellPresetDirty ? `Save the edited values into “${preset.name}”.` : `Save the current editor values into “${preset.name}”.`)
      : "Create or select a preset first.";
    elements.deleteShellPresetButton.disabled = busy || !preset;
  }

  function renderShellHistory() {
    const selectedHistoryId = elements.shellHistorySelect.value;
    const history = Array.isArray(selectedSession()?.shellHistory) ? selectedSession().shellHistory : [];
    const result = filteredWithSelection(
      history,
      listFilters.commandHistory,
      selectedHistoryId,
      (entry) => filterMatches(
        listFilters.commandHistory,
        entry.id, entry.command, entry.presetName, entry.status, entry.workingDirectory, entry.cwd,
        entry.mode, entry.returnCode, entry.error, entry.startedAt, entry.endedAt
      )
    );
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = history.length
      ? (result.matchCount ? "Select a recent command" : "No command history matches")
      : "No command history";
    const options = result.items.map((entry) => {
      const option = document.createElement("option");
      option.value = entry.id;
      const when = entry.startedAt ? new Date(entry.startedAt).toLocaleTimeString() : "";
      const kept = result.selectedKept && String(entry.id) === String(selectedHistoryId) ? " · selected outside filter" : "";
      option.textContent = `${when} · ${entry.presetName || entry.command || "Command"} · ${entry.status || "requested"}${kept}`;
      return option;
    });
    elements.shellHistorySelect.replaceChildren(empty, ...options);
    if (history.some((entry) => entry.id === selectedHistoryId)) elements.shellHistorySelect.value = selectedHistoryId;
    renderFilterResult(elements.shellHistorySearchResult, { ...result, query: listFilters.commandHistory });
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

  function inlineShellOutputText(run = selectedShellRun()) {
    const output = Array.isArray(run?.output) ? run.output : [];
    return output.map((item) => `${item.stream === "stderr" ? "[stderr] " : (item.stream === "system" ? "[system] " : "")}${item.text || ""}`).join("");
  }

  function shellHistoryFallbackText(entry) {
    if (!entry) return "";
    const stored = String(entry.inlineOutput || "");
    if (stored) return stored;
    const lines = [
      "[system] The complete Native Host log is unavailable; showing the persisted command summary.",
      entry.startedAt ? `[started] ${entry.startedAt}` : "",
      entry.workingDirectory || entry.cwd ? `[cwd] ${entry.workingDirectory || entry.cwd}` : "",
      entry.command ? `[command] ${entry.command}` : "",
      entry.endedAt ? `[ended] ${entry.endedAt}` : "",
      entry.status ? `[status] ${entry.status}` : "",
      Number.isInteger(entry.returnCode) ? `[returnCode] ${entry.returnCode}` : "",
      entry.error ? `[error] ${entry.error}` : ""
    ].filter(Boolean);
    return `${lines.join("\n")}\n`;
  }

  function commandRunArchiveMetadata(record, kind) {
    const source = record && typeof record === "object" ? record : {};
    return {
      kind,
      tabId: Number(selectedTabId),
      runId: source.runId ? String(source.runId) : null,
      historyId: source.historyId || source.id ? String(source.historyId || source.id) : null,
      status: String(source.status || "unknown"),
      source: String(source.source || "sidebar"),
      mode: String(source.mode || "background"),
      presetId: source.presetId ? String(source.presetId) : null,
      presetName: source.presetName ? String(source.presetName) : null,
      ruleId: source.ruleId ? String(source.ruleId) : null,
      ruleName: source.ruleName ? String(source.ruleName) : null,
      trigger: source.trigger ? String(source.trigger) : null,
      cycle: Number.isInteger(Number(source.cycle)) ? Number(source.cycle) : null,
      workingDirectory: String(source.workingDirectory || source.cwd || ""),
      command: String(source.command || ""),
      startedAt: source.startedAt ? String(source.startedAt) : null,
      endedAt: source.endedAt ? String(source.endedAt) : null,
      returnCode: Number.isInteger(source.returnCode) ? source.returnCode : null,
      error: source.error ? String(source.error) : null,
      pid: Number.isInteger(source.pid) ? source.pid : null,
      logId: source.logId ? String(source.logId) : null,
      logBytes: Math.max(0, Number(source.logBytes) || 0)
    };
  }

  function selectedCommandTabArchiveMetadata() {
    const session = selectedSession();
    const current = dashboard.currentTab || {};
    return {
      tabId: Number(selectedTabId),
      title: String(session?.customTitle || session?.pageTitle || (Number(current.tabId) === Number(selectedTabId) ? current.title : "") || ""),
      url: String(session?.url || (Number(current.tabId) === Number(selectedTabId) ? current.url : "") || "")
    };
  }

  function selectedShellLogDescriptor() {
    const run = selectedShellRun();
    const inlineText = inlineShellOutputText(run);
    if (run?.logId || inlineText) {
      return {
        tabId: selectedTabId,
        logId: run.logId || null,
        runId: run.runId,
        logBytes: Number(run.logBytes) || 0,
        inlineText,
        label: run.presetName || run.command || "Current command",
        runMetadata: commandRunArchiveMetadata(run, "current-run"),
        tabMetadata: selectedCommandTabArchiveMetadata()
      };
    }
    const history = Array.isArray(selectedSession()?.shellHistory) ? selectedSession().shellHistory : [];
    const selectedId = elements.shellHistorySelect.value;
    const entry = history.find((item) => item.id === selectedId) || history[0];
    return entry ? {
      tabId: selectedTabId,
      logId: entry.logId || null,
      runId: entry.runId || null,
      logBytes: Number(entry.logBytes) || 0,
      inlineText: shellHistoryFallbackText(entry),
      label: entry.presetName || entry.command || "Command history",
      runMetadata: commandRunArchiveMetadata(entry, "history-entry"),
      tabMetadata: selectedCommandTabArchiveMetadata()
    } : null;
  }

  function decodeLogChunkBytes(base64Value) {
    const binary = atob(String(base64Value || ""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function decodeLogChunk(base64Value) {
    return new TextDecoder().decode(decodeLogChunkBytes(base64Value));
  }

  function formatByteCount(value) {
    const bytes = Math.max(0, Number(value) || 0);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
  }

  async function loadShellLogPage(descriptor, options = {}) {
    const requestEpoch = Number(options.requestEpoch || ++shellLogLoadEpoch);
    if (!descriptor?.logId && descriptor?.runId) {
      const resolvedResponse = await browser.runtime.sendMessage({
        type: MESSAGE.READ_SHELL_LOG,
        tabId: descriptor.tabId,
        runId: descriptor.runId,
        logId: null,
        offset: Math.max(0, Number(options.offset) || 0),
        maxBytes: SHELL_LOG_PAGE_BYTES,
        fromEnd: Boolean(options.fromEnd)
      });
      if (resolvedResponse?.ok && resolvedResponse.logChunk?.logId) {
        descriptor = { ...descriptor, logId: String(resolvedResponse.logChunk.logId) };
        const chunk = resolvedResponse.logChunk;
        if (requestEpoch !== shellLogLoadEpoch || Number(descriptor.tabId) !== Number(shellLogState.tabId)) return null;
        shellLogState = {
          ...shellLogState,
          tabId: descriptor.tabId,
          logId: descriptor.logId,
          runId: descriptor.runId || null,
          offset: Number(chunk.offset) || 0,
          nextOffset: Number(chunk.nextOffset) || 0,
          totalBytes: Number(chunk.totalBytes) || 0,
          eof: Boolean(chunk.eof),
          text: decodeLogChunk(chunk.dataBase64),
          pageOffsets: [Number(chunk.offset) || 0],
          pageIndex: 0
        };
        elements.shellLogViewer.value = shellLogState.text;
        elements.shellLogViewer.scrollTop = options.fromEnd ? elements.shellLogViewer.scrollHeight : 0;
        elements.shellLogPageInfo.textContent = `Recovered legacy log · Bytes ${shellLogState.offset.toLocaleString()}–${shellLogState.nextOffset.toLocaleString()} of ${shellLogState.totalBytes.toLocaleString()} (${formatByteCount(shellLogState.totalBytes)}).`;
        elements.shellLogFirstButton.disabled = shellLogState.offset <= 0;
        elements.shellLogPreviousButton.disabled = true;
        elements.shellLogNextButton.disabled = shellLogState.eof;
        elements.shellLogLastButton.disabled = shellLogState.eof;
        elements.deleteShellLogButton.disabled = false;
        return shellLogState;
      }
    }
    if (!descriptor?.logId) {
      const currentInline = descriptor?.runId === selectedShellRun()?.runId
        ? inlineShellOutputText(selectedShellRun())
        : String(descriptor?.inlineText || shellLogState.inlineText || "");
      if (requestEpoch !== shellLogLoadEpoch || Number(descriptor?.tabId) !== Number(shellLogState.tabId)) return null;
      shellLogState = {
        ...shellLogState,
        tabId: descriptor?.tabId ?? shellLogState.tabId,
        runId: descriptor?.runId || shellLogState.runId || null,
        logId: null,
        offset: 0,
        nextOffset: currentInline.length,
        totalBytes: new TextEncoder().encode(currentInline).length,
        eof: true,
        pageOffsets: [0],
        pageIndex: 0,
        text: currentInline,
        inlineText: currentInline
      };
      elements.shellLogViewer.value = currentInline || "No stdout or stderr has been received yet.";
      elements.shellLogViewer.scrollTop = elements.shellLogViewer.scrollHeight;
      elements.shellLogPageInfo.textContent = "Showing all output received by the add-on. Reinstall Native Host 0.11.0 or newer for restart-safe relocation receipts and legacy log discovery.";
      elements.shellLogFirstButton.disabled = true;
      elements.shellLogPreviousButton.disabled = true;
      elements.shellLogNextButton.disabled = true;
      elements.shellLogLastButton.disabled = true;
      elements.deleteShellLogButton.disabled = true;
      return shellLogState;
    }
    elements.deleteShellLogButton.disabled = false;
    const response = await browser.runtime.sendMessage({
      type: MESSAGE.READ_SHELL_LOG,
      tabId: descriptor.tabId,
      logId: descriptor.logId,
      offset: Math.max(0, Number(options.offset) || 0),
      maxBytes: SHELL_LOG_PAGE_BYTES,
      fromEnd: Boolean(options.fromEnd)
    });
    if (!response?.ok) throw new Error(response?.error || "Could not read the stored shell log.");
    if (requestEpoch !== shellLogLoadEpoch || Number(descriptor.tabId) !== Number(shellLogState.tabId)) return null;
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

  async function acknowledgeDisplayedShellLog(descriptor) {
    if (!descriptor || Number(descriptor.tabId) !== Number(selectedTabId)) return;
    const response = await browser.runtime.sendMessage({
      type: MESSAGE.ACKNOWLEDGE_SHELL_LOG,
      tabId: descriptor.tabId,
      runId: descriptor.runId || null,
      logId: descriptor.logId || null,
      requireActiveTab: true
    });
    if (response?.ok && response.dashboard) renderRuntimeDashboard(response.dashboard);
  }

  function reportShellLogFailure(error) {
    const message = error instanceof Error ? error.message : String(error);
    elements.shellLogPageInfo.textContent = message;
    RuntimeGuard?.report("shell-log", error, { fatal: false });
    showMessage(`Command log unavailable: ${message}`, "error");
  }

  async function openShellLogDialog(descriptor = selectedShellLogDescriptor(), fromEnd = true) {
    const requestEpoch = ++shellLogLoadEpoch;
    if (!descriptor) {
      if (elements.shellLogDialog.open) elements.shellLogDialog.close();
      showMessage("No stored shell log is available for this tab.", "error");
      return;
    }
    shellLogState = { tabId: descriptor.tabId, logId: descriptor.logId || null, runId: descriptor.runId || null, offset: 0, nextOffset: 0, totalBytes: descriptor.logBytes || 0, eof: false, pageOffsets: [], pageIndex: -1, text: "", inlineText: String(descriptor.inlineText || ""), label: String(descriptor.label || "Command run"), runMetadata: descriptor.runMetadata ? Settings.clone(descriptor.runMetadata) : null, tabMetadata: descriptor.tabMetadata ? Settings.clone(descriptor.tabMetadata) : null };
    elements.exportShellLogArchiveButton.disabled = shellLogExportBusy;
    elements.shellLogDialogTitle.textContent = descriptor.label || "Full command log";
    elements.shellLogMetadata.textContent = `Tab ${descriptor.tabId}${descriptor.runId ? ` · Run ${descriptor.runId}` : ""}`;
    elements.shellLogViewer.value = descriptor.logId ? "Loading stored log…" : "Loading received output…";
    if (!elements.shellLogDialog.open) elements.shellLogDialog.showModal();
    elements.shellLogViewer.focus();
    let displayed = false;
    try {
      const loaded = await loadShellLogPage(descriptor, { fromEnd, requestEpoch });
      displayed = Boolean(loaded && (elements.shellLogViewer.value || descriptor.logId));
    } catch (error) {
      if (requestEpoch !== shellLogLoadEpoch || Number(descriptor.tabId) !== Number(selectedTabId)) return;
      const fallback = String(descriptor.inlineText || (Number(descriptor.tabId) === Number(selectedTabId) ? inlineShellOutputText(selectedShellRun()) : "") || "");
      if (fallback) {
        const loaded = await loadShellLogPage({ ...descriptor, logId: null, inlineText: fallback }, { fromEnd: true, requestEpoch });
        displayed = Boolean(loaded);
        elements.shellLogPageInfo.textContent = `Stored complete log unavailable; showing the persisted per-run fallback. ${error instanceof Error ? error.message : String(error)}`;
        showMessage("Stored complete log unavailable; the persisted command output or summary is shown instead.", "info");
      } else {
        elements.shellLogViewer.value = "";
        reportShellLogFailure(error);
      }
    }
    if (displayed && requestEpoch === shellLogLoadEpoch && Number(descriptor.tabId) === Number(selectedTabId)) {
      try { await acknowledgeDisplayedShellLog(descriptor); } catch (error) { reportShellLogFailure(error); }
    }
  }

  async function reloadOpenShellLogPage(options = {}) {
    const descriptor = { ...shellLogState };
    try {
      await loadShellLogPage(descriptor, options);
    } catch (error) {
      reportShellLogFailure(error);
    }
  }

  function syncOpenShellLogToSelectedTab() {
    shellLogLoadEpoch += 1;
    if (!elements.shellLogDialog.open) return;
    const descriptor = selectedShellLogDescriptor();
    if (!descriptor) {
      elements.shellLogDialog.close();
      shellLogState = { tabId: selectedTabId, logId: null, runId: null, offset: 0, nextOffset: 0, totalBytes: 0, eof: true, pageOffsets: [], pageIndex: -1, text: "", inlineText: "", label: "", runMetadata: null, tabMetadata: null };
      elements.exportShellLogArchiveButton.disabled = true;
      showMessage(`Tab ${selectedTabId} has no command log to display.`, "info");
      return;
    }
    void openShellLogDialog(descriptor, true);
  }

  async function copyTextValue(text, successText) {
    if (!text) throw new Error("There is no log text to copy.");
    await navigator.clipboard.writeText(text);
    showMessage(successText, "success");
  }

  async function copyAllShellLog() {
    if (!shellLogState.logId) {
      await copyTextValue(shellLogState.text || shellLogState.inlineText, "All received command output copied.");
      elements.shellLogPageInfo.textContent = "Copied all output received by the add-on.";
      return;
    }
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


  function archiveRunDescriptor() {
    return {
      tabId: Number(shellLogState.tabId),
      logId: shellLogState.logId || null,
      runId: shellLogState.runId || null,
      logBytes: Math.max(0, Number(shellLogState.totalBytes || shellLogState.logBytes) || 0),
      inlineText: String(shellLogState.inlineText || shellLogState.text || ""),
      label: String(shellLogState.label || "Command run"),
      runMetadata: shellLogState.runMetadata ? Settings.clone(shellLogState.runMetadata) : null,
      tabMetadata: shellLogState.tabMetadata ? Settings.clone(shellLogState.tabMetadata) : null
    };
  }

  async function readCompleteShellLog(descriptor, onProgress = () => {}) {
    if (!descriptor?.logId) {
      const fallback = String(descriptor?.inlineText || "");
      if (!fallback) throw new Error("This command run has no stored log or persisted fallback output.");
      const bytes = new TextEncoder().encode(fallback);
      onProgress(bytes.byteLength, bytes.byteLength);
      return { bytes, completeTranscript: false, source: "persisted-fallback", logId: null, totalBytes: bytes.byteLength };
    }
    const expectedBytes = Math.max(0, Number(descriptor.logBytes) || 0);
    if (expectedBytes > SHELL_LOG_EXPORT_MAX_BYTES) {
      throw new Error(`This log is ${formatByteCount(expectedBytes)}. Per-run ZIP export is limited to ${formatByteCount(SHELL_LOG_EXPORT_MAX_BYTES)} to protect sidebar memory.`);
    }
    const chunks = [];
    let offset = 0;
    let totalBytes = expectedBytes;
    while (true) {
      const response = await browser.runtime.sendMessage({
        type: MESSAGE.READ_SHELL_LOG,
        tabId: descriptor.tabId,
        logId: descriptor.logId,
        runId: descriptor.runId || null,
        offset,
        maxBytes: SHELL_LOG_PAGE_BYTES
      });
      if (!response?.ok) throw new Error(response?.error || "Could not read the complete stored shell log.");
      const chunk = response.logChunk || {};
      const bytes = decodeLogChunkBytes(chunk.dataBase64);
      chunks.push(bytes);
      totalBytes = Math.max(totalBytes, Number(chunk.totalBytes) || 0);
      const nextOffset = Number(chunk.nextOffset);
      onProgress(Number.isFinite(nextOffset) ? nextOffset : offset + bytes.byteLength, totalBytes);
      if (chunk.eof) break;
      if (!Number.isFinite(nextOffset) || nextOffset <= offset) throw new Error("The Native Host returned a non-progressing shell-log page.");
      offset = nextOffset;
      if (offset > SHELL_LOG_EXPORT_MAX_BYTES || totalBytes > SHELL_LOG_EXPORT_MAX_BYTES) {
        throw new Error(`This log exceeds the ${formatByteCount(SHELL_LOG_EXPORT_MAX_BYTES)} per-run ZIP export limit.`);
      }
    }
    const joined = LogArchive.concatBytes(chunks);
    return { bytes: joined, completeTranscript: true, source: "native-complete-log", logId: descriptor.logId, totalBytes: joined.byteLength };
  }

  function commandRunArchiveReadme(metadata) {
    const completeness = metadata.log.completeTranscript
      ? "command.log contains the complete Native Host transcript captured for this run."
      : "command.log contains the persisted fallback available to the add-on; the original complete Native Host transcript was unavailable.";
    return [
      "Firefox ChatAI Assistant — command run archive",
      "",
      completeness,
      "metadata.json records the selected tab/run identity and command result at export time.",
      "The archive may contain commands, paths, output, URLs, or other sensitive information. Review it before sharing.",
      "",
      `Exported: ${metadata.exportedAt}`,
      `Run ID: ${metadata.run.runId || "unknown"}`,
      `Status: ${metadata.run.status || "unknown"}`,
      `Log source: ${metadata.log.source}`,
      ""
    ].join("\n");
  }

  async function exportShellLogArchive() {
    if (shellLogExportBusy) return;
    const descriptor = archiveRunDescriptor();
    if (!Number.isInteger(descriptor.tabId)) {
      showMessage("Open a command log before exporting its run archive.", "error");
      return;
    }
    if (descriptor.logBytes > SHELL_LOG_EXPORT_WARNING_BYTES && !confirm(`This command log is ${formatByteCount(descriptor.logBytes)}. Creating a ZIP may temporarily use additional memory. Continue?`)) return;
    shellLogExportBusy = true;
    elements.exportShellLogArchiveButton.disabled = true;
    const originalInfo = elements.shellLogPageInfo.textContent;
    try {
      const log = await readCompleteShellLog(descriptor, (loaded, total) => {
        elements.shellLogPageInfo.textContent = `Reading complete run log for ZIP: ${formatByteCount(loaded)} / ${formatByteCount(total || loaded)}…`;
      }).catch(async (error) => {
        const fallback = String(descriptor.inlineText || "");
        if (!fallback) throw error;
        const bytes = new TextEncoder().encode(fallback);
        return { bytes, completeTranscript: false, source: "persisted-fallback", logId: descriptor.logId || null, totalBytes: bytes.byteLength, fallbackReason: error instanceof Error ? error.message : String(error) };
      });
      const exportedAt = new Date().toISOString();
      const metadata = {
        schema: "firefox-chat-assistant.command-run-archive",
        schemaVersion: 1,
        exportedAt,
        extension: { version: "0.36.0", protocolVersion: Number(dashboard.protocolVersion) || null },
        tab: { ...(descriptor.tabMetadata || {}), tabId: descriptor.tabId },
        run: { ...(descriptor.runMetadata || {}), tabId: descriptor.tabId, runId: descriptor.runId || descriptor.runMetadata?.runId || null },
        log: {
          source: log.source,
          completeTranscript: Boolean(log.completeTranscript),
          originalLogId: log.logId,
          transcriptBytes: log.totalBytes,
          fallbackReason: log.fallbackReason || null,
          archiveEntry: "command.log"
        }
      };
      elements.shellLogPageInfo.textContent = "Compressing command.log and metadata.json…";
      const metadataText = `${JSON.stringify(metadata, null, 2)}\n`;
      const archiveBytes = await LogArchive.buildZip([
        { name: "command.log", data: log.bytes },
        { name: "metadata.json", data: metadataText },
        { name: "README.txt", data: commandRunArchiveReadme(metadata) }
      ], { modifiedAt: new Date(exportedAt) });
      const stamp = exportedAt.replace(/[:.]/g, "-");
      const runStem = LogArchive.safeDownloadStem(descriptor.runId || descriptor.label || `tab-${descriptor.tabId}`);
      downloadBlob(new Blob([archiveBytes], { type: "application/zip" }), `firefox-chat-assistant-command-run-${runStem}-${stamp}.zip`);
      elements.shellLogPageInfo.textContent = `Exported ${formatByteCount(log.totalBytes)} transcript as a ${formatByteCount(archiveBytes.byteLength)} ZIP${log.completeTranscript ? "." : " using the persisted fallback."}`;
      showMessage(log.completeTranscript ? "Complete command-run ZIP exported." : "Command-run ZIP exported from the persisted fallback because the complete stored log was unavailable.", log.completeTranscript ? "success" : "info");
    } catch (error) {
      elements.shellLogPageInfo.textContent = originalInfo;
      const message = error instanceof Error ? error.message : String(error);
      RuntimeGuard?.report("shell-log-export", error, { fatal: false });
      showMessage(`Could not export command-run ZIP: ${message}`, "error");
    } finally {
      shellLogExportBusy = false;
      elements.exportShellLogArchiveButton.disabled = !Number.isInteger(shellLogState.tabId);
    }
  }

  function readNativeLogRetentionForm() {
    return Settings.normalizeNativeLogRetention({
      enabled: elements.nativeLogRetentionEnabled.checked,
      maxAgeDays: Number(elements.nativeLogMaxAgeDays.value),
      maxTotalMiB: Number(elements.nativeLogMaxTotalMiB.value),
      maxFiles: Number(elements.nativeLogMaxFiles.value),
      runOnStartup: elements.nativeLogCleanupOnStartup.checked,
      runAfterCommand: elements.nativeLogCleanupAfterCommand.checked
    });
  }

  function writeNativeLogRetentionForm(rawPolicy) {
    const policy = Settings.normalizeNativeLogRetention(rawPolicy);
    elements.nativeLogRetentionEnabled.checked = policy.enabled;
    elements.nativeLogMaxAgeDays.value = String(policy.maxAgeDays);
    elements.nativeLogMaxTotalMiB.value = String(policy.maxTotalMiB);
    elements.nativeLogMaxFiles.value = String(policy.maxFiles);
    elements.nativeLogCleanupOnStartup.checked = policy.runOnStartup;
    elements.nativeLogCleanupAfterCommand.checked = policy.runAfterCommand;
  }

  function nativeCleanupSummary() {
    const cleanup = dashboard.nativeHost?.logCleanup || {};
    const store = cleanup.lastResult?.after || dashboard.nativeHost?.logStore || {};
    if (cleanup.lastError) return { text: `Cleanup error: ${cleanup.lastError}`, state: "error" };
    const count = Number(store.fileCount);
    const bytes = Number(store.totalBytes);
    const prefix = Number.isFinite(count) && Number.isFinite(bytes)
      ? `${count} log file${count === 1 ? "" : "s"}, ${formatByteCount(bytes)}`
      : "Log-store status has not been checked";
    if (!cleanup.lastCleanupAt) return { text: `${prefix}.`, state: "idle" };
    const deleted = Number(cleanup.lastResult?.deletedLogIds?.length || 0);
    return {
      text: `${prefix}. Last cleanup: ${cleanup.lastCleanupAt}; deleted ${deleted} file${deleted === 1 ? "" : "s"}${cleanup.lastReason ? ` (${cleanup.lastReason})` : ""}.`,
      state: "success"
    };
  }

  function renderShellState() {
    const native = dashboard.nativeHost || {};
    const run = selectedShellRun();
    const nativeVersionParts = String(native.hostVersion || "0.0.0").split(".").map((part) => Number(part) || 0);
    const nativeNeedsUpdate = Boolean(native.connected) && (nativeVersionParts[0] < 0 || (nativeVersionParts[0] === 0 && nativeVersionParts[1] < 12));
    const nativeVersion = String(native.hostVersion || (native.connected ? "unknown" : "not checked"));
    const nativeStatusText = native.connected
      ? `Native ${nativeVersion}${nativeNeedsUpdate ? " · update required" : ""}`
      : (native.lastError ? "Native error" : "Native not checked");
    const nativeStatusDetails = [
      `Native Host version: ${nativeVersion}`,
      `Status: ${nativeNeedsUpdate ? "update required" : (native.connected ? "connected" : (native.lastError ? "error" : "not checked"))}`,
      native.lastError ? `Error: ${native.lastError}` : "",
      native.lastSeenAt ? `Last checked: ${native.lastSeenAt}` : ""
    ].filter(Boolean).join("\n");
    elements.nativeHostStatus.dataset.state = nativeNeedsUpdate ? "error" : (native.connected ? "online" : (native.lastError ? "error" : "offline"));
    elements.nativeHostStatus.textContent = nativeStatusText;
    elements.nativeHostStatus.title = nativeStatusDetails;
    elements.nativeHostStatus.setAttribute("aria-label", nativeStatusDetails.replace(/\n/g, ". "));
    if (!nativeLogRetentionDirty) writeNativeLogRetentionForm(dashboard.nativeLogRetention);
    const cleanupSummary = nativeCleanupSummary();
    elements.nativeLogCleanupStatus.textContent = cleanupSummary.text;
    elements.nativeLogCleanupStatus.dataset.state = cleanupSummary.state;
    elements.shellRunStatus.textContent = run.error
      ? `${run.status}: ${run.error}`
      : (run.returnCode === null || run.returnCode === undefined
        ? (run.status || "idle")
        : `${run.status} (rc=${run.returnCode})`);
    elements.shellRunPid.textContent = Number.isInteger(run.pid) ? String(run.pid) : "—";
    elements.shellRunId.textContent = run.runId || "—";
    const output = Array.isArray(run.output) ? run.output : [];
    const inlineOutput = inlineShellOutputText(run);
    elements.shellOutput.textContent = inlineOutput || "No output yet.";
    elements.checkNativeButton.disabled = busy;
    elements.saveNativeLogRetentionButton.disabled = busy || !nativeLogRetentionDirty;
    elements.runNativeLogCleanupButton.disabled = busy || !native.connected || nativeNeedsUpdate;
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
    const downloadState = selectedDownloadState();
    const shouldAutoOpenFullLog = run.source !== "download" || downloadState.openShellLogAfterExecution !== false;
    const completedDownloadLogPending = run.source === "download" && ["exited", "error"].includes(run.status);
    const justFinished = ["starting", "running", "stopping"].includes(previousStatus) && ["exited", "error"].includes(run.status);
    if (shouldAutoOpenFullLog && (justFinished || completedDownloadLogPending) && (run.logId || inlineShellOutputText(run)) && !autoOpenedShellRunIds.has(run.runId)) {
      autoOpenedShellRunIds.add(run.runId);
      queueMicrotask(() => void openShellLogDialog({ tabId: selectedTabId, logId: run.logId || null, runId: run.runId, logBytes: run.logBytes, inlineText: inlineShellOutputText(run), label: run.source === "download" ? `Download console · ${run.command}` : (run.presetName || run.command || "Completed command") }, true));
    }
    renderShellPresetOptions();
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

  function renderSoundAlertControls() {
    const enabled = elements.soundAlertEnabled.checked;
    for (const element of [elements.soundAlertTone, elements.soundAlertVolume, elements.soundAlertRepeatCount, elements.soundAlertRepeatIntervalMs]) {
      element.disabled = !enabled;
    }
    elements.soundAlertSettings.dataset.enabled = enabled ? "true" : "false";
  }

  function readSoundAlertPreviewOptions() {
    return AlertSound.normalizeOptions({
      enabled: true,
      tone: elements.soundAlertTone.value,
      volume: Number(elements.soundAlertVolume.value) / 100,
      repeatCount: Number(elements.soundAlertRepeatCount.value),
      repeatIntervalMs: Number(elements.soundAlertRepeatIntervalMs.value)
    });
  }

  async function testSoundAlert() {
    elements.soundAlertTestResult.textContent = "Playing sound preview…";
    const result = await soundPreviewPlayer.play(readSoundAlertPreviewOptions(), { force: true });
    elements.soundAlertTestResult.textContent = result?.started
      ? `Preview started: ${result.options.tone}, ${Math.round(result.options.volume * 100)}%, repeat ${result.options.repeatCount}.`
      : `Sound preview unavailable: ${result?.reason || "unknown error"}`;
  }

  function writeConfig(config) {
    const value = Settings.normalizeConfig(config);
    formConfigDraft = value;
    selectedRuleId = value.activeRuleId;
    elements.routingEnabled.checked = value.activation.routingEnabled;
    elements.routingPriority.value = String(value.activation.routingPriority);
    elements.autoActivateMatchingUrls.checked = value.activation.autoActivate;
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
    elements.soundAlertEnabled.checked = value.alerts.sound.enabled;
    elements.soundAlertTone.value = value.alerts.sound.tone;
    elements.soundAlertVolume.value = String(Math.round(value.alerts.sound.volume * 100));
    elements.soundAlertRepeatCount.value = String(value.alerts.sound.repeatCount);
    elements.soundAlertRepeatIntervalMs.value = String(value.alerts.sound.repeatIntervalMs);
    renderSoundAlertControls();
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
    return selectedShellPreset();
  }

  function readConfig() {
    const draft = commitCurrentRuleDraft();
    return Settings.normalizeConfig({
      ...draft,
      activeRuleId: selectedRuleId,
      activation: {
        routingEnabled: elements.routingEnabled.checked,
        routingPriority: Number(elements.routingPriority.value),
        autoActivate: elements.autoActivateMatchingUrls.checked,
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
        sound: {
          enabled: elements.soundAlertEnabled.checked,
          tone: elements.soundAlertTone.value,
          volume: Number(elements.soundAlertVolume.value) / 100,
          repeatCount: Number(elements.soundAlertRepeatCount.value),
          repeatIntervalMs: Number(elements.soundAlertRepeatIntervalMs.value)
        },
        dismissOnUserActivity: elements.dismissOnUserActivity.checked,
        activeTabTimeoutSeconds: Number(elements.activeTabTimeoutSeconds.value)
      }
    });
  }

  function writeLocalActionConfig(rawConfig, options = {}) {
    const value = LocalActions.normalizeConfig(rawConfig);
    const preserveShell = options.preserveShell === true;
    suppressTabCommandAutosave = true;
    try {
      elements.localActionRoutingEnabled.checked = value.routing.enabled;
      elements.localActionRoutingPriority.value = String(value.routing.priority);
      elements.localActionUrlPatterns.value = value.routing.urlPatterns.join("\n");
      elements.managedDownloadEnabled.checked = value.download.enabled;
      elements.downloadDestinationDirectory.value = value.download.destinationDirectory;
      elements.downloadCaptureWindowSeconds.value = String(value.download.captureWindowSeconds);
      elements.downloadConflictAction.value = value.download.conflictAction;
      elements.showDownloadCompletionDialog.checked = value.download.showCompletionDialog;
      elements.downloadShellExecutionMode.value = value.download.shellExecutionMode;
      elements.openShellLogAfterExecution.checked = value.download.openShellLogAfterExecution;
      if (elements.requireShellPresetMatch) elements.requireShellPresetMatch.checked = false;
      elements.rememberShellHistory.checked = value.shell.rememberHistory;
      elements.shellHistoryLimit.value = String(value.shell.historyLimit);
      if (!preserveShell) {
        selectedShellPresetId = shellPresetsDraft.some((preset) => preset.id === value.shell.selectedPresetId)
          ? value.shell.selectedPresetId
          : "";
        elements.workingDirectory.value = value.shell.workingDirectory;
        elements.shellCommand.value = value.shell.command;
        elements.shellMode.value = value.shell.mode;
        elements.confirmBeforeRun.checked = value.shell.confirmBeforeRun;
        selectedShellPresetDirty = false;
        commandPresetEditorMode = selectedShellPresetId ? "preset-edit" : "tab";
      }
    } finally {
      suppressTabCommandAutosave = false;
    }
    renderShellPresetOptions();
    renderRuleCommandPresetOptions(ruleById(Settings.normalizeConfig(formConfigDraft), selectedRuleId));
    renderShellHistory();
    captureLocalActionBaseline(value, { preserveCommandDirty: preserveShell });
  }

  function readLocalActionConfig() {
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
        shellExecutionMode: elements.downloadShellExecutionMode.value,
        openShellLogAfterExecution: elements.openShellLogAfterExecution.checked
      },
      shell: {
        workingDirectory: elements.workingDirectory.value,
        command: elements.shellCommand.value,
        mode: elements.shellMode.value,
        confirmBeforeRun: elements.confirmBeforeRun.checked,
        requirePresetMatch: false,
        rememberHistory: elements.rememberShellHistory.checked,
        historyLimit: Number(elements.shellHistoryLimit.value),
        selectedPresetId: selectedShellPresetId,
        presets: shellPresetsDraft
      }
    });
  }

  function readLocalActionProfileConfig() {
    return LocalActions.normalizeConfig(readLocalActionConfig());
  }

  function renderLocalActionProfileOptions() {
    const store = dashboard.localActionStore || LocalActions.defaultStore();
    const session = selectedSession();
    const routed = LocalActions.routeProfile(store, session?.url || dashboard.currentTab?.url || "");
    const currentTabBindingId = Number(dashboard.currentTab?.tabId) === Number(selectedTabId)
      ? dashboard.currentTab?.localActionProfileId
      : null;
    if (!store.profiles.some((profile) => profile.id === selectedLocalActionProfileId)) {
      selectedLocalActionProfileId = session?.localActionProfileId || currentTabBindingId || routed.profileId || store.defaultProfileId;
    }
    const result = filteredWithSelection(
      store.profiles,
      listFilters.localActionProfiles,
      selectedLocalActionProfileId,
      (profile) => filterMatches(
        listFilters.localActionProfiles,
        profile.id, profile.name, profile.config?.routing?.urlPatterns,
        profile.config?.download?.destinationDirectory,
        profile.config?.shell?.workingDirectory, profile.config?.shell?.command
      )
    );
    elements.localActionProfileSelect.replaceChildren(...result.items.map((profile) => {
      const suffix = profile.id === store.defaultProfileId ? " (default)" : "";
      const kept = result.selectedKept && String(profile.id) === String(selectedLocalActionProfileId) ? " (selected; outside filter)" : "";
      return new Option(`${profile.name}${suffix}${kept}`, profile.id);
    }));
    elements.localActionProfileSelect.value = selectedLocalActionProfileId || "";
    renderFilterResult(elements.localActionProfileSearchResult, { ...result, query: listFilters.localActionProfiles });
    const profile = localActionProfileById(selectedLocalActionProfileId);
    elements.localActionProfileName.value = profile?.name || "";
    if (elements.localActionModeStatus) {
      elements.localActionModeStatus.hidden = true;
      elements.localActionModeStatus.textContent = "";
    }
    const currentTabSelected = Number(dashboard.currentTab?.tabId) === Number(selectedTabId);
    const effectiveBinding = session?.localActionProfileBinding || (currentTabSelected ? dashboard.currentTab?.localActionProfileBinding : null) || "default";
    const effectiveProfileId = session?.localActionProfileId || (currentTabSelected ? dashboard.currentTab?.localActionProfileId : null) || routed.profileId || store.defaultProfileId;
    const effectiveProfile = localActionProfileById(effectiveProfileId);
    const baseSourceLabel = effectiveBinding === "explicit-tab"
      ? "Explicit tab binding"
      : (effectiveBinding === "url-route" ? "URL-routed profile" : "Default profile");
    const stoppedLocalOverride = !session && currentTabSelected && dashboard.currentTab?.stoppedConfig?.localActionConfigMode === CONFIG_MODE.TAB;
    const sourceLabel = session?.localActionConfigMode === CONFIG_MODE.TAB || stoppedLocalOverride
      ? `${baseSourceLabel}; tab override preserved`
      : baseSourceLabel;
    if (elements.localActionSourceSummary) {
      elements.localActionSourceSummary.hidden = false;
      elements.localActionSourceSummary.dataset.state = effectiveBinding === "explicit-tab" ? "ok" : "idle";
      const selectedDiffers = profile && effectiveProfile && profile.id !== effectiveProfile.id;
      elements.localActionSourceSummary.dataset.state = selectedDiffers ? "warning" : (effectiveBinding === "explicit-tab" ? "ok" : "idle");
      elements.localActionSourceSummary.textContent = `Tab uses: ${effectiveProfile?.name || "Profile unavailable"} (${sourceLabel}) · Editing: ${profile?.name || "Profile unavailable"}${selectedDiffers ? " (not applied)" : ""}`;
    }
    const selectedTabExists = Boolean(session) || currentTabSelected;
    const hasExplicitBinding = effectiveBinding === "explicit-tab";
    elements.assignLocalActionProfileButton.disabled = busy || !selectedTabExists || !profile;
    elements.assignLocalActionProfileButton.title = session
      ? "Apply this local-action profile to the active tab session."
      : (selectedTabExists ? "Bind this local-action profile now; it will be used when the tab is activated." : "Select an available tab first.");
    elements.clearLocalActionProfileBindingButton.disabled = busy || !selectedTabExists || !hasExplicitBinding;
    elements.clearLocalActionProfileBindingButton.title = hasExplicitBinding
      ? "Remove the explicit tab binding and use URL routing or the default Local action profile."
      : "This tab is already using URL routing or the default Local action profile.";
    elements.saveTabLocalActionsButton.disabled = busy || !session;
    elements.resetTabLocalActionsButton.disabled = busy || !session || session.localActionConfigMode !== CONFIG_MODE.TAB;
    const localActionIsDefault = Boolean(profile && profile.id === store.defaultProfileId);
    elements.setDefaultLocalActionProfileButton.disabled = busy || !profile || localActionIsDefault;
    elements.setDefaultLocalActionProfileButton.title = localActionIsDefault
      ? "This is already the default Local action profile."
      : "Use this profile only as the fallback for future unmatched tabs; open tabs are unchanged.";
    elements.deleteLocalActionProfileButton.disabled = busy || !profile || store.profiles.length <= 1 || localActionIsDefault;
    elements.deleteLocalActionProfileButton.title = localActionIsDefault
      ? "Choose another default Local action profile before deleting this one."
      : "Delete this Local action profile while preserving values for tabs that currently use it.";
    renderLocalActionDraftStatus();
  }

  function renderDownloadState() {
    const state = selectedDownloadState();
    const shellAvailability = LocalActions.downloadShellReadiness(state);
    const shellOutcome = LocalActions.downloadShellOutcome(state);
    const text = state.error
      ? `${state.status}: ${state.error}`
      : (state.destinationPath ? `${state.status}: ${state.destinationPath}` : state.status || "idle");
    elements.downloadStateSummary.dataset.state = state.error ? "error" : (state.status === "completed" ? "ok" : "idle");
    elements.downloadStateSummary.textContent = state.moveAttempt > 1 ? `${text} · attempt ${state.moveAttempt}` : text;
    elements.downloadShellStateSummary.dataset.state = shellOutcome.severity;
    elements.downloadShellStateSummary.dataset.outcome = shellOutcome.phase;
    elements.downloadShellStateSummary.textContent = shellOutcome.message;
    elements.downloadShellStateSummary.title = shellOutcome.details;
    elements.retryDownloadMoveButton.disabled = busy || !state.retryable || state.status !== "error";
    elements.executeShellAfterDownloadButton.disabled = busy || !shellAvailability.ready;
    elements.executeShellAfterDownloadButton.title = shellAvailability.reason;
    elements.executeShellAfterDownloadButton.dataset.ready = shellAvailability.ready ? "true" : "false";
    const config = selectedSession()?.effectiveLocalActions || localActionProfileById(selectedLocalActionProfileId)?.config || LocalActions.defaultConfig();
    if (state.status === "completed" && state.destinationPath && state.completionSurface !== "page" && config.download.showCompletionDialog && lastShownDownloadCaptureByTab.get(Number(selectedTabId)) !== (state.completionId || state.moveId || state.captureId)) {
      lastShownDownloadCaptureByTab.set(Number(selectedTabId), state.completionId || state.moveId || state.captureId);
      elements.downloadCompletionMessage.textContent = state.completionReason === "retry"
        ? "The existing staging file was relocated successfully. Retry did not download the file again."
        : "The managed download was moved successfully.";
      elements.downloadCompletionPath.value = state.destinationPath;
      if (!elements.downloadCompletionDialog.open) elements.downloadCompletionDialog.showModal();
      (shellAvailability.ready ? elements.executeShellAfterDownloadButton : elements.acknowledgeDownloadButton).focus();
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

  function autoActivationRoutingForSelectedUrl(includeDraft = false) {
    const currentIsSelected = Number(dashboard.currentTab?.tabId) === Number(selectedTabId);
    const session = selectedSession();
    const url = session?.url || (currentIsSelected ? dashboard.currentTab?.url : "") || "";
    if (!includeDraft || !selectedProfileId) return Settings.routeAutoActivation(dashboard.store, url);
    const draftStore = Settings.clone(dashboard.store);
    const draftProfile = Settings.profileById(draftStore, selectedProfileId);
    if (draftProfile) draftProfile.config = readConfig();
    return Settings.routeAutoActivation(draftStore, url);
  }

  function renderAutoActivationStatus(includeDraft = false) {
    const config = includeDraft ? readConfig() : (profileById(selectedProfileId)?.config || Settings.defaultConfig());
    const origins = Settings.autoActivationPermissionOrigins(config);
    const routing = autoActivationRoutingForSelectedUrl(includeDraft);
    const audit = dashboard.autoActivation?.current || null;
    if (!config.activation.autoActivate) {
      elements.autoActivationResult.dataset.state = "none";
      elements.autoActivationResult.textContent = "Automatic activation is disabled for this profile.";
      return { config, origins, routing };
    }
    if (!origins.length) {
      elements.autoActivationResult.dataset.state = "error";
      elements.autoActivationResult.textContent = "Add an explicit HTTP/HTTPS allowlist before granting access.";
      return { config, origins, routing };
    }
    const auditText = audit?.status
      ? ` Last decision: ${audit.status}${audit.reason ? ` — ${audit.reason}` : ""}.`
      : "";
    elements.autoActivationResult.dataset.state = routing.matched ? "match" : "fallback";
    elements.autoActivationResult.textContent = routing.matched
      ? `This URL is eligible for automatic activation with “${routing.profileName}”. Permission origin(s): ${origins.join(", ")}.${auditText}`
      : `Automatic activation is enabled for this profile, but the selected URL is not currently matched. Permission origin(s): ${origins.join(", ")}.${auditText}`;
    return { config, origins, routing };
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
    renderAutoActivationStatus(includeDraft);
    return routing;
  }

  function renderComponentProfileOptions() {
    const monitorProfiles = Array.isArray(dashboard.store?.monitorProfiles) ? dashboard.store.monitorProfiles : [];
    selectedMonitorProfileId = monitorProfiles.some((profile) => profile.id === selectedMonitorProfileId)
      ? selectedMonitorProfileId
      : (dashboard.store.defaultMonitorProfileId || monitorProfiles[0]?.id || null);
    const monitorResult = filteredWithSelection(
      monitorProfiles,
      listFilters.monitorProfiles,
      selectedMonitorProfileId,
      (profile) => filterMatches(listFilters.monitorProfiles, profile.id, profile.name, profile.monitor?.selector?.tag, profile.monitor?.selector?.kind, profile.monitor?.selector?.value, profile.monitor?.selector?.attributeName, profile.monitor?.visibilityTransition, profile.monitor?.conditions?.map((condition) => [condition.attribute, condition.operator, condition.value]))
    );
    elements.monitorProfileSelect.replaceChildren(...monitorResult.items.map((profile) => {
      const suffix = profile.id === dashboard.store.defaultMonitorProfileId ? " (default)" : "";
      const kept = monitorResult.selectedKept && String(profile.id) === String(selectedMonitorProfileId) ? " (selected; outside filter)" : "";
      return new Option(`${profile.name}${suffix}${kept}`, profile.id);
    }));
    elements.monitorProfileSelect.value = selectedMonitorProfileId || "";
    elements.monitorProfileName.value = monitorProfileById(selectedMonitorProfileId)?.name || "";
    renderFilterResult(elements.monitorProfileSearchResult, { ...monitorResult, query: listFilters.monitorProfiles });

    const targetProfiles = Array.isArray(dashboard.store?.targetProfiles) ? dashboard.store.targetProfiles : [];
    selectedTargetProfileId = targetProfiles.some((profile) => profile.id === selectedTargetProfileId)
      ? selectedTargetProfileId
      : (dashboard.store.defaultTargetProfileId || targetProfiles[0]?.id || null);
    const targetResult = filteredWithSelection(
      targetProfiles,
      listFilters.targetProfiles,
      selectedTargetProfileId,
      (profile) => filterMatches(listFilters.targetProfiles, profile.id, profile.name, profile.target?.selector?.tag, profile.target?.selector?.kind, profile.target?.selector?.value, profile.target?.selector?.attributeName, profile.target?.clickStrategy, profile.target?.pipeline?.verifySelector?.tag, profile.target?.pipeline?.verifySelector?.kind, profile.target?.pipeline?.verifySelector?.value, profile.target?.pipeline?.verifyExpectation)
    );
    elements.targetProfileSelect.replaceChildren(...targetResult.items.map((profile) => {
      const suffix = profile.id === dashboard.store.defaultTargetProfileId ? " (default)" : "";
      const kept = targetResult.selectedKept && String(profile.id) === String(selectedTargetProfileId) ? " (selected; outside filter)" : "";
      return new Option(`${profile.name}${suffix}${kept}`, profile.id);
    }));
    elements.targetProfileSelect.value = selectedTargetProfileId || "";
    elements.targetProfileName.value = targetProfileById(selectedTargetProfileId)?.name || "";
    renderFilterResult(elements.targetProfileSearchResult, { ...targetResult, query: listFilters.targetProfiles });
  }

  function workingSessionCatalogEntries() {
    return Array.isArray(dashboard.workingSessionCatalog?.entries)
      ? dashboard.workingSessionCatalog.entries
      : [];
  }

  function selectedWorkingSessionEntry() {
    return workingSessionCatalogEntries().find((entry) => entry.id === selectedWorkingSessionEntryId) || null;
  }

  function formatSavedSessionDate(rawValue, fallback = "—") {
    if (!rawValue) return fallback;
    const date = new Date(rawValue);
    return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString("en-GB", { hour12: false });
  }

  function setWorkingSessionCatalogResult(text, state = "idle") {
    elements.workingSessionCatalogResult.textContent = text;
    elements.workingSessionCatalogResult.dataset.state = state;
  }

  function renderWorkingSessionCatalog() {
    const entries = workingSessionCatalogEntries();
    if (!entries.some((entry) => entry.id === selectedWorkingSessionEntryId)) {
      selectedWorkingSessionEntryId = entries[0]?.id || null;
      workingSessionEditorEntryId = null;
    }
    const result = filteredWithSelection(
      entries,
      listFilters.workingSessions,
      selectedWorkingSessionEntryId,
      (entry) => filterMatches(
        listFilters.workingSessions,
        entry.id,
        entry.name,
        entry.description,
        entry.tabCount,
        entry.tabs?.map((tab) => [tab.title, tab.customTitle, tab.pageTitle, tab.url, tab.mode, tab.addOnActive ? "active" : "inactive"])
      )
    );
    elements.workingSessionCatalogSelect.replaceChildren(...(
      result.items.length
        ? result.items.map((entry) => {
          const kept = result.selectedKept && entry.id === selectedWorkingSessionEntryId ? " (selected; outside filter)" : "";
          return new Option(`${entry.name} · ${entry.tabCount} tab(s)${kept}`, entry.id);
        })
        : [new Option("No saved sessions yet", "")]
    ));
    elements.workingSessionCatalogSelect.value = selectedWorkingSessionEntryId || "";
    renderFilterResult(elements.workingSessionCatalogSearchResult, { ...result, query: listFilters.workingSessions });

    const entry = selectedWorkingSessionEntry();
    if (workingSessionEditorEntryId !== (entry?.id || null)) {
      elements.workingSessionCatalogName.value = entry?.name || "";
      elements.workingSessionCatalogDescription.value = entry?.description || "";
      workingSessionEditorEntryId = entry?.id || null;
    }
    elements.workingSessionCatalogTabCount.textContent = String(entry?.tabCount || 0);
    elements.workingSessionCatalogUpdatedAt.textContent = formatSavedSessionDate(entry?.updatedAt);
    elements.workingSessionCatalogLastRestoredAt.textContent = formatSavedSessionDate(entry?.lastRestoredAt, "Never");

    const hasEntry = Boolean(entry);
    elements.newWorkingSessionEntryButton.disabled = busy;
    elements.updateWorkingSessionEntryButton.disabled = busy || !hasEntry;
    elements.restoreWorkingSessionEntryButton.disabled = busy || !hasEntry;
    elements.renameWorkingSessionEntryButton.disabled = busy || !hasEntry;
    elements.duplicateWorkingSessionEntryButton.disabled = busy || !hasEntry;
    elements.deleteWorkingSessionEntryButton.disabled = busy || !hasEntry;
    elements.exportWorkingSessionEntryButton.disabled = busy || !hasEntry;
    elements.importWorkingSessionEntryButton.disabled = busy;
    elements.exportWorkingSessionCatalogButton.disabled = busy || !entries.length;
    elements.importWorkingSessionCatalogButton.disabled = busy;
  }

  function renderSelectors(preferredTabId = null) {
    const oldTab = selectedTabId;
    const current = dashboard.currentTab;
    const currentSession = sessionById(current.tabId);
    const tabItems = [];
    if (Number.isInteger(current.tabId) && !currentSession) {
      tabItems.push({
        id: current.tabId,
        title: current.title || current.url || String(current.tabId),
        url: current.url || "",
        mode: "inactive",
        current: true,
        inactive: true,
        shellNotice: ""
      });
    }
    for (const session of dashboard.sessions) {
      tabItems.push({
        id: session.tabId,
        title: session.customTitle || session.title || session.url || String(session.tabId),
        pageTitle: session.pageTitle || session.title || "",
        url: session.url || "",
        mode: session.mode || "inactive",
        current: session.tabId === current.tabId,
        inactive: false,
        shellNotice: session.shellNotice?.status || "idle",
        session
      });
    }
    const allIds = tabItems.map((item) => Number(item.id));
    const preferred = preferredTabId === null || preferredTabId === undefined ? null : Number(preferredTabId);
    selectedTabId = preferred !== null && allIds.includes(preferred)
      ? preferred
      : (allIds.includes(Number(oldTab)) ? Number(oldTab) : (Number.isInteger(current.tabId) ? current.tabId : allIds[0] || null));
    const tabResult = filteredWithSelection(
      tabItems,
      listFilters.tabs,
      selectedTabId,
      (item) => filterMatches(listFilters.tabs, item.id, item.title, item.pageTitle, item.url, item.mode, item.current ? "current" : "", item.shellNotice)
    );
    elements.tabSelect.replaceChildren(...tabResult.items.map((item) => {
      const marker = item.inactive ? "[Current tab] " : `${item.current ? "★ " : ""}${item.session ? shellNoticeMarker(item.session) : ""}[${item.mode}] `;
      const kept = tabResult.selectedKept && Number(item.id) === Number(selectedTabId) ? " (selected; outside filter)" : "";
      const option = new Option(`${marker}${item.title}${kept}`, String(item.id));
      if (item.inactive) option.dataset.inactive = "true";
      return option;
    }));
    if (selectedTabId !== null) elements.tabSelect.value = String(selectedTabId);
    renderFilterResult(elements.tabSearchResult, { ...tabResult, query: listFilters.tabs });

    validateTabProfileUiContext(selectedTabId);
    const oldProfile = selectedProfileId;
    const session = selectedSession();
    const stoppedConfig = !session && Number(dashboard.currentTab?.tabId) === Number(selectedTabId)
      ? dashboard.currentTab?.stoppedConfig
      : null;
    const editorProfileId = profileEditorSelectionByTab.get(Number(selectedTabId));
    const manualProfileId = manualProfileSelectionByTab.get(Number(selectedTabId));
    const routedProfileId = autoProfileByUrl && !session
      ? Settings.routeProfile(dashboard.store, dashboard.currentTab?.url || "").profileId
      : null;
    selectedProfileId =
      (dashboard.store.profiles.some((profile) => profile.id === editorProfileId) ? editorProfileId : null) ||
      session?.profileId ||
      (dashboard.store.profiles.some((profile) => profile.id === manualProfileId) ? manualProfileId : null) ||
      (dashboard.store.profiles.some((profile) => profile.id === stoppedConfig?.profileId) ? stoppedConfig.profileId : null) ||
      (dashboard.store.profiles.some((profile) => profile.id === routedProfileId) ? routedProfileId : null) ||
      (dashboard.store.profiles.some((profile) => profile.id === oldProfile) ? oldProfile : dashboard.store.defaultProfileId);
    const profileResult = filteredWithSelection(
      dashboard.store.profiles,
      listFilters.configurationProfiles,
      selectedProfileId,
      (profile) => filterMatches(listFilters.configurationProfiles, profile.id, profile.name, profile.config?.activation?.urlPatterns, profile.config?.rules?.map((rule) => [rule.name, rule.monitor?.selector?.value, rule.target?.selector?.value, rule.target?.pipeline?.verifySelector?.value]))
    );
    elements.profileSelect.replaceChildren(...profileResult.items.map((profile) => {
      const suffix = profile.id === dashboard.store.defaultProfileId ? " (default)" : "";
      const kept = profileResult.selectedKept && String(profile.id) === String(selectedProfileId) ? " (selected; outside filter)" : "";
      return new Option(`${profile.name}${suffix}${kept}`, profile.id);
    }));
    elements.profileSelect.value = selectedProfileId;
    renderFilterResult(elements.profileSearchResult, { ...profileResult, query: listFilters.configurationProfiles });
    if (elements.automationProfileSourceSummary) {
      const selectedProfile = profileById(selectedProfileId);
      let effectiveProfileId = dashboard.store.defaultProfileId;
      let sourceLabel = "Default profile";
      if (session) {
        effectiveProfileId = session.profileId || dashboard.store.defaultProfileId;
        sourceLabel = session.configMode === CONFIG_MODE.TAB ? "Active tab override based on" : "Active tab uses";
      } else if (stoppedConfig && !stoppedConfigBypassTabs.has(Number(selectedTabId))) {
        effectiveProfileId = stoppedConfig.profileId || dashboard.store.defaultProfileId;
        sourceLabel = stoppedConfig.configMode === CONFIG_MODE.TAB ? "Stopped tab override based on" : "Stopped tab will restore";
      } else if (dashboard.store.profiles.some((profile) => profile.id === manualProfileId)) {
        effectiveProfileId = manualProfileId;
        sourceLabel = "Next Start will use";
      } else if (dashboard.store.profiles.some((profile) => profile.id === routedProfileId)) {
        effectiveProfileId = routedProfileId;
        sourceLabel = "URL routing selects";
      }
      const effectiveProfile = profileById(effectiveProfileId);
      const differs = selectedProfile && effectiveProfile && selectedProfile.id !== effectiveProfile.id;
      elements.automationProfileSourceSummary.dataset.state = differs ? "warning" : "idle";
      elements.automationProfileSourceSummary.textContent = `${sourceLabel}: ${effectiveProfile?.name || "Profile unavailable"} · Editing: ${selectedProfile?.name || "Profile unavailable"}${differs ? " (not applied)" : ""}`;
    }
    renderComponentProfileOptions();
    const localStore = dashboard.localActionStore || LocalActions.defaultStore();
    const routedLocal = LocalActions.routeProfile(localStore, session?.url || dashboard.currentTab?.url || "");
    const currentTabBindingId = Number(dashboard.currentTab?.tabId) === Number(selectedTabId)
      ? dashboard.currentTab?.localActionProfileId
      : null;
    const editorLocalActionProfileId = localActionProfileEditorSelectionByTab.get(Number(selectedTabId));
    selectedLocalActionProfileId =
      (localStore.profiles.some((profile) => profile.id === editorLocalActionProfileId) ? editorLocalActionProfileId : null) ||
      session?.localActionProfileId ||
      (localStore.profiles.some((profile) => profile.id === currentTabBindingId) ? currentTabBindingId : null) ||
      (localStore.profiles.some((profile) => profile.id === stoppedConfig?.localActionProfileId) ? stoppedConfig.localActionProfileId : null) ||
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



  function formatStatisticsDuration(milliseconds, count) {
    if (!count) return "—";
    const value = Math.max(0, Number(milliseconds) || 0) / Math.max(1, Number(count) || 1);
    if (value < 1000) return `${Math.round(value)} ms`;
    if (value < 60000) return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)} s`;
    return `${(value / 60000).toFixed(1)} min`;
  }

  function normalizedRuleStatistics(session, rule) {
    const source = session?.ruleStatistics?.[rule.id] || {};
    const count = (key) => Math.max(0, Number(source[key]) || 0);
    return {
      ruleId: rule.id,
      ruleName: rule.name,
      startedAt: source.startedAt || session?.statisticsStartedAt || session?.activatedAt || null,
      updatedAt: source.updatedAt || null,
      matchCount: count("matchCount"),
      clickCount: count("clickCount"),
      dryRunCount: count("dryRunCount"),
      verifyPassCount: count("verifyPassCount"),
      verifyFailCount: count("verifyFailCount"),
      verifySkippedCount: count("verifySkippedCount"),
      commandSuccessCount: count("commandSuccessCount"),
      commandFailureCount: count("commandFailureCount"),
      returnCodeCounts: source.returnCodeCounts && typeof source.returnCodeCounts === "object" ? source.returnCodeCounts : {},
      lastReturnCode: Number.isInteger(source.lastReturnCode) ? source.lastReturnCode : null,
      targetLatencyCount: count("targetLatencyCount"),
      totalTargetLatencyMs: count("totalTargetLatencyMs"),
      pipelineDurationCount: count("pipelineDurationCount"),
      totalPipelineDurationMs: count("totalPipelineDurationMs"),
      lastMatchedAt: source.lastMatchedAt || null,
      lastTargetAt: source.lastTargetAt || null,
      lastVerifyAt: source.lastVerifyAt || null,
      lastCommandAt: source.lastCommandAt || null,
      lastEventAt: source.lastEventAt || null
    };
  }

  function returnCodeStatisticsText(statistics) {
    const entries = Object.entries(statistics.returnCodeCounts || {})
      .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
      .map(([code, count]) => `${code}×${count}`);
    return entries.length ? entries.join(", ") : "none";
  }

  function renderRuleStatistics() {
    const session = selectedSession();
    const config = Settings.normalizeConfig(session?.effectiveConfig || profileById(selectedProfileId)?.config || Settings.defaultConfig());
    const rules = Array.isArray(config.rules) ? config.rules : [];
    const statistics = rules.map((rule) => ({ rule, value: normalizedRuleStatistics(session, rule) }));
    const totals = statistics.reduce((result, entry) => {
      for (const key of ["matchCount", "clickCount", "dryRunCount", "verifyPassCount", "verifyFailCount", "verifySkippedCount", "commandSuccessCount", "commandFailureCount"]) {
        result[key] += entry.value[key];
      }
      return result;
    }, { matchCount: 0, clickCount: 0, dryRunCount: 0, verifyPassCount: 0, verifyFailCount: 0, verifySkippedCount: 0, commandSuccessCount: 0, commandFailureCount: 0 });

    elements.statisticsRuleCount.textContent = session ? String(rules.length) : "—";
    elements.statisticsMatchCount.textContent = session ? String(totals.matchCount) : "—";
    elements.statisticsClickCount.textContent = session ? `${totals.clickCount} / dry ${totals.dryRunCount}` : "—";
    elements.statisticsVerifyCount.textContent = session ? `${totals.verifyPassCount} / ${totals.verifyFailCount}${totals.verifySkippedCount ? ` / skip ${totals.verifySkippedCount}` : ""}` : "—";
    elements.statisticsCommandCount.textContent = session ? `${totals.commandSuccessCount} / ${totals.commandFailureCount}` : "—";
    elements.ruleStatisticsRows.replaceChildren();

    if (!session) {
      const empty = document.createElement("p");
      empty.className = "empty-log";
      empty.textContent = "Activate a tab to collect rule statistics.";
      elements.ruleStatisticsRows.append(empty);
      elements.selectedRuleStatistics.textContent = "No activated tab session is selected.";
      elements.ruleStatisticsStatus.textContent = "Statistics start when the tab is activated.";
      elements.ruleStatisticsStatus.dataset.state = "empty";
      elements.exportRuleStatisticsButton.disabled = true;
      elements.resetRuleStatisticsButton.disabled = true;
      return;
    }

    for (const { rule, value } of statistics) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "rule-statistics-row";
      row.dataset.ruleId = rule.id;
      row.dataset.selected = String(rule.id === selectedRuleId);
      row.dataset.enabled = String(Boolean(rule.enabled));
      row.setAttribute("role", "listitem");
      row.title = `Select ${rule.name} in the rule editor`;
      const heading = document.createElement("span");
      heading.className = "rule-statistics-row-heading";
      const name = document.createElement("span");
      name.textContent = rule.name;
      const state = document.createElement("small");
      state.textContent = rule.enabled ? (session.runtime?.ruleRuntimes?.[rule.id]?.monitorState || "idle") : "disabled";
      heading.append(name, state);
      const metrics = document.createElement("span");
      metrics.className = "rule-statistics-metrics";
      for (const text of [
        `Match ${value.matchCount}`,
        `Click ${value.clickCount}`,
        `Dry ${value.dryRunCount}`,
        `Verify ${value.verifyPassCount}/${value.verifyFailCount}`,
        `Cmd ${value.commandSuccessCount}/${value.commandFailureCount}`,
        `Avg ${formatStatisticsDuration(value.totalPipelineDurationMs, value.pipelineDurationCount)}`
      ]) {
        const metric = document.createElement("span");
        metric.textContent = text;
        metrics.append(metric);
      }
      row.append(heading, metrics);
      row.addEventListener("click", () => selectRuleForEditing(rule.id));
      elements.ruleStatisticsRows.append(row);
    }

    const selected = statistics.find((entry) => entry.rule.id === selectedRuleId) || statistics[0] || null;
    if (selected) {
      const value = selected.value;
      elements.selectedRuleStatistics.textContent = `${selected.rule.name}: matches ${value.matchCount}; clicks ${value.clickCount}; dry-runs ${value.dryRunCount}; verify PASS ${value.verifyPassCount}, FAIL ${value.verifyFailCount}, skipped ${value.verifySkippedCount}; commands OK ${value.commandSuccessCount}, failed ${value.commandFailureCount}; return codes ${returnCodeStatisticsText(value)}; average MATCHED→target ${formatStatisticsDuration(value.totalTargetLatencyMs, value.targetLatencyCount)}; average pipeline ${formatStatisticsDuration(value.totalPipelineDurationMs, value.pipelineDurationCount)}; last event ${value.lastEventAt ? new Date(value.lastEventAt).toLocaleString() : "none"}.`;
    } else {
      elements.selectedRuleStatistics.textContent = "No configured rule is available.";
    }
    const startedAt = session.statisticsStartedAt || session.activatedAt;
    elements.ruleStatisticsStatus.textContent = `Tab ${session.tabId}; collecting since ${startedAt ? new Date(startedAt).toLocaleString() : "activation"}. Statistics persist across background recovery and are cleared when this tab session stops.`;
    elements.ruleStatisticsStatus.dataset.state = "active";
    elements.exportRuleStatisticsButton.disabled = busy || !rules.length;
    elements.resetRuleStatisticsButton.disabled = busy;
  }

  function exportRuleStatistics() {
    const session = selectedSession();
    if (!session) {
      showMessage("Activate a tab before exporting rule statistics.", "error");
      return;
    }
    const config = Settings.normalizeConfig(session.effectiveConfig || Settings.defaultConfig());
    const payload = {
      type: "firefox-chat-improver-rule-statistics",
      schema: 1,
      exportedAt: new Date().toISOString(),
      tab: { tabId: session.tabId, title: session.customTitle || session.title || "", url: session.url || "", sessionToken: session.sessionToken || null },
      statisticsStartedAt: session.statisticsStartedAt || session.activatedAt || null,
      rules: config.rules.map((rule) => ({ ...normalizedRuleStatistics(session, rule), enabled: Boolean(rule.enabled) }))
    };
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadBlob(new Blob([JSON.stringify(payload, null, 2) + "\n"], { type: "application/json" }), `firefox-chat-assistant-rule-statistics-tab-${session.tabId}-${stamp}.json`);
    showMessage(`Exported statistics for ${payload.rules.length} rule(s) in tab ${session.tabId}.`, "success");
  }

  async function resetRuleStatistics() {
    const session = selectedSession();
    if (!session) {
      showMessage("Activate a tab before resetting rule statistics.", "error");
      return;
    }
    if (!confirm(`Reset all per-rule statistics for tab ${session.tabId}?\n\nThis does not change the rules or stop automation.`)) return;
    const response = await request(MESSAGE.RESET_RULE_STATISTICS, { tabId: session.tabId });
    if (response?.ok) showMessage(`Rule statistics for tab ${session.tabId} were reset.`, "success");
  }

  function renderSettingsSnapshots() {
    const snapshots = Array.isArray(dashboard.settingsSnapshots) ? dashboard.settingsSnapshots : [];
    const previous = elements.settingsSnapshotSelect.value;
    elements.settingsSnapshotSelect.replaceChildren();
    if (!snapshots.length) {
      elements.settingsSnapshotSelect.add(new Option("No snapshots yet", ""));
      elements.settingsSnapshotInfo.textContent = "New snapshots cover all configuration. Legacy snapshots created before v0.40.9 contain Automation settings only.";
    } else {
      for (const snapshot of snapshots) {
        const stamp = new Date(snapshot.createdAt).toLocaleString();
        elements.settingsSnapshotSelect.add(new Option(`${stamp} · ${snapshot.label}`, snapshot.id));
      }
      elements.settingsSnapshotSelect.value = snapshots.some((snapshot) => snapshot.id === previous)
        ? previous
        : snapshots[0].id;
      const selected = snapshots.find((snapshot) => snapshot.id === elements.settingsSnapshotSelect.value) || snapshots[0];
      elements.settingsSnapshotInfo.textContent = selected.scope === "all-configuration"
        ? `${selected.profileCount} Automation, ${selected.localActionProfileCount} Local action, ${selected.commandPresetCount} command preset(s), ${selected.customPromptTemplateCount} custom prompt template(s); reason: ${selected.reason}.`
        : `Legacy Automation-only snapshot: ${selected.profileCount} profile(s), revision ${selected.revision}, reason: ${selected.reason}.`;
    }
    const hasSelection = Boolean(elements.settingsSnapshotSelect.value);
    elements.restoreSettingsSnapshotButton.disabled = busy || !hasSelection;
    elements.deleteSettingsSnapshotButton.disabled = busy || !hasSelection;
    elements.createSettingsSnapshotButton.disabled = busy;
  }

  const KEYBOARD_COMMAND_VIEW = Object.freeze({
    _execute_sidebar_action: elements.shortcutOpenSidebar,
    "fci-toggle-current-tab": elements.shortcutToggleCurrentTab,
    "fci-acknowledge-current-alert": elements.shortcutAcknowledgeAlert,
    "fci-run-current-target-action": elements.shortcutRunTargetAction,
    "fci-open-current-command-log": elements.shortcutOpenCommandLog,
    "fci-stop-current-tab": elements.shortcutStopCurrentTab
  });

  function renderKeyboardShortcuts() {
    const commands = Array.isArray(dashboard.keyboardCommands) ? dashboard.keyboardCommands : [];
    const byName = new Map(commands.map((item) => [item.name, item]));
    let missing = 0;
    for (const [name, output] of Object.entries(KEYBOARD_COMMAND_VIEW)) {
      const item = byName.get(name);
      const shortcut = String(item?.shortcut || "").trim();
      output.textContent = shortcut || "Not assigned";
      output.dataset.state = shortcut ? "assigned" : "missing";
      output.title = item?.description || name;
      if (!shortcut) missing += 1;
    }
    elements.shortcutStatus.textContent = missing
      ? `${missing} command(s) are unassigned. The browser may have cleared a conflicting shortcut.`
      : "All keyboard commands are assigned.";
    elements.shortcutStatus.dataset.state = missing ? "warning" : "success";
    elements.resetShortcutsButton.disabled = busy || !browser.commands?.reset;
    elements.manageShortcutsButton.disabled = busy || !browser.commands?.openShortcutSettings;
  }

  async function consumePendingShortcutAction() {
    const action = dashboard.pendingShortcutAction;
    if (!action?.id || action.id === lastHandledShortcutActionId) return;
    lastHandledShortcutActionId = action.id;
    try {
      if (Number.isInteger(Number(action.tabId)) && Number(action.tabId) !== Number(selectedTabId)) {
        await refreshForActiveTab(Number(action.tabId));
      }
      if (action.action === "open-shell-log") {
        const descriptor = selectedShellLogDescriptor();
        if (descriptor) await openShellLogDialog(descriptor, true);
        else showMessage("No command log is available for the current tab.", "error");
      } else if (action.action === "message") {
        showMessage(action.message || "The keyboard shortcut could not be completed.", "error");
      }
    } finally {
      const response = await browser.runtime.sendMessage({ type: MESSAGE.ACK_SHORTCUT_ACTION, actionId: action.id });
      if (response?.ok) dashboard = response.dashboard || dashboard;
    }
  }

  async function manageKeyboardShortcuts() {
    if (!browser.commands?.openShortcutSettings) throw new Error("This browser cannot open extension shortcut settings automatically.");
    await browser.commands.openShortcutSettings();
  }

  async function resetKeyboardShortcuts() {
    if (!browser.commands?.reset) throw new Error("This browser cannot reset extension shortcuts.");
    const commands = Array.isArray(dashboard.keyboardCommands) ? dashboard.keyboardCommands : [];
    for (const item of commands) {
      if (!item?.name) continue;
      try { await browser.commands.reset(item.name); } catch (_error) {}
    }
    const response = await browser.runtime.sendMessage({ type: MESSAGE.GET_DASHBOARD });
    if (!response?.ok) throw new Error(response?.error || "Could not refresh keyboard shortcuts.");
    dashboard = response.dashboard;
    renderKeyboardShortcuts();
    showMessage("Keyboard shortcuts reset to the manifest defaults. Unassigned optional commands remain available in Firefox settings.", "success");
  }

  function downloadHeaderNotice(rawState) {
    const state = rawState && typeof rawState === "object" ? rawState : {};
    const status = String(state.status || "idle");
    if (status === "armed") {
      return {
        visible: true,
        icon: "CK",
        state: "checking",
        label: "Ready; checking for a managed download to start."
      };
    }
    if (status === "downloading") {
      return {
        visible: true,
        icon: "DL",
        state: "downloading",
        label: "Managed download is currently downloading in Firefox."
      };
    }
    if (status === "moving") {
      return {
        visible: true,
        icon: "MV",
        state: "moving",
        label: "Browser download finished; moving the file to its configured destination."
      };
    }
    if (status === "completed") {
      return {
        visible: true,
        icon: "✓",
        state: "completed",
        label: state.destinationPath
          ? `Download completed: ${state.destinationPath}`
          : "Managed download completed."
      };
    }
    if (status === "expired") {
      return {
        visible: true,
        icon: "NO",
        state: "expired",
        label: String(state.error || "No managed download was detected before the capture window ended.")
      };
    }
    if (status === "error") {
      return {
        visible: true,
        icon: "×",
        state: "error",
        label: String(state.error || "Managed download failed.")
      };
    }
    return { visible: false, icon: "", state: "idle", label: "No active managed download notification." };
  }

  function renderDetails(loadForm = true) {
    const session = selectedSession();
    const currentIsSelected = Number(dashboard.currentTab.tabId) === Number(selectedTabId);
    const stoppedConfig = !session && currentIsSelected ? dashboard.currentTab?.stoppedConfig : null;
    const mode = session?.mode || MODE.INACTIVE;
    const runtime = session?.runtime || {};
    elements.body.dataset.mode = mode;
    const sidebarAlertEnabled = Boolean(session?.effectiveConfig?.alerts?.sidebar);
    const alertActive = Boolean(runtime.alertActive);
    elements.body.dataset.alert = sidebarAlertEnabled && alertActive ? "active" : "inactive";
    const shellNotice = selectedShellNotice();
    elements.body.dataset.command = shellNotice.status;
    elements.statusPill.textContent = mode === MODE.ACTIVE && runtime.monitorState === "matched"
      ? "RD"
      : (modeLabels[mode] || mode);
    elements.statusPill.title = mode === MODE.ACTIVE && runtime.monitorState === "matched"
      ? "AI ready: the monitored condition is matched."
      : (modeLabels[mode] || mode);
    const downloadNotice = downloadHeaderNotice(selectedDownloadState());
    elements.downloadStatusIcon.hidden = !downloadNotice.visible;
    elements.downloadStatusIcon.textContent = downloadNotice.icon;
    elements.downloadStatusIcon.dataset.state = downloadNotice.state;
    elements.downloadStatusIcon.title = downloadNotice.label;
    elements.downloadStatusIcon.setAttribute("aria-label", downloadNotice.label);
    const commandIcon = shellNotice.status === "running" ? "⌘" : (shellNotice.status === "unread" ? "✓" : "");
    elements.commandStatusIcon.hidden = !commandIcon;
    elements.commandStatusIcon.textContent = commandIcon;
    elements.commandStatusIcon.dataset.state = shellNotice.status;
    elements.commandStatusIcon.title = shellNotice.status === "running"
      ? "A shell command is running in this tab."
      : (shellNotice.status === "unread" ? "The shell command finished; open its console log to clear this indicator." : "");
    elements.commandStatusIcon.setAttribute("aria-label", elements.commandStatusIcon.title || "No command notification");
    elements.tabId.textContent = Number.isInteger(selectedTabId) ? String(selectedTabId) : "—";
    const recoveryState = runtime.recoveryState || "none";
    const recoverySuffix = recoveryState !== "none" && recoveryState !== "attached"
      ? ` · ${recoveryState}`
      : "";
    elements.modeText.textContent = `${modeLabels[mode] || mode}${recoverySuffix}`;
    elements.configModeText.textContent = session?.configMode === CONFIG_MODE.TAB
      ? "Tab-specific"
      : (session ? "Profile-based" : (stoppedConfig ? (stoppedConfig.configMode === CONFIG_MODE.TAB ? "Stopped · tab-specific" : "Stopped · profile-based") : "No session"));
    elements.profileText.textContent = session?.profileName || profileById(stoppedConfig?.profileId || selectedProfileId)?.name || "—";
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
        ? `ACTIVE cycle ${runtime.alertCycle || runtime.cycle || 0}${runtime.titleBlinking ? " / title blink" : ""}${runtime.soundAlertState && runtime.soundAlertState !== "idle" ? ` / sound ${runtime.soundAlertState}` : ""}`
        : (runtime.alertDismissReason ? `dismissed (${runtime.alertDismissReason})` : "inactive"))
      : "—";
    elements.commandNoticeText.textContent = !session
      ? "—"
      : (shellNotice.status === "running" ? "⌘" : (shellNotice.status === "unread" ? "✓" : "—"));
    elements.commandNoticeText.title = !session
      ? ""
      : (shellNotice.status === "running"
        ? `Command running${shellNotice.command ? `: ${shellNotice.command}` : ""}`
        : (shellNotice.status === "unread"
          ? `Command finished; console not viewed${shellNotice.returnCode === null ? "" : `; rc=${shellNotice.returnCode}`}`
          : "No command notification."));
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
    const tabMetadata = selectedTabMetadata();
    elements.tabUrl.textContent = session?.url || (currentIsSelected ? dashboard.currentTab.url : "") || "—";
    elements.saveCustomTabTitleButton.disabled = busy || !tabMetadata;
    elements.clearCustomTabTitleButton.disabled = busy || !tabMetadata || !String(tabMetadata?.customTitle || "").trim();
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
    const automationProfile = profileById(selectedProfileId);
    const automationIsDefault = Boolean(automationProfile && automationProfile.id === dashboard.store.defaultProfileId);
    elements.setDefaultProfileButton.disabled = busy || !automationProfile || automationIsDefault;
    elements.setDefaultProfileButton.title = automationIsDefault
      ? "This is already the default Automation profile."
      : "Use this profile only as the fallback for future activations; open tabs are unchanged.";
    elements.deleteProfileButton.disabled = busy || !automationProfile || dashboard.store.profiles.length <= 1 || automationIsDefault;
    elements.deleteProfileButton.title = automationIsDefault
      ? "Choose another default Automation profile before deleting this one."
      : "Delete this Automation profile while preserving values for tabs that currently use it.";
    elements.testUrlRoutingButton.disabled = busy || !currentIsSelected;
    elements.useRoutedProfileButton.disabled = busy || !currentIsSelected;
    const autoActivationPreview = renderAutoActivationStatus();
    elements.grantAutoActivationAccessButton.disabled = busy || !autoActivationPreview.config.activation.autoActivate || !autoActivationPreview.origins.length;
    elements.runAutoActivationScanButton.disabled = busy || !autoActivationPreview.config.activation.autoActivate;
    elements.autoProfileByUrl.checked = autoProfileByUrl;
    elements.saveTabButton.disabled = busy || !session;
    elements.resetTabButton.disabled = busy || !session || session.configMode !== CONFIG_MODE.TAB;
    const monitorProfile = monitorProfileById(selectedMonitorProfileId);
    const monitorIsDefault = Boolean(monitorProfile && monitorProfile.id === dashboard.store.defaultMonitorProfileId);
    elements.applyMonitorProfileButton.disabled = busy || !monitorProfile;
    elements.newMonitorProfileButton.disabled = busy;
    elements.saveMonitorProfileButton.disabled = busy || !monitorProfile;
    elements.setDefaultMonitorProfileButton.disabled = busy || !monitorProfile || monitorIsDefault;
    elements.setDefaultMonitorProfileButton.title = monitorIsDefault
      ? "This is already the default Monitor profile."
      : "Use this profile as the initial Monitor-library selection; the current rule is unchanged.";
    elements.deleteMonitorProfileButton.disabled = busy || !monitorProfile || (dashboard.store.monitorProfiles?.length || 0) <= 1 || monitorIsDefault;
    elements.deleteMonitorProfileButton.title = monitorIsDefault
      ? "Choose another default Monitor profile before deleting this one."
      : "Delete this library profile without changing the current rule draft.";
    const targetProfile = targetProfileById(selectedTargetProfileId);
    const targetIsDefault = Boolean(targetProfile && targetProfile.id === dashboard.store.defaultTargetProfileId);
    elements.applyTargetProfileButton.disabled = busy || !targetProfile;
    elements.newTargetProfileButton.disabled = busy;
    elements.saveTargetProfileButton.disabled = busy || !targetProfile;
    elements.setDefaultTargetProfileButton.disabled = busy || !targetProfile || targetIsDefault;
    elements.setDefaultTargetProfileButton.title = targetIsDefault
      ? "This is already the default Target profile."
      : "Use this profile as the initial Target-library selection; the current rule is unchanged.";
    elements.deleteTargetProfileButton.disabled = busy || !targetProfile || (dashboard.store.targetProfiles?.length || 0) <= 1 || targetIsDefault;
    elements.deleteTargetProfileButton.title = targetIsDefault
      ? "Choose another default Target profile before deleting this one."
      : "Delete this library profile without changing the current rule draft.";
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
    renderRuleStatistics();
    renderSettingsSnapshots();
    renderKeyboardShortcuts();
    renderWorkingSessionCatalog();

    const profile = profileById(selectedProfileId);
    if (loadForm) {
      elements.profileName.value = profile?.name || "";
      elements.customTabTitle.value = String(tabMetadata?.customTitle || "");
      const useStoppedConfig = Boolean(stoppedConfig) &&
        !manualProfileSelectionByTab.has(Number(selectedTabId)) &&
        !stoppedConfigBypassTabs.has(Number(selectedTabId));
      writeConfig(session?.effectiveConfig || (useStoppedConfig ? stoppedConfig?.effectiveConfig : null) || profile?.config || Settings.defaultConfig());
      const localProfile = localActionProfileById(selectedLocalActionProfileId);
      const stoppedLocalChoiceMatches = Boolean(stoppedConfig) &&
        String(stoppedConfig?.localActionProfileId || "") === String(selectedLocalActionProfileId || "");
      writeLocalActionConfig(session?.effectiveLocalActions || (stoppedLocalChoiceMatches ? stoppedConfig?.effectiveLocalActions : null) || localProfile?.config || LocalActions.defaultConfig());
    }
  }

  function dashboardStructureSignature(value) {
    const data = value || {};
    return JSON.stringify({
      currentTabId: Number.isInteger(data.currentTab?.tabId) ? data.currentTab.tabId : null,
      sessions: (Array.isArray(data.sessions) ? data.sessions : []).map((session) => [
        session.tabId, session.profileId, session.configMode, session.shellNotice?.status || "idle", session.shellNotice?.runId || null
      ]),
      profiles: (Array.isArray(data.store?.profiles) ? data.store.profiles : []).map((profile) => [
        profile.id, profile.name
      ]),
      defaultProfileId: data.store?.defaultProfileId || null,
      monitorProfiles: (Array.isArray(data.store?.monitorProfiles) ? data.store.monitorProfiles : []).map((profile) => [profile.id, profile.name, profile.updatedAt]),
      defaultMonitorProfileId: data.store?.defaultMonitorProfileId || null,
      targetProfiles: (Array.isArray(data.store?.targetProfiles) ? data.store.targetProfiles : []).map((profile) => [profile.id, profile.name, profile.updatedAt]),
      defaultTargetProfileId: data.store?.defaultTargetProfileId || null,
      localSessions: (Array.isArray(data.sessions) ? data.sessions : []).map((session) => [
        session.tabId, session.localActionProfileId, session.localActionConfigMode
      ]),
      localProfiles: (Array.isArray(data.localActionStore?.profiles) ? data.localActionStore.profiles : []).map((profile) => [profile.id, profile.name]),
      localDefaultProfileId: data.localActionStore?.defaultProfileId || null,
      snapshotIds: (Array.isArray(data.settingsSnapshots) ? data.settingsSnapshots : []).map((snapshot) => snapshot.id),
      workingSessionEntries: (Array.isArray(data.workingSessionCatalog?.entries) ? data.workingSessionCatalog.entries : []).map((entry) => [entry.id, entry.name, entry.updatedAt, entry.lastRestoredAt, entry.tabCount])
    });
    queueMicrotask(() => void consumePendingShortcutAction().catch((error) => showMessage(error instanceof Error ? error.message : String(error), "error")));
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
    if (Number(oldTabId) !== Number(selectedTabId)) syncOpenShellLogToSelectedTab();
  }

  function render(nextDashboard, loadForm = true, preferredTabId = null) {
    if (nextDashboard) {
      dashboard = nextDashboard;
    }
    renderSelectors(preferredTabId);
    renderDetails(loadForm);
    renderPromptTemplates();
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
          : selectedProfileId,
        restoreStoppedConfig: Boolean(
          dashboard.currentTab?.stoppedConfig &&
          !manualProfileSelectionByTab.has(Number(activationTabId)) &&
          !stoppedConfigBypassTabs.has(Number(activationTabId))
        ),
        discardStoppedConfig: Boolean(
          dashboard.currentTab?.stoppedConfig &&
          stoppedConfigBypassTabs.has(Number(activationTabId))
        )
      });
      if (!response) {
        throw new Error("The background script did not respond.");
      }
      if (!response.ok) {
        throw new Error(response.error || "Could not activate the current tab.");
      }
      setStoppedConfigBypass(activationTabId, false);
      setTabProfileSelection(manualProfileSelectionByTab, activationTabId, null);
      void persistSidebarUi();
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

  function stopSelectedTab() {
    const session = selectedSession();
    const drafts = session ? {
      config: readConfig(),
      localActions: readLocalActionConfig()
    } : null;
    void request(MESSAGE.STOP_TAB, { tabId: selectedTabId, drafts }, "Tab stopped; its configuration will be restored on Start.");
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

  function commandPresetStatus(text, state = "idle") {
    const output = document.querySelector("#tabCommandSaveStatus");
    if (!output) return;
    output.textContent = text;
    output.dataset.state = state;
  }

  function ensureCommandPresetUi() {
    const panel = elements.shellPresetSelect.closest(".shell-preset-panel") || elements.shellPresetSelect.parentElement;
    elements.shellPresetName?.closest("label")?.remove();
    elements.shellPresetEnabled?.closest("label")?.remove();
    elements.requireShellPresetMatch?.closest("label")?.remove();
    if (panel && !document.querySelector("#commandPresetScopeNote")) {
      const note = document.createElement("p");
      note.id = "commandPresetScopeNote";
      note.className = "command-preset-scope-note";
      note.innerHTML = "<strong>Command presets are global.</strong> Select a preset, edit the fields below, then save the changes directly back to that preset or apply it to this tab.";
      panel.prepend(note);
    }
    document.querySelector("#useDirectTabCommandButton")?.remove();
    if (!document.querySelector("#tabCommandSaveStatus")) {
      const output = document.createElement("output");
      output.id = "tabCommandSaveStatus";
      output.className = "tab-command-save-status";
      output.setAttribute("aria-live", "polite");
      elements.confirmBeforeRun.closest("label")?.after(output);
    }
    renderShellPresetOptions();
  }

  async function saveCommandPresetLibrary() {
    commandPresetStore = CommandPresets.normalizeStore(commandPresetStore);
    await browser.storage.local.set({ [CommandPresets.STORAGE_KEY]: commandPresetStore });
    const verified = await browser.storage.local.get(CommandPresets.STORAGE_KEY);
    const saved = CommandPresets.normalizeStore(verified[CommandPresets.STORAGE_KEY]);
    if (JSON.stringify(saved) !== JSON.stringify(commandPresetStore)) {
      throw new Error("Global command preset verification failed after Firefox storage write.");
    }
  }

  async function loadCommandPresetLibrary() {
    const stored = await browser.storage.local.get(CommandPresets.STORAGE_KEY);
    commandPresetStore = CommandPresets.normalizeStore(stored[CommandPresets.STORAGE_KEY]);
    shellPresetsDraft = CommandPresets.clone(commandPresetStore.presets);
  }

  async function migrateLegacyCommandPresets() {
    const merged = CommandPresets.mergeLegacy(commandPresetStore, dashboard.localActionStore);
    if (JSON.stringify(merged) !== JSON.stringify(commandPresetStore)) {
      commandPresetStore = merged;
      shellPresetsDraft = CommandPresets.clone(merged.presets);
      await saveCommandPresetLibrary();
    }
    renderShellPresetOptions();
    renderRuleCommandPresetOptions(ruleById(Settings.normalizeConfig(formConfigDraft), selectedRuleId));
  }

  async function persistCurrentTabCommand(reason = "direct command", rawShell = null) {
    const session = selectedSession();
    if (!session) {
      commandPresetStatus("Activate this tab before saving its command.", "error");
      return false;
    }
    const serial = ++tabCommandSaveSerial;
    const draft = readLocalActionConfig();
    if (rawShell) draft.shell = { ...draft.shell, ...rawShell };
    const executionConfig = buildTabExecutionConfig(session, draft);
    const validation = LocalActions.validateConfig(executionConfig);
    if (!validation.ok) {
      commandPresetStatus(validation.errors.join(" "), "error");
      return false;
    }
    commandPresetStatus("Saving command for this tab…", "saving");
    try {
      const response = await browser.runtime.sendMessage({
        type: MESSAGE.SAVE_TAB_LOCAL_ACTIONS,
        tabId: selectedTabId,
        config: validation.config
      });
      if (!response?.ok) throw new Error(response?.error || "Could not save the tab command.");
      assertSavedLocalActionConfig(validation.config, response.savedSession?.effectiveLocalActions, "Save tab command");
      if (serial !== tabCommandSaveSerial) return false;
      dashboard = response.dashboard || dashboard;
      volatileTabCommandDirty = false;
      captureLocalActionBaseline(response.savedSession?.effectiveLocalActions || validation.config);
      commandPresetStatus(`Applied to tab ${selectedTabId} · ${reason}.`, "saved");
      renderSelectors(selectedTabId);
      renderDetails(false);
      return true;
    } catch (error) {
      if (serial === tabCommandSaveSerial) commandPresetStatus(error instanceof Error ? error.message : String(error), "error");
      return false;
    }
  }

  function scheduleTabCommandPersistence() {
    if (suppressTabCommandAutosave) return;
    if (selectedShellPresetId && selectedShellPreset()) {
      refreshSelectedPresetDirtyState();
      return;
    }
    selectedShellPresetDirty = false;
    selectedShellPresetId = "";
    elements.shellPresetSelect.value = "";
    volatileTabCommandDirty = true;
    renderLocalActionDraftStatus();
    if (tabCommandSaveTimer) clearTimeout(tabCommandSaveTimer);
    tabCommandSaveTimer = setTimeout(() => {
      tabCommandSaveTimer = null;
      void syncVolatileLocalActionDraft();
    }, 140);
  }


  function shellPresetEditorMatches(preset = selectedShellPreset()) {
    if (!preset) return false;
    return String(elements.workingDirectory.value || "") === String(preset.workingDirectory || "") &&
      String(elements.shellCommand.value || "") === String(preset.command || "") &&
      String(elements.shellMode.value || "terminal") === String(preset.mode || "terminal") &&
      Boolean(elements.confirmBeforeRun.checked) === Boolean(preset.confirmBeforeRun);
  }

  function refreshSelectedPresetDirtyState() {
    const preset = selectedShellPreset();
    selectedShellPresetDirty = Boolean(preset && !shellPresetEditorMatches(preset));
    if (preset) {
      commandPresetEditorMode = "preset-edit";
      commandPresetStatus(selectedShellPresetDirty
        ? `Unsaved changes for preset “${preset.name}”. Click Save changes before selecting another preset.`
        : `Editing preset “${preset.name}”.`, selectedShellPresetDirty ? "saving" : "idle");
    }
    renderShellPresetOptions();
    return selectedShellPresetDirty;
  }

  function createShellPresetFromForm(name, id = null) {
    return LocalActions.normalizeCommandPreset({
      id: id || Settings.makeId("command-preset"),
      name,
      enabled: true,
      workingDirectory: elements.workingDirectory.value,
      command: elements.shellCommand.value,
      mode: elements.shellMode.value,
      confirmBeforeRun: elements.confirmBeforeRun.checked
    }, shellPresetsDraft.length);
  }

  async function loadSelectedShellPreset() {
    const preset = selectedShellPreset();
    if (!preset) {
      showMessage("Select a command preset first.", "error");
      return;
    }
    suppressTabCommandAutosave = true;
    loadShellValues(preset);
    suppressTabCommandAutosave = false;
    selectedShellPresetDirty = false;
    commandPresetEditorMode = "preset-edit";
    renderShellPresetOptions();
    const saved = await persistCurrentTabCommand(`preset “${preset.name}”`, {
      workingDirectory: preset.workingDirectory,
      command: preset.command,
      mode: preset.mode,
      confirmBeforeRun: preset.confirmBeforeRun,
      selectedPresetId: preset.id,
      presets: shellPresetsDraft
    });
    if (saved) showMessage(`Preset “${preset.name}” applied and verified for tab ${selectedTabId}.`, "success");
  }

  async function newShellPreset() {
    const rawName = prompt("Preset name:", "");
    if (rawName === null) return;
    const name = rawName.trim();
    if (!name) {
      showMessage("Preset name must not be empty.", "error");
      return;
    }
    if (shellPresetsDraft.some((preset) => preset.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0)) {
      showMessage(`A command preset named “${name}” already exists.`, "error");
      return;
    }
    const result = CommandPresets.upsert(commandPresetStore, {
      id: CommandPresets.makeId("command-preset"),
      name,
      enabled: true,
      workingDirectory: "",
      command: "",
      mode: "background",
      confirmBeforeRun: true
    });
    commandPresetStore = result.store;
    shellPresetsDraft = CommandPresets.clone(result.store.presets);
    selectedShellPresetId = result.preset.id;
    selectedShellPresetDirty = false;
    commandPresetEditorMode = "preset-edit";
    suppressTabCommandAutosave = true;
    loadShellValues(result.preset);
    suppressTabCommandAutosave = false;
    try {
      await saveCommandPresetLibrary();
      renderShellPresetOptions();
      renderRuleCommandPresetOptions(ruleById(Settings.normalizeConfig(formConfigDraft), selectedRuleId));
      elements.workingDirectory.focus();
      commandPresetStatus(`Preset “${name}” created. Enter its command settings, then click Save preset.`, "saved");
    } catch (error) {
      showMessage(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function updateShellPreset({ quiet = false } = {}) {
    const current = selectedShellPreset();
    if (!current) {
      if (!quiet) showMessage("Create or select a command preset first.", "error");
      return false;
    }
    const candidate = createShellPresetFromForm(current.name, current.id);
    if (!candidate.workingDirectory.startsWith("/")) {
      if (!quiet) showMessage("Preset working directory must be an absolute path.", "error");
      return false;
    }
    if (!candidate.command.trim()) {
      if (!quiet) showMessage("Preset command must not be empty.", "error");
      return false;
    }
    try {
      const result = CommandPresets.upsert(commandPresetStore, candidate);
      commandPresetStore = result.store;
      shellPresetsDraft = CommandPresets.clone(result.store.presets);
      selectedShellPresetId = result.preset.id;
      selectedShellPresetDirty = false;
      commandPresetEditorMode = "preset-edit";
      await saveCommandPresetLibrary();
      renderShellPresetOptions();
      renderRuleCommandPresetOptions(ruleById(Settings.normalizeConfig(formConfigDraft), selectedRuleId));
      commandPresetStatus(`Preset “${result.preset.name}” saved.`, "saved");
      if (!quiet) showMessage(`Global command preset “${result.preset.name}” saved and verified.`, "success");
      return true;
    } catch (error) {
      if (!quiet) showMessage(error instanceof Error ? error.message : String(error), "error");
      return false;
    }
  }

  async function deleteShellPreset() {
    const preset = selectedShellPreset();
    if (!preset || !confirm(`Delete global command preset “${preset.name}”?`)) return;
    try {
      commandPresetStore = CommandPresets.remove(commandPresetStore, preset.id);
      shellPresetsDraft = CommandPresets.clone(commandPresetStore.presets);
      selectedShellPresetId = "";
      selectedShellPresetDirty = false;
      commandPresetEditorMode = "tab";
      await saveCommandPresetLibrary();
      renderShellPresetOptions();
      renderRuleCommandPresetOptions(ruleById(Settings.normalizeConfig(formConfigDraft), selectedRuleId));
      commandPresetStatus(`Global preset “${preset.name}” deleted. Existing tab command copies are unchanged.`, "saved");
    } catch (error) {
      showMessage(error instanceof Error ? error.message : String(error), "error");
    }
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

  function buildTabExecutionConfig(session, draftConfig) {
    const profile = localActionProfileById(session?.localActionProfileId || selectedLocalActionProfileId);
    const base = LocalActions.normalizeConfig(
      session?.effectiveLocalActions || profile?.config || LocalActions.defaultConfig()
    );
    const draft = LocalActions.normalizeConfig(draftConfig);
    return LocalActions.normalizeConfig({
      routing: base.routing,
      download: draft.download,
      shell: draft.shell
    });
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
    const validation = LocalActions.validateConfig(readLocalActionProfileConfig());
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
      setTabProfileSelection(localActionProfileEditorSelectionByTab, selectedTabId, selectedLocalActionProfileId);
      void persistSidebarUi();
      renderSelectors(selectedTabId);
      elements.localActionProfileName.value = response.savedProfile.name;
      captureLocalActionBaseline(validation.config);
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

  async function createLocalActionProfileFromCurrentForm() {
    const name = prompt("New local-action profile name:", "New local actions");
    if (!name) return;
    const validation = LocalActions.validateConfig(readLocalActionProfileConfig());
    if (!validation.ok) {
      showMessage(validation.errors.join("\n"), "error");
      return;
    }
    setBusy(true);
    try {
      const response = await browser.runtime.sendMessage({
        type: MESSAGE.CREATE_LOCAL_ACTION_PROFILE,
        name,
        baseProfileId: selectedLocalActionProfileId,
        config: validation.config
      });
      if (!response?.ok) throw new Error(response?.error || "Could not create the local-action profile.");
      assertSavedLocalActionConfig(validation.config, response.savedProfile?.config, "Create local-action profile");
      dashboard = response.dashboard || dashboard;
      selectedLocalActionProfileId = response.localActionProfileId;
      setTabProfileSelection(localActionProfileEditorSelectionByTab, selectedTabId, selectedLocalActionProfileId);
      void persistSidebarUi();
      renderSelectors(selectedTabId);
      elements.localActionProfileName.value = response.savedProfile?.name || name;
      captureLocalActionBaseline(validation.config);
      renderDetails(false);
      showMessage(`Local-action profile “${response.savedProfile?.name || name}” created from the current values.`, "success");
    } catch (error) {
      showMessage(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(false);
    }
  }

  async function runShellAfterDownload() {
    const state = selectedDownloadState();
    const availability = LocalActions.downloadShellReadiness(state);
    if (!availability.ready) {
      showMessage(availability.reason, "error");
      return;
    }
    const shell = availability.snapshot.shell;
    const confirmBeforeRun = shell.confirmBeforeRun !== false;
    if (confirmBeforeRun && !confirm(`Execute the frozen shell command for this completed download?

Working directory:
${shell.workingDirectory}

Command:
${shell.command}

Downloaded file:
${state.destinationPath}`)) return;
    if (elements.downloadCompletionDialog.open) elements.downloadCompletionDialog.close();
    const response = await request(MESSAGE.RUN_COMPLETED_DOWNLOAD_SHELL, {
      tabId: selectedTabId,
      captureId: state.captureId,
      confirmed: true
    });
    if (response?.ok) showMessage("Download shell command started. The complete console will open when it finishes.", "success");
  }

  async function runShellCommand() {
    const session = selectedSession();
    if (!session) {
      showMessage("Activate the tab before running a command.", "error");
      return;
    }
    const draftConfig = readLocalActionConfig();
    const shell = draftConfig.shell;
    if (!shell.workingDirectory.trim() || !shell.command.trim()) {
      showMessage("Working directory and command must not be empty.", "error");
      return;
    }
    const executionConfig = buildTabExecutionConfig(session, draftConfig);
    const validation = LocalActions.validateConfig(executionConfig);
    if (!validation.ok) {
      showMessage(validation.errors.join("\n"), "error");
      return;
    }
    if (shell.confirmBeforeRun && !confirm(commandConfirmation(shell))) {
      return;
    }

    setBusy(true);
    showMessage();
    try {
      volatileTabCommandDirty = true;
      renderLocalActionDraftStatus();
      await syncVolatileLocalActionDraft({ reportErrors: true });

      const runResponse = await browser.runtime.sendMessage({
        type: MESSAGE.RUN_SHELL,
        tabId: selectedTabId,
        cwd: shell.workingDirectory,
        command: shell.command,
        mode: shell.mode
      });
      if (!runResponse?.ok) {
        throw new Error(runResponse?.error || "The shell command could not be started.");
      }
      if (runResponse.dashboard) renderRuntimeDashboard(runResponse.dashboard);
      showMessage(
        shell.mode === "terminal"
          ? "Terminal launch requested from the current editor values."
          : "Background command started from the current editor values.",
        "success"
      );
    } catch (error) {
      showMessage(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(false);
    }
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
    document.querySelector("main")?.setAttribute("aria-busy", busy ? "true" : "false");
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
      if (response.componentProfileId && response.profileType === "monitor") {
        selectedMonitorProfileId = response.componentProfileId;
        void persistSidebarUi();
      }
      if (response.componentProfileId && response.profileType === "target") {
        selectedTargetProfileId = response.componentProfileId;
        void persistSidebarUi();
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
    renderRuleStatistics();
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

  elements.monitorProfileSelect.addEventListener("change", () => {
    selectedMonitorProfileId = elements.monitorProfileSelect.value;
    elements.monitorProfileName.value = monitorProfileById(selectedMonitorProfileId)?.name || "";
    void persistSidebarUi();
  });
  elements.applyMonitorProfileButton.addEventListener("click", () => applyComponentProfileToRule("monitor"));
  elements.newMonitorProfileButton.addEventListener("click", () => void createComponentProfileFromRule("monitor"));
  elements.saveMonitorProfileButton.addEventListener("click", () => void saveSelectedComponentProfile("monitor"));
  elements.setDefaultMonitorProfileButton.addEventListener("click", () => void setSelectedComponentProfileAsDefault("monitor"));
  elements.deleteMonitorProfileButton.addEventListener("click", () => void deleteSelectedComponentProfile("monitor"));

  elements.targetProfileSelect.addEventListener("change", () => {
    selectedTargetProfileId = elements.targetProfileSelect.value;
    elements.targetProfileName.value = targetProfileById(selectedTargetProfileId)?.name || "";
    void persistSidebarUi();
  });
  elements.applyTargetProfileButton.addEventListener("click", () => applyComponentProfileToRule("target"));
  elements.newTargetProfileButton.addEventListener("click", () => void createComponentProfileFromRule("target"));
  elements.saveTargetProfileButton.addEventListener("click", () => void saveSelectedComponentProfile("target"));
  elements.setDefaultTargetProfileButton.addEventListener("click", () => void setSelectedComponentProfileAsDefault("target"));
  elements.deleteTargetProfileButton.addEventListener("click", () => void deleteSelectedComponentProfile("target"));

  elements.saveCustomTabTitleButton.addEventListener("click", () => void saveCustomTabTitle(elements.customTabTitle.value));
  elements.clearCustomTabTitleButton.addEventListener("click", () => void saveCustomTabTitle(""));
  elements.customTabTitle.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void saveCustomTabTitle(elements.customTabTitle.value);
    }
  });

  elements.tabSelect.addEventListener("change", () => {
    const previousTabId = selectedTabId;
    const nextTabId = Number(elements.tabSelect.value);
    if (nextTabId !== Number(previousTabId) && !confirmDiscardLocalActionDraft("switching tabs")) {
      elements.tabSelect.value = String(previousTabId);
      return;
    }
    if (nextTabId !== Number(previousTabId) && hasVolatileLocalActionEdits()) {
      discardVolatileLocalActionDraft(previousTabId);
    } else {
      cancelScheduledVolatileLocalActionSync();
    }
    selectedTabId = nextTabId;
    syncOpenShellLogToSelectedTab();
    renderSelectors(selectedTabId);
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
    if (Number.isInteger(Number(selectedTabId))) {
      setTabProfileSelection(profileEditorSelectionByTab, selectedTabId, selectedProfileId);
    }
    if (Number.isInteger(Number(selectedTabId)) && !selectedSession()) {
      setTabProfileSelection(manualProfileSelectionByTab, selectedTabId, selectedProfileId);
      if (dashboard.currentTab?.stoppedConfig) setStoppedConfigBypass(selectedTabId, true);
    }
    void persistSidebarUi();
    const profile = profileById(selectedProfileId);
    elements.profileName.value = profile?.name || "";
    writeConfig(profile?.config || Settings.defaultConfig());
  });
  elements.autoProfileByUrl.addEventListener("change", () => {
    autoProfileByUrl = elements.autoProfileByUrl.checked;
    if (autoProfileByUrl) {
      setTabProfileSelection(manualProfileSelectionByTab, selectedTabId, null);
      if (!selectedSession() && dashboard.currentTab?.stoppedConfig) setStoppedConfigBypass(selectedTabId, true);
      const routing = renderUrlRoutingPreview();
      if (!selectedSession() && routing.profileId) {
        selectedProfileId = routing.profileId;
        setTabProfileSelection(profileEditorSelectionByTab, selectedTabId, selectedProfileId);
        elements.profileSelect.value = selectedProfileId;
        const profile = profileById(selectedProfileId);
        elements.profileName.value = profile?.name || "";
        writeConfig(profile?.config || Settings.defaultConfig());
      }
    } else {
      setStoppedConfigBypass(selectedTabId, false);
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
    setTabProfileSelection(manualProfileSelectionByTab, selectedTabId, null);
    if (!selectedSession() && dashboard.currentTab?.stoppedConfig) setStoppedConfigBypass(selectedTabId, true);
    selectedProfileId = routing.profileId;
    setTabProfileSelection(profileEditorSelectionByTab, selectedTabId, selectedProfileId);
    elements.profileSelect.value = selectedProfileId;
    const profile = profileById(selectedProfileId);
    elements.profileName.value = profile?.name || "";
    writeConfig(profile?.config || Settings.defaultConfig());
    void persistSidebarUi();
    showMessage(`Selected profile “${routing.profileName}” by URL.`, "success");
  });
  elements.autoActivateMatchingUrls.addEventListener("change", () => {
    if (elements.autoActivateMatchingUrls.checked) {
      elements.routingEnabled.checked = true;
      elements.requireUrlMatch.checked = true;
    }
    renderAutoActivationStatus(true);
  });
  elements.grantAutoActivationAccessButton.addEventListener("click", () => {
    const preview = renderAutoActivationStatus(true);
    const validation = Settings.validateConfig(preview.config);
    const profile = profileById(selectedProfileId);
    if (!profile || !validation.ok || !preview.config.activation.autoActivate || !preview.origins.length) {
      showMessage(validation.ok
        ? "Enable automatic activation and add an explicit HTTP/HTTPS allowlist first."
        : validation.errors.join("\n"), "error");
      return;
    }
    // permissions.request must be called directly from this user click. Persist the
    // profile immediately after Firefox grants access, then scan the selected tab.
    const permissionRequest = browser.permissions.request({ origins: preview.origins });
    setBusy(true);
    showMessage(`Requesting automatic-activation access for ${preview.origins.join(", ")}`);
    void permissionRequest.then(async (granted) => {
      if (!granted) throw new Error("Firefox did not grant the requested automatic-activation site access.");
      const saved = await browser.runtime.sendMessage({
        type: MESSAGE.SAVE_PROFILE,
        profile: { ...profile, name: elements.profileName.value.trim() || profile.name, config: validation.config }
      });
      if (!saved?.ok) throw new Error(saved?.error || "Could not save the auto-activation profile.");
      dashboard = saved.dashboard || dashboard;
      const response = await browser.runtime.sendMessage({ type: MESSAGE.RUN_AUTO_ACTIVATION_SCAN, tabId: selectedTabId, reason: "permission-granted" });
      if (!response?.ok) throw new Error(response?.error || "Could not scan the selected tab for automatic activation.");
      if (response.dashboard) render(response.dashboard, true, selectedTabId);
      showMessage(`Permission granted and profile saved. ${response.report?.activated || 0} matching tab(s) activated.`, "success");
    }).catch((error) => showMessage(error instanceof Error ? error.message : String(error), "error"))
      .finally(() => setBusy(false));
  });
  elements.runAutoActivationScanButton.addEventListener("click", () => {
    const preview = renderAutoActivationStatus(true);
    const validation = Settings.validateConfig(preview.config);
    const profile = profileById(selectedProfileId);
    if (!profile || !validation.ok) {
      showMessage(validation.ok ? "Select a profile first." : validation.errors.join("\n"), "error");
      return;
    }
    setBusy(true);
    void browser.runtime.sendMessage({
      type: MESSAGE.SAVE_PROFILE,
      profile: { ...profile, name: elements.profileName.value.trim() || profile.name, config: validation.config }
    }).then((saved) => {
      if (!saved?.ok) throw new Error(saved?.error || "Could not save the auto-activation profile.");
      dashboard = saved.dashboard || dashboard;
      return browser.runtime.sendMessage({ type: MESSAGE.RUN_AUTO_ACTIVATION_SCAN, reason: "sidebar-manual-scan" });
    }).then((response) => {
      if (!response?.ok) throw new Error(response?.error || "Could not scan open tabs.");
      if (response.dashboard) render(response.dashboard, true, selectedTabId);
      const report = response.report || {};
      showMessage(`Automatic activation scan: ${report.activated || 0} activated, ${report.permissionRequired || 0} need permission, ${report.skipped || 0} skipped.`, report.activated ? "success" : "info");
    }).catch((error) => showMessage(error instanceof Error ? error.message : String(error), "error"))
      .finally(() => setBusy(false));
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

  function currentRuleDraft() {
    const config = readConfig();
    return { config, rule: ruleById(config, selectedRuleId) || config.rules[0] };
  }

  function applyComponentProfileToRule(type) {
    const { config, rule } = currentRuleDraft();
    const profile = type === "monitor"
      ? monitorProfileById(selectedMonitorProfileId)
      : targetProfileById(selectedTargetProfileId);
    if (!profile || !rule) {
      showMessage(`Select a ${type} profile first.`, "error");
      return;
    }
    const nextRule = {
      ...rule,
      monitor: type === "monitor" ? Settings.clone(profile.monitor) : Settings.clone(rule.monitor),
      target: type === "target" ? Settings.clone(profile.target) : Settings.clone(rule.target)
    };
    const rules = config.rules.map((item) => item.id === rule.id ? nextRule : item);
    formConfigDraft = Settings.normalizeConfig({
      ...config,
      activeRuleId: nextRule.id,
      rules,
      monitor: nextRule.monitor,
      target: nextRule.target
    });
    writeRuleFields(nextRule);
    renderRuleRuntimeSummary();
    showMessage(`${type === "monitor" ? "Monitor" : "Target"} profile “${profile.name}” applied to rule “${nextRule.name}”. Save the Automation profile or save for this tab to persist it.`, "success");
  }

  function captureComponentProfileEditorDraft() {
    const config = Settings.normalizeConfig(readConfig());
    const rule = ruleById(config, selectedRuleId) || ruleById(config, config.activeRuleId) || config.rules[0] || null;
    return {
      config,
      selectedRuleId: rule?.id || null
    };
  }

  function restoreComponentProfileEditorDraft(snapshot) {
    if (!snapshot?.config) return;
    const config = Settings.normalizeConfig(snapshot.config);
    const rule = ruleById(config, snapshot.selectedRuleId) || ruleById(config, config.activeRuleId) || config.rules[0] || null;
    if (!rule) return;
    selectedRuleId = rule.id;
    formConfigDraft = Settings.normalizeConfig({
      ...config,
      activeRuleId: rule.id,
      monitor: rule.monitor,
      target: rule.target
    });
    renderRuleOptions();
    writeRuleFields(rule);
    renderRuleRuntimeSummary();
  }

  async function createComponentProfileFromRule(type) {
    const editorDraft = captureComponentProfileEditorDraft();
    const rule = ruleById(editorDraft.config, editorDraft.selectedRuleId) || editorDraft.config.rules[0];
    if (!rule) return;
    const defaultName = type === "monitor" ? "New monitor profile" : "New target profile";
    const name = prompt(`${type === "monitor" ? "Monitor" : "Target"} profile name:`, defaultName);
    if (!name) return;
    const response = await request(MESSAGE.CREATE_COMPONENT_PROFILE, {
      profileType: type,
      name,
      config: type === "monitor" ? rule.monitor : rule.target
    }, "", { reloadForm: false });
    restoreComponentProfileEditorDraft(editorDraft);
    if (!response?.savedProfile) return;
    renderComponentProfileOptions();
    await persistSidebarUi();
    showMessage(`${type === "monitor" ? "Monitor" : "Target"} profile “${response.savedProfile.name}” created and selected; the current rule draft was preserved.`, "success");
  }

  async function saveSelectedComponentProfile(type) {
    const editorDraft = captureComponentProfileEditorDraft();
    const rule = ruleById(editorDraft.config, editorDraft.selectedRuleId) || editorDraft.config.rules[0];
    const profile = type === "monitor"
      ? monitorProfileById(selectedMonitorProfileId)
      : targetProfileById(selectedTargetProfileId);
    if (!profile || !rule) {
      showMessage(`Select a ${type} profile before saving.`, "error");
      return;
    }
    const nameElement = type === "monitor" ? elements.monitorProfileName : elements.targetProfileName;
    const response = await request(MESSAGE.SAVE_COMPONENT_PROFILE, {
      profileType: type,
      profile: {
        ...profile,
        name: nameElement.value.trim() || profile.name,
        ...(type === "monitor" ? { monitor: rule.monitor } : { target: rule.target })
      }
    }, "", { reloadForm: false });
    restoreComponentProfileEditorDraft(editorDraft);
    if (!response?.savedProfile) return;
    if (type === "monitor") selectedMonitorProfileId = response.savedProfile.id;
    else selectedTargetProfileId = response.savedProfile.id;
    renderComponentProfileOptions();
    await persistSidebarUi();
    showMessage(`${type === "monitor" ? "Monitor" : "Target"} profile “${response.savedProfile.name}” saved; the current rule draft was preserved.`, "success");
  }

  async function setSelectedComponentProfileAsDefault(type) {
    const editorDraft = captureComponentProfileEditorDraft();
    const profile = type === "monitor"
      ? monitorProfileById(selectedMonitorProfileId)
      : targetProfileById(selectedTargetProfileId);
    const defaultProfileId = type === "monitor"
      ? dashboard.store.defaultMonitorProfileId
      : dashboard.store.defaultTargetProfileId;
    const label = type === "monitor" ? "Monitor" : "Target";
    if (!profile) {
      showMessage(`Select a ${type} profile first.`, "error");
      return;
    }
    if (profile.id === defaultProfileId) {
      showMessage(`${label} profile “${profile.name}” is already the default.`, "info");
      return;
    }
    const response = await request(MESSAGE.SET_DEFAULT_COMPONENT_PROFILE, {
      profileType: type,
      profileId: profile.id
    }, "", { reloadForm: false });
    restoreComponentProfileEditorDraft(editorDraft);
    if (!response?.ok) return;
    if (type === "monitor") selectedMonitorProfileId = profile.id;
    else selectedTargetProfileId = profile.id;
    renderComponentProfileOptions();
    await persistSidebarUi();
    showMessage(`${label} profile “${profile.name}” is now the default library selection. The current rule was not changed.`, "success");
  }

  async function deleteSelectedComponentProfile(type) {
    const editorDraft = captureComponentProfileEditorDraft();
    const profile = type === "monitor"
      ? monitorProfileById(selectedMonitorProfileId)
      : targetProfileById(selectedTargetProfileId);
    if (!profile || !confirm(`Delete ${type} profile “${profile.name}”? The current rule draft will not change.`)) return;
    const response = await request(MESSAGE.DELETE_COMPONENT_PROFILE, {
      profileType: type,
      profileId: profile.id
    }, "", { reloadForm: false });
    restoreComponentProfileEditorDraft(editorDraft);
    if (!response?.ok) return;
    renderComponentProfileOptions();
    await persistSidebarUi();
    showMessage(`${type === "monitor" ? "Monitor" : "Target"} profile “${profile.name}” deleted; the current rule draft was preserved.`, "success");
  }

  async function saveCustomTabTitle(title) {
    const value = String(title || "").trim();
    const metadata = selectedTabMetadata();
    if (!metadata) {
      showMessage("Select a normal tab before changing its title.", "error");
      return;
    }
    if (value) {
      const origin = hostPermissionPattern(metadata.url || dashboard.currentTab?.url || "");
      if (origin) {
        const alreadyGranted = await browser.permissions.contains({ origins: [origin] });
        if (!alreadyGranted) {
          const granted = await browser.permissions.request({ origins: [origin] });
          if (!granted) {
            showMessage("Site access is required to keep a custom title after reload.", "error");
            return;
          }
        }
      }
    }
    const response = await request(MESSAGE.SET_TAB_CUSTOM_TITLE, {
      tabId: selectedTabId,
      title: value
    }, value ? "Custom tab title saved." : "Page title restored.");
    if (response?.ok) elements.customTabTitle.value = value;
  }

  async function exportProfileType(type) {
    const response = await request(MESSAGE.EXPORT_PROFILE_BUNDLE, { profileType: type });
    if (!response?.text) return;
    const label = type === "local-action" ? "local-action" : type;
    downloadBlob(
      new Blob([response.text], { type: "application/json" }),
      `firefox-chat-improver-${label}-profiles-${new Date().toISOString().slice(0, 10)}.json`
    );
    showMessage(`${response.count || 0} ${type} profile(s) exported.`, "success");
  }

  function chooseProfileImport(type) {
    pendingProfileImportType = type;
    elements.profileImportFile.value = "";
    elements.profileImportFile.click();
  }

  async function createProfileFromCurrentForm() {
    const name = prompt("New profile name:", "New profile");
    if (!name) return;
    const validation = Settings.validateConfig(readConfig());
    if (!validation.ok) {
      showMessage(validation.errors.join("\n"), "error");
      return;
    }
    setBusy(true);
    try {
      const response = await browser.runtime.sendMessage({
        type: MESSAGE.CREATE_PROFILE,
        name,
        baseProfileId: selectedProfileId,
        config: validation.config
      });
      if (!response?.ok) throw new Error(response?.error || "Could not create the profile.");
      assertSavedConfig(validation.config, response.savedProfile?.config, "Create profile");
      dashboard = response.dashboard || dashboard;
      selectedProfileId = response.profileId;
      setTabProfileSelection(profileEditorSelectionByTab, selectedTabId, selectedProfileId);
      void persistSidebarUi();
      formConfigDraft = Settings.normalizeConfig(validation.config);
      renderSelectors(selectedTabId);
      elements.profileName.value = response.savedProfile?.name || name;
      renderDetails(false);
      showMessage(`Profile “${response.savedProfile?.name || name}” created from the current values.`, "success");
    } catch (error) {
      showMessage(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(false);
    }
  }


  async function setSelectedAutomationProfileAsDefault() {
    const profile = profileById(selectedProfileId);
    if (!profile) {
      showMessage("Select an Automation profile first.", "error");
      return;
    }
    if (profile.id === dashboard.store.defaultProfileId) {
      showMessage(`Automation profile “${profile.name}” is already the default.`, "info");
      return;
    }
    setBusy(true);
    try {
      const response = await browser.runtime.sendMessage({ type: MESSAGE.SET_DEFAULT_PROFILE, profileId: profile.id });
      if (!response?.ok) throw new Error(response?.error || "Could not set the default Automation profile.");
      dashboard = response.dashboard || dashboard;
      selectedProfileId = profile.id;
      setTabProfileSelection(profileEditorSelectionByTab, selectedTabId, selectedProfileId);
      void persistSidebarUi();
      renderSelectors(selectedTabId);
      renderDetails(false);
      showMessage(`Automation profile “${profile.name}” is now the default for future fallback. Open tabs were not changed.`, "success");
    } catch (error) {
      showMessage(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(false);
    }
  }

  async function setSelectedLocalActionProfileAsDefault() {
    const profile = localActionProfileById(selectedLocalActionProfileId);
    if (!profile) {
      showMessage("Select a Local action profile first.", "error");
      return;
    }
    if (profile.id === dashboard.localActionStore.defaultProfileId) {
      showMessage(`Local action profile “${profile.name}” is already the default.`, "info");
      return;
    }
    setBusy(true);
    try {
      const response = await browser.runtime.sendMessage({ type: MESSAGE.SET_DEFAULT_LOCAL_ACTION_PROFILE, profileId: profile.id });
      if (!response?.ok) throw new Error(response?.error || "Could not set the default Local action profile.");
      dashboard = response.dashboard || dashboard;
      selectedLocalActionProfileId = profile.id;
      setTabProfileSelection(localActionProfileEditorSelectionByTab, selectedTabId, selectedLocalActionProfileId);
      void persistSidebarUi();
      renderSelectors(selectedTabId);
      renderDetails(false);
      showMessage(`Local action profile “${profile.name}” is now the default for future fallback. Open tabs were not changed.`, "success");
    } catch (error) {
      showMessage(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelectedAutomationProfile() {
    const profile = profileById(selectedProfileId);
    if (!profile) {
      showMessage("Select an Automation profile before deleting it.", "error");
      return;
    }
    const activeCount = dashboard.sessions.filter((session) => session.profileId === profile.id).length;
    const stoppedCount = Number(dashboard.currentTab?.tabId) === Number(selectedTabId) &&
      !selectedSession() && dashboard.currentTab?.stoppedConfig?.profileId === profile.id ? 1 : 0;
    const affected = activeCount + stoppedCount;
    const impact = affected
      ? `\n\n${affected} open tab${affected === 1 ? "" : "s"} currently use this profile. Their current values will be preserved as tab-specific overrides.`
      : "";
    if (!confirm(`Delete Automation profile “${profile.name}”?${impact}`)) return;
    setBusy(true);
    try {
      const response = await browser.runtime.sendMessage({ type: MESSAGE.DELETE_PROFILE, profileId: profile.id });
      if (!response?.ok) throw new Error(response?.error || "Could not delete the Automation profile.");
      dashboard = response.dashboard || dashboard;
      const session = dashboard.sessions.find((item) => Number(item.tabId) === Number(selectedTabId));
      selectedProfileId = session?.profileId || dashboard.currentTab?.stoppedConfig?.profileId || dashboard.store.defaultProfileId;
      setTabProfileSelection(profileEditorSelectionByTab, selectedTabId, selectedProfileId);
      void persistSidebarUi();
      renderSelectors(selectedTabId);
      renderDetails(true);
      const preserved = Number(response.preservedTabs) || 0;
      showMessage(`Automation profile “${profile.name}” deleted.${preserved ? ` Current values were preserved for ${preserved} tab${preserved === 1 ? "" : "s"}.` : ""}`, "success");
    } catch (error) {
      showMessage(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelectedLocalActionProfile() {
    const profile = localActionProfileById(selectedLocalActionProfileId);
    if (!profile) {
      showMessage("Select a Local action profile before deleting it.", "error");
      return;
    }
    const activeCount = dashboard.sessions.filter((session) => session.localActionProfileId === profile.id).length;
    const stoppedCount = Number(dashboard.currentTab?.tabId) === Number(selectedTabId) &&
      !selectedSession() && dashboard.currentTab?.stoppedConfig?.localActionProfileId === profile.id ? 1 : 0;
    const affected = activeCount + stoppedCount;
    const impact = affected
      ? `\n\n${affected} open tab${affected === 1 ? "" : "s"} currently use this profile. Their download and shell values will be preserved as tab-specific overrides.`
      : "";
    if (!confirm(`Delete Local action profile “${profile.name}”?${impact}`)) return;
    setBusy(true);
    try {
      const response = await browser.runtime.sendMessage({ type: MESSAGE.DELETE_LOCAL_ACTION_PROFILE, profileId: profile.id });
      if (!response?.ok) throw new Error(response?.error || "Could not delete the Local action profile.");
      dashboard = response.dashboard || dashboard;
      const session = dashboard.sessions.find((item) => Number(item.tabId) === Number(selectedTabId));
      selectedLocalActionProfileId = session?.localActionProfileId || dashboard.currentTab?.stoppedConfig?.localActionProfileId || dashboard.localActionStore.defaultProfileId;
      setTabProfileSelection(localActionProfileEditorSelectionByTab, selectedTabId, selectedLocalActionProfileId);
      void persistSidebarUi();
      renderSelectors(selectedTabId);
      renderDetails(true);
      const preserved = Number(response.preservedTabs) || 0;
      showMessage(`Local action profile “${profile.name}” deleted.${preserved ? ` Current values were preserved for ${preserved} tab${preserved === 1 ? "" : "s"}.` : ""}`, "success");
    } catch (error) {
      showMessage(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(false);
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
      setTabProfileSelection(profileEditorSelectionByTab, selectedTabId, selectedProfileId);
      void persistSidebarUi();
      formConfigDraft = Settings.normalizeConfig(validation.config);
      renderSelectors(selectedTabId);
      elements.profileName.value = response.savedProfile.name;
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
    const isRestore = mode === "import" || mode === "catalog-restore";
    const isCatalogSave = mode === "catalog-create" || mode === "catalog-update";
    elements.workingSessionDialogTitle.textContent = mode === "import"
      ? "Import working session"
      : (mode === "catalog-restore"
        ? "Restore saved working session"
        : (isCatalogSave ? "Save tabs to catalog" : "Save working session file"));
    elements.workingSessionDialogDescription.textContent = isRestore
      ? "Choose which saved tabs to open. Firefox site access is requested before restore."
      : (isCatalogSave
        ? "Active add-on tabs are selected by default. Choose the tabs to store in this named saved session."
        : "Active add-on tabs are selected by default. Select any additional tabs to include in the JSON file.");
    elements.confirmWorkingSessionButton.textContent = isRestore
      ? "Open and restore tabs"
      : (isCatalogSave ? "Save selected tabs" : "Export selected tabs");
    elements.workingSessionResult.textContent = "";
    elements.workingSessionTabList.replaceChildren(...tabs.map((tab, index) => {
      const label = document.createElement("label");
      label.className = "working-session-tab-row";
      label.dataset.addonActive = tab.addOnActive ? "true" : "false";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.tabId = String(tab.tabId ?? tab.sourceTabId ?? tab.index ?? index);
      checkbox.checked = isRestore ? true : Boolean(tab.addOnActive);
      const content = document.createElement("span");
      const title = document.createElement("span");
      title.className = "working-session-tab-title";
      title.textContent = tab.title || tab.customTitle || tab.pageTitle || "Untitled tab";
      const url = document.createElement("span");
      url.className = "working-session-tab-url";
      url.textContent = tab.url;
      const meta = document.createElement("span");
      meta.className = "working-session-tab-meta";
      meta.textContent = tab.addOnActive
        ? `Add-on ${tab.mode || "active"}; profile ${tab.profileName || tab.profile?.name || "saved"}`
        : "Add-on inactive";
      content.append(title, url, meta);
      label.append(checkbox, content);
      return label;
    }));
    if (!elements.workingSessionDialog.open) {
      elements.workingSessionDialog.showModal();
    }
    const firstTabChoice = elements.workingSessionTabList.querySelector('input[type="checkbox"]');
    (firstTabChoice || elements.confirmWorkingSessionButton).focus();
  }

  async function openSaveWorkingSessionDialog(mode = "export", entryId = null) {
    setBusy(true);
    try {
      const response = await browser.runtime.sendMessage({ type: MESSAGE.LIST_WORKING_SESSION_TABS });
      if (!response?.ok) throw new Error(response?.error || "Could not list open tabs.");
      pendingWorkingSessionBundle = null;
      pendingWorkingSessionEntryId = entryId;
      renderWorkingSessionDialog(response.tabs || [], mode);
    } catch (error) {
      showMessage(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(false);
    }
  }

  function openCatalogRestoreDialog() {
    const entry = selectedWorkingSessionEntry();
    if (!entry) {
      setWorkingSessionCatalogResult("Choose a saved working session first.", "error");
      return;
    }
    pendingWorkingSessionEntryId = entry.id;
    pendingWorkingSessionBundle = { tabs: entry.tabs || [] };
    renderWorkingSessionDialog(entry.tabs || [], "catalog-restore");
  }

  function safeSessionFilename(value, fallback = "working-session") {
    const normalized = String(value || "").trim().replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "");
    return normalized || fallback;
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
        showMessage(`Working session file saved with ${response.tabCount} tab(s).`, "success");
      } catch (error) {
        elements.workingSessionResult.textContent = error instanceof Error ? error.message : String(error);
      } finally {
        setBusy(false);
      }
      return;
    }

    if (workingSessionMode === "catalog-create" || workingSessionMode === "catalog-update") {
      const name = elements.workingSessionCatalogName.value.trim();
      if (!name) {
        elements.workingSessionResult.textContent = "Enter a saved-session name before continuing.";
        return;
      }
      setBusy(true);
      try {
        const response = await browser.runtime.sendMessage({
          type: MESSAGE.SAVE_WORKING_SESSION_ENTRY,
          entryId: workingSessionMode === "catalog-update" ? pendingWorkingSessionEntryId : null,
          name,
          description: elements.workingSessionCatalogDescription.value.trim(),
          tabIds: selected
        });
        if (!response?.ok) throw new Error(response?.error || "Could not save the named working session.");
        selectedWorkingSessionEntryId = response.entryId || response.dashboard?.workingSessionCatalog?.entries?.[0]?.id || selectedWorkingSessionEntryId;
        workingSessionEditorEntryId = null;
        void persistSidebarUi();
        if (response.dashboard) render(response.dashboard, false);
        elements.workingSessionDialog.close();
        setWorkingSessionCatalogResult(`Saved “${name}” with ${selected.length} tab(s).`, "success");
        showMessage(`Saved working session “${name}”.`, "success");
      } catch (error) {
        elements.workingSessionResult.textContent = error instanceof Error ? error.message : String(error);
      } finally {
        setBusy(false);
      }
      return;
    }

    if (workingSessionMode === "catalog-restore") {
      const entry = selectedWorkingSessionEntry();
      const selectedTabs = (pendingWorkingSessionBundle?.tabs || []).filter((tab) => selected.includes(Number(tab.index)));
      const origins = [...new Set(selectedTabs.map((tab) => hostPermissionPattern(tab.url)).filter(Boolean))];
      const permissionRequest = origins.length ? browser.permissions.request({ origins }) : Promise.resolve(true);
      setBusy(true);
      try {
        const granted = await permissionRequest;
        if (!granted) throw new Error("Site access was not granted for every restored tab.");
        const response = await browser.runtime.sendMessage({
          type: MESSAGE.RESTORE_WORKING_SESSION_ENTRY,
          entryId: pendingWorkingSessionEntryId,
          tabIndexes: selected
        });
        if (!response?.ok) throw new Error(response?.error || "Could not restore the saved working session.");
        if (response.dashboard) render(response.dashboard, true, response.report?.openedTabIds?.[0] || null);
        elements.workingSessionDialog.close();
        setWorkingSessionCatalogResult(`Restored “${entry?.name || "saved session"}”: ${response.report.restored} active add-on tab(s), ${response.report.failed.length} failure(s).`, response.report.failed.length ? "error" : "success");
        showMessage(`Saved working session restored: ${response.report.restored} restored, ${response.report.failed.length} failed.`, response.report.failed.length ? "error" : "success");
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
    if (nextProfileId !== previousProfileId && hasVolatileLocalActionEdits()) {
      discardVolatileLocalActionDraft(selectedTabId);
    } else {
      cancelScheduledVolatileLocalActionSync();
    }
    selectedLocalActionProfileId = nextProfileId;
    if (Number.isInteger(Number(selectedTabId))) {
      setTabProfileSelection(localActionProfileEditorSelectionByTab, selectedTabId, selectedLocalActionProfileId);
      void persistSidebarUi();
    }
    const profile = localActionProfileById(selectedLocalActionProfileId);
    elements.localActionProfileName.value = profile?.name || "";
    writeLocalActionConfig(profile?.config || LocalActions.defaultConfig(), { preserveShell: true });
    scheduleVolatileLocalActionSync();
    renderLocalActionProfileOptions();
  });
  elements.assignLocalActionProfileButton.addEventListener("click", () => {
    if (!confirmDiscardLocalActionDraft("applying another profile to this tab")) return;
    const inactive = !selectedSession();
    void request(MESSAGE.ASSIGN_LOCAL_ACTION_PROFILE, {
      tabId: selectedTabId, profileId: selectedLocalActionProfileId
    }, inactive
      ? "Local-action profile bound to this stopped tab and will be used on activation."
      : "Local-action profile applied to tab.", { reloadForm: true, preferredTabId: selectedTabId });
  });
  elements.clearLocalActionProfileBindingButton.addEventListener("click", () => {
    if (!confirmDiscardLocalActionDraft("removing the explicit Local action profile binding")) return;
    const inactive = !selectedSession();
    void request(MESSAGE.CLEAR_LOCAL_ACTION_PROFILE_BINDING, {
      tabId: selectedTabId
    }, inactive
      ? "Explicit Local action binding removed; URL routing or the default profile will be used on activation."
      : "Explicit Local action binding removed; the active tab now uses URL routing or the default profile.",
    { reloadForm: true, preferredTabId: selectedTabId });
  });
  elements.newLocalActionProfileButton.addEventListener("click", () => void createLocalActionProfileFromCurrentForm());
  elements.saveLocalActionProfileButton.addEventListener("click", () => void saveLocalActionProfile());
  elements.setDefaultLocalActionProfileButton.addEventListener("click", () => void setSelectedLocalActionProfileAsDefault());
  elements.deleteLocalActionProfileButton.addEventListener("click", () => void deleteSelectedLocalActionProfile());
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
    elements.downloadShellExecutionMode, elements.openShellLogAfterExecution,
    elements.rememberShellHistory, elements.shellHistoryLimit
  ]) {
    element.addEventListener("input", updateLocalActionDraftState);
    element.addEventListener("change", updateLocalActionDraftState);
  }

  elements.soundAlertEnabled.addEventListener("change", () => {
    renderSoundAlertControls();
    if (!elements.soundAlertEnabled.checked) soundPreviewPlayer.stop();
  });
  elements.testSoundAlertButton.addEventListener("click", () => void testSoundAlert());
  elements.logChannel.addEventListener("change", renderActivityLog);
  elements.copyLogsButton.addEventListener("click", () => void copySelectedLogs());
  elements.clearLogsButton.addEventListener("click", () => {
    if (selectedSession() && confirm("Clear all user and debug logs for this tab?")) {
      void request(MESSAGE.CLEAR_SESSION_LOGS, { tabId: selectedTabId }, "Tab logs cleared.");
    }
  });
  elements.clearHighlightsButton.addEventListener("click", () => void request(MESSAGE.CLEAR_HIGHLIGHTS, { tabId: selectedTabId }, "Tab highlights cleared."));
  elements.shellPresetSelect.addEventListener("change", async () => {
    const requestedPresetId = elements.shellPresetSelect.value;
    const previousPresetId = selectedShellPresetId;
    const previousPreset = selectedShellPreset();
    if (previousPreset && selectedShellPresetDirty && requestedPresetId !== previousPresetId) {
      const shouldSave = confirm(`Save changes to preset “${previousPreset.name}” before switching?

OK: save and continue.
Cancel: keep editing without losing the changes.`);
      if (!shouldSave) {
        elements.shellPresetSelect.value = previousPresetId;
        return;
      }
      const saved = await updateShellPreset({ quiet: true });
      if (!saved) {
        elements.shellPresetSelect.value = previousPresetId;
        showMessage(`Could not save preset “${previousPreset.name}”. The edited values are still in the form.`, "error");
        return;
      }
    }
    selectedShellPresetId = requestedPresetId;
    selectedShellPresetDirty = false;
    const preset = selectedShellPreset();
    if (preset) {
      commandPresetEditorMode = "preset-edit";
      suppressTabCommandAutosave = true;
      loadShellValues(preset);
      suppressTabCommandAutosave = false;
      commandPresetStatus(`Editing preset “${preset.name}”.`, "idle");
    } else {
      commandPresetEditorMode = "tab";
      commandPresetStatus("Select an existing preset or click New preset.", "idle");
    }
    renderShellPresetOptions();
  });
  for (const element of [elements.workingDirectory, elements.shellCommand, elements.shellMode, elements.confirmBeforeRun]) {
    element.addEventListener("input", scheduleTabCommandPersistence);
    element.addEventListener("change", scheduleTabCommandPersistence);
  }
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
  for (const element of [elements.nativeLogRetentionEnabled, elements.nativeLogMaxAgeDays, elements.nativeLogMaxTotalMiB, elements.nativeLogMaxFiles, elements.nativeLogCleanupOnStartup, elements.nativeLogCleanupAfterCommand]) {
    element.addEventListener("input", () => { nativeLogRetentionDirty = true; renderShellState(); });
    element.addEventListener("change", () => { nativeLogRetentionDirty = true; renderShellState(); });
  }
  elements.saveNativeLogRetentionButton.addEventListener("click", async () => {
    const response = await request(MESSAGE.SAVE_NATIVE_LOG_RETENTION, { policy: readNativeLogRetentionForm() }, "Native log-retention policy saved.");
    if (response?.ok) nativeLogRetentionDirty = false;
  });
  elements.runNativeLogCleanupButton.addEventListener("click", async () => {
    const response = await request(MESSAGE.RUN_NATIVE_LOG_CLEANUP, {}, "Native command-log cleanup completed.");
    if (response?.ok) nativeLogRetentionDirty = false;
  });
  elements.runShellButton.addEventListener("click", runShellCommand);
  elements.runShellQuickButton.addEventListener("click", runShellCommand);
  elements.stopShellButton.addEventListener("click", stopShellCommand);
  elements.stopShellQuickButton.addEventListener("click", stopShellCommand);
  elements.clearShellOutputButton.addEventListener("click", () => void request(MESSAGE.CLEAR_SHELL_OUTPUT, { tabId: selectedTabId }, "Live output tail cleared. The full stored log is unchanged."));
  elements.openShellLogButton.addEventListener("click", () => void openShellLogDialog());
  elements.openShellLogQuickButton.addEventListener("click", () => void openShellLogDialog());
  elements.shellLogFirstButton.addEventListener("click", () => void reloadOpenShellLogPage({ offset: 0 }));
  elements.shellLogPreviousButton.addEventListener("click", () => {
    const offset = shellLogState.pageOffsets[Math.max(0, shellLogState.pageIndex - 1)] || 0;
    void reloadOpenShellLogPage({ offset });
  });
  elements.shellLogNextButton.addEventListener("click", () => void reloadOpenShellLogPage({ offset: shellLogState.nextOffset }));
  elements.shellLogLastButton.addEventListener("click", () => void reloadOpenShellLogPage({ fromEnd: true }));
  elements.refreshShellLogButton.addEventListener("click", () => void reloadOpenShellLogPage({ fromEnd: true }));
  elements.copyShellLogSelectionButton.addEventListener("click", () => {
    const text = elements.shellLogViewer.value.slice(elements.shellLogViewer.selectionStart, elements.shellLogViewer.selectionEnd);
    void copyTextValue(text, "Selected log text copied.").catch((error) => showMessage(error.message, "error"));
  });
  elements.copyShellLogPageButton.addEventListener("click", () => void copyTextValue(elements.shellLogViewer.value, "Current log page copied.").catch((error) => showMessage(error.message, "error")));
  elements.copyShellLogAllButton.addEventListener("click", () => void copyAllShellLog().catch((error) => showMessage(error.message, "error")));
  elements.exportShellLogArchiveButton.addEventListener("click", () => void exportShellLogArchive());
  elements.deleteShellLogButton.addEventListener("click", () => {
    if (!shellLogState.logId || !confirm("Delete this stored command log from disk?")) return;
    void request(MESSAGE.DELETE_SHELL_LOG, { tabId: shellLogState.tabId, logId: shellLogState.logId }, "Stored command log deleted.").then((response) => {
      if (response?.ok && elements.shellLogDialog.open) elements.shellLogDialog.close();
    });
  });
  elements.refreshShortcutsButton.addEventListener("click", () => void request(MESSAGE.GET_DASHBOARD));
  elements.exportRuleStatisticsButton.addEventListener("click", exportRuleStatistics);
  elements.resetRuleStatisticsButton.addEventListener("click", () => void resetRuleStatistics());
  elements.manageShortcutsButton.addEventListener("click", () => void manageKeyboardShortcuts().catch((error) => showMessage(error instanceof Error ? error.message : String(error), "error")));
  elements.resetShortcutsButton.addEventListener("click", () => void resetKeyboardShortcuts().catch((error) => showMessage(error instanceof Error ? error.message : String(error), "error")));
  elements.refreshButton.addEventListener("click", () => void request(MESSAGE.GET_DASHBOARD));
  elements.tabPrimaryQuickButton.addEventListener("click", runPrimaryTabAction);
  elements.tabStopQuickButton.addEventListener("click", stopSelectedTab);
  elements.activateButton.addEventListener("click", activateCurrentTab);
  elements.pauseButton.addEventListener("click", () => void request(MESSAGE.PAUSE_TAB, { tabId: selectedTabId }, "Tab paused."));
  elements.resumeButton.addEventListener("click", () => void request(MESSAGE.RESUME_TAB, { tabId: selectedTabId }, "Tab resumed."));
  elements.stopButton.addEventListener("click", stopSelectedTab);
  elements.assignProfileButton.addEventListener("click", () => void request(MESSAGE.ASSIGN_PROFILE, { tabId: selectedTabId, profileId: selectedProfileId }, "Profile applied to tab."));
  elements.saveTabButton.addEventListener("click", () => void saveTabConfiguration());
  elements.resetTabButton.addEventListener("click", () => void request(MESSAGE.RESET_TAB_CONFIG, { tabId: selectedTabId }, "The tab now uses its profile configuration."));
  elements.newProfileButton.addEventListener("click", () => void createProfileFromCurrentForm());
  elements.setDefaultProfileButton.addEventListener("click", () => void setSelectedAutomationProfileAsDefault());
  elements.deleteProfileButton.addEventListener("click", () => void deleteSelectedAutomationProfile());
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
      `firefox-chat-improver-configuration-${new Date().toISOString().slice(0, 10)}.json`
    );
  });
  elements.confirmWorkingSessionButton.addEventListener("click", () => void confirmWorkingSession());
  elements.workingSessionCatalogSelect.addEventListener("change", () => {
    selectedWorkingSessionEntryId = elements.workingSessionCatalogSelect.value || null;
    workingSessionEditorEntryId = null;
    renderWorkingSessionCatalog();
    void persistSidebarUi();
  });
  elements.newWorkingSessionEntryButton.addEventListener("click", () => {
    workingSessionEditorEntryId = "new";
    elements.workingSessionCatalogName.value = `Working session ${new Date().toLocaleString("en-GB", { hour12: false })}`;
    elements.workingSessionCatalogDescription.value = "";
    pendingWorkingSessionEntryId = null;
    void openSaveWorkingSessionDialog("catalog-create", null);
  });
  elements.updateWorkingSessionEntryButton.addEventListener("click", () => {
    const entry = selectedWorkingSessionEntry();
    if (!entry) return;
    pendingWorkingSessionEntryId = entry.id;
    void openSaveWorkingSessionDialog("catalog-update", entry.id);
  });
  elements.restoreWorkingSessionEntryButton.addEventListener("click", openCatalogRestoreDialog);
  elements.renameWorkingSessionEntryButton.addEventListener("click", async () => {
    const entry = selectedWorkingSessionEntry();
    const name = elements.workingSessionCatalogName.value.trim();
    if (!entry || !name) {
      setWorkingSessionCatalogResult("Choose a saved session and enter a non-empty name.", "error");
      return;
    }
    const response = await request(MESSAGE.RENAME_WORKING_SESSION_ENTRY, { entryId: entry.id, name }, `Saved session renamed to “${name}”.`);
    if (response?.ok) {
      workingSessionEditorEntryId = null;
      setWorkingSessionCatalogResult(`Renamed saved session to “${name}”.`, "success");
    }
  });
  elements.duplicateWorkingSessionEntryButton.addEventListener("click", async () => {
    const entry = selectedWorkingSessionEntry();
    if (!entry) return;
    const name = prompt("Duplicate saved-session name:", `${entry.name} - copy`);
    if (!name?.trim()) return;
    const response = await request(MESSAGE.DUPLICATE_WORKING_SESSION_ENTRY, { entryId: entry.id, name: name.trim() }, `Saved session duplicated as “${name.trim()}”.`);
    if (response?.ok) {
      selectedWorkingSessionEntryId = response.entryId || selectedWorkingSessionEntryId;
      workingSessionEditorEntryId = null;
      if (response.dashboard) render(response.dashboard, false);
      void persistSidebarUi();
      setWorkingSessionCatalogResult(`Created duplicate “${name.trim()}”.`, "success");
    }
  });
  elements.deleteWorkingSessionEntryButton.addEventListener("click", async () => {
    const entry = selectedWorkingSessionEntry();
    if (!entry || !confirm(`Delete saved working session “${entry.name}”?`)) return;
    const response = await request(MESSAGE.DELETE_WORKING_SESSION_ENTRY, { entryId: entry.id }, `Saved session “${entry.name}” deleted.`);
    if (response?.ok) {
      selectedWorkingSessionEntryId = response.dashboard?.workingSessionCatalog?.entries?.[0]?.id || null;
      workingSessionEditorEntryId = null;
      if (response.dashboard) render(response.dashboard, false);
      void persistSidebarUi();
      setWorkingSessionCatalogResult(`Deleted “${entry.name}”.`, "success");
    }
  });
  elements.exportWorkingSessionEntryButton.addEventListener("click", async () => {
    const entry = selectedWorkingSessionEntry();
    if (!entry) return;
    const response = await request(MESSAGE.EXPORT_WORKING_SESSION_ENTRY, { entryId: entry.id });
    if (!response?.text) return;
    downloadBlob(new Blob([response.text], { type: "application/json" }), `${safeSessionFilename(response.name)}.working-session.json`);
    setWorkingSessionCatalogResult(`Exported “${response.name}” with ${response.tabCount} tab(s).`, "success");
  });
  elements.importWorkingSessionEntryButton.addEventListener("click", () => elements.importWorkingSessionEntryFile.click());
  elements.importWorkingSessionEntryFile.addEventListener("change", async () => {
    const file = elements.importWorkingSessionEntryFile.files?.[0];
    if (!file) return;
    try {
      const suggestedName = file.name.replace(/(?:\.working-session)?\.json$/i, "").replace(/[-_]+/g, " ").trim();
      const response = await request(MESSAGE.IMPORT_WORKING_SESSION_ENTRY, { text: await file.text(), name: suggestedName }, "Working-session file added to the saved catalog.");
      if (response?.ok) {
        selectedWorkingSessionEntryId = response.entryId || selectedWorkingSessionEntryId;
        workingSessionEditorEntryId = null;
        if (response.dashboard) render(response.dashboard, false);
        void persistSidebarUi();
        setWorkingSessionCatalogResult(`Imported “${suggestedName || "working session"}” into the catalog without opening tabs.`, "success");
      }
    } finally {
      elements.importWorkingSessionEntryFile.value = "";
    }
  });
  elements.exportWorkingSessionCatalogButton.addEventListener("click", async () => {
    const response = await request(MESSAGE.EXPORT_WORKING_SESSION_CATALOG);
    if (!response?.text) return;
    downloadBlob(new Blob([response.text], { type: "application/json" }), `firefox-chat-assistant-saved-sessions-${new Date().toISOString().slice(0, 10)}.json`);
    setWorkingSessionCatalogResult(`Exported ${response.entryCount} saved working session(s).`, "success");
  });
  elements.importWorkingSessionCatalogButton.addEventListener("click", () => elements.importWorkingSessionCatalogFile.click());
  elements.importWorkingSessionCatalogFile.addEventListener("change", async () => {
    const file = elements.importWorkingSessionCatalogFile.files?.[0];
    if (!file) return;
    try {
      const response = await request(MESSAGE.IMPORT_WORKING_SESSION_CATALOG, { text: await file.text() }, "Saved-session catalog imported.");
      if (response?.ok) {
        selectedWorkingSessionEntryId = response.dashboard?.workingSessionCatalog?.entries?.[0]?.id || selectedWorkingSessionEntryId;
        workingSessionEditorEntryId = null;
        if (response.dashboard) render(response.dashboard, false);
        void persistSidebarUi();
        const report = response.report || {};
        setWorkingSessionCatalogResult(`Catalog import: ${report.created || 0} created, ${report.updated || 0} updated, ${report.renamed || 0} collision copy/copies.`, "success");
      }
    } finally {
      elements.importWorkingSessionCatalogFile.value = "";
    }
  });

  elements.importButton.addEventListener("click", () => elements.importFile.click());
  elements.importFile.addEventListener("change", async () => {
    const file = elements.importFile.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const previewResponse = await request(MESSAGE.PREVIEW_SETTINGS_IMPORT, { text }, "", { reloadForm: false });
      const preview = previewResponse?.preview;
      if (!previewResponse?.ok || !preview) return;
      const details = preview.scope === "all-configuration"
        ? [
            `${preview.automationProfiles} Automation`,
            `${preview.monitorProfiles} Monitor`,
            `${preview.targetProfiles} Target`,
            `${preview.localActionProfiles} Local action`,
            `${preview.commandPresets} command preset(s)`,
            `${preview.customPromptTemplates} custom prompt template(s)`,
            `sidebar preset: ${preview.sidebarFeaturePreset || "standard"}`
          ].join(", ")
        : `${preview.automationProfiles} Automation, ${preview.monitorProfiles} Monitor, ${preview.targetProfiles} Target profile(s)`;
      const scopeText = preview.scope === "all-configuration"
        ? "FULL configuration bundle"
        : "LEGACY Automation-only configuration";
      const warning = preview.scope === "all-configuration"
        ? "This replaces the global Automation, Local action, preset, template and sidebar-preference libraries. Open/stopped tabs keep their current effective values where profiles differ."
        : "This replaces only the global Automation library. Local action profiles, presets, templates and sidebar preferences stay unchanged.";
      if (!confirm(`Import ${scopeText}?

File: ${file.name}
Contains: ${details}

${warning}

A recovery snapshot will be created before import.`)) return;
      const response = await request(MESSAGE.IMPORT_SETTINGS, { text }, "", { reloadForm: true });
      if (!response?.ok) return;
      if (response.scope === "all-configuration") {
        const automationPreserved = Number(response.automationPreservation?.preservedActiveTabs || 0) + Number(response.automationPreservation?.preservedStoppedTabs || 0);
        const localActionPreserved = Number(response.localActionPreservation?.preservedActiveTabs || 0) + Number(response.localActionPreservation?.preservedStoppedTabs || 0);
        const preservedDetail = automationPreserved || localActionPreserved
          ? ` Preserved tab overrides: ${automationPreserved} Automation, ${localActionPreserved} Local action.`
          : "";
        showMessage(`Full configuration imported. Existing open/stopped tabs kept their current Automation and Local action values where imported profiles differed.${preservedDetail} Reloading the sidebar to apply imported UI, preset and template preferences…`, "success");
        window.setTimeout(() => window.location.reload(), 180);
      } else {
        showMessage("Legacy Automation-only configuration imported. Local action profiles, presets, templates and sidebar preferences were left unchanged.", "success");
      }
    } finally {
      elements.importFile.value = "";
    }
  });
  elements.exportConfigurationProfilesButton.addEventListener("click", () => void exportProfileType("configuration"));
  elements.importConfigurationProfilesButton.addEventListener("click", () => chooseProfileImport("configuration"));
  elements.exportMonitorProfilesButton.addEventListener("click", () => void exportProfileType("monitor"));
  elements.importMonitorProfilesButton.addEventListener("click", () => chooseProfileImport("monitor"));
  elements.exportTargetProfilesButton.addEventListener("click", () => void exportProfileType("target"));
  elements.importTargetProfilesButton.addEventListener("click", () => chooseProfileImport("target"));
  elements.exportLocalActionProfilesButton.addEventListener("click", () => void exportProfileType("local-action"));
  elements.importLocalActionProfilesButton.addEventListener("click", () => chooseProfileImport("local-action"));
  elements.profileImportFile.addEventListener("change", async () => {
    const file = elements.profileImportFile.files?.[0];
    const type = pendingProfileImportType;
    pendingProfileImportType = null;
    if (!file || !type) return;
    try {
      const text = await file.text();
      const preserveComponentDraft = type === "monitor" || type === "target";
      const editorDraft = preserveComponentDraft ? captureComponentProfileEditorDraft() : null;
      const response = await request(
        MESSAGE.IMPORT_PROFILE_BUNDLE,
        { profileType: type, text },
        "",
        { reloadForm: !preserveComponentDraft }
      );
      if (editorDraft) restoreComponentProfileEditorDraft(editorDraft);
      if (response?.ok) {
        if (preserveComponentDraft) {
          renderComponentProfileOptions();
          await persistSidebarUi();
        }
        const created = Number(response.created) || 0;
        const skipped = Number(response.skipped) || 0;
        const collisionCopies = Number(response.collisionCopies) || 0;
        const renamed = Number(response.renamed) || 0;
        const details = [
          `${created} added`,
          `${skipped} identical skipped`,
          collisionCopies ? `${collisionCopies} ID conflict${collisionCopies === 1 ? "" : "s"} imported as copies` : "",
          renamed ? `${renamed} name conflict${renamed === 1 ? "" : "s"} renamed` : ""
        ].filter(Boolean).join(", ");
        showMessage(`${type} profile import: ${details}. Existing profiles, defaults and running tabs were unchanged.${preserveComponentDraft ? " The current rule draft was preserved." : ""}`, "success");
      }
    } finally {
      elements.profileImportFile.value = "";
    }
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
    if (snapshotId && confirm(`Restore ${label}? Current configuration will be snapshotted first. Open/stopped tabs keep their current effective values if restored profiles differ.`)) {
      void (async () => {
        const response = await request(MESSAGE.RESTORE_SETTINGS_SNAPSHOT, { snapshotId }, "", { reloadForm: true });
        if (!response?.ok) return;
        if (response.scope === "all-configuration") {
          const automationPreserved = Number(response.automationPreservation?.preservedActiveTabs || 0) + Number(response.automationPreservation?.preservedStoppedTabs || 0);
          const localActionPreserved = Number(response.localActionPreservation?.preservedActiveTabs || 0) + Number(response.localActionPreservation?.preservedStoppedTabs || 0);
          const preservedDetail = automationPreserved || localActionPreserved
            ? ` Preserved tab overrides: ${automationPreserved} Automation, ${localActionPreserved} Local action.`
            : "";
          showMessage(`Full configuration snapshot restored. Existing open/stopped tabs kept their current Automation and Local action values where restored profiles differed.${preservedDetail} Reloading the sidebar to apply restored UI, preset and template preferences…`, "success");
          window.setTimeout(() => window.location.reload(), 180);
        } else {
          showMessage("Legacy Automation-only snapshot restored. Local action profiles, presets, templates and sidebar preferences were left unchanged.", "success");
        }
      })();
    }
  });
  elements.deleteSettingsSnapshotButton.addEventListener("click", () => {
    const snapshotId = elements.settingsSnapshotSelect.value;
    const label = elements.settingsSnapshotSelect.selectedOptions[0]?.textContent || "selected snapshot";
    if (snapshotId && confirm(`Delete ${label}?`)) {
      void request(MESSAGE.DELETE_SETTINGS_SNAPSHOT, { snapshotId }, "Settings snapshot deleted.");
    }
  });


  elements.customizeSidebarButton.addEventListener("click", openSidebarFeaturesDialog);
  elements.sidebarFeaturePresetSelect.addEventListener("change", () => {
    const preset = elements.sidebarFeaturePresetSelect.value;
    if (preset === "custom") {
      sidebarFeaturePreset = "custom";
      renderSidebarFeatureControls();
      void persistSidebarUi();
    } else {
      setSidebarFeaturePreset(preset);
    }
  });
  for (const checkbox of document.querySelectorAll("[data-sidebar-feature]")) {
    checkbox.addEventListener("change", () => {
      setSidebarFeatureEnabled(checkbox.dataset.sidebarFeature, checkbox.checked);
    });
  }
  elements.resetSidebarFeaturesButton.addEventListener("click", () => setSidebarFeaturePreset("standard"));

  elements.promptTemplateSelect.addEventListener("change", () => {
    promptTemplateEditorMode = "selected";
    selectedPromptTemplateId = elements.promptTemplateSelect.value || null;
    setPromptTemplateStatus();
    renderPromptTemplates(selectedPromptTemplateId);
    void persistSidebarUi();
  });
  elements.newPromptTemplateButton.addEventListener("click", beginNewPromptTemplate);
  elements.savePromptTemplateButton.addEventListener("click", () => void saveCurrentPromptTemplate());
  elements.deletePromptTemplateButton.addEventListener("click", () => void deleteCurrentPromptTemplate());
  elements.copyPromptTemplateButton.addEventListener("click", () => void copyCurrentPromptTemplate().catch((error) => setPromptTemplateStatus(error instanceof Error ? error.message : String(error), "error")));
  elements.fillPromptTemplateButton.addEventListener("click", () => void fillCurrentPromptTemplate());
  elements.promptTemplateName.addEventListener("input", () => {
    elements.savePromptTemplateButton.disabled = false;
  });
  elements.promptTemplateText.addEventListener("input", () => {
    elements.savePromptTemplateButton.disabled = false;
    elements.fillPromptTemplateButton.disabled = !elements.promptTemplateText.value.trim();
    elements.copyPromptTemplateButton.disabled = !elements.promptTemplateText.value.trim();
  });

  function bindListFilter(input, key, render) {
    input.addEventListener("input", () => {
      listFilters[key] = input.value;
      render();
      void persistSidebarUi();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && input.value) {
        input.value = "";
        listFilters[key] = "";
        render();
        void persistSidebarUi();
      }
    });
  }

  bindListFilter(elements.tabSearch, "tabs", () => renderSelectors(selectedTabId));
  bindListFilter(elements.profileSearch, "configurationProfiles", () => renderSelectors(selectedTabId));
  bindListFilter(elements.monitorProfileSearch, "monitorProfiles", renderComponentProfileOptions);
  bindListFilter(elements.targetProfileSearch, "targetProfiles", renderComponentProfileOptions);
  bindListFilter(elements.localActionProfileSearch, "localActionProfiles", renderLocalActionProfileOptions);
  bindListFilter(elements.shellPresetSearch, "commandPresets", renderShellPresetOptions);
  bindListFilter(elements.shellHistorySearch, "commandHistory", renderShellHistory);
  bindListFilter(elements.workingSessionCatalogSearch, "workingSessions", renderWorkingSessionCatalog);

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

  async function bootstrapSidebar() {
    RuntimeGuard?.markStarting();
    RuntimeGuard?.clearStage("dashboard");
    RuntimeGuard?.clearStage("collapsible-groups");
    placeLocalActionProfileAfterConfigurationProfiles();
    organizeSidebarGroups();
    ensureCommandPresetUi();
    await loadCommandPresetLibrary();
    let layoutFailure = null;
    try {
      await initializeCollapsibleGroups();
    } catch (error) {
      layoutFailure = error;
      console.error("Sidebar group initialization failed.", error);
      showMessage(`Sidebar layout initialization failed: ${error instanceof Error ? error.message : String(error)}`, "error");
      RuntimeGuard?.report("collapsible-groups", error, { fatal: false });
    }

    const response = await request(MESSAGE.GET_DASHBOARD);
    if (!response) {
      const error = new Error("Dashboard initialization failed. Check the background script and reload the add-on.");
      RuntimeGuard?.report("dashboard", error, { fatal: true });
      document.body.dataset.sidebarReady = "false";
      return false;
    }

    /* Phase 28 preset migration */
    try {
      await migrateLegacyCommandPresets();
      renderDetails(true);
    } catch (error) {
      console.error("Command preset migration failed.", error);
      commandPresetStatus(error instanceof Error ? error.message : String(error), "error");
    }
    document.body.dataset.sidebarReady = "true";
    RuntimeGuard?.markReady({ degraded: Boolean(layoutFailure) });
    return true;
  }

  RuntimeGuard?.setRetryHandler(() => bootstrapSidebar());
  void bootstrapSidebar();
})();
