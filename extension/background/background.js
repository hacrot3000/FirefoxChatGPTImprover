(() => {
  "use strict";

  // Phase 28 v0.28.7: consume correlated move completion before resolving Native Host requests.

  // Phase 28 v0.28.8: same-tab download jobs survive session-token rollover.

  // Phase 28 v0.28.14: tab-bound shell log viewer and persistent command notices.
  // Phase 28 v0.28.15: active-tab viewed notices clear to idle and AI status regains priority.
  // Phase 28 v0.28.16: command notices never suppress AI state; missing native logs use a persisted per-run fallback.
  // Phase 28 v0.28.20: restart-resumable captures, idempotent moves and legacy log recovery.
  // Phase 28 v0.28.22: bounded Native Host log retention with protected unread logs.
  // Phase 28 v0.28.23: tab-bound working local actions survive background restarts and reject stale sidebar syncs.
  // Phase 44 v0.39.5: Stop keeps a per-tab configuration snapshot for the next Start.
  // Phase 45 v0.39.6: explicit stopped state blocks auto-activation and reconciles profile choices.

  const { MESSAGE, MODE, CONFIG_MODE, MONITOR_STATE } = globalThis.FCI_PROTOCOL;
  const Settings = globalThis.FCI_SETTINGS;
  const Snapshots = globalThis.FCI_SETTINGS_SNAPSHOTS;
  const Recovery = globalThis.FCI_RECOVERY;
  const SupportBundle = globalThis.FCI_SUPPORT_BUNDLE;
  const WorkingSession = globalThis.FCI_WORKING_SESSION;
  const LocalActions = globalThis.FCI_LOCAL_ACTIONS;
  const CommandPresets = globalThis.FCI_COMMAND_PRESETS;
  const ConfigurationBundle = globalThis.FCI_CONFIGURATION_BUNDLE;
  // Phase 37 rerun compatibility marker: const PromptTemplates = globalThis.FCI_PROMPT_TEMPLATES;
  const PromptTemplates = globalThis.FCI_PROMPT_TEMPLATES || null;
  const PROMPT_TEMPLATE_MAX_LENGTH_FALLBACK = 30000;
  const PROMPT_TEMPLATE_LIBRARY_FALLBACK = Object.freeze({
    schema: 1,
    builtInCount: 0,
    customCount: 0,
    maxCustomTemplates: 0,
    templates: Object.freeze([])
  });
  const TAB_SESSION_KEY = "firefoxChatImprover.tabSession.v2";
  const TAB_CUSTOM_TITLE_KEY = "firefoxChatImprover.customTabTitle.v1";
  const TAB_LOCAL_ACTION_PROFILE_KEY = "firefoxChatImprover.localActionProfile.v1";
  const TAB_STOPPED_CONFIG_KEY = "firefoxChatImprover.stoppedTabConfig.v1";
  const sessions = new Map();
  const pickerStates = new Map();
  const volatileLocalActionDrafts = new Map(); // tabId -> { config, context }; persisted mirror survives background restarts
  let storePromise = null;
  let localActionStorePromise = null;
  let snapshotPromise = null;
  let workingSessionCatalogPromise = null;
  let recoveryPromise = null;
  let nativeLogCleanupTimer = null;
  let nativeLogCleanupRunning = false;
  let nativeLogCleanupState = { lastCleanupAt: null, lastReason: null, lastResult: null, lastError: null };

  const NATIVE_HOST_NAME = "com.duongtc.firefox_chat_assistant";
  const SHELL_OUTPUT_LIMIT = 500;
  const SHELL_OUTPUT_CHAR_LIMIT = 200000; // UI tail only; the Native Host keeps the complete file-backed log.
  const SHELL_HISTORY_INLINE_CHAR_LIMIT = 65536;
  const SHELL_HISTORY_INLINE_ENTRY_LIMIT = 5;
  const SHELL_LOG_READ_MAX_BYTES = 256 * 1024;
  const shellRuns = new Map();
  const downloadCaptures = new Map();
  const downloadCaptureExpiryTimers = new Map();
  const downloadJobs = new Map();
  const managedDownloadIds = new Set();
  const managedDownloadStarts = new Map();
  const downloadMoveToTab = new Map();
  const runToTab = new Map();
  const shellBroadcastTimers = new Map();
  const runtimeBroadcastTimers = new Map();
  const autoActivationInFlight = new Map();
  const autoActivationAudit = new Map();
  let autoActivationScanTimer = null;
  let pendingShortcutAction = null;
  const pendingNativeRequests = new Map();
  let nativePort = null;
  let nativeState = {
    connected: false,
    hostName: NATIVE_HOST_NAME,
    hostVersion: null,
    lastError: null,
    lastSeenAt: null,
    logStore: null
  };

  const KEYBOARD_COMMAND = Object.freeze({
    OPEN_SIDEBAR: "fci-open-side-panel",
    TOGGLE_CURRENT_TAB: "fci-toggle-current-tab",
    ACKNOWLEDGE_CURRENT_ALERT: "fci-acknowledge-current-alert",
    RUN_CURRENT_TARGET_ACTION: "fci-run-current-target-action",
    OPEN_CURRENT_COMMAND_LOG: "fci-open-current-command-log",
    STOP_CURRENT_TAB: "fci-stop-current-tab"
  });

  function emptyShellRun(tabId) {
    return {
      tabId,
      runId: null,
      mode: null,
      status: "idle",
      pid: null,
      cwd: "",
      command: "",
      startedAt: null,
      endedAt: null,
      returnCode: null,
      stopped: false,
      error: null,
      logId: null,
      logBytes: 0,
      output: []
    };
  }

  function shellRunForTab(tabId) {
    if (!shellRuns.has(tabId)) {
      shellRuns.set(tabId, emptyShellRun(tabId));
    }
    return shellRuns.get(tabId);
  }

  function publicShellRun(tabId) {
    return clone(shellRuns.get(tabId) || emptyShellRun(tabId));
  }

  function emptyShellNotice(tabId) {
    return {
      tabId: Number(tabId),
      runId: null,
      status: "idle",
      command: "",
      source: null,
      logId: null,
      logBytes: 0,
      startedAt: null,
      completedAt: null,
      viewedAt: null,
      returnCode: null,
      error: null
    };
  }

  function normalizeShellNotice(raw, tabId) {
    const source = raw && typeof raw === "object" ? raw : {};
    const status = ["idle", "running", "unread", "viewed"].includes(source.status) ? source.status : "idle";
    return {
      ...emptyShellNotice(tabId),
      ...clone(source),
      tabId: Number(tabId),
      runId: source.runId ? String(source.runId) : null,
      status,
      command: String(source.command || ""),
      source: ["sidebar", "automation", "download"].includes(source.source) ? source.source : null,
      logId: source.logId ? String(source.logId) : null,
      logBytes: Math.max(0, Number(source.logBytes) || 0),
      returnCode: Number.isInteger(source.returnCode) ? source.returnCode : null,
      error: source.error ? String(source.error) : null
    };
  }

  function syncShellNoticeFromRun(session, run, event) {
    if (!session || !run?.runId) return null;
    const current = normalizeShellNotice(session.shellNotice, session.tabId);
    if (current.runId && current.runId !== run.runId && event !== "starting") return current;
    const completed = ["exited", "error"].includes(event);
    session.shellNotice = normalizeShellNotice({
      ...current,
      tabId: session.tabId,
      runId: run.runId,
      status: completed ? "unread" : "running",
      command: run.command || current.command,
      source: run.source || current.source || "sidebar",
      logId: run.logId || current.logId || null,
      logBytes: Math.max(Number(run.logBytes) || 0, Number(current.logBytes) || 0),
      startedAt: run.startedAt || current.startedAt || Settings.nowIso(),
      completedAt: completed ? (run.endedAt || Settings.nowIso()) : null,
      viewedAt: completed ? null : current.viewedAt,
      returnCode: Number.isInteger(run.returnCode) ? run.returnCode : null,
      error: event === "error" ? (run.error || "The command failed.") : null
    }, session.tabId);
    return session.shellNotice;
  }

  async function syncShellNoticeToContent(session) {
    if (!Number.isInteger(session?.tabId)) return;
    try {
      await browser.tabs.sendMessage(session.tabId, {
        type: MESSAGE.CONTENT_SHELL_NOTICE,
        payload: { shellNotice: normalizeShellNotice(session.shellNotice, session.tabId) }
      });
    } catch (_error) {
      // The content runtime may be unavailable while the tab navigates or reloads.
    }
  }

  async function publishShellNotice(session, { persist = true, reason = "shell-notice-updated" } = {}) {
    if (!session) return null;
    session.shellNotice = normalizeShellNotice(session.shellNotice, session.tabId);
    if (persist) await persistSession(session);
    const store = await loadStore();
    await updateBadge(session, store);
    await syncShellNoticeToContent(session);
    await broadcast(reason, session.tabId);
    return clone(session.shellNotice);
  }

  async function acknowledgeShellNotice(session, { runId = null, logId = null, requireActiveTab = false } = {}) {
    if (!session) throw new Error("This tab is not activated.");
    const notice = normalizeShellNotice(session.shellNotice, session.tabId);
    const runMatches = !runId || !notice.runId || String(runId) === notice.runId;
    const logMatches = !logId || !notice.logId || String(logId) === notice.logId;
    let activeTabMatches = true;
    if (requireActiveTab) {
      const active = await currentTab();
      activeTabMatches = Number(active?.id) === Number(session.tabId);
    }
    if (notice.status === "unread" && runMatches && logMatches) {
      session.shellNotice = normalizeShellNotice({
        ...notice,
        status: activeTabMatches ? "idle" : "viewed",
        viewedAt: Settings.nowIso()
      }, session.tabId);
      await publishShellNotice(session, { reason: activeTabMatches ? "shell-log-viewed" : "shell-log-viewed-pending-active-tab" });
    }
    return clone(normalizeShellNotice(session.shellNotice, session.tabId));
  }

  async function clearViewedShellNoticeForActiveTab(tabId) {
    const session = sessions.get(Number(tabId));
    if (!session) return false;
    const notice = normalizeShellNotice(session.shellNotice, session.tabId);
    if (notice.status !== "viewed") return false;
    session.shellNotice = normalizeShellNotice({ ...notice, status: "idle" }, session.tabId);
    await publishShellNotice(session, { reason: "shell-log-viewed-active-tab" });
    return true;
  }

  function appendShellOutput(run, stream, text) {
    const value = String(text || "");
    if (!value) {
      return;
    }
    run.output.push({ at: Settings.nowIso(), stream: stream || "system", text: value });
    if (run.output.length > SHELL_OUTPUT_LIMIT) {
      run.output.splice(0, run.output.length - SHELL_OUTPUT_LIMIT);
    }
    let total = run.output.reduce((sum, item) => sum + item.text.length, 0);
    while (total > SHELL_OUTPUT_CHAR_LIMIT && run.output.length > 1) {
      total -= run.output.shift().text.length;
    }
  }

  function shellRunInlineText(run) {
    const output = Array.isArray(run?.output) ? run.output : [];
    const text = output.map((item) => `${item.stream === "stderr" ? "[stderr] " : (item.stream === "system" ? "[system] " : "")}${item.text || ""}`).join("");
    return text.length > SHELL_HISTORY_INLINE_CHAR_LIMIT
      ? text.slice(text.length - SHELL_HISTORY_INLINE_CHAR_LIMIT)
      : text;
  }

  function emptyDownloadState(tabId) {
    return {
      tabId,
      captureId: null,
      sessionToken: null,
      localActionProfileId: null,
      localActionRevision: 0,
      localActionSource: null,
      localActionFingerprint: null,
      configSnapshot: null,
      ruleId: null,
      cycle: 0,
      pageUrl: null,
      pageOrigin: null,
      status: "idle",
      armedAt: null,
      expiresAt: null,
      downloadId: null,
      sourceUrl: null,
      sourcePath: null,
      destinationDirectory: null,
      destinationPath: null,
      filename: null,
      size: null,
      moveId: null,
      moveAttempt: 0,
      moveRequestedAt: null,
      moveRecoveredAt: null,
      recoveryAttempts: 0,
      retryable: false,
      completionId: null,
      completionReason: null,
      completionSurface: null,
      completionShownAt: null,
      recoveryNote: null,
      error: null,
      completedAt: null,
      showCompletionDialog: false,
      executeShellAfterMove: false,
      shellExecutionMode: "disabled",
      openShellLogAfterExecution: true,
      shellStatus: "idle",
      shellRunId: null,
      shellReturnCode: null,
      shellLogId: null,
      shellLogBytes: 0,
      shellStartedAt: null,
      shellCompletedAt: null,
      shellError: null
    };
  }

  function normalizeDownloadState(raw, tabId) {
    const source = raw && typeof raw === "object" ? raw : {};
    const allowedStatuses = new Set(["idle", "armed", "downloading", "moving", "completed", "expired", "error"]);
    const configSnapshot = source.configSnapshot
      ? LocalActions.normalizeExecutionSnapshot(source.configSnapshot)
      : null;
    return {
      ...emptyDownloadState(Number(tabId)),
      ...clone(source),
      tabId: Number(tabId),
      status: allowedStatuses.has(source.status) ? source.status : "idle",
      sessionToken: source.sessionToken ? String(source.sessionToken) : null,
      localActionProfileId: source.localActionProfileId ? String(source.localActionProfileId) : null,
      localActionRevision: Math.max(0, Number(source.localActionRevision) || 0),
      localActionSource: source.localActionSource ? String(source.localActionSource) : null,
      localActionFingerprint: source.localActionFingerprint ? String(source.localActionFingerprint) : null,
      configSnapshot,
      ruleId: source.ruleId ? String(source.ruleId) : null,
      cycle: Math.max(0, Number(source.cycle) || 0),
      pageUrl: source.pageUrl ? String(source.pageUrl) : null,
      pageOrigin: source.pageOrigin ? String(source.pageOrigin) : null,
      downloadId: Number.isInteger(source.downloadId) ? source.downloadId : null,
      moveAttempt: Math.max(0, Number(source.moveAttempt) || 0),
      recoveryAttempts: Math.max(0, Number(source.recoveryAttempts) || 0),
      retryable: Boolean(source.retryable),
      showCompletionDialog: Boolean(source.showCompletionDialog),
      executeShellAfterMove: Boolean(source.executeShellAfterMove),
      shellExecutionMode: ["disabled", "manual", "automatic"].includes(source.shellExecutionMode) ? source.shellExecutionMode : (source.executeShellAfterMove ? "automatic" : "manual"),
      openShellLogAfterExecution: source.openShellLogAfterExecution !== false,
      shellStatus: String(source.shellStatus || "idle"),
      shellRunId: source.shellRunId ? String(source.shellRunId) : null,
      shellReturnCode: Number.isInteger(source.shellReturnCode) ? source.shellReturnCode : null,
      shellLogId: source.shellLogId ? String(source.shellLogId) : null,
      shellLogBytes: Math.max(0, Number(source.shellLogBytes) || 0),
      shellError: source.shellError ? String(source.shellError) : null
    };
  }

  function publicDownloadState(tabId) {
    return normalizeDownloadState(downloadJobs.get(Number(tabId)), Number(tabId));
  }

  async function persistDownloadState(tabId) {
    const numericTabId = Number(tabId);
    const session = sessions.get(numericTabId);
    if (!session) return;
    session.downloadJob = publicDownloadState(numericTabId);
    await persistSession(session);
  }

  function jobExecutionConfig(job, fallbackConfig = null) {
    if (job?.configSnapshot) {
      return LocalActions.normalizeConfig(job.configSnapshot);
    }
    return LocalActions.normalizeConfig(fallbackConfig || LocalActions.defaultConfig());
  }

  function cleanDownloadFilename(value, fallback = "download.bin") {
    const raw = String(value || "").split(/[\\/]/).pop() || fallback;
    const cleaned = raw.replace(/[\u0000-\u001f<>:"|?*]/g, "_").trim();
    return cleaned && cleaned !== "." && cleaned !== ".." ? cleaned.slice(0, 220) : fallback;
  }

  function contentDispositionFilename(headers = []) {
    const header = headers.find((item) => String(item?.name || "").toLowerCase() === "content-disposition");
    const value = String(header?.value || "");
    const encoded = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(value);
    if (encoded) {
      try { return cleanDownloadFilename(decodeURIComponent(encoded[1].replace(/^"|"$/g, ""))); } catch (_error) { /* fall through */ }
    }
    const plain = /filename\s*=\s*(?:"([^"]+)"|([^;]+))/i.exec(value);
    return cleanDownloadFilename(plain?.[1] || plain?.[2] || "");
  }

  function responseLooksDownload(details) {
    const headers = Array.isArray(details?.responseHeaders) ? details.responseHeaders : [];
    const disposition = headers.find((item) => String(item?.name || "").toLowerCase() === "content-disposition");
    if (/\battachment\b/i.test(String(disposition?.value || ""))) return true;
    const contentType = String(headers.find((item) => String(item?.name || "").toLowerCase() === "content-type")?.value || "").toLowerCase();
    return /application\/(octet-stream|zip|x-zip|x-gzip|gzip|pdf|vnd\.|force-download)/.test(contentType);
  }

  function clearDownloadCaptureExpiryTimer(tabId) {
    const numericTabId = Number(tabId);
    const timer = downloadCaptureExpiryTimers.get(numericTabId);
    if (timer) {
      clearTimeout(timer);
      downloadCaptureExpiryTimers.delete(numericTabId);
    }
  }

  function clearDownloadRoutingKeys(job, extraKey = null) {
    if (extraKey !== null && extraKey !== undefined && extraKey !== "") {
      downloadMoveToTab.delete(extraKey);
      if (Number.isInteger(extraKey)) managedDownloadIds.delete(extraKey);
    }
    if (Number.isInteger(job?.downloadId)) {
      downloadMoveToTab.delete(job.downloadId);
      managedDownloadIds.delete(job.downloadId);
    }
    if (job?.moveId) {
      downloadMoveToTab.delete(job.moveId);
    }
  }

  function scheduleDownloadCaptureExpiry(capture) {
    const numericTabId = Number(capture?.tabId);
    const expiresAtMs = Number(capture?.expiresAtMs);
    if (!Number.isInteger(numericTabId) || !Number.isFinite(expiresAtMs)) return;
    clearDownloadCaptureExpiryTimer(numericTabId);
    const delayMs = Math.max(0, expiresAtMs - Date.now());
    const timer = setTimeout(() => {
      downloadCaptureExpiryTimers.delete(numericTabId);
      activeDownloadCapture(numericTabId);
    }, delayMs + 10);
    downloadCaptureExpiryTimers.set(numericTabId, timer);
  }

  function activeDownloadCapture(tabId) {
    const capture = downloadCaptures.get(Number(tabId));
    if (!capture) return null;
    if (Date.now() >= capture.expiresAtMs) {
      clearDownloadCaptureExpiryTimer(Number(tabId));
      downloadCaptures.delete(Number(tabId));
      const job = downloadJobs.get(Number(tabId));
      if (job?.status === "armed") {
        job.status = "expired";
        job.retryable = false;
        job.error = "No download was detected before the capture window expired.";
        job.completedAt = Settings.nowIso();
        void persistDownloadState(Number(tabId));
        void broadcast("download-capture-expired", Number(tabId));
      }
      return null;
    }
    return capture;
  }

  async function armDownloadCapture(tabId, metadata = {}) {
    const numericTabId = Number(tabId);
    const session = sessions.get(numericTabId);
    if (!session) throw new Error("This tab is not activated.");
    const localStore = await loadLocalActionStore();
    const resolution = sessionLocalActionResolution(session, localStore);
    const config = resolution.config;
    if (!config.download.enabled) {
      return { armed: false, reason: "disabled" };
    }
    const activeJob = downloadJobs.get(numericTabId);
    if (activeJob && ["armed", "downloading", "moving"].includes(activeJob.status)) {
      return {
        armed: false,
        blocked: true,
        reason: "download-active",
        status: activeJob.status,
        captureId: activeJob.captureId || null
      };
    }
    const captureId = `download-${tabId}-${crypto.randomUUID()}`;
    const seconds = config.download.captureWindowSeconds;
    const configSnapshot = LocalActions.createExecutionSnapshot(config);
    const capture = {
      captureId,
      tabId: Number(tabId),
      sessionToken: session.sessionToken,
      ruleId: metadata.ruleId || null,
      cycle: Number(metadata.cycle || 0),
      url: session.url,
      origin: (() => { try { return new URL(session.url).origin; } catch (_error) { return ""; } })(),
      localActionProfileId: session.localActionProfileId,
      localActionRevision: Number(session.localActionRevision || 0),
      localActionSource: resolution.source,
      localActionFingerprint: resolution.fingerprint,
      config: configSnapshot,
      armedAtMs: Date.now(),
      expiresAtMs: Date.now() + seconds * 1000,
      claimed: false
    };
    downloadCaptures.set(Number(tabId), capture);
    scheduleDownloadCaptureExpiry(capture);
    downloadJobs.set(Number(tabId), {
      ...emptyDownloadState(Number(tabId)),
      captureId,
      sessionToken: session.sessionToken,
      localActionProfileId: session.localActionProfileId,
      localActionRevision: Number(session.localActionRevision || 0),
      localActionSource: resolution.source,
      localActionFingerprint: resolution.fingerprint,
      configSnapshot,
      ruleId: capture.ruleId,
      cycle: capture.cycle,
      pageUrl: capture.url,
      pageOrigin: capture.origin,
      status: "armed",
      armedAt: Settings.nowIso(),
      expiresAt: new Date(capture.expiresAtMs).toISOString(),
      destinationDirectory: config.download.destinationDirectory,
      showCompletionDialog: config.download.showCompletionDialog,
      executeShellAfterMove: config.download.executeShellAfterMove,
      shellExecutionMode: config.download.shellExecutionMode,
      openShellLogAfterExecution: config.download.openShellLogAfterExecution
    });
    session.downloadJob = publicDownloadState(Number(tabId));
    appendLog(session, "debug", "download-capture-armed", "Managed download capture armed before target click.", {
      captureId,
      ruleId: capture.ruleId,
      cycle: capture.cycle,
      expiresAt: capture.expiresAtMs,
      destinationDirectory: config.download.destinationDirectory,
      localActionSource: resolution.source,
      localActionProfileId: session.localActionProfileId,
      localActionRevision: Number(session.localActionRevision || 0),
      localActionFingerprint: resolution.fingerprint
    });
    await persistSession(session);
    await broadcast("download-capture-armed", Number(tabId));
    return { armed: true, captureId, expiresAt: capture.expiresAtMs };
  }

  function captureForDownloadItem(item) {
    const captures = [...downloadCaptures.values()].filter((capture) => activeDownloadCapture(capture.tabId) && !capture.claimed);
    if (!captures.length) return null;
    const referrer = String(item?.referrer || "");
    const url = String(item?.url || "");
    const matching = captures.filter((capture) =>
      (capture.origin && (referrer.startsWith(capture.origin) || url.startsWith(capture.origin)))
    );
    if (matching.length === 1) {
      return matching[0];
    }
    if (matching.length > 1) {
      // downloads.onCreated does not expose the originating tab. When two
      // armed tabs share the same origin, guessing by recency could relocate
      // one tab's file with another tab's destination/shell snapshot. Fail
      // closed and let each capture expire independently instead.
      return null;
    }
    // Firefox download-manager fallback events do not expose a tabId. Falling
    // back is safe only when exactly one capture is armed globally; otherwise
    // attributing the file to the most recent tab could move it with another
    // tab's destination or shell settings.
    return captures.length === 1 ? captures[0] : null;
  }

  async function claimDownload(capture, item, source = "browser-download") {
    if (!capture || capture.claimed) return;
    capture.claimed = true;
    clearDownloadCaptureExpiryTimer(capture.tabId);
    downloadCaptures.delete(capture.tabId);
    const job = downloadJobs.get(capture.tabId) || emptyDownloadState(capture.tabId);
    Object.assign(job, {
      captureId: capture.captureId,
      status: "downloading",
      downloadId: item.id,
      sourceUrl: item.url || null,
      sourcePath: item.filename || null,
      filename: item.filename ? cleanDownloadFilename(item.filename) : null,
      sessionToken: capture.sessionToken,
      localActionProfileId: capture.localActionProfileId,
      localActionRevision: capture.localActionRevision,
      localActionSource: capture.localActionSource || null,
      localActionFingerprint: capture.localActionFingerprint || null,
      configSnapshot: LocalActions.normalizeExecutionSnapshot(capture.config),
      destinationDirectory: capture.config.download.destinationDirectory,
      showCompletionDialog: capture.config.download.showCompletionDialog,
      executeShellAfterMove: capture.config.download.executeShellAfterMove,
      shellExecutionMode: capture.config.download.shellExecutionMode,
      openShellLogAfterExecution: capture.config.download.openShellLogAfterExecution,
      retryable: false,
      recoveryNote: null,
      error: null
    });
    downloadJobs.set(capture.tabId, job);
    if (Number.isInteger(item.id)) downloadMoveToTab.set(item.id, capture.tabId);
    const session = sessions.get(capture.tabId);
    appendLog(session, "user", "download-captured", `Download captured (${source}).`, {
      captureId: capture.captureId, downloadId: item.id, url: item.url || null
    });
    if (session) {
      session.downloadJob = publicDownloadState(capture.tabId);
      await persistSession(session);
    }
    await broadcast("download-captured", capture.tabId);
  }

  function managedDownloadRequest(capture, url, filename, sourceItem = null) {
    const safeName = cleanDownloadFilename(filename || (() => {
      try { return new URL(url).pathname.split("/").pop(); } catch (_error) { return "download.bin"; }
    })());
    const request = {
      url,
      filename: `FirefoxChatImprover/${capture.captureId}/${safeName}`,
      saveAs: false,
      conflictAction: "uniquify"
    };
    const referrer = String(sourceItem?.referrer || "");
    if (/^https?:/i.test(String(url || "")) && /^https?:/i.test(referrer)) {
      request.headers = [{ name: "Referer", value: referrer }];
    }
    if (typeof sourceItem?.cookieStoreId === "string" && sourceItem.cookieStoreId) {
      request.cookieStoreId = sourceItem.cookieStoreId;
    }
    if (sourceItem?.incognito === true) {
      request.incognito = true;
    }
    return request;
  }

  function managedDownloadStartMatches(item) {
    const now = Date.now();
    const itemUrls = new Set([String(item?.url || ""), String(item?.finalUrl || "")].filter(Boolean));
    let matched = false;
    for (const [captureId, pending] of managedDownloadStarts.entries()) {
      if (!pending || now - Number(pending.startedAtMs || 0) > 30000) {
        managedDownloadStarts.delete(captureId);
        continue;
      }
      if (itemUrls.has(String(pending.url || ""))) matched = true;
    }
    return matched;
  }

  async function startManagedDownload(capture, url, filename, sourceItem = null) {
    if (!capture || capture.claimed) return;
    const captureId = String(capture.captureId || "");
    if (captureId) {
      managedDownloadStarts.set(captureId, {
        captureId,
        tabId: Number(capture.tabId),
        url: String(url || ""),
        startedAtMs: Date.now()
      });
    }
    try {
      const downloadId = await browser.downloads.download(
        managedDownloadRequest(capture, url, filename, sourceItem)
      );
      managedDownloadIds.add(downloadId);
      let claimedItem = { id: downloadId, url, filename: "" };
      try {
        const results = await browser.downloads.search({ id: downloadId });
        if (results[0]) claimedItem = results[0];
      } catch (_error) {
        // The download itself was already created. Keep the job correlated even
        // if Firefox cannot immediately return its metadata from downloads.search.
      }
      await claimDownload(capture, claimedItem, "managed-http-download");
    } finally {
      if (captureId) managedDownloadStarts.delete(captureId);
    }
  }

  async function cancelAndRestartCapturedDownload(capture, item) {
    if (!capture || capture.claimed || capture.intercepting) return;
    capture.intercepting = true;
    clearDownloadCaptureExpiryTimer(capture.tabId);
    downloadCaptures.delete(capture.tabId);
    const session = sessions.get(capture.tabId);
    const job = downloadJobs.get(capture.tabId) || emptyDownloadState(capture.tabId);
    Object.assign(job, {
      captureId: capture.captureId,
      sessionToken: capture.sessionToken,
      configSnapshot: LocalActions.normalizeExecutionSnapshot(capture.config),
      status: "downloading",
      sourceUrl: item?.finalUrl || item?.url || null,
      downloadId: null,
      error: null,
      retryable: false
    });
    downloadJobs.set(capture.tabId, job);
    appendLog(session, "debug", "download-fallback-restart", "Canceling the page-created download and restarting it with saveAs disabled.", {
      captureId: capture.captureId,
      originalDownloadId: item?.id,
      url: item?.finalUrl || item?.url || null
    });
    await persistDownloadState(capture.tabId);
    await broadcast("download-restarting", capture.tabId);

    try {
      if (Number.isInteger(item?.id)) {
        await browser.downloads.cancel(item.id).catch(() => undefined);
        await browser.downloads.erase({ id: item.id }).catch(() => undefined);
      }
      const url = String(item?.finalUrl || item?.url || "");
      if (!url) throw new Error("Firefox did not expose a URL for the page-created download.");
      await startManagedDownload(capture, url, cleanDownloadFilename(item?.filename || "download.bin"), item);
    } catch (error) {
      Object.assign(job, {
        status: "error",
        retryable: false,
        error: `The page-created download was canceled, but the managed no-dialog restart failed: ${error instanceof Error ? error.message : String(error)}`,
        completedAt: Settings.nowIso()
      });
      appendLog(session, "user", "download-restart-error", job.error, {
        captureId: capture.captureId,
        originalDownloadId: item?.id
      });
      await persistDownloadState(capture.tabId);
      await broadcast("download-capture-error", capture.tabId);
    }
  }

  async function moveCompletedDownload(tabId, downloadItem, options = {}) {
    const numericTabId = Number(tabId);
    const job = downloadJobs.get(numericTabId);
    if (!job || job.status === "moving" || (job.status === "completed" && !options.force)) return;
    const session = sessions.get(numericTabId);
    let fallbackConfig = null;
    if (!job.configSnapshot && session) {
      const localStore = await loadLocalActionStore();
      fallbackConfig = sessionLocalActionConfig(session, localStore);
    }
    const config = jobExecutionConfig(job, fallbackConfig);
    if (!config.download.enabled || !config.download.destinationDirectory.startsWith("/")) {
      job.status = "error";
      job.retryable = false;
      job.error = "The captured download job does not contain a valid absolute destination.";
      job.completedAt = Settings.nowIso();
      clearDownloadRoutingKeys(job, downloadItem?.id);
      await persistDownloadState(numericTabId);
      await broadcast("download-move-error", numericTabId);
      return;
    }
    const sourcePath = String(downloadItem?.filename || job.sourcePath || "");
    if (!sourcePath) {
      job.status = "error";
      job.retryable = false;
      job.error = "Firefox did not report the downloaded file path.";
      job.completedAt = Settings.nowIso();
      clearDownloadRoutingKeys(job, downloadItem?.id);
      await persistDownloadState(numericTabId);
      await broadcast("download-move-error", numericTabId);
      return;
    }
    const moveId = `move-${numericTabId}-${crypto.randomUUID()}`;
    job.status = "moving";
    job.sourcePath = sourcePath;
    job.filename = cleanDownloadFilename(sourcePath);
    job.destinationDirectory = config.download.destinationDirectory;
    job.moveId = moveId;
    job.moveAttempt = Math.max(0, Number(job.moveAttempt) || 0) + 1;
    job.moveRequestedAt = Settings.nowIso();
    job.retryable = false;
    job.destinationPath = null;
    job.size = null;
    job.completedAt = null;
    job.completionId = null;
    job.completionReason = options.retry ? "retry" : (options.recovery ? "recovery" : "initial");
    job.completionSurface = null;
    job.completionShownAt = null;
    job.recoveryNote = options.recovery ? "Resumed after background recovery." : (options.retry ? "Manual relocation retry using the currently saved destination." : null);
    job.error = null;
    downloadMoveToTab.set(moveId, numericTabId);
    appendLog(session, "debug", "download-move-request", "Native Host download relocation requested from the captured immutable local-action snapshot.", {
      moveId,
      sourcePath,
      destinationDirectory: config.download.destinationDirectory,
      localActionProfileId: job.localActionProfileId,
      localActionRevision: job.localActionRevision,
      localActionSource: job.localActionSource,
      localActionFingerprint: job.localActionFingerprint,
      moveAttempt: job.moveAttempt,
      nativeHostVersion: nativeState.hostVersion || null
    });
    await persistDownloadState(numericTabId);
    await broadcast("download-moving", numericTabId);
    try {
      // Correlate move success, validation errors and unsupported-host errors
      // with the same moveId. The previous fire-and-forget path could leave a
      // job in `moving` forever when the host returned an uncorrelated error.
      const response = await nativeRequest("move_download", {
        moveId,
        tabId: numericTabId,
        sourcePath,
        destinationDirectory: config.download.destinationDirectory,
        conflictAction: config.download.conflictAction
      }, 20000, moveId);
      // The Native Host listener normally consumes correlated move success
      // before resolving this request. Retain a guarded continuation for old
      // or unusual host response ordering without processing success twice.
      if (job.status !== "completed") {
        await handleNativeDownloadMessage(response);
      }
    } catch (error) {
      clearDownloadRoutingKeys(job, moveId);
      if (job.status === "completed") return;
      job.status = "error";
      job.error = error instanceof Error ? error.message : String(error);
      const missingStagingFile = /source file does not exist|downloaded source file does not exist/i.test(job.error);
      job.retryable = Boolean(job.sourcePath) && !missingStagingFile;
      if (missingStagingFile) {
        job.error += " The staging file is no longer available; trigger the target again to download a new file.";
      }
      if (/not supported/i.test(job.error)) {
        job.error += " Reinstall the Native Host from this add-on version, then retry relocation.";
      }
      job.completedAt = Settings.nowIso();
      appendLog(session, "user", "download-error", job.error, {
        moveId,
        sourcePath,
        destinationDirectory: config.download.destinationDirectory,
        nativeHostVersion: nativeState.hostVersion || null
      });
      if (session) {
        session.downloadJob = publicDownloadState(numericTabId);
        await persistSession(session);
      }
      await persistDownloadState(numericTabId);
      await broadcast("download-move-error", numericTabId);
    }
  }

  async function showDownloadCompletion(tabId, job, session) {
    if (!job?.showCompletionDialog || !session || Number(job.tabId) !== Number(session.tabId)) {
      job.completionSurface = null;
      return false;
    }
    const config = jobExecutionConfig(job);
    const shellReadiness = LocalActions.downloadShellReadiness(job);
    try {
      const response = await browser.tabs.sendMessage(Number(tabId), {
        type: MESSAGE.CONTENT_SHOW_DOWNLOAD_COMPLETION,
        payload: {
          captureId: job.captureId,
          completionId: job.completionId,
          destinationPath: job.destinationPath,
          filename: job.filename,
          size: job.size,
          retry: job.completionReason === "retry",
          shellAvailable: shellReadiness.ready,
          shellReady: shellReadiness.ready,
          shellReason: shellReadiness.reason,
          manualFallback: Boolean(shellReadiness.manualFallback),
          shellExecutionMode: job.shellExecutionMode,
          shellStatus: job.shellStatus,
          shellRunId: job.shellRunId,
          confirmBeforeRun: Boolean(config.shell.confirmBeforeRun)
        }
      });
      if (response?.ok && response?.shown) {
        job.completionSurface = "page";
        job.completionShownAt = Settings.nowIso();
        return true;
      }
    } catch (_error) {
      // A restricted, unloaded or navigated page may not have the content
      // runtime. The sidebar completion dialog remains the fallback.
    }
    job.completionSurface = "sidebar";
    return false;
  }

  function downloadShellEnvironment(job) {
    return {
      FCI_DOWNLOAD_PATH: String(job.destinationPath || ""),
      FCI_DOWNLOAD_DIRECTORY: String(job.destinationDirectory || ""),
      FCI_DOWNLOAD_FILENAME: String(job.filename || ""),
      FCI_DOWNLOAD_SOURCE_URL: String(job.sourceUrl || ""),
      FCI_DOWNLOAD_CAPTURE_ID: String(job.captureId || ""),
      FCI_DOWNLOAD_TAB_ID: String(job.tabId),
      FCI_LOCAL_ACTION_PROFILE_ID: String(job.localActionProfileId || "")
    };
  }

  async function startDownloadShellForJob(job, session, trigger) {
    if (!job || !session || job.status !== "completed") {
      throw new Error("The managed download has not completed successfully.");
    }
    if (Number(job.tabId) !== Number(session.tabId)) {
      throw new Error("The completed download belongs to a different browser tab.");
    }
    if (job.shellExecutionMode === "disabled") {
      throw new Error("Shell execution is disabled for this managed download.");
    }
    if (["starting", "running", "stopping"].includes(job.shellStatus)) {
      throw new Error("The download shell command is already running.");
    }
    if (job.shellRunId && ["completed", "error"].includes(job.shellStatus)) {
      throw new Error("The download shell command has already been executed. Use the Shell command group to run it again explicitly.");
    }
    const config = jobExecutionConfig(job);
    const shell = validateShellPayload({
      tabId: job.tabId,
      cwd: config.shell.workingDirectory,
      command: config.shell.command,
      mode: "background"
    }, { ...config, shell: { ...config.shell, mode: "background" } });
    job.shellStatus = "starting";
    job.shellError = null;
    job.shellReturnCode = null;
    job.shellStartedAt = Settings.nowIso();
    job.shellCompletedAt = null;
    let run;
    try {
      run = await startShellRunForSession(session, config, { ...shell, mode: "background" }, {
        source: "download",
        trigger,
        captureId: job.captureId,
        downloadPath: job.destinationPath,
        environment: downloadShellEnvironment(job)
      });
    } catch (error) {
      const failedRun = shellRunForTab(job.tabId);
      if (failedRun?.source === "download" && failedRun.captureId === job.captureId) {
        job.shellRunId = failedRun.runId || null;
        job.shellLogId = failedRun.logId || null;
        job.shellLogBytes = Math.max(0, Number(failedRun.logBytes) || 0);
      }
      job.shellStatus = "error";
      job.shellError = error instanceof Error ? error.message : String(error);
      job.shellCompletedAt = Settings.nowIso();
      await persistDownloadState(job.tabId);
      await broadcast("download-shell-error", job.tabId);
      throw error;
    }
    job.shellRunId = run.runId;
    job.shellStatus = run.status === "exited"
      ? (Number(run.returnCode || 0) === 0 ? "completed" : "error")
      : (run.status === "error" ? "error" : run.status);
    job.shellReturnCode = Number.isInteger(run.returnCode) ? run.returnCode : null;
    job.shellLogId = run.logId || null;
    job.shellLogBytes = Math.max(0, Number(run.logBytes) || 0);
    job.shellError = run.error || (job.shellStatus === "error" && Number.isInteger(run.returnCode) ? `Command exited with code ${run.returnCode}.` : null);
    if (["completed", "error"].includes(job.shellStatus)) job.shellCompletedAt = run.endedAt || Settings.nowIso();
    await persistDownloadState(job.tabId);
    await broadcast("download-shell-starting", job.tabId);
    return run;
  }

  async function runCompletedDownloadShell(message, sender) {
    let tabId;
    if (Number.isInteger(sender?.tab?.id)) {
      tabId = Number(sender.tab.id);
    } else {
      assertSidebarSender(sender);
      tabId = Number(message?.tabId);
    }
    if (!Number.isInteger(tabId)) {
      throw new Error("The completed-download shell action must identify the original tab.");
    }
    const session = sessions.get(tabId);
    const job = downloadJobs.get(tabId);
    const captureId = String(message?.payload?.captureId || message?.captureId || "");
    if (!session || !job || job.status !== "completed" || !captureId || job.captureId !== captureId) {
      throw new Error("This completed download is no longer available for shell execution.");
    }
    const config = jobExecutionConfig(job);
    if (config.shell.confirmBeforeRun && message?.payload?.confirmed !== true && message?.confirmed !== true) {
      throw new Error("Shell execution confirmation is required.");
    }
    return startDownloadShellForJob(job, session, "download-completion-manual");
  }

  async function handleNativeDownloadMessage(message) {
    const moveId = String(message?.moveId || message?.requestId || "");
    let tabId = Number(message?.tabId ?? downloadMoveToTab.get(moveId));
    if (!Number.isInteger(tabId) && moveId) {
      for (const [candidateTabId, candidateJob] of downloadJobs.entries()) {
        if (String(candidateJob?.moveId || "") === moveId) {
          tabId = Number(candidateTabId);
          break;
        }
      }
    }
    if (!Number.isInteger(tabId)) return;
    const job = downloadJobs.get(tabId);
    if (!job) {
      if (moveId) downloadMoveToTab.delete(moveId);
      return;
    }
    // A delayed response from an older relocation must never mutate the
    // current job merely because the Native Host still reports the same tab.
    // Correlation is owned by the immutable moveId, not by tabId alone.
    if (!moveId || String(job.moveId || "") !== moveId) {
      if (moveId) downloadMoveToTab.delete(moveId);
      return;
    }
    const session = sessions.get(tabId);
    if (message.event === "download_moved") {
      const verifiedDestinationPath = String(message.destinationPath || message.path || message.targetPath || "").trim();
      if (!verifiedDestinationPath.startsWith("/")) {
        throw new Error("The Native Host reported success without a valid absolute destination path.");
      }
      if (job.status === "completed" && job.moveId === moveId && job.destinationPath === verifiedDestinationPath) {
        downloadMoveToTab.delete(moveId);
        return;
      }
      appendLog(session, "debug", "download-move-response", "Correlated Native Host relocation success was consumed by the download state machine.", {
        moveId,
        requestId: message?.requestId || null,
        destinationPath: verifiedDestinationPath,
        nativeHostVersion: nativeState.hostVersion || null
      });
      Object.assign(job, {
        status: "completed",
        destinationPath: verifiedDestinationPath,
        filename: String(message.filename || job.filename || ""),
        size: Math.max(0, Number(message.size || 0)),
        completedAt: Settings.nowIso(),
        completionId: String(message.moveId || job.moveId || crypto.randomUUID()),
        retryable: false,
        recoveryNote: null,
        error: null
      });
      appendLog(session, "user", "download-completed", `Downloaded file moved to ${job.destinationPath}.`, {
        destinationPath: job.destinationPath, size: job.size
      });
      clearDownloadRoutingKeys(job, moveId);
      if (Number.isInteger(job.downloadId)) {
        void browser.downloads.erase({ id: job.downloadId }).catch(() => []);
      }
      if (session) {
        session.downloadJob = publicDownloadState(tabId);
        await persistSession(session);
      }
      if (session) {
        // Same-tab navigation may replace the content runtime token while the
        // Native Host is moving the file. Rebind only runtime ownership; the
        // captured local-action snapshot remains immutable.
        job.sessionToken = session.sessionToken;
        const localConfig = jobExecutionConfig(job);
        job.shellExecutionMode = localConfig.download.shellExecutionMode;
        job.openShellLogAfterExecution = localConfig.download.openShellLogAfterExecution;
        job.shellStatus = job.shellExecutionMode === "disabled" ? "disabled" : "available";
        job.shellError = null;
        session.downloadJob = publicDownloadState(tabId);
        await persistSession(session);
        await persistDownloadState(tabId);
        await broadcast("download-shell-available", tabId);
        if (job.shellExecutionMode === "automatic") {
          try {
            await startDownloadShellForJob(job, session, "download-moved-automatic");
          } catch (error) {
            job.shellStatus = "error";
            job.shellError = error instanceof Error ? error.message : String(error);
            job.shellCompletedAt = Settings.nowIso();
            appendLog(session, "user", "download-command-error", job.shellError, {
              captureId: job.captureId,
              manualFallback: !job.shellRunId
            });
            session.downloadJob = publicDownloadState(tabId);
            await persistSession(session);
            await persistDownloadState(tabId);
            await broadcast("download-shell-fallback-available", tabId);
          }
        }
      }
      await showDownloadCompletion(tabId, job, session);
      if (session) {
        session.downloadJob = publicDownloadState(tabId);
        await persistSession(session);
      }
      await persistDownloadState(tabId);
      await broadcast("download-completed", tabId);
      return;
    }
    Object.assign(job, {
      status: "error",
      retryable: Boolean(job.sourcePath),
      error: String(message?.error || "The Native Host could not move the downloaded file."),
      completedAt: Settings.nowIso()
    });
    appendLog(session, "user", "download-error", job.error, { moveId });
    clearDownloadRoutingKeys(job, moveId);
    if (session) {
      session.downloadJob = publicDownloadState(tabId);
      await persistSession(session);
    }
    await broadcast("download-move-error", tabId);
  }

  function interceptDownloadResponse(details) {
    const capture = activeDownloadCapture(Number(details?.tabId));
    if (!capture || capture.claimed || capture.intercepting || !responseLooksDownload(details)) {
      return {};
    }
    if (String(details.method || "GET").toUpperCase() !== "GET") {
      return {};
    }
    capture.intercepting = true;
    clearDownloadCaptureExpiryTimer(capture.tabId);
    downloadCaptures.delete(capture.tabId);
    const job = downloadJobs.get(capture.tabId) || emptyDownloadState(capture.tabId);
    Object.assign(job, {
      captureId: capture.captureId,
      status: "downloading",
      sourceUrl: String(details.url || "") || null,
      downloadId: null,
      error: null,
      retryable: false
    });
    downloadJobs.set(capture.tabId, job);
    // The response has already been positively identified as a download and
    // the page request is about to be cancelled. Show DL immediately instead
    // of leaving the header in CK while Firefox creates the managed restart.
    void persistDownloadState(capture.tabId);
    void broadcast("download-restarting", capture.tabId);
    const filename = contentDispositionFilename(details.responseHeaders) || "download.bin";
    void startManagedDownload(capture, details.url, filename).catch(async (error) => {
      const job = downloadJobs.get(capture.tabId) || emptyDownloadState(capture.tabId);
      Object.assign(job, {
        captureId: capture.captureId,
        status: "error",
        retryable: false,
        error: error instanceof Error ? error.message : String(error),
        completedAt: Settings.nowIso()
      });
      downloadJobs.set(capture.tabId, job);
      await persistDownloadState(capture.tabId);
      await broadcast("download-capture-error", capture.tabId);
    });
    return { cancel: true };
  }

  async function onBrowserDownloadCreated(item) {
    if (managedDownloadIds.has(item.id) || item?.byExtensionId === browser.runtime.id) return;
    // downloads.onCreated may be delivered before browser.downloads.download()
    // resolves with its ID. During that short interval another armed tab on
    // the same origin must not claim the extension-created replacement.
    // Failing closed for the exact in-flight URL is safer than relocating a
    // file with another tab's destination/shell snapshot.
    if (managedDownloadStartMatches(item)) return;
    const capture = captureForDownloadItem(item);
    if (!capture) return;
    await cancelAndRestartCapturedDownload(capture, item);
  }

  async function onBrowserDownloadChanged(delta) {
    const tabId = downloadMoveToTab.get(delta.id);
    if (!Number.isInteger(tabId)) {
      if (delta.error?.current || delta.state?.current === "complete") {
        managedDownloadIds.delete(delta.id);
      }
      return;
    }
    const job = downloadJobs.get(tabId);
    if (!job) {
      downloadMoveToTab.delete(delta.id);
      managedDownloadIds.delete(delta.id);
      return;
    }
    // A late browser event from a superseded download must not mutate the
    // current tab job. Browser download ownership is correlated by downloadId.
    if (!Number.isInteger(job.downloadId) || job.downloadId !== delta.id) {
      downloadMoveToTab.delete(delta.id);
      managedDownloadIds.delete(delta.id);
      return;
    }
    // Once relocation starts the browser download is already terminal; any
    // later Firefox download-manager notification is stale for this state.
    if (job.status === "moving") return;
    if (job.status !== "downloading") {
      clearDownloadRoutingKeys(job, delta.id);
      return;
    }
    if (delta.filename?.current) {
      job.sourcePath = delta.filename.current;
      job.filename = cleanDownloadFilename(delta.filename.current);
    }
    if (delta.error?.current) {
      job.status = "error";
      job.retryable = false;
      job.error = String(delta.error.current);
      job.completedAt = Settings.nowIso();
      clearDownloadRoutingKeys(job, delta.id);
      await persistDownloadState(tabId);
      await broadcast("download-error", tabId);
      return;
    }
    if (delta.state?.current !== "complete") return;
    let results = [];
    try {
      results = await browser.downloads.search({ id: delta.id });
    } catch (_error) {
      // Completion itself is authoritative. If Firefox temporarily cannot
      // search its download database, continue with the path captured from
      // earlier onChanged/onCreated metadata instead of leaving DL stuck.
    }
    await moveCompletedDownload(tabId, results[0] || { id: delta.id, filename: job.sourcePath });
  }

  async function retryDownloadMove(message, sender) {
    assertSidebarSender(sender);
    const tabId = Number(message.tabId);
    const session = sessions.get(tabId);
    const job = downloadJobs.get(tabId);
    if (!session || !job) {
      throw new Error("This tab has no managed download job to retry.");
    }
    if (job.status !== "error" || !job.retryable || !job.sourcePath) {
      throw new Error("The managed download relocation is not retryable. Trigger the target again to create a new download.");
    }
    const localStore = await loadLocalActionStore();
    const currentConfig = sessionLocalActionConfig(session, localStore);
    if (!currentConfig.download.enabled || !currentConfig.download.destinationDirectory.startsWith("/")) {
      throw new Error("Save a valid absolute Managed download destination before retrying the move.");
    }
    const capturedConfig = jobExecutionConfig(job, currentConfig);
    job.configSnapshot = LocalActions.createExecutionSnapshot({
      ...capturedConfig,
      download: {
        ...capturedConfig.download,
        enabled: true,
        destinationDirectory: currentConfig.download.destinationDirectory,
        conflictAction: currentConfig.download.conflictAction,
        showCompletionDialog: currentConfig.download.showCompletionDialog
      }
    });
    job.destinationDirectory = currentConfig.download.destinationDirectory;
    job.showCompletionDialog = currentConfig.download.showCompletionDialog;
    job.destinationPath = null;
    job.completionId = null;
    job.completionSurface = null;
    job.completionShownAt = null;
    appendLog(session, "debug", "download-retry-request", "Retry relocation uses the currently saved destination and the existing staging file; it does not download the URL again.", {
      captureId: job.captureId,
      sourcePath: job.sourcePath,
      destinationDirectory: currentConfig.download.destinationDirectory,
      previousDestinationDirectory: capturedConfig.download.destinationDirectory
    });
    await persistDownloadState(tabId);
    await moveCompletedDownload(tabId, { id: job.downloadId, filename: job.sourcePath }, { retry: true, force: true });
    const result = publicDownloadState(tabId);
    if (result.status !== "completed") {
      throw new Error(result.error || "The relocation retry did not complete.");
    }
    return result;
  }

  function restoreArmedDownloadCapture(session, job) {
    const tabId = Number(session?.tabId);
    clearDownloadCaptureExpiryTimer(tabId);
    downloadCaptures.delete(tabId);
    const expiresAtMs = Date.parse(String(job.expiresAt || ""));
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      job.status = "expired";
      job.retryable = false;
      job.error = "The restored download capture window expired before Firefox could resume it.";
      job.completedAt = Settings.nowIso();
      return false;
    }
    const config = jobExecutionConfig(job);
    if (!job.captureId || !config.download.enabled) {
      job.status = "error";
      job.retryable = false;
      job.error = "The persisted download capture is incomplete and cannot be restored safely.";
      job.completedAt = Settings.nowIso();
      return false;
    }
    const pageUrl = String(job.pageUrl || session.url || "");
    let origin = String(job.pageOrigin || "");
    if (!origin) {
      try { origin = new URL(pageUrl).origin; } catch (_error) { origin = ""; }
    }
    const restoredCapture = {
      captureId: job.captureId,
      tabId: Number(session.tabId),
      sessionToken: session.sessionToken,
      ruleId: job.ruleId || null,
      cycle: Math.max(0, Number(job.cycle) || 0),
      url: pageUrl,
      origin,
      localActionProfileId: job.localActionProfileId,
      localActionRevision: job.localActionRevision,
      localActionSource: job.localActionSource || null,
      localActionFingerprint: job.localActionFingerprint || null,
      config: LocalActions.createExecutionSnapshot(config),
      armedAtMs: Date.parse(String(job.armedAt || "")) || Date.now(),
      expiresAtMs,
      claimed: false,
      restored: true
    };
    downloadCaptures.set(Number(session.tabId), restoredCapture);
    scheduleDownloadCaptureExpiry(restoredCapture);
    job.sessionToken = session.sessionToken;
    job.recoveryNote = "The managed download capture was restored after background restart.";
    job.error = null;
    return true;
  }

  async function resumeInterruptedDownloadMove(session, job) {
    const tabId = Number(session.tabId);
    if (!job.moveId || !job.sourcePath || !job.destinationDirectory) {
      clearDownloadRoutingKeys(job, job.moveId);
      job.status = "error";
      job.retryable = Boolean(job.sourcePath);
      job.error = "The interrupted relocation is missing persisted transaction fields.";
      job.completedAt = Settings.nowIso();
      return false;
    }
    job.recoveryAttempts = Math.max(0, Number(job.recoveryAttempts) || 0) + 1;
    job.recoveryNote = "Replaying the persisted moveId through the Native Host idempotency receipt.";
    appendLog(session, "debug", "download-move-recovery-request", "Resuming interrupted relocation with the original moveId.", {
      moveId: job.moveId,
      sourcePath: job.sourcePath,
      destinationDirectory: job.destinationDirectory,
      recoveryAttempt: job.recoveryAttempts
    });
    downloadMoveToTab.set(job.moveId, tabId);
    try {
      const config = jobExecutionConfig(job);
      const response = await nativeRequest("move_download", {
        moveId: job.moveId,
        tabId,
        sourcePath: job.sourcePath,
        destinationDirectory: job.destinationDirectory,
        conflictAction: config.download.conflictAction
      }, 20000, job.moveId);
      if (job.status !== "completed") await handleNativeDownloadMessage(response);
      job.moveRecoveredAt = Settings.nowIso();
      return job.status === "completed";
    } catch (error) {
      clearDownloadRoutingKeys(job, job.moveId);
      job.status = "error";
      job.error = `Automatic relocation recovery failed: ${error instanceof Error ? error.message : String(error)}`;
      job.retryable = Boolean(job.sourcePath) && !/source.*does not exist|neither the relocation source/i.test(job.error);
      job.completedAt = Settings.nowIso();
      job.recoveryNote = "Install Native Host 0.11.0 or newer for idempotent relocation recovery; manual retry remains available when the staging file exists.";
      appendLog(session, "user", "download-move-recovery-error", job.error, { moveId: job.moveId });
      return false;
    }
  }

  function ownedShellRunId(session, run, runId) {
    if (!runId) return false;
    if (run?.runId === runId) return true;
    return Array.isArray(session?.shellHistory) && session.shellHistory.some((entry) => entry.runId === runId);
  }

  async function resolveLegacyShellLog(session, runId) {
    const normalizedRunId = String(runId || "");
    if (!session || !ownedShellRunId(session, shellRunForTab(session.tabId), normalizedRunId)) return null;
    let resolved;
    try {
      resolved = await nativeRequest("resolve_log", { runId: normalizedRunId });
    } catch (_error) {
      return null;
    }
    if (!resolved?.exists || !resolved.logId) return null;
    const logId = String(resolved.logId);
    const logBytes = Math.max(0, Number(resolved.logBytes) || 0);
    const run = shellRunForTab(session.tabId);
    if (run.runId === normalizedRunId) {
      run.logId = logId;
      run.logBytes = logBytes;
    }
    session.shellHistory = normalizeShellHistory(session.shellHistory, 100).map((entry) =>
      entry.runId === normalizedRunId ? { ...entry, logId, logBytes } : entry
    );
    const notice = normalizeShellNotice(session.shellNotice, session.tabId);
    if (notice.runId === normalizedRunId) {
      session.shellNotice = normalizeShellNotice({ ...notice, logId, logBytes }, session.tabId);
    }
    await persistSession(session);
    return { logId, logBytes };
  }

  async function recoverLegacyShellLogs(session) {
    const runIds = new Set();
    const notice = normalizeShellNotice(session.shellNotice, session.tabId);
    if (notice.runId && !notice.logId) runIds.add(notice.runId);
    for (const entry of normalizeShellHistory(session.shellHistory, 100)) {
      if (entry.runId && !entry.logId) runIds.add(entry.runId);
    }
    for (const runId of [...runIds].slice(0, 20)) {
      await resolveLegacyShellLog(session, runId);
    }
  }

  async function recoverDownloadJob(session) {
    const tabId = Number(session?.tabId);
    if (!Number.isInteger(tabId) || !session?.downloadJob) return;
    const storedJob = normalizeDownloadState(session.downloadJob, tabId);
    const inMemoryJob = downloadJobs.get(tabId);
    const sameCapture = Boolean(inMemoryJob?.captureId && inMemoryJob.captureId === storedJob.captureId);
    // In-memory state is authoritative for the same capture during navigation.
    // This includes terminal error/expired states: an older persisted
    // `downloading` snapshot must never resurrect a job that already failed or
    // expired while persistSession() was still in flight. Background-start
    // recovery still uses storedJob because there is no in-memory job yet.
    const job = sameCapture ? inMemoryJob : storedJob;
    if (session.sessionToken) job.sessionToken = session.sessionToken;
    downloadJobs.set(tabId, job);
    if (job.status === "armed") {
      restoreArmedDownloadCapture(session, job);
    } else if (job.status === "moving") {
      await resumeInterruptedDownloadMove(session, job);
      if (job.status === "completed") return;
    } else if (job.status === "downloading" && !Number.isInteger(job.downloadId)) {
      job.status = "error";
      job.retryable = false;
      job.error = "The persisted active download is missing its Firefox download ID. Trigger the target again to create a new download.";
      job.completedAt = Settings.nowIso();
      clearDownloadRoutingKeys(job);
    } else if (job.status === "downloading" && Number.isInteger(job.downloadId)) {
      downloadMoveToTab.set(job.downloadId, tabId);
      managedDownloadIds.add(job.downloadId);
      let results;
      try {
        results = await browser.downloads.search({ id: job.downloadId });
      } catch (error) {
        job.status = "error";
        job.retryable = false;
        job.error = `Firefox could not restore the active browser download: ${error instanceof Error ? error.message : String(error)}`;
        job.completedAt = Settings.nowIso();
        clearDownloadRoutingKeys(job, job.downloadId);
        results = [];
      }
      const item = results[0];
      if (job.status === "downloading" && item?.state === "complete") {
        await moveCompletedDownload(tabId, item, { recovery: true, force: true });
        return;
      }
      if (job.status === "downloading" && item?.state === "interrupted") {
        job.status = "error";
        job.retryable = false;
        job.error = item.error || "The browser download was interrupted.";
        job.completedAt = Settings.nowIso();
        clearDownloadRoutingKeys(job, job.downloadId);
      } else if (job.status === "downloading" && !item) {
        job.status = "error";
        job.retryable = false;
        job.error = "Firefox no longer has the active browser download that was persisted for this tab. Trigger the target again to create a new download.";
        job.completedAt = Settings.nowIso();
        clearDownloadRoutingKeys(job, job.downloadId);
      }
    } else {
      clearDownloadRoutingKeys(job);
    }
    session.downloadJob = publicDownloadState(tabId);
    await persistSession(session);
  }

  function nativeLogRetentionPolicy(store) {
    return Settings.normalizeNativeLogRetention(store?.nativeLogRetention);
  }

  function protectedShellLogIds() {
    const protectedIds = new Set();
    for (const run of shellRuns.values()) {
      if (run?.logId && ["starting", "running", "terminal", "stopping"].includes(run.status)) {
        protectedIds.add(String(run.logId));
      }
    }
    for (const session of sessions.values()) {
      const notice = normalizeShellNotice(session.shellNotice, session.tabId);
      if (notice.status === "unread" && notice.logId) protectedIds.add(String(notice.logId));
    }
    return [...protectedIds].sort();
  }

  async function clearDeletedShellLogReferences(deletedLogIds) {
    const deleted = new Set((Array.isArray(deletedLogIds) ? deletedLogIds : []).map(String));
    if (!deleted.size) return;
    for (const run of shellRuns.values()) {
      if (run.logId && deleted.has(String(run.logId))) {
        run.logId = null;
        run.logBytes = 0;
      }
    }
    for (const session of sessions.values()) {
      let changed = false;
      if (Array.isArray(session.shellHistory)) {
        session.shellHistory = session.shellHistory.map((entry) => {
          if (!entry?.logId || !deleted.has(String(entry.logId))) return entry;
          changed = true;
          return { ...entry, logId: null, logBytes: 0, logRetentionExpired: true };
        });
      }
      const notice = normalizeShellNotice(session.shellNotice, session.tabId);
      if (notice.logId && deleted.has(String(notice.logId))) {
        session.shellNotice = normalizeShellNotice({ ...notice, logId: null, logBytes: 0 }, session.tabId);
        changed = true;
      }
      const job = downloadJobs.get(session.tabId);
      if (job?.shellLogId && deleted.has(String(job.shellLogId))) {
        job.shellLogId = null;
        job.shellLogBytes = 0;
        job.shellLogRetentionExpired = true;
        changed = true;
      }
      if (changed) await persistSession(session);
    }
  }

  async function runNativeLogCleanup(reason = "manual", { force = false, dryRun = false } = {}) {
    if (nativeLogCleanupRunning) throw new Error("Native log cleanup is already running.");
    const store = await loadStore();
    const policy = nativeLogRetentionPolicy(store);
    if (!force && !policy.enabled) {
      return { skipped: true, reason: "disabled", policy };
    }
    nativeLogCleanupRunning = true;
    nativeLogCleanupState = { ...nativeLogCleanupState, lastReason: reason, lastError: null };
    try {
      const result = await nativeRequest("cleanup_logs", {
        maxAgeDays: policy.maxAgeDays,
        maxFiles: policy.maxFiles,
        maxTotalBytes: policy.maxTotalMiB * 1024 * 1024,
        protectedLogIds: protectedShellLogIds(),
        dryRun
      }, 30000);
      nativeLogCleanupState = {
        lastCleanupAt: Settings.nowIso(),
        lastReason: reason,
        lastResult: clone(result),
        lastError: null
      };
      if (result?.logStore) nativeState.logStore = clone(result.logStore);
      if (!dryRun) await clearDeletedShellLogReferences(result?.deletedLogIds);
      await broadcast("native-log-cleanup");
      return result;
    } catch (error) {
      nativeLogCleanupState = {
        ...nativeLogCleanupState,
        lastCleanupAt: Settings.nowIso(),
        lastReason: reason,
        lastError: error instanceof Error ? error.message : String(error)
      };
      await broadcast("native-log-cleanup-error");
      throw error;
    } finally {
      nativeLogCleanupRunning = false;
    }
  }

  function scheduleNativeLogCleanup(reason, delayMs = 1200) {
    if (nativeLogCleanupTimer) clearTimeout(nativeLogCleanupTimer);
    nativeLogCleanupTimer = setTimeout(() => {
      nativeLogCleanupTimer = null;
      void loadStore().then((store) => {
        const policy = nativeLogRetentionPolicy(store);
        const allowed = reason === "startup" ? policy.runOnStartup : policy.runAfterCommand;
        if (!policy.enabled || !allowed) return null;
        return runNativeLogCleanup(reason);
      }).catch(() => {
        // Cleanup availability is reflected in the dashboard; startup remains non-fatal.
      });
    }, Math.max(0, Number(delayMs) || 0));
  }

  async function saveNativeLogRetention(rawPolicy) {
    const store = await loadStore();
    const policy = Settings.normalizeNativeLogRetention(rawPolicy);
    const saved = await saveStore({
      ...store,
      revision: Number(store.revision || 0) + 1,
      nativeLogRetention: policy
    });
    nativeLogCleanupState = { ...nativeLogCleanupState, lastError: null };
    await broadcast("native-log-retention-saved");
    return saved.nativeLogRetention;
  }

  function nativeDashboardState() {
    return {
      ...clone(nativeState),
      runs: [...shellRuns.values()].map((run) => clone(run)),
      downloads: [...downloadJobs.values()].map((job) => clone(job)),
      logCleanup: clone(nativeLogCleanupState)
    };
  }

  function scheduleShellBroadcast(tabId) {
    if (shellBroadcastTimers.has(tabId)) {
      return;
    }
    const timer = setTimeout(() => {
      shellBroadcastTimers.delete(tabId);
      void broadcast("native-shell-output", tabId);
    }, 120);
    shellBroadcastTimers.set(tabId, timer);
  }

  function nativeRequest(action, payload = {}, timeoutMs = 15000, requestIdOverride = null) {
    const requestId = String(requestIdOverride || crypto.randomUUID());
    const port = ensureNativePort();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingNativeRequests.delete(requestId);
        reject(new Error(`Native Host request timed out after ${timeoutMs}ms: ${action}`));
      }, timeoutMs);
      pendingNativeRequests.set(requestId, { resolve, reject, timer, action });
      try {
        port.postMessage({ action, requestId, ...payload });
      } catch (error) {
        clearTimeout(timer);
        pendingNativeRequests.delete(requestId);
        const message = error instanceof Error ? error.message : String(error);
        void handleNativeDisconnect(port, message);
        reject(error);
      }
    });
  }

  function disconnectNativePort() {
    if (!nativePort) {
      return;
    }
    const port = nativePort;
    nativePort = null;
    try {
      port.disconnect();
    } catch (_error) {
      // Port may already be disconnected.
    }
  }

  async function handleNativeMessage(message) {
    nativeState.connected = true;
    nativeState.lastSeenAt = Settings.nowIso();
    nativeState.lastError = null;
    if (message?.hostName) {
      nativeState.hostName = message.hostName;
    }
    if (message?.hostVersion) {
      nativeState.hostVersion = message.hostVersion;
    }
    if (message?.logStore && typeof message.logStore === "object") {
      nativeState.logStore = clone(message.logStore);
    }

    const event = String(message?.event || "");
    const requestId = String(message?.requestId || message?.moveId || "");
    if (requestId && pendingNativeRequests.has(requestId)) {
      const pending = pendingNativeRequests.get(requestId);
      pendingNativeRequests.delete(requestId);
      clearTimeout(pending.timer);
      const destinationPath = String(message?.destinationPath || message?.path || message?.targetPath || "").trim();
      const correlatedMessage = pending.action === "move_download" && event !== "error" && event !== "fatal"
        ? {
            ...message,
            event: event || (destinationPath.startsWith("/") ? "download_moved" : event),
            requestId: message?.requestId || requestId,
            moveId: message?.moveId || requestId,
            destinationPath
          }
        : message;
      if (event === "error" || event === "fatal") {
        pending.reject(new Error(String(message.error || "The Native Host request failed.")));
      } else {
        if (pending.action === "move_download") {
          await handleNativeDownloadMessage(correlatedMessage);
        }
        pending.resolve(clone(correlatedMessage));
      }
      return;
    }
    if (event === "hello" || event === "status") {
      await broadcast("native-status");
      return;
    }

    if (event === "download_moved" || (event === "error" && message?.moveId)) {
      await handleNativeDownloadMessage(message);
      return;
    }

    const tabId = Number(message?.tabId ?? runToTab.get(String(message?.runId || "")));
    if (!Number.isInteger(tabId)) {
      await broadcast("native-event");
      return;
    }
    const run = shellRunForTab(tabId);
    if (message?.runId && run.runId && message.runId !== run.runId) {
      return;
    }
    if (message?.logId) run.logId = String(message.logId);
    if (Number.isFinite(Number(message?.logBytes))) run.logBytes = Math.max(0, Number(message.logBytes));

    if (event === "started") {
      run.status = message.mode === "terminal" ? "terminal" : "running";
      run.pid = Number.isInteger(message.pid) ? message.pid : null;
      run.startedAt = run.startedAt || Settings.nowIso();
      run.error = null;
      appendShellOutput(run, "system", `[started] pid=${run.pid ?? "—"} mode=${message.mode || run.mode}\n`);
    } else if (event === "output") {
      appendShellOutput(run, message.stream === "stderr" ? "stderr" : "stdout", message.text);
    } else if (event === "stopping") {
      run.status = "stopping";
      appendShellOutput(run, "system", "[stopping] SIGTERM sent.\n");
    } else if (event === "killed") {
      appendShellOutput(run, "system", "[killed] The process did not stop in time and received SIGKILL.\n");
    } else if (event === "exited") {
      run.status = "exited";
      run.returnCode = Number.isInteger(message.returnCode) ? message.returnCode : null;
      run.stopped = Boolean(message.stopped);
      run.endedAt = Settings.nowIso();
      appendShellOutput(run, "system", `[exited] returnCode=${run.returnCode ?? "—"}${run.stopped ? " stopped=true" : ""}\n`);
      if (run.runId) {
        runToTab.delete(run.runId);
      }
    } else if (event === "error") {
      run.status = "error";
      run.error = String(message.error || "The Native Host reported an unknown error.");
      run.endedAt = Settings.nowIso();
      appendShellOutput(run, "stderr", `[error] ${run.error}\n`);
      if (run.runId) {
        runToTab.delete(run.runId);
      }
    } else if (event === "fatal") {
      nativeState.lastError = String(message.error || "Native host fatal error.");
    }

    if (event === "output") {
      scheduleShellBroadcast(tabId);
      return;
    }

    const session = sessions.get(tabId);
    if (session && ["started", "stopping", "exited", "error"].includes(event)) {
      appendLog(
        session,
        event === "error" ? "user" : "debug",
        `shell-${event}`,
        event === "error" ? run.error : `Shell ${event}: ${run.command}`,
        { runId: run.runId, pid: run.pid, returnCode: run.returnCode }
      );
      const localStore = await loadLocalActionStore();
      syncShellHistory(session, run, sessionLocalActionConfig(session, localStore));
      syncShellNoticeFromRun(session, run, event);
      if (run.source === "download") {
        const job = downloadJobs.get(tabId);
        if (job && job.shellRunId === run.runId) {
          job.shellStatus = event === "started" ? "running" : (event === "exited" ? (Number(run.returnCode || 0) === 0 ? "completed" : "error") : (event === "error" ? "error" : event));
          job.shellReturnCode = Number.isInteger(run.returnCode) ? run.returnCode : null;
          job.shellLogId = run.logId || job.shellLogId || null;
          job.shellLogBytes = Math.max(Number(job.shellLogBytes) || 0, Number(run.logBytes) || 0);
          job.shellError = event === "error" ? run.error : (event === "exited" && Number(run.returnCode || 0) !== 0 ? `Command exited with code ${run.returnCode}.` : null);
          if (["exited", "error"].includes(event)) job.shellCompletedAt = Settings.nowIso();
          await persistDownloadState(tabId);
        }
      }
      if (run.source === "automation") {
        recordRuleCommandStatistics(session, run, event);
        const failed = event === "error" || (event === "exited" && Number(run.returnCode || 0) !== 0);
        session.runtime = {
          ...session.runtime,
          automationCommandState: event === "started" ? "running" : (failed ? "failed" : (event === "exited" ? "completed" : event)),
          lastAutomationCommandError: failed ? (run.error || `Command exited with code ${run.returnCode}.`) : null,
          lastAutomationCommandRun: {
            runId: run.runId,
            ruleId: run.ruleId || null,
            ruleName: run.ruleName || null,
            trigger: run.trigger || null,
            cycle: run.cycle ?? null,
            presetId: run.presetId || null,
            presetName: run.presetName || null,
            status: run.status,
            returnCode: run.returnCode,
            endedAt: run.endedAt || null
          }
        };
      }
      await persistSession(session);
      await publishShellNotice(session, { persist: false, reason: "native-shell-event" });
      if (["exited", "error"].includes(event)) scheduleNativeLogCleanup("command-complete", 1800);
      return;
    }
    await broadcast("native-shell-event", tabId);
  }

  async function handleNativeDisconnect(port, errorOverride = null) {
    if (nativePort !== port) {
      return;
    }
    nativePort = null;
    const lastError = String(errorOverride || browser.runtime.lastError?.message || "The Native Host disconnected.");
    nativeState = {
      ...nativeState,
      connected: false,
      lastError,
      lastSeenAt: Settings.nowIso()
    };
    for (const [requestId, pending] of pendingNativeRequests.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(lastError));
      pendingNativeRequests.delete(requestId);
    }
    let localStore = null;
    try {
      localStore = await loadLocalActionStore();
    } catch (_error) {
      // Session-specific terminal state still has to be published even if the
      // reusable Local action store cannot be read during disconnect cleanup.
    }
    for (const run of shellRuns.values()) {
      if (!["starting", "running", "terminal", "stopping"].includes(run.status)) continue;
      run.status = "error";
      run.error = lastError;
      run.endedAt = Settings.nowIso();
      appendShellOutput(run, "stderr", `[native disconnected] ${lastError}\n`);
      if (run.runId) runToTab.delete(run.runId);
      const session = sessions.get(Number(run.tabId));
      if (!session) continue;
      const historyConfig = localStore
        ? sessionLocalActionConfig(session, localStore)
        : { shell: { rememberHistory: Boolean(run.historyId), historyLimit: 100 } };
      syncShellHistory(session, run, historyConfig);
      syncShellNoticeFromRun(session, run, "error");
      if (run.source === "download") {
        const job = downloadJobs.get(Number(run.tabId));
        if (job && job.shellRunId === run.runId) {
          job.shellStatus = "error";
          job.shellReturnCode = null;
          job.shellLogId = run.logId || job.shellLogId || null;
          job.shellLogBytes = Math.max(Number(job.shellLogBytes) || 0, Number(run.logBytes) || 0);
          job.shellError = lastError;
          job.shellCompletedAt = run.endedAt;
          session.downloadJob = publicDownloadState(Number(run.tabId));
        }
      }
      if (run.source === "automation") {
        recordRuleCommandStatistics(session, run, "error");
        session.runtime = {
          ...session.runtime,
          automationCommandState: "failed",
          lastAutomationCommandError: lastError,
          lastAutomationCommandRun: {
            runId: run.runId,
            ruleId: run.ruleId || null,
            ruleName: run.ruleName || null,
            trigger: run.trigger || null,
            cycle: run.cycle ?? null,
            presetId: run.presetId || null,
            presetName: run.presetName || null,
            status: run.status,
            returnCode: null,
            endedAt: run.endedAt || null
          }
        };
      }
      appendLog(session, "user", "shell-error", lastError, { runId: run.runId, source: run.source, nativeDisconnect: true });
      await persistSession(session);
      await publishShellNotice(session, { persist: false, reason: "native-disconnected" });
    }
    runToTab.clear();
    scheduleNativeLogCleanup("native-disconnected", 1800);
    await broadcast("native-disconnected");
  }

  function ensureNativePort() {
    if (nativePort) {
      return nativePort;
    }
    let port = null;
    try {
      port = browser.runtime.connectNative(NATIVE_HOST_NAME);
      nativePort = port;
      nativeState = {
        ...nativeState,
        connected: true,
        lastError: null,
        lastSeenAt: Settings.nowIso()
      };
      port.onMessage.addListener((message) => {
        void handleNativeMessage(message);
      });
      port.onDisconnect.addListener(() => { void handleNativeDisconnect(port); });
      port.postMessage({ action: "ping" });
      return port;
    } catch (error) {
      if (port && nativePort === port) nativePort = null;
      try { port?.disconnect(); } catch (_disconnectError) { /* already unusable */ }
      nativeState = {
        ...nativeState,
        connected: false,
        lastError: error instanceof Error ? error.message : String(error),
        lastSeenAt: Settings.nowIso()
      };
      throw error;
    }
  }

  function assertSidebarSender(sender) {
    if (sender?.tab) {
      throw new Error("Content scripts are not allowed to control Native Messaging.");
    }
    const sidebarPrefix = browser.runtime.getURL("sidebar/");
    if (typeof sender?.url !== "string" || !sender.url.startsWith(sidebarPrefix)) {
      throw new Error("Shell commands may be sent only from the extension sidebar.");
    }
  }

  function normalizeShellHistory(raw, limit = 20) {
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
    const entries = Array.isArray(raw) ? raw : [];
    return entries.filter((entry) => entry && typeof entry === "object").slice(0, safeLimit).map((entry, index) => ({
      id: String(entry.id || Settings.makeId("shell-history")),
      runId: entry.runId ? String(entry.runId) : null,
      startedAt: String(entry.startedAt || Settings.nowIso()),
      endedAt: entry.endedAt ? String(entry.endedAt) : null,
      cwd: String(entry.cwd || entry.workingDirectory || ""),
      workingDirectory: String(entry.workingDirectory || entry.cwd || ""),
      command: String(entry.command || ""),
      mode: entry.mode === "background" ? "background" : "terminal",
      presetId: entry.presetId ? String(entry.presetId) : null,
      presetName: entry.presetName ? String(entry.presetName) : null,
      status: String(entry.status || "requested"),
      returnCode: Number.isInteger(entry.returnCode) ? entry.returnCode : null,
      error: entry.error ? String(entry.error) : null,
      confirmBeforeRun: entry.confirmBeforeRun !== false,
      source: ["automation", "download"].includes(entry.source) ? entry.source : "sidebar",
      ruleId: entry.ruleId ? String(entry.ruleId) : null,
      ruleName: entry.ruleName ? String(entry.ruleName) : null,
      trigger: entry.trigger ? String(entry.trigger) : null,
      cycle: Number.isInteger(Number(entry.cycle)) ? Number(entry.cycle) : null,
      logId: entry.logId ? String(entry.logId) : null,
      logBytes: Math.max(0, Number(entry.logBytes) || 0),
      inlineOutput: index < SHELL_HISTORY_INLINE_ENTRY_LIMIT
        ? String(entry.inlineOutput || "").slice(-SHELL_HISTORY_INLINE_CHAR_LIMIT)
        : ""
    }));
  }

  function syncShellHistory(session, run, config) {
    if (!session || !config?.shell?.rememberHistory || !run?.historyId) return;
    session.shellHistory = normalizeShellHistory(session.shellHistory, config.shell.historyLimit);
    const entry = session.shellHistory.find((item) => item.id === run.historyId);
    if (!entry) return;
    Object.assign(entry, {
      runId: run.runId || entry.runId,
      endedAt: run.endedAt || entry.endedAt,
      status: run.status || entry.status,
      returnCode: Number.isInteger(run.returnCode) ? run.returnCode : null,
      error: run.error || null,
      logId: run.logId || entry.logId || null,
      logBytes: Math.max(Number(run.logBytes) || 0, Number(entry.logBytes) || 0),
      inlineOutput: shellRunInlineText(run) || entry.inlineOutput || ""
    });
  }

  function validateShellPayload(message, config) {
    const tabId = Number(message.tabId);
    if (!Number.isInteger(tabId)) {
      throw new Error("The command tab ID is invalid.");
    }
    const cwd = String(message.cwd || "").trim();
    if (!cwd.startsWith("/")) {
      throw new Error("The working directory must be an absolute path.");
    }
    const command = String(message.command || "");
    if (!command.trim()) {
      throw new Error("The command is empty.");
    }
    if (command.includes("\u0000")) {
      throw new Error("The command contains an invalid NUL character.");
    }
    const mode = message.mode === "terminal" ? "terminal" : "background";
    const preset = LocalActions.matchingPreset(config, { workingDirectory: cwd, command, mode });
    if (config.shell.requirePresetMatch && !preset) {
      throw new Error("This command is not allowed because it does not match an enabled command preset.");
    }
    return { tabId, cwd, command, mode, preset };
  }

  async function checkNativeStatus(sender) {
    assertSidebarSender(sender);
    const port = ensureNativePort();
    try {
      port.postMessage({ action: "ping" });
    } catch (error) {
      await handleNativeDisconnect(port, error instanceof Error ? error.message : String(error));
      throw error;
    }
    return nativeDashboardState();
  }

  async function startShellRunForSession(session, config, shell, metadata = {}) {
    const tabId = Number(session?.tabId);
    if (!Number.isInteger(tabId)) {
      throw new Error("The command tab ID is invalid.");
    }
    const { cwd, command, mode, preset } = shell;
    const current = shellRunForTab(tabId);
    if (["starting", "running", "terminal", "stopping"].includes(current.status)) {
      throw new Error("This tab already has a command that has not finished.");
    }
    const source = ["automation", "download"].includes(metadata.source) ? metadata.source : "sidebar";
    const runId = `tab-${tabId}-${crypto.randomUUID()}`;
    const historyId = config.shell.rememberHistory ? Settings.makeId("shell-history") : null;
    const run = {
      ...emptyShellRun(tabId),
      runId,
      historyId,
      mode,
      status: "starting",
      cwd,
      command,
      presetId: preset?.id || null,
      presetName: preset?.name || null,
      source,
      ruleId: metadata.ruleId || null,
      ruleName: metadata.ruleName || null,
      trigger: metadata.trigger || null,
      cycle: Number.isInteger(Number(metadata.cycle)) ? Number(metadata.cycle) : null,
      captureId: metadata.captureId || null,
      downloadPath: metadata.downloadPath || null,
      environment: metadata.environment ? clone(metadata.environment) : {},
      startedAt: Settings.nowIso()
    };
    shellRuns.set(tabId, run);
    runToTab.set(runId, tabId);
    session.shellNotice = normalizeShellNotice({
      ...emptyShellNotice(tabId),
      runId,
      status: "running",
      command,
      source,
      startedAt: run.startedAt
    }, tabId);
    appendShellOutput(run, "system", `[request:${source}] cwd=${cwd}\n[command] ${command}\n`);
    if (config.shell.rememberHistory) {
      session.shellHistory = normalizeShellHistory(session.shellHistory, config.shell.historyLimit);
      session.shellHistory.unshift({
        id: historyId,
        runId,
        startedAt: run.startedAt,
        endedAt: null,
        cwd,
        workingDirectory: cwd,
        command,
        mode,
        presetId: preset?.id || null,
        presetName: preset?.name || null,
        status: "starting",
        returnCode: null,
        error: null,
        confirmBeforeRun: preset?.confirmBeforeRun ?? config.shell.confirmBeforeRun,
        source,
        ruleId: metadata.ruleId || null,
        ruleName: metadata.ruleName || null,
        trigger: metadata.trigger || null,
        cycle: Number.isInteger(Number(metadata.cycle)) ? Number(metadata.cycle) : null,
        logId: null,
        logBytes: 0,
        inlineOutput: ""
      });
      session.shellHistory = normalizeShellHistory(session.shellHistory, config.shell.historyLimit);
    }
    const sourceText = source === "automation"
      ? `Automation rule “${metadata.ruleName || metadata.ruleId || "unknown"}” requested preset “${preset?.name || "unknown"}” after ${metadata.trigger || "rule event"}.`
      : (source === "download"
        ? `The completed managed download requested the configured command in ${mode} mode${preset ? ` using preset “${preset.name}”` : ""}.`
        : `Command requested in ${mode} mode${preset ? ` using preset “${preset.name}”` : ""}.`);
    const logEvent = source === "automation" ? "automation-command-request" : (source === "download" ? "download-command-request" : "shell-run-request");
    appendLog(session, "user", logEvent, sourceText, {
      runId, cwd, command, presetId: preset?.id || null, ruleId: metadata.ruleId || null,
      trigger: metadata.trigger || null, cycle: metadata.cycle ?? null
    });
    await persistSession(session);
    try {
      const port = ensureNativePort();
      port.postMessage({ action: "run", runId, tabId, cwd, command, mode, environment: run.environment });
      await publishShellNotice(session, { persist: false, reason: "native-shell-starting" });
      return publicShellRun(tabId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      run.status = "error";
      run.error = message;
      run.endedAt = Settings.nowIso();
      appendShellOutput(run, "stderr", `[native start failed] ${message}\n`);
      syncShellHistory(session, run, config);
      syncShellNoticeFromRun(session, run, "error");
      runToTab.delete(runId);
      await persistSession(session);
      await publishShellNotice(session, { persist: false, reason: "native-shell-start-error" });
      throw error;
    }
  }

  async function runShell(message, sender) {
    assertSidebarSender(sender);
    const tabId = Number(message.tabId);
    const session = sessions.get(tabId);
    if (!session) {
      throw new Error("This tab is not activated, so there is no session for the command.");
    }
    const localStore = await loadLocalActionStore();
    const config = sessionLocalActionConfig(session, localStore);
    const shell = validateShellPayload(message, config);
    return startShellRunForSession(session, config, shell, { source: "sidebar" });
  }

  async function processAutomationCommandRequest(session, rawRequest, store) {
    const request = rawRequest && typeof rawRequest === "object" ? rawRequest : null;
    if (!request) return null;
    const requestId = String(request.requestId || "").trim();
    if (!requestId) return null;
    session.automationCommandRequestIds = Array.isArray(session.automationCommandRequestIds)
      ? session.automationCommandRequestIds.map(String).slice(-199)
      : [];
    if (session.automationCommandRequestIds.includes(requestId)) {
      return null;
    }
    session.automationCommandRequestIds.push(requestId);

    const config = sessionConfig(session, store);
    const localStore = await loadLocalActionStore();
    const localConfig = sessionLocalActionConfig(session, localStore);
    const ruleId = String(request.ruleId || "");
    const rule = config.rules.find((item) => item.id === ruleId);
    const fail = async (message, state = "rejected") => {
      session.runtime = {
        ...session.runtime,
        automationCommandState: state,
        lastAutomationCommandError: message,
        lastAutomationCommandRequest: { ...clone(request), requestId }
      };
      appendLog(session, "user", "automation-command-rejected", message, { requestId, ruleId, presetId: request.presetId || null });
      await persistSession(session);
      await broadcast("automation-command-rejected", session.tabId);
      return null;
    };
    if (!rule || !rule.enabled || !rule.commandAction?.enabled) {
      return fail("The automation command request no longer matches an enabled rule.");
    }
    const action = rule.commandAction;
    if (action.presetId !== String(request.presetId || "") || action.trigger !== String(request.trigger || "")) {
      return fail("The automation command request does not match the saved rule action.");
    }
    const ruleCycle = Number(session.runtime?.ruleRuntimes?.[ruleId]?.cycle || 0);
    if (Number(request.cycle || 0) !== ruleCycle || ruleCycle <= 0) {
      return fail("The automation command request belongs to a stale monitor cycle.", "stale");
    }
    const preset = localConfig.shell.presets.find((item) => item.id === action.presetId && item.enabled);
    if (!preset) {
      return fail("The command preset selected by the rule is missing or disabled.");
    }
    if (preset.confirmBeforeRun) {
      return fail("Automatic command presets must have confirmation disabled.");
    }
    if (["starting", "running", "terminal", "stopping"].includes(shellRunForTab(session.tabId).status)) {
      return fail("The rule command was skipped because this tab already has a running command.", "busy");
    }

    session.runtime = {
      ...session.runtime,
      automationCommandState: "starting",
      lastAutomationCommandError: null,
      lastAutomationCommandRequest: { ...clone(request), requestId }
    };
    try {
      return await startShellRunForSession(session, localConfig, {
        tabId: session.tabId,
        cwd: preset.workingDirectory,
        command: preset.command,
        mode: preset.mode,
        preset
      }, {
        source: "automation",
        ruleId,
        ruleName: rule.name,
        trigger: action.trigger,
        cycle: ruleCycle
      });
    } catch (error) {
      const failedRun = shellRunForTab(session.tabId);
      const message = error instanceof Error ? error.message : String(error);
      if (failedRun?.source === "automation" && failedRun.ruleId === ruleId && failedRun.cycle === ruleCycle) {
        recordRuleCommandStatistics(session, failedRun, "error");
        session.runtime = {
          ...session.runtime,
          automationCommandState: "failed",
          lastAutomationCommandError: message,
          lastAutomationCommandRun: {
            runId: failedRun.runId || null,
            ruleId: failedRun.ruleId || ruleId,
            ruleName: failedRun.ruleName || rule.name,
            trigger: failedRun.trigger || action.trigger,
            cycle: failedRun.cycle ?? ruleCycle,
            presetId: failedRun.presetId || preset.id,
            presetName: failedRun.presetName || preset.name,
            status: failedRun.status || "error",
            returnCode: failedRun.returnCode ?? null,
            endedAt: failedRun.endedAt || Settings.nowIso()
          }
        };
        appendLog(session, "user", "automation-command-error", message, { requestId, ruleId, runId: failedRun.runId || null, nativeStartFailure: true });
        await persistSession(session);
        await broadcast("automation-command-error", session.tabId);
      }
      throw error;
    }
  }

  async function stopShell(message, sender) {
    assertSidebarSender(sender);
    const tabId = Number(message.tabId);
    const run = shellRuns.get(tabId);
    if (!run?.runId || !["starting", "running", "terminal", "stopping"].includes(run.status)) {
      throw new Error("This tab has no running command to stop.");
    }
    const port = ensureNativePort();
    run.status = "stopping";
    try {
      port.postMessage({ action: "stop", runId: run.runId, tabId });
    } catch (error) {
      await handleNativeDisconnect(port, error instanceof Error ? error.message : String(error));
      throw error;
    }
    await broadcast("native-shell-stopping", tabId);
    return publicShellRun(tabId);
  }

  async function clearShellOutput(message, sender) {
    assertSidebarSender(sender);
    const tabId = Number(message.tabId);
    const run = shellRunForTab(tabId);
    run.output = [];
    await broadcast("native-shell-output-cleared", tabId);
    return publicShellRun(tabId);
  }

  function ownedShellLog(session, run, logId) {
    if (!logId) return false;
    if (run?.logId === logId) return true;
    return Array.isArray(session?.shellHistory) && session.shellHistory.some((entry) => entry.logId === logId);
  }

  async function readShellLog(message, sender) {
    assertSidebarSender(sender);
    const tabId = Number(message.tabId);
    const session = sessions.get(tabId);
    const run = shellRunForTab(tabId);
    let logId = String(message.logId || "");
    const runId = String(message.runId || "");
    if (!session) throw new Error("This tab is not activated.");
    if (!logId && runId) {
      const resolved = await resolveLegacyShellLog(session, runId);
      logId = String(resolved?.logId || "");
    }
    if (!logId || !ownedShellLog(session, run, logId)) {
      throw new Error("The requested shell log does not belong to this tab session or is no longer recoverable.");
    }
    const chunk = await nativeRequest("read_log", {
      logId,
      offset: Math.max(0, Number(message.offset) || 0),
      maxBytes: Math.min(SHELL_LOG_READ_MAX_BYTES, Math.max(1, Number(message.maxBytes) || SHELL_LOG_READ_MAX_BYTES)),
      fromEnd: Boolean(message.fromEnd)
    });
    return chunk;
  }

  async function acknowledgeShellLog(message, sender) {
    assertSidebarSender(sender);
    const tabId = Number(message.tabId);
    const session = sessions.get(tabId);
    return acknowledgeShellNotice(session, {
      runId: message.runId || null,
      logId: message.logId || null,
      requireActiveTab: message.requireActiveTab !== false
    });
  }

  async function deleteShellLog(message, sender) {
    assertSidebarSender(sender);
    const tabId = Number(message.tabId);
    const session = sessions.get(tabId);
    const run = shellRunForTab(tabId);
    const logId = String(message.logId || "");
    if (!session || !ownedShellLog(session, run, logId)) {
      throw new Error("The requested shell log does not belong to this tab session.");
    }
    await nativeRequest("delete_log", { logId });
    if (run.logId === logId) {
      run.logId = null;
      run.logBytes = 0;
    }
    session.shellHistory = normalizeShellHistory(session.shellHistory, 100).map((entry) =>
      entry.logId === logId ? { ...entry, logId: null, logBytes: 0 } : entry
    );
    const notice = normalizeShellNotice(session.shellNotice, tabId);
    if (notice.logId === logId) {
      session.shellNotice = normalizeShellNotice({ ...notice, status: "idle", logId: null, logBytes: 0, viewedAt: Settings.nowIso() }, tabId);
    }
    await persistSession(session);
    await publishShellNotice(session, { persist: false, reason: "shell-log-deleted" });
    return { logId };
  }

  async function clearShellHistory(message, sender) {
    assertSidebarSender(sender);
    const tabId = Number(message.tabId);
    const session = sessions.get(tabId);
    if (!session) {
      throw new Error("This tab is not activated.");
    }
    session.shellHistory = [];
    appendLog(session, "user", "shell-history-cleared", "Command history cleared for this tab session.");
    await persistSession(session);
    await broadcast("shell-history-cleared", tabId);
    return [];
  }


  function clone(value) {
    return Settings.clone(value);
  }

  function isSupportedUrl(rawUrl) {
    if (typeof rawUrl !== "string" || !rawUrl) {
      return false;
    }
    try {
      const url = new URL(rawUrl);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch (_error) {
      return false;
    }
  }

  function hostPermissionPattern(rawUrl) {
    if (!isSupportedUrl(rawUrl)) {
      return null;
    }
    const url = new URL(rawUrl);
    return `${url.protocol}//${url.host}/*`;
  }

  function tabMeta(tab) {
    return {
      tabId: Number.isInteger(tab?.id) ? tab.id : null,
      windowId: Number.isInteger(tab?.windowId) ? tab.windowId : null,
      url: typeof tab?.url === "string" ? tab.url : "",
      title: typeof tab?.title === "string" ? tab.title : ""
    };
  }
  function normalizeCustomTitleState(raw, fallbackPageTitle = "") {
    const source = raw && typeof raw === "object" ? raw : {};
    return {
      customTitle: typeof source.customTitle === "string" ? source.customTitle.trim().slice(0, 240) : "",
      pageTitle: typeof source.pageTitle === "string" && source.pageTitle.trim()
        ? source.pageTitle.trim().slice(0, 500)
        : String(fallbackPageTitle || "").trim().slice(0, 500),
      updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : Settings.nowIso()
    };
  }

  async function loadCustomTitleState(tabId, fallbackPageTitle = "") {
    if (!Number.isInteger(Number(tabId))) return normalizeCustomTitleState(null, fallbackPageTitle);
    try {
      const raw = await browser.sessions.getTabValue(Number(tabId), TAB_CUSTOM_TITLE_KEY);
      return normalizeCustomTitleState(raw, fallbackPageTitle);
    } catch (_error) {
      return normalizeCustomTitleState(null, fallbackPageTitle);
    }
  }

  async function saveCustomTitleState(tabId, rawState) {
    const state = normalizeCustomTitleState(rawState);
    if (!Number.isInteger(Number(tabId))) throw new Error("The selected tab has no valid tab ID.");
    if (!state.customTitle) {
      try {
        await browser.sessions.removeTabValue(Number(tabId), TAB_CUSTOM_TITLE_KEY);
      } catch (_error) {
        // The tab may have closed while clearing its custom title.
      }
      return state;
    }
    await browser.sessions.setTabValue(Number(tabId), TAB_CUSTOM_TITLE_KEY, state);
    return state;
  }

  async function loadTabLocalActionProfileId(tabId, localStore = null) {
    const numericTabId = Number(tabId);
    if (!Number.isInteger(numericTabId)) return null;
    try {
      const rawProfileId = await browser.sessions.getTabValue(numericTabId, TAB_LOCAL_ACTION_PROFILE_KEY);
      const profileId = typeof rawProfileId === "string" ? rawProfileId.trim() : "";
      if (!profileId) return null;
      const store = localStore || await loadLocalActionStore();
      if (LocalActions.profileById(store, profileId)) return profileId;
      await browser.sessions.removeTabValue(numericTabId, TAB_LOCAL_ACTION_PROFILE_KEY).catch(() => {});
      return null;
    } catch (_error) {
      return null;
    }
  }

  async function saveTabLocalActionProfileId(tabId, profileId) {
    const numericTabId = Number(tabId);
    const normalizedProfileId = String(profileId || "").trim();
    if (!Number.isInteger(numericTabId)) throw new Error("The selected tab has no valid tab ID.");
    if (!normalizedProfileId) throw new Error("The local-action profile ID is empty.");
    await browser.sessions.setTabValue(numericTabId, TAB_LOCAL_ACTION_PROFILE_KEY, normalizedProfileId);
    return normalizedProfileId;
  }

  async function clearTabLocalActionProfileId(tabId) {
    const numericTabId = Number(tabId);
    if (!Number.isInteger(numericTabId)) throw new Error("The selected tab has no valid tab ID.");
    try {
      await browser.sessions.removeTabValue(numericTabId, TAB_LOCAL_ACTION_PROFILE_KEY);
    } catch (_error) {
      // The tab may have closed while the explicit binding was being removed.
    }
  }


  function configFingerprint(rawConfig) {
    return WorkingSession.configFingerprint(Settings.normalizeConfig(rawConfig));
  }

  function normalizeStoppedTabConfigSnapshot(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const profileId = String(source.profileId || "").trim();
    const localActionProfileId = String(source.localActionProfileId || "").trim();
    if (!profileId || !localActionProfileId) return null;
    const configMode = source.configMode === CONFIG_MODE.TAB ? CONFIG_MODE.TAB : CONFIG_MODE.PROFILE;
    const localActionConfigMode = source.localActionConfigMode === CONFIG_MODE.TAB ? CONFIG_MODE.TAB : CONFIG_MODE.PROFILE;
    const effectiveConfig = Settings.normalizeConfig(source.effectiveConfig || source.tabConfig || Settings.defaultConfig());
    const effectiveLocalActions = LocalActions.normalizeConfig(
      source.effectiveLocalActions || source.localActionWorkingConfig || source.localActionTabConfig || LocalActions.defaultConfig()
    );
    return {
      schema: 1,
      stoppedAt: typeof source.stoppedAt === "string" ? source.stoppedAt : Settings.nowIso(),
      url: String(source.url || ""),
      profileId,
      configMode,
      tabConfig: configMode === CONFIG_MODE.TAB
        ? Settings.normalizeConfig(source.tabConfig || effectiveConfig)
        : null,
      effectiveConfig,
      localActionProfileId,
      localActionBinding: ["explicit-tab", "url-route", "default"].includes(source.localActionBinding)
        ? source.localActionBinding
        : "stopped-snapshot",
      localActionConfigMode,
      localActionTabConfig: localActionConfigMode === CONFIG_MODE.TAB
        ? LocalActions.normalizeConfig(source.localActionTabConfig || effectiveLocalActions)
        : null,
      localActionWorkingConfig: source.localActionWorkingConfig
        ? LocalActions.normalizeConfig(source.localActionWorkingConfig)
        : null,
      effectiveLocalActions
    };
  }

  async function loadStoppedTabConfigSnapshot(tabId) {
    const numericTabId = Number(tabId);
    if (!Number.isInteger(numericTabId)) return null;
    try {
      return normalizeStoppedTabConfigSnapshot(
        await browser.sessions.getTabValue(numericTabId, TAB_STOPPED_CONFIG_KEY)
      );
    } catch (_error) {
      return null;
    }
  }

  async function saveStoppedTabConfigSnapshot(tabId, rawSnapshot) {
    const numericTabId = Number(tabId);
    const snapshot = normalizeStoppedTabConfigSnapshot(rawSnapshot);
    if (!Number.isInteger(numericTabId)) throw new Error("The selected tab has no valid tab ID.");
    if (!snapshot) throw new Error("The stopped-tab configuration snapshot is invalid.");
    await browser.sessions.setTabValue(numericTabId, TAB_STOPPED_CONFIG_KEY, snapshot);
    return snapshot;
  }

  async function clearStoppedTabConfigSnapshot(tabId) {
    const numericTabId = Number(tabId);
    if (!Number.isInteger(numericTabId)) return;
    try {
      await browser.sessions.removeTabValue(numericTabId, TAB_STOPPED_CONFIG_KEY);
    } catch (_error) {
      // The tab may have closed while its stopped configuration was cleared.
    }
  }

  async function replaceStoppedTabLocalActionChoice(tabId, profile, binding) {
    const snapshot = await loadStoppedTabConfigSnapshot(tabId);
    if (!snapshot || !profile) return null;
    return saveStoppedTabConfigSnapshot(tabId, {
      ...snapshot,
      localActionProfileId: profile.id,
      localActionBinding: ["explicit-tab", "url-route", "default"].includes(binding) ? binding : "default",
      localActionConfigMode: CONFIG_MODE.PROFILE,
      localActionTabConfig: null,
      localActionWorkingConfig: null,
      effectiveLocalActions: profile.config
    });
  }

  function stoppedTabConfigSnapshot(session, store, localStore, rawDrafts = null, localActionBinding = "stopped-snapshot") {
    if (!session) return null;
    const drafts = rawDrafts && typeof rawDrafts === "object" ? rawDrafts : {};
    const currentConfig = sessionConfig(session, store);
    const configValidation = drafts.config ? Settings.validateConfig(drafts.config) : null;
    const draftedConfig = configValidation?.ok && Settings.urlAllowed(configValidation.config, session.url)
      ? configValidation.config
      : currentConfig;
    const configChanged = configFingerprint(draftedConfig) !== configFingerprint(currentConfig);

    const currentLocalActions = sessionLocalActionConfig(session, localStore);
    const localValidation = drafts.localActions ? LocalActions.validateConfig(drafts.localActions) : null;
    const draftedLocalActions = localValidation?.ok ? localValidation.config : currentLocalActions;
    const localChanged = LocalActions.configFingerprint(draftedLocalActions) !== LocalActions.configFingerprint(currentLocalActions);
    const existingWorking = normalizeWorkingLocalActionSnapshot(session);

    return normalizeStoppedTabConfigSnapshot({
      stoppedAt: Settings.nowIso(),
      url: session.url,
      profileId: session.profileId,
      configMode: configChanged ? CONFIG_MODE.TAB : session.configMode,
      tabConfig: configChanged ? draftedConfig : session.tabConfig,
      effectiveConfig: draftedConfig,
      localActionProfileId: session.localActionProfileId,
      localActionBinding,
      localActionConfigMode: session.localActionConfigMode,
      localActionTabConfig: session.localActionTabConfig,
      localActionWorkingConfig: localChanged ? draftedLocalActions : existingWorking,
      effectiveLocalActions: draftedLocalActions
    });
  }

  function applyStoppedTabConfigSnapshot(session, snapshot, store, localStore) {
    if (!session || !snapshot) return;
    const profile = Settings.profileById(store, snapshot.profileId);
    session.profileId = profile?.id || store.defaultProfileId || store.profiles[0]?.id;
    const profileStillMatches = Boolean(profile) &&
      configFingerprint(profile.config) === configFingerprint(snapshot.effectiveConfig);
    if (snapshot.configMode === CONFIG_MODE.TAB || !profileStillMatches) {
      session.configMode = CONFIG_MODE.TAB;
      session.tabConfig = Settings.normalizeConfig(snapshot.tabConfig || snapshot.effectiveConfig);
    } else {
      session.configMode = CONFIG_MODE.PROFILE;
      session.tabConfig = null;
    }

    const localProfile = LocalActions.profileById(localStore, snapshot.localActionProfileId);
    session.localActionProfileId = localProfile?.id || localStore.defaultProfileId || localStore.profiles[0]?.id;
    const localProfileStillMatches = Boolean(localProfile) &&
      LocalActions.configFingerprint(localProfile.config) === LocalActions.configFingerprint(snapshot.effectiveLocalActions);
    session.localActionWorkingConfig = null;
    session.localActionWorkingContext = null;
    if (snapshot.localActionWorkingConfig) {
      session.localActionConfigMode = snapshot.localActionConfigMode;
      session.localActionTabConfig = snapshot.localActionConfigMode === CONFIG_MODE.TAB
        ? LocalActions.normalizeConfig(snapshot.localActionTabConfig || snapshot.effectiveLocalActions)
        : null;
      session.localActionWorkingConfig = LocalActions.normalizeConfig(snapshot.localActionWorkingConfig);
      session.localActionWorkingContext = {
        ...currentLocalActionContext(session),
        updatedAt: Settings.nowIso(),
        fingerprint: LocalActions.configFingerprint(session.localActionWorkingConfig)
      };
    } else if (snapshot.localActionConfigMode === CONFIG_MODE.TAB || !localProfileStillMatches) {
      session.localActionConfigMode = CONFIG_MODE.TAB;
      session.localActionTabConfig = LocalActions.normalizeConfig(snapshot.localActionTabConfig || snapshot.effectiveLocalActions);
    } else {
      session.localActionConfigMode = CONFIG_MODE.PROFILE;
      session.localActionTabConfig = null;
    }
    session.configRevision = Math.max(1, Number(session.configRevision || 1));
    session.localActionRevision = Math.max(1, Number(session.localActionRevision || 1));
  }


  function replacementAutomationProfile(store, url) {
    const routed = Settings.routeProfile(store, url || "");
    return routed.profile || Settings.profileById(store, store.defaultProfileId) || store.profiles[0] || null;
  }

  function replacementLocalActionProfile(store, url) {
    const routed = LocalActions.routeProfile(store, url || "");
    const profile = routed.profile || LocalActions.profileById(store, store.defaultProfileId) || store.profiles[0] || null;
    return { profile, binding: routed.matched ? "url-route" : "default" };
  }

  async function reconcileDeletedAutomationProfileTabs(deletedProfile, savedStore) {
    let preservedTabs = 0;
    const tabs = await browser.tabs.query({});
    for (const tab of tabs) {
      if (!Number.isInteger(tab?.id)) continue;
      const session = sessions.get(tab.id);
      if (session?.profileId === deletedProfile.id) {
        const effectiveConfig = session.configMode === CONFIG_MODE.TAB && session.tabConfig
          ? Settings.normalizeConfig(session.tabConfig)
          : Settings.normalizeConfig(deletedProfile.config);
        const replacement = replacementAutomationProfile(savedStore, session.url || tab.url || "");
        if (!replacement) continue;
        session.profileId = replacement.id;
        session.configMode = CONFIG_MODE.TAB;
        session.tabConfig = effectiveConfig;
        session.configRevision += 1;
        appendLog(session, "user", "profile-deleted-config-preserved", `Deleted profile “${deletedProfile.name}”; current automation values were preserved as a tab override based on “${replacement.name}”.`);
        try {
          await applySessionToContent(session, savedStore);
          session.error = null;
        } catch (error) {
          session.mode = MODE.ERROR;
          session.error = error instanceof Error ? error.message : String(error);
        }
        await persistSession(session);
        await updateBadge(session, savedStore);
        preservedTabs += 1;
        continue;
      }

      const snapshot = await loadStoppedTabConfigSnapshot(tab.id);
      if (!snapshot || snapshot.profileId !== deletedProfile.id) continue;
      const replacement = replacementAutomationProfile(savedStore, tab.url || snapshot.url || "");
      if (!replacement) continue;
      await saveStoppedTabConfigSnapshot(tab.id, {
        ...snapshot,
        profileId: replacement.id,
        configMode: CONFIG_MODE.TAB,
        tabConfig: snapshot.effectiveConfig,
        effectiveConfig: snapshot.effectiveConfig
      });
      preservedTabs += 1;
    }
    return preservedTabs;
  }

  async function reconcileDeletedLocalActionProfileTabs(deletedProfile, oldStore, savedStore) {
    let preservedTabs = 0;
    const tabs = await browser.tabs.query({});
    for (const tab of tabs) {
      if (!Number.isInteger(tab?.id)) continue;
      let explicitProfileId = null;
      try {
        explicitProfileId = await browser.sessions.getTabValue(tab.id, TAB_LOCAL_ACTION_PROFILE_KEY);
      } catch (_error) {
        explicitProfileId = null;
      }
      const explicitDeleted = String(explicitProfileId || "") === String(deletedProfile.id);
      if (explicitDeleted) await clearTabLocalActionProfileId(tab.id);

      const session = sessions.get(tab.id);
      if (session?.localActionProfileId === deletedProfile.id) {
        const effectiveConfig = sessionLocalActionConfig(session, oldStore);
        const replacement = replacementLocalActionProfile(savedStore, session.url || tab.url || "");
        if (!replacement.profile) continue;
        clearWorkingLocalActionSnapshot(session);
        session.localActionProfileId = replacement.profile.id;
        session.localActionConfigMode = CONFIG_MODE.TAB;
        session.localActionTabConfig = LocalActions.normalizeConfig(effectiveConfig);
        session.localActionRevision = Number(session.localActionRevision || 0) + 1;
        appendLog(session, "user", "local-action-profile-deleted-config-preserved", `Deleted Local action profile “${deletedProfile.name}”; current download and shell values were preserved as a tab override based on “${replacement.profile.name}”.`);
        await persistSession(session);
        preservedTabs += 1;
        continue;
      }

      const snapshot = await loadStoppedTabConfigSnapshot(tab.id);
      if (!snapshot || (snapshot.localActionProfileId !== deletedProfile.id && !explicitDeleted)) continue;
      const replacement = replacementLocalActionProfile(savedStore, tab.url || snapshot.url || "");
      if (!replacement.profile) continue;
      await saveStoppedTabConfigSnapshot(tab.id, {
        ...snapshot,
        localActionProfileId: replacement.profile.id,
        localActionBinding: replacement.binding,
        localActionConfigMode: CONFIG_MODE.TAB,
        localActionTabConfig: snapshot.effectiveLocalActions,
        localActionWorkingConfig: null,
        effectiveLocalActions: snapshot.effectiveLocalActions
      });
      preservedTabs += 1;
    }
    return preservedTabs;
  }

  function applyCustomTitleStateToSession(session, state, fallbackPageTitle = "") {
    if (!session) return;
    const normalized = normalizeCustomTitleState(state, fallbackPageTitle || session.pageTitle || session.title);
    session.customTitle = normalized.customTitle;
    session.pageTitle = normalized.pageTitle || String(fallbackPageTitle || session.pageTitle || session.title || "");
    session.title = session.customTitle || session.pageTitle || session.title || session.url;
    session.runtime = {
      ...newRuntime(),
      ...(session.runtime || {}),
      customTitle: session.customTitle,
      pageTitle: session.pageTitle
    };
  }

  async function applyPlainCustomTitle(tabId, title, enabled = true) {
    const value = String(title || "");
    await browser.scripting.executeScript({
      target: { tabId: Number(tabId) },
      func: (nextTitle, lockEnabled) => {
        const key = "__fciCustomTabTitleLockV1";
        const previous = globalThis[key];
        if (previous?.observer) previous.observer.disconnect();
        delete globalThis[key];
        const apply = () => {
          const text = String(nextTitle || "");
          if (document.title !== text) document.title = text;
        };
        apply();
        if (!lockEnabled) return;
        const target = document.querySelector("title") || document.head || document.documentElement;
        if (!target) return;
        let applying = false;
        const observer = new MutationObserver(() => {
          if (applying || document.title === String(nextTitle || "")) return;
          applying = true;
          apply();
          queueMicrotask(() => { applying = false; });
        });
        observer.observe(target, { childList: true, characterData: true, subtree: true });
        globalThis[key] = { observer, title: String(nextTitle || "") };
      },
      args: [value, Boolean(enabled)]
    });
  }

  async function setTabCustomTitle(tabId, rawTitle) {
    const numericTabId = Number(tabId);
    if (!Number.isInteger(numericTabId)) throw new Error("The selected tab has no valid tab ID.");
    const tab = await browser.tabs.get(numericTabId);
    if (!isSupportedUrl(tab.url)) throw new Error("Only normal HTTP or HTTPS tabs can use a custom title.");
    const previous = await loadCustomTitleState(numericTabId, tab.title || "");
    const session = sessions.get(numericTabId);
    const customTitle = String(rawTitle || "").trim().slice(0, 240);
    const pageTitle = previous.pageTitle || session?.pageTitle || session?.runtime?.originalTitle || tab.title || tab.url || "";
    const state = await saveCustomTitleState(numericTabId, {
      customTitle,
      pageTitle,
      updatedAt: Settings.nowIso()
    });

    if (session) {
      applyCustomTitleStateToSession(session, state, pageTitle);
      session.updatedAt = Settings.nowIso();
      const store = await loadStore();
      await applySessionToContent(session, store);
      await persistSession(session);
    } else {
      await applyPlainCustomTitle(numericTabId, customTitle || pageTitle, Boolean(customTitle));
    }
    await broadcast(customTitle ? "tab-custom-title-set" : "tab-custom-title-cleared", numericTabId);
    return {
      tabId: numericTabId,
      customTitle,
      pageTitle,
      title: customTitle || pageTitle
    };
  }

  async function tabMetaWithCustomTitle(tab) {
    const meta = tabMeta(tab);
    if (!Number.isInteger(meta.tabId)) return { ...meta, customTitle: "", pageTitle: meta.title };
    const state = await loadCustomTitleState(meta.tabId, meta.title);
    return {
      ...meta,
      pageTitle: state.pageTitle || meta.title,
      customTitle: state.customTitle,
      title: state.customTitle || meta.title
    };
  }

  async function restoreAllCustomTabTitles() {
    const tabs = await browser.tabs.query({});
    for (const tab of tabs) {
      if (!Number.isInteger(tab?.id) || !isSupportedUrl(tab?.url)) continue;
      const state = await loadCustomTitleState(tab.id, tab.title || "");
      if (!state.customTitle) continue;
      const session = sessions.get(tab.id);
      if (session) {
        applyCustomTitleStateToSession(session, state, tab.title || state.pageTitle);
        continue;
      }
      try {
        await applyPlainCustomTitle(tab.id, state.customTitle, true);
      } catch (_error) {
        // A site may no longer have permission; the next user save can request it again.
      }
    }
  }

  async function loadStore() {
    if (!storePromise) {
      storePromise = browser.storage.local.get(Settings.STORAGE_KEY).then(async (result) => {
        const store = Settings.normalizeStore(result[Settings.STORAGE_KEY]);
        await browser.storage.local.set({ [Settings.STORAGE_KEY]: store });
        return store;
      });
    }
    return clone(await storePromise);
  }

  async function saveStore(nextStore) {
    const normalized = Settings.normalizeStore(nextStore);
    normalized.revision += 1;
    await browser.storage.local.set({ [Settings.STORAGE_KEY]: normalized });
    storePromise = Promise.resolve(normalized);
    return clone(normalized);
  }

  async function loadLocalActionStore() {
    if (!localActionStorePromise) {
      localActionStorePromise = Promise.all([
        browser.storage.local.get(LocalActions.STORAGE_KEY),
        loadStore()
      ]).then(async ([result, settingsStore]) => {
        const legacyProfile = Settings.profileById(settingsStore, settingsStore.defaultProfileId) || settingsStore.profiles[0];
        const localStore = LocalActions.normalizeStore(
          result[LocalActions.STORAGE_KEY],
          legacyProfile?.config?.shell || null
        );
        await browser.storage.local.set({ [LocalActions.STORAGE_KEY]: localStore });
        return localStore;
      });
    }
    return LocalActions.clone(await localActionStorePromise);
  }

  async function saveLocalActionStore(nextStore) {
    const normalized = LocalActions.normalizeStore(nextStore);
    normalized.revision += 1;
    await browser.storage.local.set({ [LocalActions.STORAGE_KEY]: normalized });
    localActionStorePromise = Promise.resolve(normalized);
    return LocalActions.clone(normalized);
  }

  async function loadCommandPresetStore() {
    const result = await browser.storage.local.get(CommandPresets.STORAGE_KEY);
    return CommandPresets.normalizeStore(result[CommandPresets.STORAGE_KEY]);
  }

  async function saveCommandPresetStore(nextStore) {
    const normalized = CommandPresets.normalizeStore(nextStore);
    await browser.storage.local.set({ [CommandPresets.STORAGE_KEY]: normalized });
    return CommandPresets.clone(normalized);
  }

  async function loadSidebarPreferences() {
    const result = await browser.storage.local.get(ConfigurationBundle.SIDEBAR_UI_STORAGE_KEY);
    return ConfigurationBundle.normalizeSidebarPreferences(result[ConfigurationBundle.SIDEBAR_UI_STORAGE_KEY]);
  }

  async function saveSidebarPreferences(nextPreferences) {
    const result = await browser.storage.local.get(ConfigurationBundle.SIDEBAR_UI_STORAGE_KEY);
    const existing = result[ConfigurationBundle.SIDEBAR_UI_STORAGE_KEY] && typeof result[ConfigurationBundle.SIDEBAR_UI_STORAGE_KEY] === "object"
      ? result[ConfigurationBundle.SIDEBAR_UI_STORAGE_KEY]
      : {};
    const preferences = ConfigurationBundle.normalizeSidebarPreferences(nextPreferences);
    const merged = {
      ...existing,
      collapsedGroups: preferences.collapsedGroups,
      featurePreset: preferences.featurePreset,
      visibleFeatures: preferences.visibleFeatures,
      autoProfileByUrl: preferences.autoProfileByUrl
    };
    await browser.storage.local.set({ [ConfigurationBundle.SIDEBAR_UI_STORAGE_KEY]: merged });
    return preferences;
  }

  async function buildFullConfigurationBundle(automationStoreOverride = null, localActionStoreOverride = null) {
    const [automationStore, localActionStore, commandPresetStore, promptTemplateStore, sidebarPreferences] = await Promise.all([
      automationStoreOverride ? Promise.resolve(Settings.normalizeStore(automationStoreOverride)) : loadStore(),
      localActionStoreOverride ? Promise.resolve(LocalActions.normalizeStore(localActionStoreOverride)) : loadLocalActionStore(),
      loadCommandPresetStore(),
      PromptTemplates.loadStore(browser),
      loadSidebarPreferences()
    ]);
    return ConfigurationBundle.build({
      automationStore,
      localActionStore,
      commandPresetStore,
      promptTemplateStore,
      sidebarPreferences
    });
  }

  async function loadSnapshotCollection() {
    if (!snapshotPromise) {
      snapshotPromise = browser.storage.local.get(Snapshots.STORAGE_KEY).then(async (result) => {
        const collection = Snapshots.normalizeCollection(result[Snapshots.STORAGE_KEY]);
        await browser.storage.local.set({ [Snapshots.STORAGE_KEY]: collection });
        return collection;
      });
    }
    return Snapshots.clone(await snapshotPromise);
  }

  async function saveSnapshotCollection(nextCollection) {
    const normalized = Snapshots.normalizeCollection(nextCollection);
    await browser.storage.local.set({ [Snapshots.STORAGE_KEY]: normalized });
    snapshotPromise = Promise.resolve(normalized);
    return Snapshots.clone(normalized);
  }

  async function loadWorkingSessionCatalog() {
    if (!workingSessionCatalogPromise) {
      workingSessionCatalogPromise = browser.storage.local.get(WorkingSession.CATALOG_STORAGE_KEY).then(async (result) => {
        const catalog = WorkingSession.normalizeCatalog(result[WorkingSession.CATALOG_STORAGE_KEY]);
        await browser.storage.local.set({ [WorkingSession.CATALOG_STORAGE_KEY]: catalog });
        return catalog;
      });
    }
    return WorkingSession.clone(await workingSessionCatalogPromise);
  }

  async function saveWorkingSessionCatalog(nextCatalog) {
    const normalized = WorkingSession.normalizeCatalog(nextCatalog);
    normalized.updatedAt = Settings.nowIso();
    await browser.storage.local.set({ [WorkingSession.CATALOG_STORAGE_KEY]: normalized });
    workingSessionCatalogPromise = Promise.resolve(normalized);
    return WorkingSession.clone(normalized);
  }

  async function createSettingsSnapshot(reason = "manual", label = "Manual snapshot", rawStore = null) {
    const store = rawStore ? Settings.normalizeStore(rawStore) : await loadStore();
    const configurationBundle = await buildFullConfigurationBundle(store, null);
    const collection = await loadSnapshotCollection();
    const result = Snapshots.addSnapshot(collection, Snapshots.makeSnapshot(store, reason, label, { configurationBundle }));
    if (result.added) {
      await saveSnapshotCollection(result.collection);
      await broadcast("settings-snapshot-created");
    }
    return {
      added: result.added,
      snapshot: Snapshots.summary(result.snapshot)
    };
  }

  async function deleteSettingsSnapshot(snapshotId) {
    const collection = await loadSnapshotCollection();
    if (!Snapshots.findSnapshot(collection, snapshotId)) {
      throw new Error("Settings snapshot not found.");
    }
    const saved = await saveSnapshotCollection(Snapshots.removeSnapshot(collection, snapshotId));
    await broadcast("settings-snapshot-deleted");
    return saved.snapshots.map(Snapshots.summary);
  }

  function sessionConfig(session, store) {
    if (session.configMode === CONFIG_MODE.TAB && session.tabConfig) {
      return Settings.normalizeConfig(session.tabConfig);
    }
    const profile = Settings.profileById(store, session.profileId) ||
      Settings.profileById(store, store.defaultProfileId) || store.profiles[0];
    return Settings.normalizeConfig(profile.config);
  }

  function profileName(session, store) {
    return Settings.profileById(store, session.profileId)?.name || "Profile not found";
  }

  function currentLocalActionContext(session) {
    return {
      sessionToken: String(session?.sessionToken || ""),
      localActionRevision: Math.max(0, Number(session?.localActionRevision) || 0),
      localActionProfileId: String(session?.localActionProfileId || ""),
      localActionConfigMode: session?.localActionConfigMode === CONFIG_MODE.TAB ? CONFIG_MODE.TAB : CONFIG_MODE.PROFILE,
      pageUrl: String(session?.url || "")
    };
  }

  function localActionContextMatches(session, context) {
    if (!session || !context || typeof context !== "object") return false;
    const current = currentLocalActionContext(session);
    return String(context.sessionToken || "") === current.sessionToken &&
      Math.max(0, Number(context.localActionRevision) || 0) === current.localActionRevision &&
      String(context.localActionProfileId || "") === current.localActionProfileId &&
      String(context.localActionConfigMode || CONFIG_MODE.PROFILE) === current.localActionConfigMode;
  }

  function clearWorkingLocalActionSnapshot(session) {
    if (!session) return;
    volatileLocalActionDrafts.delete(Number(session.tabId));
    session.localActionWorkingConfig = null;
    session.localActionWorkingContext = null;
  }

  function normalizeWorkingLocalActionSnapshot(session) {
    if (!session?.localActionWorkingConfig || !localActionContextMatches(session, session.localActionWorkingContext)) {
      clearWorkingLocalActionSnapshot(session);
      return null;
    }
    return LocalActions.normalizeConfig(session.localActionWorkingConfig);
  }

  function captureWorkingLocalActionDraft(session) {
    if (!session) return null;
    const tabId = Number(session.tabId);
    const volatileEntry = volatileLocalActionDrafts.get(tabId);
    if (volatileEntry && localActionContextMatches(session, volatileEntry.context)) {
      return LocalActions.normalizeConfig(volatileEntry.config);
    }
    if (session.localActionWorkingConfig && localActionContextMatches(session, session.localActionWorkingContext)) {
      return LocalActions.normalizeConfig(session.localActionWorkingConfig);
    }
    return null;
  }

  function restoreWorkingLocalActionDraft(session, rawConfig) {
    if (!session || !rawConfig) return false;
    const config = LocalActions.normalizeConfig(rawConfig);
    const context = currentLocalActionContext(session);
    volatileLocalActionDrafts.set(Number(session.tabId), { config: LocalActions.clone(config), context: { ...context } });
    session.localActionWorkingConfig = LocalActions.clone(config);
    session.localActionWorkingContext = {
      ...context,
      updatedAt: Settings.nowIso(),
      fingerprint: LocalActions.configFingerprint(config)
    };
    return true;
  }

  function sessionLocalActionResolution(session, localStore) {
    const tabId = Number(session?.tabId);
    const volatileEntry = volatileLocalActionDrafts.get(tabId);
    if (volatileEntry) {
      if (localActionContextMatches(session, volatileEntry.context)) {
        const config = LocalActions.normalizeConfig(volatileEntry.config);
        return { config, source: "tab-working-draft", fingerprint: LocalActions.configFingerprint(config) };
      }
      volatileLocalActionDrafts.delete(tabId);
    }
    const workingConfig = normalizeWorkingLocalActionSnapshot(session);
    if (workingConfig) {
      return { config: workingConfig, source: "tab-working-snapshot", fingerprint: LocalActions.configFingerprint(workingConfig) };
    }
    if (session.localActionConfigMode === CONFIG_MODE.TAB && session.localActionTabConfig) {
      const config = LocalActions.normalizeConfig(session.localActionTabConfig);
      return { config, source: "tab-override", fingerprint: LocalActions.configFingerprint(config) };
    }
    const profile = LocalActions.profileById(localStore, session.localActionProfileId) ||
      LocalActions.profileById(localStore, localStore.defaultProfileId) || localStore.profiles[0];
    const config = LocalActions.normalizeConfig(profile.config);
    return { config, source: "assigned-profile", fingerprint: LocalActions.configFingerprint(config) };
  }

  function sessionLocalActionConfig(session, localStore) {
    return sessionLocalActionResolution(session, localStore).config;
  }

  function localActionProfileName(session, localStore) {
    return LocalActions.profileById(localStore, session.localActionProfileId)?.name || "Local-action profile not found";
  }

  function publicSession(session, store, localStore = null) {
    const publicValue = {
      ...clone(session),
      profileName: profileName(session, store),
      effectiveConfig: sessionConfig(session, store)
    };
    publicValue.ruleStatistics = normalizeRuleStatisticsMap(session.ruleStatistics, session.statisticsStartedAt || session.activatedAt);
    delete publicValue.ruleStatisticsObserver;
    if (localStore) {
      publicValue.localActionProfileName = localActionProfileName(session, localStore);
      publicValue.effectiveLocalActions = sessionLocalActionConfig(session, localStore);
    }
    return publicValue;
  }


  const RULE_STATISTICS_SCHEMA = 1;
  const TERMINAL_PIPELINE_STATES = new Set(["completed", "dry-run-complete", "verified", "verify-failed", "failed"]);

  function emptyRuleStatistics(ruleId = "", ruleName = "", startedAt = null) {
    return {
      schema: RULE_STATISTICS_SCHEMA,
      ruleId: String(ruleId || ""),
      ruleName: String(ruleName || ruleId || "Rule"),
      startedAt: startedAt || Settings.nowIso(),
      updatedAt: null,
      matchCount: 0,
      clickCount: 0,
      dryRunCount: 0,
      verifyPassCount: 0,
      verifyFailCount: 0,
      verifySkippedCount: 0,
      commandSuccessCount: 0,
      commandFailureCount: 0,
      returnCodeCounts: {},
      lastReturnCode: null,
      targetLatencyCount: 0,
      totalTargetLatencyMs: 0,
      pipelineDurationCount: 0,
      totalPipelineDurationMs: 0,
      lastMatchedAt: null,
      lastTargetAt: null,
      lastVerifyAt: null,
      lastCommandAt: null,
      lastEventAt: null
    };
  }

  function normalizeRuleStatisticsEntry(raw, ruleId = "", ruleName = "", startedAt = null) {
    const source = raw && typeof raw === "object" ? raw : {};
    const value = emptyRuleStatistics(ruleId || source.ruleId, ruleName || source.ruleName, source.startedAt || startedAt);
    const counters = [
      "matchCount", "clickCount", "dryRunCount", "verifyPassCount", "verifyFailCount", "verifySkippedCount",
      "commandSuccessCount", "commandFailureCount", "targetLatencyCount", "totalTargetLatencyMs",
      "pipelineDurationCount", "totalPipelineDurationMs"
    ];
    for (const key of counters) value[key] = Math.max(0, Number(source[key]) || 0);
    const returnCodes = source.returnCodeCounts && typeof source.returnCodeCounts === "object" ? source.returnCodeCounts : {};
    value.returnCodeCounts = Object.fromEntries(Object.entries(returnCodes)
      .filter(([key, count]) => String(key).length <= 32 && Number(count) > 0)
      .map(([key, count]) => [String(key), Math.max(0, Number(count) || 0)]));
    value.lastReturnCode = Number.isInteger(source.lastReturnCode) ? source.lastReturnCode : null;
    for (const key of ["updatedAt", "lastMatchedAt", "lastTargetAt", "lastVerifyAt", "lastCommandAt", "lastEventAt"]) {
      value[key] = source[key] ? String(source[key]) : null;
    }
    return value;
  }

  function normalizeRuleStatisticsMap(raw, startedAt = null) {
    const source = raw && typeof raw === "object" ? raw : {};
    return Object.fromEntries(Object.entries(source)
      .filter(([ruleId, value]) => ruleId && value && typeof value === "object")
      .map(([ruleId, value]) => [String(ruleId), normalizeRuleStatisticsEntry(value, ruleId, value.ruleName, startedAt)]));
  }

  function emptyRuleStatisticsObserver(runtime = null) {
    const source = runtime && typeof runtime === "object" ? runtime : {};
    return {
      monitorState: String(source.monitorState || "idle"),
      cycle: Math.max(0, Number(source.cycle) || 0),
      clickedCount: Math.max(0, Number(source.clickedCount) || 0),
      dryRunCount: Math.max(0, Number(source.dryRunCount) || 0),
      pipelineState: String(source.pipelineState || "idle"),
      lastTargetAction: source.lastTargetAction ? String(source.lastTargetAction) : null,
      commandRunIds: []
    };
  }

  function normalizeRuleStatisticsObserverMap(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    return Object.fromEntries(Object.entries(source).map(([ruleId, value]) => {
      const observer = emptyRuleStatisticsObserver(value);
      observer.commandRunIds = Array.isArray(value?.commandRunIds) ? value.commandRunIds.map(String).slice(-50) : [];
      return [String(ruleId), observer];
    }));
  }

  function ruleStatisticsElapsedMs(start, end) {
    const left = Date.parse(String(start || ""));
    const right = Date.parse(String(end || ""));
    return Number.isFinite(left) && Number.isFinite(right) && right >= left ? right - left : null;
  }

  function ensureRuleStatistics(session, ruleId, ruleName, eventAt) {
    session.statisticsStartedAt = session.statisticsStartedAt || session.activatedAt || eventAt || Settings.nowIso();
    session.ruleStatistics = normalizeRuleStatisticsMap(session.ruleStatistics, session.statisticsStartedAt);
    const current = session.ruleStatistics[ruleId] || emptyRuleStatistics(ruleId, ruleName, session.statisticsStartedAt);
    current.ruleName = String(ruleName || current.ruleName || ruleId);
    session.ruleStatistics[ruleId] = current;
    return current;
  }

  function updateRuleStatistics(session, previousRuntime, currentRuntime) {
    const currentRules = currentRuntime?.ruleRuntimes && typeof currentRuntime.ruleRuntimes === "object"
      ? currentRuntime.ruleRuntimes : {};
    const previousRules = previousRuntime?.ruleRuntimes && typeof previousRuntime.ruleRuntimes === "object"
      ? previousRuntime.ruleRuntimes : {};
    session.ruleStatisticsObserver = normalizeRuleStatisticsObserverMap(session.ruleStatisticsObserver);
    for (const [ruleId, current] of Object.entries(currentRules)) {
      if (!current || typeof current !== "object") continue;
      const eventAt = String(current.lastEventAt || currentRuntime?.lastEventAt || Settings.nowIso());
      const statistics = ensureRuleStatistics(session, ruleId, current.ruleName, eventAt);
      const observer = session.ruleStatisticsObserver[ruleId] || emptyRuleStatisticsObserver(previousRules[ruleId]);
      let changed = false;

      if (current.monitorState === MONITOR_STATE.MATCHED && observer.monitorState !== MONITOR_STATE.MATCHED) {
        statistics.matchCount += 1;
        statistics.lastMatchedAt = eventAt;
        changed = true;
      }

      const cycle = Math.max(0, Number(current.cycle) || 0);
      const clickedCount = Math.max(0, Number(current.clickedCount) || 0);
      const dryRunCount = Math.max(0, Number(current.dryRunCount) || 0);
      const sameOrNewerCycle = cycle >= observer.cycle;
      const clickDelta = sameOrNewerCycle
        ? Math.max(0, cycle === observer.cycle ? clickedCount - observer.clickedCount : clickedCount)
        : 0;
      const dryRunDelta = sameOrNewerCycle
        ? Math.max(0, cycle === observer.cycle ? dryRunCount - observer.dryRunCount : dryRunCount)
        : 0;
      if (clickDelta || dryRunDelta) {
        statistics.clickCount += clickDelta;
        statistics.dryRunCount += dryRunDelta;
        statistics.lastTargetAt = String(current.lastTargetAt || eventAt);
        const latency = ruleStatisticsElapsedMs(statistics.lastMatchedAt, statistics.lastTargetAt);
        if (latency !== null) {
          statistics.targetLatencyCount += 1;
          statistics.totalTargetLatencyMs += latency;
        }
        changed = true;
      }

      const pipelineState = String(current.pipelineState || "idle");
      if (pipelineState !== observer.pipelineState && TERMINAL_PIPELINE_STATES.has(pipelineState)) {
        const verifyResult = current.verifyResult && typeof current.verifyResult === "object" ? current.verifyResult : null;
        if (verifyResult?.skipped) statistics.verifySkippedCount += 1;
        else if (verifyResult?.passed === true) statistics.verifyPassCount += 1;
        else if (verifyResult?.passed === false || pipelineState === "verify-failed") statistics.verifyFailCount += 1;
        if (verifyResult || pipelineState === "verify-failed" || pipelineState === "verified") {
          statistics.lastVerifyAt = eventAt;
        }
        const duration = ruleStatisticsElapsedMs(current.pipelineStartedAt, eventAt);
        if (duration !== null) {
          statistics.pipelineDurationCount += 1;
          statistics.totalPipelineDurationMs += duration;
        }
        changed = true;
      }

      observer.monitorState = String(current.monitorState || "idle");
      observer.cycle = cycle;
      observer.clickedCount = clickedCount;
      observer.dryRunCount = dryRunCount;
      observer.pipelineState = pipelineState;
      observer.lastTargetAction = current.lastTargetAction ? String(current.lastTargetAction) : null;
      session.ruleStatisticsObserver[ruleId] = observer;
      if (changed) {
        statistics.updatedAt = eventAt;
        statistics.lastEventAt = eventAt;
      }
    }
  }

  function recordRuleCommandStatistics(session, run, event) {
    if (!session || run?.source !== "automation" || !run.ruleId || !["exited", "error"].includes(event)) return;
    session.ruleStatisticsObserver = normalizeRuleStatisticsObserverMap(session.ruleStatisticsObserver);
    const ruleId = String(run.ruleId);
    const observer = session.ruleStatisticsObserver[ruleId] || emptyRuleStatisticsObserver();
    const runKey = String(run.runId || `${ruleId}:${run.cycle ?? ""}:${run.startedAt || ""}`);
    if (observer.commandRunIds.includes(runKey)) return;
    observer.commandRunIds.push(runKey);
    observer.commandRunIds = observer.commandRunIds.slice(-50);
    session.ruleStatisticsObserver[ruleId] = observer;

    const eventAt = String(run.endedAt || Settings.nowIso());
    const statistics = ensureRuleStatistics(session, ruleId, run.ruleName, eventAt);
    const successful = event === "exited" && Number(run.returnCode) === 0;
    if (successful) statistics.commandSuccessCount += 1;
    else statistics.commandFailureCount += 1;
    const key = event === "error" || !Number.isInteger(run.returnCode) ? "error" : String(run.returnCode);
    statistics.returnCodeCounts[key] = Math.max(0, Number(statistics.returnCodeCounts[key]) || 0) + 1;
    statistics.lastReturnCode = Number.isInteger(run.returnCode) ? run.returnCode : null;
    statistics.lastCommandAt = eventAt;
    statistics.lastEventAt = eventAt;
    statistics.updatedAt = eventAt;
  }

  async function resetRuleStatistics(tabId) {
    const session = sessions.get(tabId);
    if (!session) throw new Error("This tab is not activated.");
    const now = Settings.nowIso();
    session.statisticsStartedAt = now;
    session.ruleStatistics = {};
    session.ruleStatisticsObserver = Object.fromEntries(Object.entries(session.runtime?.ruleRuntimes || {})
      .map(([ruleId, runtime]) => [ruleId, emptyRuleStatisticsObserver(runtime)]));
    appendLog(session, "user", "rule-statistics-reset", "Per-rule statistics were reset for this tab session.");
    await persistSession(session);
    await broadcast("rule-statistics-reset", tabId);
    return clone(session.ruleStatistics);
  }

  function newRuntime() {
    return {
      monitorState: MONITOR_STATE.IDLE,
      cycle: 0,
      ruleCount: 1,
      enabledRuleCount: 1,
      matchedRuleCount: 0,
      matchedRuleIds: [],
      activeRuleId: "rule-default",
      lastRuleId: null,
      lastRuleName: null,
      ruleRuntimes: {},
      baselineCount: 0,
      candidateCount: 0,
      targetState: "disabled",
      targetEnabled: false,
      targetSelector: "",
      targetTotalCount: 0,
      targetEligibleCount: 0,
      handledCount: 0,
      clickedCount: 0,
      dryRunCount: 0,
      targetCycle: 0,
      pipelineEnabled: false,
      pipelineState: "idle",
      pipelineBusy: false,
      pipelineStartedAt: null,
      verifyResult: null,
      automationCommandState: "idle",
      lastAutomationCommandRequest: null,
      lastAutomationCommandError: null,
      lastTargetAction: null,
      lastTargetAt: null,
      lastTargetError: null,
      monitorSelector: "",
      monitorCount: 0,
      monitorVisibleCount: 0,
      monitorHiddenCount: 0,
      monitorMatchedCount: 0,
      monitorAttributeMatchedCount: 0,
      visibilityTransitionMode: "none",
      lastVisibilityTransition: null,
      conditionMatched: false,
      pendingMonitorState: null,
      stabilityStartedAt: null,
      stabilityDueAt: null,
      stabilityDelayMs: 0,
      matchStableMs: 0,
      resetStableMs: 0,
      lastReason: null,
      lastTransition: null,
      alertActive: false,
      alertCycle: 0,
      titleBlinking: false,
      originalTitle: "",
      displayedTitle: "",
      alertStartedAt: null,
      alertAcknowledgedAt: null,
      alertDismissReason: null,
      lastUserActivityAt: null,
      activeVisibleSince: null,
      soundAlertState: "idle",
      soundAlertCycle: 0,
      soundAlertError: null,
      lastAlertReason: null,
      lastEventAt: null,
      recoveryState: Recovery.STATE.NONE,
      recoveryReason: null,
      recoveryStartedAt: null,
      recoveredAt: null,
      recoveryAttempts: 0,
      navigationPending: false
    };
  }

  function makeSession(tab, profileId, source, localActionProfileId = null) {
    const now = Settings.nowIso();
    return {
      ...tabMeta(tab),
      pageTitle: typeof tab?.title === "string" ? tab.title : "",
      customTitle: "",
      mode: MODE.ACTIVE,
      activatedAt: now,
      updatedAt: now,
      source,
      sessionToken: Settings.makeId("session"),
      error: null,
      profileId,
      configMode: CONFIG_MODE.PROFILE,
      tabConfig: null,
      configRevision: 1,
      localActionProfileId: localActionProfileId || LocalActions.DEFAULT_PROFILE_ID,
      localActionConfigMode: CONFIG_MODE.PROFILE,
      localActionTabConfig: null,
      localActionRevision: 1,
      localActionWorkingConfig: null,
      localActionWorkingContext: null,
      runtime: newRuntime(),
      statisticsStartedAt: now,
      ruleStatistics: {},
      ruleStatisticsObserver: {},
      logs: { user: [], debug: [] },
      downloadJob: emptyDownloadState(tab.id),
      shellHistory: [],
      shellNotice: emptyShellNotice(tab.id),
      automationCommandRequestIds: []
    };
  }

  function serializableSession(session) {
    return clone(session);
  }

  async function persistSession(session) {
    if (!Number.isInteger(session?.tabId)) {
      return;
    }
    await browser.sessions.setTabValue(
      session.tabId,
      TAB_SESSION_KEY,
      serializableSession(session)
    );
  }

  async function removePersistedSession(tabId) {
    try {
      await browser.sessions.removeTabValue(tabId, TAB_SESSION_KEY);
    } catch (_error) {
      // The tab may already be closed.
    }
  }

  function normalizeLogs(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    return {
      user: Array.isArray(source.user) ? source.user.slice(-80) : [],
      debug: Array.isArray(source.debug) ? source.debug.slice(-120) : []
    };
  }

  function appendLog(session, channel, event, message, detail = null) {
    if (!session) {
      return;
    }
    session.logs = normalizeLogs(session.logs);
    const key = channel === "debug" ? "debug" : "user";
    session.logs[key].push({
      at: Settings.nowIso(),
      event: String(event || "event"),
      message: String(message || ""),
      detail: detail === null || detail === undefined ? null : clone(detail)
    });
    const limit = key === "debug" ? 120 : 80;
    if (session.logs[key].length > limit) {
      session.logs[key].splice(0, session.logs[key].length - limit);
    }
  }

  async function applyBadge(tabId, text, color = null) {
    if (!Number.isInteger(tabId)) {
      return;
    }
    await browser.action.setBadgeText({ tabId, text });
    if (color) {
      await browser.action.setBadgeBackgroundColor({ tabId, color });
    }
  }

  async function updateBadge(session, store) {
    if (!session) {
      return;
    }
    const config = sessionConfig(session, store);
    if ([Recovery.STATE.PERMISSION_REQUIRED, Recovery.STATE.URL_BLOCKED, Recovery.STATE.FAILED].includes(session.runtime?.recoveryState)) {
      await applyBadge(session.tabId, "?", "#8250df");
      return;
    }
    if (session.runtime?.recoveryState === Recovery.STATE.NAVIGATION_PENDING) {
      await applyBadge(session.tabId, "…", "#57606a");
      return;
    }
    if (session.mode === MODE.ERROR) {
      await applyBadge(session.tabId, "!", "#cf222e");
      return;
    }
    if (session.mode === MODE.PAUSED) {
      await applyBadge(session.tabId, "II", "#9a6700");
      return;
    }
    if (session.mode === MODE.ACTIVE && session.runtime?.alertActive && config.alerts.badge) {
      await applyBadge(session.tabId, "RD", "#238636");
      return;
    }
    if (session.mode === MODE.ACTIVE) {
      await applyBadge(session.tabId, "ON", "#238636");
      return;
    }
    const shellNotice = normalizeShellNotice(session.shellNotice, session.tabId);
    if (shellNotice.status === "running") {
      await applyBadge(session.tabId, "⌘", "#0969da");
      return;
    }
    if (shellNotice.status === "unread") {
      await applyBadge(session.tabId, "✓", "#9a6700");
      return;
    }
    await applyBadge(session.tabId, "", null);
  }

  async function clearNotification(tabId) {
    try {
      await browser.notifications.clear(`fci-tab-${tabId}`);
    } catch (_error) {
      // Notification may not exist.
    }
  }

  async function showMatchedNotification(session, store) {
    const config = sessionConfig(session, store);
    if (!config.alerts.notification) {
      return;
    }
    await browser.notifications.create(`fci-tab-${session.tabId}`, {
      type: "basic",
      iconUrl: browser.runtime.getURL("icons/icon.svg"),
      title: "Firefox ChatAI Assistant — condition matched",
      message: `${session.runtime.originalTitle || session.title || session.url}
Tab ${session.tabId}, cycle ${session.runtime.cycle || 0}`
    });
  }

  async function broadcast(reason, changedTabId = null) {
    try {
      await browser.runtime.sendMessage({
        type: MESSAGE.DASHBOARD_CHANGED,
        reason,
        changedTabId
      });
    } catch (_error) {
      // Sidebar may be closed.
    }
  }

  function scheduleRuntimeBroadcast(tabId) {
    if (runtimeBroadcastTimers.has(tabId)) {
      return;
    }
    const timer = setTimeout(() => {
      runtimeBroadcastTimers.delete(tabId);
      void broadcast("runtime-updated", tabId);
    }, 120);
    runtimeBroadcastTimers.set(tabId, timer);
  }

  function assertPersistedConfig(expected, actual, label) {
    const left = JSON.stringify(Settings.normalizeConfig(expected));
    const right = JSON.stringify(Settings.normalizeConfig(actual));
    if (left !== right) {
      throw new Error(`${label}: the persisted configuration does not match the input.`);
    }
  }

  async function currentTab() {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  async function applySessionToContent(session, store, messageType = MESSAGE.CONTENT_APPLY_SESSION) {
    const snapshot = publicSession(session, store);
    const response = await browser.tabs.sendMessage(session.tabId, {
      type: messageType,
      payload: { session: snapshot }
    });
    if (response?.runtime) {
      session.runtime = { ...session.runtime, ...response.runtime };
    }
    session.updatedAt = response?.updatedAt || Settings.nowIso();
    return response;
  }

  async function hasHostPermission(rawUrl) {
    const origin = hostPermissionPattern(rawUrl);
    return Boolean(origin && await browser.permissions.contains({ origins: [origin] }));
  }

  function recoveryRuntime(session, reason) {
    return Recovery.prepareRuntime(
      { ...newRuntime(), ...(session.runtime || {}) },
      session.mode,
      reason,
      Settings.nowIso()
    );
  }

  async function markRecoveryDeferred(session, store, state, reason) {
    session.runtime = {
      ...recoveryRuntime(session, reason),
      recoveryState: state,
      recoveryReason: reason,
      navigationPending: state === Recovery.STATE.NAVIGATION_PENDING
    };
    session.updatedAt = Settings.nowIso();
    appendLog(session, "user", "session-recovery-deferred", reason, { state, url: session.url });
    await persistSession(session);
    await updateBadge(session, store);
    await broadcast("session-recovery-deferred", session.tabId);
    return false;
  }

  async function reattachSession(session, store, reason = "background-recovery") {
    const tab = await browser.tabs.get(session.tabId);
    session.url = tab.url || session.url;
    const customTitleState = await loadCustomTitleState(session.tabId, tab.title || session.pageTitle || session.title || "");
    applyCustomTitleStateToSession(session, customTitleState, tab.title || session.pageTitle || session.title || "");
    session.windowId = tab.windowId;
    session.index = tab.index;

    const config = sessionConfig(session, store);
    const permitted = await hasHostPermission(session.url);
    const decision = Recovery.decision({
      supportedUrl: isSupportedUrl(session.url),
      urlAllowed: Settings.urlAllowed(config, session.url),
      hostPermission: permitted
    });
    if (decision === Recovery.STATE.URL_BLOCKED) {
      session.mode = MODE.PAUSED;
      return markRecoveryDeferred(
        session,
        store,
        decision,
        "The current URL no longer matches the profile or tab configuration; the session remains paused."
      );
    }
    if (decision === Recovery.STATE.PERMISSION_REQUIRED) {
      return markRecoveryDeferred(
        session,
        store,
        decision,
        "Firefox must grant site access again before the content runtime can be recovered."
      );
    }

    session.runtime = recoveryRuntime(session, reason);
    await ensureContentScripts(session.tabId);
    const response = await applySessionToContent(session, store, MESSAGE.CONTENT_APPLY_SESSION);
    session.runtime = {
      ...session.runtime,
      ...(response?.runtime || {}),
      recoveryState: Recovery.STATE.ATTACHED,
      recoveryReason: reason,
      recoveredAt: Settings.nowIso(),
      navigationPending: false
    };
    session.updatedAt = response?.updatedAt || Settings.nowIso();
    appendLog(session, "user", "session-recovered", "The content runtime was recovered and a new baseline was created.", {
      reason,
      mode: session.mode,
      url: session.url,
      attempts: session.runtime.recoveryAttempts
    });
    await persistSession(session);
    await updateBadge(session, store);
    await broadcast("session-recovered", session.tabId);
    return true;
  }

  async function recoverOne(tab, store, localStore) {
    if (!Number.isInteger(tab?.id) || sessions.has(tab.id)) {
      return sessions.get(tab?.id) || null;
    }

    let stored;
    try {
      stored = await browser.sessions.getTabValue(tab.id, TAB_SESSION_KEY);
    } catch (_error) {
      return null;
    }
    if (!stored || ![MODE.ACTIVE, MODE.PAUSED].includes(stored.mode)) {
      return null;
    }

    const recovered = {
      ...stored,
      ...tabMeta(tab),
      pageTitle: stored.pageTitle || tab.title || "",
      customTitle: stored.customTitle || "",
      sessionToken: stored.sessionToken || Settings.makeId("session"),
      runtime: { ...newRuntime(), ...(stored.runtime || {}) },
      statisticsStartedAt: stored.statisticsStartedAt || stored.activatedAt || Settings.nowIso(),
      ruleStatistics: normalizeRuleStatisticsMap(stored.ruleStatistics, stored.statisticsStartedAt || stored.activatedAt),
      ruleStatisticsObserver: normalizeRuleStatisticsObserverMap(stored.ruleStatisticsObserver),
      logs: normalizeLogs(stored.logs),
      downloadJob: normalizeDownloadState(stored.downloadJob, tab.id),
      shellHistory: normalizeShellHistory(stored.shellHistory, 100),
      shellNotice: normalizeShellNotice(stored.shellNotice, tab.id)
    };
    const recoveredCustomTitle = await loadCustomTitleState(tab.id, recovered.pageTitle || tab.title || "");
    applyCustomTitleStateToSession(recovered, recoveredCustomTitle, tab.title || recovered.pageTitle || "");
    if (recovered.shellNotice.status === "running") {
      recovered.shellNotice = normalizeShellNotice({
        ...recovered.shellNotice,
        status: "unread",
        completedAt: recovered.shellNotice.completedAt || Settings.nowIso(),
        viewedAt: null,
        error: recovered.shellNotice.error || "Firefox restarted before the final command state was received; inspect the command log."
      }, tab.id);
    }
    if (!Settings.profileById(store, recovered.profileId)) {
      recovered.profileId = store.defaultProfileId;
      recovered.configMode = CONFIG_MODE.PROFILE;
      recovered.tabConfig = null;
    }
    if (!LocalActions.profileById(localStore, recovered.localActionProfileId)) {
      const routed = LocalActions.routeProfile(localStore, recovered.url || tab.url || "");
      recovered.localActionProfileId = routed.profileId || localStore.defaultProfileId;
      recovered.localActionConfigMode = CONFIG_MODE.PROFILE;
      recovered.localActionTabConfig = null;
    }
    recovered.localActionConfigMode = recovered.localActionConfigMode === CONFIG_MODE.TAB ? CONFIG_MODE.TAB : CONFIG_MODE.PROFILE;
    recovered.localActionTabConfig = recovered.localActionConfigMode === CONFIG_MODE.TAB
      ? LocalActions.normalizeConfig(recovered.localActionTabConfig)
      : null;
    recovered.localActionRevision = Math.max(1, Number(recovered.localActionRevision || 1));
    recovered.localActionWorkingConfig = recovered.localActionWorkingConfig
      ? LocalActions.normalizeConfig(recovered.localActionWorkingConfig)
      : null;
    recovered.localActionWorkingContext = recovered.localActionWorkingContext && typeof recovered.localActionWorkingContext === "object"
      ? clone(recovered.localActionWorkingContext)
      : null;
    normalizeWorkingLocalActionSnapshot(recovered);
    sessions.set(tab.id, recovered);
    try {
      await recoverLegacyShellLogs(recovered);
      await recoverDownloadJob(recovered);
      await reattachSession(recovered, store, "background-startup");
      await syncShellNoticeToContent(recovered);
      await updateBadge(recovered, store);
    } catch (error) {
      recovered.runtime = {
        ...recoveryRuntime(recovered, "background-startup"),
        recoveryState: Recovery.STATE.FAILED,
        recoveryReason: error instanceof Error ? error.message : String(error)
      };
      appendLog(recovered, "user", "session-recovery-failed", recovered.runtime.recoveryReason);
      await persistSession(recovered);
      await updateBadge(recovered, store);
    }
    return recovered;
  }

  async function recoverAll() {
    if (!recoveryPromise) {
      recoveryPromise = (async () => {
        const [store, localStore] = await Promise.all([loadStore(), loadLocalActionStore()]);
        const tabs = await browser.tabs.query({});
        await Promise.all(tabs.map((tab) => recoverOne(tab, store, localStore)));
      })().finally(() => {
        recoveryPromise = null;
      });
    }
    await recoveryPromise;
  }

  async function ensureContentScripts(tabId) {
    await browser.scripting.executeScript({
      target: { tabId },
      files: [
        "shared/browser_compat.js",
        "shared/protocol.js",
        "shared/settings.js",
        "shared/alert_sound.js",
        "content/monitor.js",
        "content/target.js",
        "content/alert.js",
        "content/rules.js",
        "content/picker.js",
        "content/activation.js"
      ]
    });
  }

  function publicPickerState(tabId) {
    const state = pickerStates.get(Number(tabId));
    return state ? clone(state) : null;
  }

  async function startElementPicker(tabId, kind) {
    if (!["monitor", "target", "verify"].includes(kind)) {
      throw new Error("The element picker type is invalid.");
    }
    await ensureInteractiveTab(tabId);
    const previous = pickerStates.get(tabId);
    if (previous) {
      try {
        await browser.tabs.sendMessage(tabId, {
          type: MESSAGE.CONTENT_CANCEL_ELEMENT_PICKER,
          payload: { reason: "replaced" }
        });
      } catch (_error) {
        // A stale picker context can be replaced safely.
      }
    }
    const response = await browser.tabs.sendMessage(tabId, {
      type: MESSAGE.CONTENT_START_ELEMENT_PICKER,
      payload: { kind }
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Could not start the element picker.");
    }
    const state = {
      tabId,
      kind,
      status: "active",
      startedAt: Settings.nowIso()
    };
    pickerStates.set(tabId, state);
    return clone(state);
  }

  async function cancelElementPicker(tabId, reason = "sidebar-cancel") {
    const existing = pickerStates.get(tabId);
    if (!existing) {
      return { tabId, status: "inactive", cancelled: false };
    }
    try {
      await browser.tabs.sendMessage(tabId, {
        type: MESSAGE.CONTENT_CANCEL_ELEMENT_PICKER,
        payload: { reason }
      });
    } catch (_error) {
      // Navigation may already have removed the picker runtime.
    }
    pickerStates.delete(tabId);
    return { ...clone(existing), status: "inactive", cancelled: true, reason };
  }

  async function handleElementPickerResult(message, sender) {
    const tabId = sender?.tab?.id;
    if (!Number.isInteger(tabId)) {
      throw new Error("The element picker result has no valid tab ID.");
    }
    const activePicker = pickerStates.get(tabId);
    if (!activePicker) {
      return { ignored: true, reason: "no-active-picker" };
    }
    const payload = message.payload && typeof message.payload === "object" ? message.payload : {};
    const kind = payload.kind === activePicker.kind ? activePicker.kind : null;
    if (!kind) {
      throw new Error("The element picker result does not match the active picker session.");
    }
    pickerStates.delete(tabId);
    const result = {
      tabId,
      kind,
      cancelled: Boolean(payload.cancelled),
      reason: String(payload.reason || ""),
      selector: payload.selector || null,
      css: String(payload.css || ""),
      matchCount: Number(payload.matchCount) || 0,
      strategy: String(payload.strategy || ""),
      elementSummary: String(payload.elementSummary || ""),
      completedAt: Settings.nowIso()
    };
    if (!result.cancelled) {
      Settings.selectorToCss(result.selector);
    }
    const session = sessions.get(tabId);
    if (session) {
      appendLog(
        session,
        "user",
        result.cancelled ? "element-picker-cancelled" : "element-picker-selected",
        result.cancelled
          ? `Cancelled ${kind === "monitor" ? "monitor element" : (kind === "verify" ? "verification element" : "target")} selection.`
          : `Selected ${kind === "monitor" ? "monitor element" : (kind === "verify" ? "verification element" : "target")}: ${result.css}`,
        result
      );
      await persistSession(session);
    }
    try {
      await browser.runtime.sendMessage({ type: MESSAGE.PICKER_RESULT, ...result });
    } catch (_error) {
      // Sidebar may be closed; the selected selector is intentionally not auto-saved.
    }
    return result;
  }

  async function testSelector(tabId, rawSelector, visibility = "any", rawConfig = null, kind = "selector") {
    const tab = await browser.tabs.get(tabId);
    const active = await currentTab();
    if (!Number.isInteger(active?.id) || active.id !== tabId) {
      throw new Error("Only the currently displayed tab can be tested or highlighted.");
    }
    if (!isSupportedUrl(tab.url)) {
      throw new Error("Selectors can be tested only on normal HTTP or HTTPS pages.");
    }

    const origin = hostPermissionPattern(tab.url);
    const granted = origin && await browser.permissions.contains({ origins: [origin] });
    if (!granted) {
      throw new Error("Firefox has not granted access to the current site.");
    }

    await ensureContentScripts(tabId);
    const response = await browser.tabs.sendMessage(tabId, {
      type: MESSAGE.CONTENT_TEST_SELECTOR,
      payload: {
        selector: rawSelector,
        visibility,
        durationMs: 8000,
        monitorConfig: kind === "monitor" && rawConfig
          ? Settings.normalizeConfig(rawConfig).monitor
          : null
      }
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Could not test the selector.");
    }
    return response.result;
  }

  async function ensureInteractiveTab(tabId) {
    const tab = await browser.tabs.get(tabId);
    const active = await currentTab();
    if (!Number.isInteger(active?.id) || active.id !== tabId) {
      throw new Error("Test actions are allowed only in the currently displayed tab.");
    }
    if (!isSupportedUrl(tab.url)) {
      throw new Error("Actions are allowed only on normal HTTP or HTTPS pages.");
    }
    const origin = hostPermissionPattern(tab.url);
    const granted = origin && await browser.permissions.contains({ origins: [origin] });
    if (!granted) {
      throw new Error("Firefox has not granted access to the current site.");
    }
    await ensureContentScripts(tabId);
    return tab;
  }

  async function testTargetAction(tabId, rawConfig, click = false) {
    await ensureInteractiveTab(tabId);
    const response = await browser.tabs.sendMessage(tabId, {
      type: MESSAGE.CONTENT_TEST_TARGET_ACTION,
      payload: {
        config: Settings.normalizeConfig(rawConfig),
        click: Boolean(click),
        durationMs: 8000
      }
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Could not test the target action.");
    }
    const session = sessions.get(tabId);
    if (session) {
      appendLog(
        session,
        "user",
        click ? "target-test-click" : "target-test-dry-run",
        click
          ? `Clicked ${response.result.selectedCount} current target(s) for testing.`
          : `Highlighted ${response.result.selectedCount} current target(s) for testing.`,
        response.result
      );
      await persistSession(session);
    }
    await broadcast("target-test", tabId);
    return response.result;
  }

  async function clearHighlights(tabId) {
    await ensureInteractiveTab(tabId);
    const response = await browser.tabs.sendMessage(tabId, {
      type: MESSAGE.CONTENT_CLEAR_HIGHLIGHTS
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Could not clear highlights.");
    }
    return response.result;
  }

  async function clearSessionLogs(tabId) {
    const session = sessions.get(tabId);
    if (!session) {
      throw new Error("This tab is not activated.");
    }
    session.logs = { user: [], debug: [] };
    await persistSession(session);
    await broadcast("logs-cleared", tabId);
  }

  async function armDownloadCaptureFromContent(message, sender) {
    const tabId = sender?.tab?.id;
    if (!Number.isInteger(tabId)) {
      throw new Error("The download capture request has no valid tab ID.");
    }
    const session = sessions.get(tabId);
    if (!session) {
      throw new Error("This tab is not activated.");
    }
    const payloadTabId = Number(message.payload?.tabId);
    if (Number.isInteger(payloadTabId) && payloadTabId !== tabId) {
      throw new Error("The download capture tab ID does not match the sender.");
    }
    if (session.sessionToken && message.payload?.sessionToken !== session.sessionToken) {
      throw new Error("The download capture request belongs to a stale tab session.");
    }
    return armDownloadCapture(tabId, message.payload || {});
  }

  async function updateRuntimeFromContent(message, sender) {
    const tabId = sender?.tab?.id;
    if (!Number.isInteger(tabId)) {
      throw new Error("The runtime event has no valid tab ID.");
    }
    const session = sessions.get(tabId);
    if (!session) {
      return null;
    }
    const payloadTabId = Number(message.payload?.tabId);
    if (Number.isInteger(payloadTabId) && payloadTabId !== tabId) {
      return null;
    }
    const incomingSessionToken = message.payload?.sessionToken;
    if (session.sessionToken && incomingSessionToken !== session.sessionToken) {
      return null;
    }
    const store = await loadStore();
    const previous = { ...session.runtime };
    const incoming = { ...(message.payload?.runtime || {}) };
    const automationCommandRequest = incoming.commandRequest || null;
    delete incoming.commandRequest;
    session.runtime = { ...session.runtime, ...incoming };
    session.updatedAt = session.runtime.lastEventAt || Settings.nowIso();
    updateRuleStatistics(session, previous, session.runtime);

    if (previous.monitorState !== session.runtime.monitorState) {
      appendLog(
        session,
        "user",
        "monitor-state",
        `Monitor ${previous.monitorState || "unknown"} → ${session.runtime.monitorState || "unknown"}`,
        { cycle: session.runtime.cycle, reason: session.runtime.lastReason }
      );
    }
    if (session.runtime.lastTransition && session.runtime.lastTransition !== previous.lastTransition) {
      appendLog(session, "debug", "monitor-transition", session.runtime.lastTransition, incoming);
    }
    if (session.runtime.lastTargetAction && session.runtime.lastTargetAction !== previous.lastTargetAction) {
      appendLog(
        session,
        session.runtime.lastTargetAction.startsWith("click:") || session.runtime.lastTargetAction.startsWith("dry-run:") ? "user" : "debug",
        "target-action",
        session.runtime.lastTargetAction,
        { clicked: session.runtime.clickedCount, dryRun: session.runtime.dryRunCount }
      );
    }
    if (session.runtime.pipelineState && session.runtime.pipelineState !== previous.pipelineState) {
      const channel = ["verified", "verify-failed", "failed"].includes(session.runtime.pipelineState) ? "user" : "debug";
      appendLog(session, channel, "target-pipeline", session.runtime.pipelineState, session.runtime.verifyResult || null);
    }
    if (session.runtime.lastTargetError && session.runtime.lastTargetError !== previous.lastTargetError) {
      appendLog(session, "user", "target-error", session.runtime.lastTargetError);
    }
    appendLog(session, "debug", "runtime", session.runtime.lastReason || session.runtime.lastTargetAction || "runtime-update", incoming);

    const alertStarted = Boolean(session.runtime.alertActive) && (
      !previous.alertActive || Number(session.runtime.alertCycle || 0) > Number(previous.alertCycle || 0)
    );
    const alertDismissed = Boolean(previous.alertActive) && !session.runtime.alertActive;
    if (alertStarted) {
      appendLog(
        session,
        "user",
        "alert-started",
        `Alert cycle ${session.runtime.alertCycle || session.runtime.cycle || 0} started.`,
        { monitorState: session.runtime.monitorState, reason: session.runtime.lastAlertReason }
      );
    }
    if (alertDismissed) {
      appendLog(
        session,
        "user",
        "alert-dismissed",
        `Alert dismissed: ${session.runtime.alertDismissReason || "unknown"}.`,
        { acknowledgedAt: session.runtime.alertAcknowledgedAt }
      );
    }
    await updateBadge(session, store);
    if (alertStarted) {
      await showMatchedNotification(session, store);
    } else if (alertDismissed) {
      await clearNotification(tabId);
    }
    if (automationCommandRequest) {
      await processAutomationCommandRequest(session, automationCommandRequest, store);
    }
    await persistSession(session);
    scheduleRuntimeBroadcast(tabId);
    return clone(session.runtime);
  }

  function autoActivationDecision(tab, status, detail = {}) {
    const value = {
      tabId: Number(tab?.id),
      url: String(tab?.url || ""),
      title: String(tab?.title || ""),
      status,
      reason: String(detail.reason || ""),
      profileId: detail.profileId || null,
      profileName: detail.profileName || null,
      matchedPattern: detail.matchedPattern || null,
      source: detail.source || null,
      signature: detail.signature || null,
      at: Settings.nowIso()
    };
    if (Number.isInteger(value.tabId)) autoActivationAudit.set(value.tabId, value);
    return value;
  }

  async function attemptAutoActivation(tab, reason = "tab-complete") {
    if (!Number.isInteger(tab?.id) || !isSupportedUrl(tab?.url)) return { status: "unsupported" };
    if (sessions.has(tab.id)) {
      return autoActivationDecision(tab, "skipped", { reason: "tab-already-active", source: reason });
    }
    if (await loadStoppedTabConfigSnapshot(tab.id)) {
      return autoActivationDecision(tab, "skipped", { reason: "tab-explicitly-stopped", source: reason });
    }
    const store = await loadStore();
    const routing = Settings.routeAutoActivation(store, tab.url);
    if (!routing.matched || !routing.profileId) {
      return autoActivationDecision(tab, "not-matched", { reason: "no-opt-in-profile-match", source: reason });
    }
    const candidate = routing.candidates[0] || {};
    const signature = `${tab.id}|${tab.url}|${routing.profileId}`;
    if (autoActivationInFlight.get(tab.id) === signature) {
      return autoActivationDecision(tab, "skipped", { reason: "activation-already-in-flight", source: reason, profileId: routing.profileId, profileName: routing.profileName, matchedPattern: candidate.bestPattern, signature });
    }
    autoActivationInFlight.set(tab.id, signature);
    try {
      if (!(await hasHostPermission(tab.url))) {
        return autoActivationDecision(tab, "permission-required", {
          reason: "Firefox host permission has not been granted for this URL.", source: reason,
          profileId: routing.profileId, profileName: routing.profileName, matchedPattern: candidate.bestPattern, signature
        });
      }
      const freshTab = await browser.tabs.get(tab.id);
      const freshRouting = Settings.routeAutoActivation(await loadStore(), freshTab.url || "");
      if (freshTab.url !== tab.url || freshRouting.profileId !== routing.profileId) {
        return autoActivationDecision(freshTab, "stale", { reason: "tab-url-or-profile-changed-before-activation", source: reason, signature });
      }
      await activateTab(freshTab, "url-auto", routing.profileId);
      const session = sessions.get(freshTab.id);
      if (session) {
        appendLog(session, "user", "auto-activated", `Tab automatically activated by URL profile “${routing.profileName}”.`, {
          reason, profileId: routing.profileId, matchedPattern: candidate.bestPattern, signature
        });
        await persistSession(session);
      }
      const decision = autoActivationDecision(freshTab, "activated", {
        reason, source: "url-auto", profileId: routing.profileId, profileName: routing.profileName,
        matchedPattern: candidate.bestPattern, signature
      });
      await broadcast("auto-activated", freshTab.id);
      return decision;
    } catch (error) {
      const decision = autoActivationDecision(tab, "error", {
        reason: error instanceof Error ? error.message : String(error), source: reason,
        profileId: routing.profileId, profileName: routing.profileName, matchedPattern: candidate.bestPattern, signature
      });
      await broadcast("auto-activation-error", tab.id);
      return decision;
    } finally {
      if (autoActivationInFlight.get(tab.id) === signature) autoActivationInFlight.delete(tab.id);
    }
  }

  async function scanAutoActivationTabs(reason = "manual-scan", onlyTabId = null) {
    const hasSpecificTab = onlyTabId !== null && onlyTabId !== undefined && Number.isInteger(Number(onlyTabId));
    const tabs = hasSpecificTab
      ? [await browser.tabs.get(Number(onlyTabId))]
      : await browser.tabs.query({});
    const report = { scanned: 0, activated: 0, permissionRequired: 0, skipped: 0, notMatched: 0, errors: 0, decisions: [] };
    for (const tab of tabs) {
      if (!Number.isInteger(tab?.id) || !isSupportedUrl(tab?.url)) continue;
      report.scanned += 1;
      const decision = await attemptAutoActivation(tab, reason);
      report.decisions.push(decision);
      if (decision.status === "activated") report.activated += 1;
      else if (decision.status === "permission-required") report.permissionRequired += 1;
      else if (decision.status === "not-matched") report.notMatched += 1;
      else if (decision.status === "error") report.errors += 1;
      else report.skipped += 1;
    }
    return report;
  }

  function scheduleAutoActivationScan(reason, delayMs = 120) {
    if (autoActivationScanTimer) clearTimeout(autoActivationScanTimer);
    autoActivationScanTimer = setTimeout(() => {
      autoActivationScanTimer = null;
      void scanAutoActivationTabs(reason).catch((error) => console.error("FirefoxChatImprover: automatic activation scan failed", error));
    }, Math.max(0, Number(delayMs) || 0));
  }

  async function activateTab(tab, source, requestedProfileId = null, requestedLocalActionProfileId = null, forceStoppedRestore = false, discardStoppedConfig = false) {
    if (!Number.isInteger(tab?.id)) {
      throw new Error("Could not determine the current tab.");
    }
    if (!isSupportedUrl(tab.url)) {
      throw new Error("Only normal HTTP or HTTPS pages can be activated.");
    }

    const [store, localStore] = await Promise.all([loadStore(), loadLocalActionStore()]);
    const existing = sessions.get(tab.id);
    if (existing) {
      const recoveryState = existing.runtime?.recoveryState;
      if ([
        Recovery.STATE.PERMISSION_REQUIRED,
        Recovery.STATE.URL_BLOCKED,
        Recovery.STATE.FAILED,
        Recovery.STATE.NAVIGATION_PENDING
      ].includes(recoveryState)) {
        const attached = await reattachSession(existing, store, "manual-recovery");
        if (!attached) {
          throw new Error(existing.runtime?.recoveryReason || "Could not recover the session in the current tab.");
        }
        return publicSession(existing, store);
      }
      if (existing.mode === MODE.PAUSED) {
        return resumeTab(tab.id);
      }
      return publicSession(existing, store);
    }

    const stoppedSnapshot = await loadStoppedTabConfigSnapshot(tab.id);
    const restoreStoppedSnapshot = Boolean(stoppedSnapshot) && !discardStoppedConfig && (
      forceStoppedRestore || source !== "sidebar" || !requestedProfileId ||
      String(requestedProfileId) === String(stoppedSnapshot.profileId)
    );
    const routing = requestedProfileId || restoreStoppedSnapshot ? null : Settings.routeProfile(store, tab.url);
    const profile = Settings.profileById(store, restoreStoppedSnapshot ? stoppedSnapshot.profileId : requestedProfileId) ||
      routing?.profile ||
      Settings.profileById(store, store.defaultProfileId) || store.profiles[0];
    const activationConfig = restoreStoppedSnapshot ? stoppedSnapshot.effectiveConfig : profile.config;
    if (!Settings.urlAllowed(activationConfig, tab.url)) {
      throw new Error(restoreStoppedSnapshot
        ? "The stopped tab configuration no longer allows the current URL. Select another profile or update its URL allowlist."
        : "The current URL does not match the selected profile allowlist.");
    }

    if (source === "sidebar") {
      const origin = hostPermissionPattern(tab.url);
      const granted = origin && await browser.permissions.contains({ origins: [origin] });
      if (!granted) {
        throw new Error(
          "Firefox has not granted access to this site. Click “Activate current tab” again and accept the permission prompt."
        );
      }
    }

    await ensureContentScripts(tab.id);

    const boundLocalActionProfileId = requestedLocalActionProfileId || await loadTabLocalActionProfileId(tab.id, localStore);
    const useStoppedLocalActions = restoreStoppedSnapshot && (
      !boundLocalActionProfileId || String(boundLocalActionProfileId) === String(stoppedSnapshot.localActionProfileId)
    );
    const boundLocalActionProfile = LocalActions.profileById(
      localStore,
      useStoppedLocalActions ? stoppedSnapshot.localActionProfileId : boundLocalActionProfileId
    );
    const localRouting = boundLocalActionProfile || useStoppedLocalActions ? null : LocalActions.routeProfile(localStore, tab.url);
    const localActionProfile = boundLocalActionProfile || localRouting?.profile ||
      LocalActions.profileById(localStore, localStore.defaultProfileId) || localStore.profiles[0];
    const session = makeSession(tab, profile.id, source, localActionProfile.id);
    if (restoreStoppedSnapshot) {
      applyStoppedTabConfigSnapshot(session, stoppedSnapshot, store, localStore);
      if (!useStoppedLocalActions && boundLocalActionProfile) {
        session.localActionProfileId = boundLocalActionProfile.id;
        session.localActionConfigMode = CONFIG_MODE.PROFILE;
        session.localActionTabConfig = null;
        clearWorkingLocalActionSnapshot(session);
      }
    }
    const customTitleState = await loadCustomTitleState(tab.id, tab.title || "");
    applyCustomTitleStateToSession(session, customTitleState, tab.title || "");
    try {
      await applySessionToContent(session, store, MESSAGE.CONTENT_ACTIVATE);
      appendLog(session, "user", "activated", `Tab activated by ${source}.`, {
        url: tab.url,
        profileId: profile.id,
        profileRouting: source === "url-auto" ? "auto-url-match" : (requestedProfileId ? "manual" : (routing?.matched ? "url-match" : "default-fallback")),
        matchedPattern: routing?.candidates?.[0]?.bestPattern || null,
        localActionProfileId: session.localActionProfileId,
        localActionRouting: boundLocalActionProfile ? "explicit-tab-binding" : (localRouting?.matched ? "url-match" : "default-fallback"),
        localActionMatchedPattern: localRouting?.candidates?.[0]?.bestPattern || null
      });
      sessions.set(tab.id, session);
      await persistSession(session);
      if (stoppedSnapshot) await clearStoppedTabConfigSnapshot(tab.id);
      await updateBadge(session, store);
      await broadcast(restoreStoppedSnapshot ? "stopped-config-restored" : "activated", tab.id);
      return publicSession(session, store);
    } catch (error) {
      sessions.delete(tab.id);
      try {
        await browser.tabs.sendMessage(tab.id, { type: MESSAGE.CONTENT_STOP });
      } catch (_stopError) {
        // A partially initialized content runtime may already be gone.
      }
      await removePersistedSession(tab.id);
      await clearNotification(tab.id);
      await applyBadge(tab.id, "", null);
      await broadcast("activation-rolled-back", tab.id);
      throw error;
    }
  }

  async function pauseTab(tabId) {
    const session = sessions.get(tabId);
    if (!session) {
      throw new Error("This tab is not activated.");
    }
    const response = await browser.tabs.sendMessage(tabId, {
      type: MESSAGE.CONTENT_PAUSE
    });
    session.mode = MODE.PAUSED;
    session.updatedAt = response?.updatedAt || Settings.nowIso();
    session.runtime = { ...session.runtime, ...(response?.runtime || {}), monitorState: MONITOR_STATE.PAUSED };
    appendLog(session, "user", "paused", "Tab monitoring paused.");
    const store = await loadStore();
    await persistSession(session);
    await clearNotification(tabId);
    await updateBadge(session, store);
    await broadcast("paused", tabId);
  }

  async function resumeTab(tabId) {
    const session = sessions.get(tabId);
    if (!session) {
      throw new Error("This tab is not activated.");
    }
    const response = await browser.tabs.sendMessage(tabId, {
      type: MESSAGE.CONTENT_RESUME
    });
    session.mode = MODE.ACTIVE;
    session.updatedAt = response?.updatedAt || Settings.nowIso();
    session.runtime = { ...session.runtime, ...(response?.runtime || {}) };
    appendLog(session, "user", "resumed", "Tab monitoring resumed with a new baseline.");
    const store = await loadStore();
    await persistSession(session);
    await updateBadge(session, store);
    await broadcast("resumed", tabId);
  }

  async function stopTab(tabId, fallbackTab = null, rawDrafts = null) {
    const session = sessions.get(tabId);
    if (session) {
      const [store, localStore] = await Promise.all([loadStore(), loadLocalActionStore()]);
      const explicitLocalActionProfileId = await loadTabLocalActionProfileId(tabId, localStore);
      const routedLocalActionProfile = LocalActions.routeProfile(localStore, session.url || "");
      const localActionBinding = explicitLocalActionProfileId
        ? "explicit-tab"
        : (routedLocalActionProfile.matched ? "url-route" : "default");
      const snapshot = stoppedTabConfigSnapshot(session, store, localStore, rawDrafts, localActionBinding);
      if (snapshot) await saveStoppedTabConfigSnapshot(tabId, snapshot);
    }
    try {
      await browser.tabs.sendMessage(tabId, { type: MESSAGE.CONTENT_STOP });
    } catch (_error) {
      // Navigation or shutdown may remove the content context first.
    }
    pickerStates.delete(tabId);
    volatileLocalActionDrafts.delete(Number(tabId));
    sessions.delete(tabId);
    await removePersistedSession(tabId);
    await clearNotification(tabId);
    await applyBadge(tabId, "", null);
    await broadcast("stopped-config-preserved", tabId);
    return {
      ...tabMeta(fallbackTab || { id: tabId }),
      mode: MODE.INACTIVE,
      activatedAt: session?.activatedAt || null,
      updatedAt: Settings.nowIso()
    };
  }

  async function assignProfile(tabId, profileId) {
    const store = await loadStore();
    const session = sessions.get(tabId);
    const profile = Settings.profileById(store, profileId);
    if (!session) {
      throw new Error("This tab is not activated.");
    }
    if (!profile) {
      throw new Error("Profile not found.");
    }
    if (!Settings.urlAllowed(profile.config, session.url)) {
      throw new Error("The tab URL does not match the profile allowlist.");
    }
    session.profileId = profile.id;
    session.configMode = CONFIG_MODE.PROFILE;
    session.tabConfig = null;
    session.configRevision += 1;
    await applySessionToContent(session, store);
    await persistSession(session);
    await updateBadge(session, store);
    await broadcast("profile-assigned", tabId);
  }

  async function saveTabConfig(tabId, rawConfig) {
    const store = await loadStore();
    const session = sessions.get(tabId);
    if (!session) {
      throw new Error("This tab is not activated.");
    }
    const validation = Settings.validateConfig(rawConfig);
    if (!validation.ok) {
      throw new Error(validation.errors.join("\n"));
    }
    if (!Settings.urlAllowed(validation.config, session.url)) {
      throw new Error("The tab URL does not match the tab configuration allowlist.");
    }
    session.configMode = CONFIG_MODE.TAB;
    session.tabConfig = validation.config;
    session.configRevision += 1;
    await applySessionToContent(session, store);
    await persistSession(session);
    await updateBadge(session, store);
    await broadcast("tab-config-saved", tabId);
  }

  async function resetTabConfig(tabId) {
    const store = await loadStore();
    const session = sessions.get(tabId);
    if (!session) {
      throw new Error("This tab is not activated.");
    }
    session.configMode = CONFIG_MODE.PROFILE;
    session.tabConfig = null;
    session.configRevision += 1;
    await applySessionToContent(session, store);
    await persistSession(session);
    await updateBadge(session, store);
    await broadcast("tab-config-reset", tabId);
  }

  async function assignLocalActionProfile(tabId, profileId) {
    const numericTabId = Number(tabId);
    const localStore = await loadLocalActionStore();
    const profile = LocalActions.profileById(localStore, profileId);
    if (!Number.isInteger(numericTabId)) throw new Error("The selected tab has no valid tab ID.");
    if (!profile) throw new Error("Local-action profile not found.");

    const session = sessions.get(numericTabId);
    if (!session) {
      const tab = await browser.tabs.get(numericTabId);
      if (!Number.isInteger(tab?.id)) throw new Error("The selected tab no longer exists.");
      await saveTabLocalActionProfileId(numericTabId, profile.id);
      await replaceStoppedTabLocalActionChoice(numericTabId, profile, "explicit-tab");
      await broadcast("local-action-profile-bound", numericTabId);
      return { profileId: profile.id, pendingActivation: true };
    }

    clearWorkingLocalActionSnapshot(session);
    session.localActionProfileId = profile.id;
    session.localActionConfigMode = CONFIG_MODE.PROFILE;
    session.localActionTabConfig = null;
    session.localActionRevision = Number(session.localActionRevision || 0) + 1;
    appendLog(session, "user", "local-action-profile-assigned", `Local-action profile “${profile.name}” applied to this tab.`);
    await Promise.all([
      persistSession(session),
      saveTabLocalActionProfileId(numericTabId, profile.id)
    ]);
    await broadcast("local-action-profile-assigned", numericTabId);
    return { profileId: profile.id, pendingActivation: false };
  }

  async function clearLocalActionProfileBinding(tabId) {
    const numericTabId = Number(tabId);
    if (!Number.isInteger(numericTabId)) throw new Error("The selected tab has no valid tab ID.");
    const [localStore, tab] = await Promise.all([
      loadLocalActionStore(),
      browser.tabs.get(numericTabId)
    ]);
    if (!Number.isInteger(tab?.id)) throw new Error("The selected tab no longer exists.");

    await clearTabLocalActionProfileId(numericTabId);
    const routed = LocalActions.routeProfile(localStore, tab.url || "");
    const profile = routed.profile || LocalActions.profileById(localStore, localStore.defaultProfileId) || localStore.profiles[0];
    if (!profile) throw new Error("No Local action profile is available after clearing the tab binding.");

    const session = sessions.get(numericTabId);
    if (!session) {
      const binding = routed.matched ? "url-route" : "default";
      await replaceStoppedTabLocalActionChoice(numericTabId, profile, binding);
      await broadcast("local-action-profile-binding-cleared", numericTabId);
      return { profileId: profile.id, binding, pendingActivation: true };
    }

    clearWorkingLocalActionSnapshot(session);
    session.localActionProfileId = profile.id;
    session.localActionConfigMode = CONFIG_MODE.PROFILE;
    session.localActionTabConfig = null;
    session.localActionRevision = Number(session.localActionRevision || 0) + 1;
    appendLog(session, "user", "local-action-profile-binding-cleared", routed.matched
      ? `Explicit Local action binding removed; URL routing selected “${profile.name}”.`
      : `Explicit Local action binding removed; default profile “${profile.name}” selected.`);
    await persistSession(session);
    await broadcast("local-action-profile-binding-cleared", numericTabId);
    return { profileId: profile.id, binding: routed.matched ? "url-route" : "default", pendingActivation: false };
  }


  async function saveTabLocalActions(tabId, rawConfig) {
    const session = sessions.get(tabId);
    if (!session) throw new Error("This tab is not activated.");
    const validation = LocalActions.validateConfig(rawConfig);
    if (!validation.ok) throw new Error(validation.errors.join("\n"));
    clearWorkingLocalActionSnapshot(session);
    session.localActionConfigMode = CONFIG_MODE.TAB;
    session.localActionTabConfig = validation.config;
    session.localActionRevision = Number(session.localActionRevision || 0) + 1;
    appendLog(session, "user", "tab-local-actions-saved", "Tab-specific local actions saved.");
    await persistSession(session);
    await broadcast("tab-local-actions-saved", tabId);
  }

  async function resetTabLocalActions(tabId) {
    const session = sessions.get(tabId);
    if (!session) throw new Error("This tab is not activated.");
    clearWorkingLocalActionSnapshot(session);
    session.localActionConfigMode = CONFIG_MODE.PROFILE;
    session.localActionTabConfig = null;
    session.localActionRevision = Number(session.localActionRevision || 0) + 1;
    appendLog(session, "user", "tab-local-actions-reset", "This tab now uses its local-action profile.");
    await persistSession(session);
    await broadcast("tab-local-actions-reset", tabId);
  }

  function manualProfileName(collection, rawName, excludeId, label, fallbackName) {
    const name = String(rawName || "").trim() || fallbackName;
    const key = name.toLocaleLowerCase();
    const conflict = collection.find((item) =>
      item.id !== excludeId && String(item.name || "").trim().toLocaleLowerCase() === key
    ) || null;
    if (conflict) {
      throw new Error(`${label} profile “${name}” already exists. Choose a different name.`);
    }
    return name;
  }

  async function createLocalActionProfile(name, baseProfileId = null, rawConfig = null) {
    const store = await loadLocalActionStore();
    const base = LocalActions.profileById(store, baseProfileId) || LocalActions.profileById(store, store.defaultProfileId);
    const validation = LocalActions.validateConfig(rawConfig || base?.config || LocalActions.defaultConfig());
    if (!validation.ok) throw new Error(validation.errors.join("\n"));
    const profileName = manualProfileName(store.profiles, name, null, "Local action", "New local actions");
    const profile = LocalActions.createProfile(profileName, validation.config);
    store.profiles.push(profile);
    const saved = await saveLocalActionStore(store);
    await broadcast("local-action-profile-created");
    return { store: saved, profileId: profile.id };
  }

  async function saveLocalActionProfile(rawProfile) {
    const store = await loadLocalActionStore();
    const profile = LocalActions.normalizeProfile(rawProfile);
    const validation = LocalActions.validateConfig(profile.config);
    if (!validation.ok) throw new Error(validation.errors.join("\n"));
    const index = store.profiles.findIndex((item) => item.id === profile.id);
    if (index < 0) throw new Error("Local-action profile not found.");
    profile.name = manualProfileName(store.profiles, profile.name, profile.id, "Local action", store.profiles[index].name);
    profile.config = validation.config;
    profile.createdAt = store.profiles[index].createdAt;
    profile.updatedAt = LocalActions.nowIso();
    await createSettingsSnapshot("before_local_action_profile_save", `Before saving Local action profile: ${store.profiles[index].name}`);
    store.profiles[index] = profile;
    const saved = await saveLocalActionStore(store);
    for (const session of sessions.values()) {
      if (session.localActionProfileId !== profile.id || session.localActionConfigMode !== CONFIG_MODE.PROFILE) continue;
      const preservedDraft = captureWorkingLocalActionDraft(session);
      session.localActionRevision = Number(session.localActionRevision || 0) + 1;
      if (preservedDraft) restoreWorkingLocalActionDraft(session, preservedDraft);
      else clearWorkingLocalActionSnapshot(session);
      await persistSession(session);
    }
    await broadcast("local-action-profile-saved");
    return saved;
  }

  async function setDefaultLocalActionProfile(profileId) {
    const store = await loadLocalActionStore();
    const profile = LocalActions.profileById(store, profileId);
    if (!profile) throw new Error("Local-action profile not found.");
    if (store.defaultProfileId === profile.id) return { store, profile };
    await createSettingsSnapshot("before_local_action_default_change", `Before setting default Local action profile: ${profile.name}`);
    store.defaultProfileId = profile.id;
    const saved = await saveLocalActionStore(store);
    await broadcast("local-action-default-profile-changed");
    return { store: saved, profile: LocalActions.profileById(saved, profile.id) };
  }

  async function deleteLocalActionProfile(profileId) {
    const store = await loadLocalActionStore();
    if (store.profiles.length <= 1) throw new Error("At least one local-action profile must remain.");
    if (store.defaultProfileId === profileId) throw new Error("Choose another default Local action profile before deleting this one.");
    const profileToDelete = LocalActions.profileById(store, profileId);
    if (!profileToDelete) throw new Error("Local-action profile not found.");
    const previousStore = LocalActions.clone(store);
    await createSettingsSnapshot("before_local_action_profile_delete", `Before deleting Local action profile: ${profileToDelete.name}`);
    store.profiles = store.profiles.filter((item) => item.id !== profileId);
    if (store.defaultProfileId === profileId) store.defaultProfileId = store.profiles[0].id;
    const saved = await saveLocalActionStore(store);
    const preservedTabs = await reconcileDeletedLocalActionProfileTabs(profileToDelete, previousStore, saved);
    await broadcast("local-action-profile-deleted");
    return { store: saved, profile: profileToDelete, preservedTabs };
  }

  async function updateProfileSessions(profileId, store) {
    for (const session of sessions.values()) {
      if (session.profileId !== profileId || session.configMode !== CONFIG_MODE.PROFILE) {
        continue;
      }
      session.configRevision += 1;
      try {
        await applySessionToContent(session, store);
        await persistSession(session);
        await updateBadge(session, store);
      } catch (error) {
        session.mode = MODE.ERROR;
        session.error = error instanceof Error ? error.message : String(error);
        await updateBadge(session, store);
      }
    }
  }

  function normalizeComponentProfile(type, rawProfile) {
    if (type === "monitor") return Settings.normalizeMonitorProfile(rawProfile);
    if (type === "target") return Settings.normalizeTargetProfile(rawProfile);
    throw new Error(`Unsupported component profile type: ${type}.`);
  }

  function validateComponentProfile(type, profile) {
    const config = Settings.defaultConfig();
    if (type === "monitor") config.monitor = Settings.clone(profile.monitor);
    if (type === "target") config.target = Settings.clone(profile.target);
    config.rules = [{
      ...config.rules[0],
      monitor: Settings.clone(config.monitor),
      target: Settings.clone(config.target)
    }];
    const validation = Settings.validateConfig(config);
    if (!validation.ok) throw new Error(validation.errors.join("\n"));
  }

  async function createComponentProfile(type, name, rawConfig) {
    const store = await loadStore();
    const collection = type === "monitor" ? store.monitorProfiles : (type === "target" ? store.targetProfiles : null);
    if (!collection) throw new Error(`Unsupported component profile type: ${type}.`);
    const label = type === "monitor" ? "Monitor" : "Target";
    const fallbackName = type === "monitor" ? "New monitor profile" : "New target profile";
    const profileName = manualProfileName(collection, name, null, label, fallbackName);
    let profile;
    if (type === "monitor") {
      profile = Settings.createMonitorProfile(profileName, rawConfig || Settings.defaultMonitorConfig());
      validateComponentProfile(type, profile);
      store.monitorProfiles.push(profile);
    } else {
      profile = Settings.createTargetProfile(profileName, rawConfig || Settings.defaultTargetConfig());
      validateComponentProfile(type, profile);
      store.targetProfiles.push(profile);
    }
    await saveStore(store);
    await broadcast(`${type}-profile-created`);
    return profile;
  }

  async function saveComponentProfile(type, rawProfile) {
    const store = await loadStore();
    const profile = normalizeComponentProfile(type, rawProfile);
    validateComponentProfile(type, profile);
    const collection = type === "monitor" ? store.monitorProfiles : store.targetProfiles;
    const index = collection.findIndex((item) => item.id === profile.id);
    if (index < 0) throw new Error(`${type === "monitor" ? "Monitor" : "Target"} profile not found.`);
    const label = type === "monitor" ? "Monitor" : "Target";
    profile.name = manualProfileName(collection, profile.name, profile.id, label, collection[index].name);
    profile.createdAt = collection[index].createdAt;
    profile.updatedAt = Settings.nowIso();
    await createSettingsSnapshot("before_component_profile_save", `Before saving ${type} profile: ${collection[index].name}`, store);
    collection[index] = profile;
    await saveStore(store);
    await broadcast(`${type}-profile-saved`);
    return profile;
  }

  async function setDefaultComponentProfile(type, profileId) {
    const store = await loadStore();
    const collectionKey = type === "monitor" ? "monitorProfiles" : (type === "target" ? "targetProfiles" : null);
    const defaultKey = type === "monitor" ? "defaultMonitorProfileId" : (type === "target" ? "defaultTargetProfileId" : null);
    if (!collectionKey) throw new Error(`Unsupported component profile type: ${type}.`);
    const profile = store[collectionKey].find((item) => item.id === profileId) || null;
    if (!profile) throw new Error(`${type === "monitor" ? "Monitor" : "Target"} profile not found.`);
    if (store[defaultKey] === profile.id) return { store, profile };
    await createSettingsSnapshot("before_component_default_change", `Before setting default ${type} profile: ${profile.name}`, store);
    store[defaultKey] = profile.id;
    const saved = await saveStore(store);
    await broadcast(`${type}-default-profile-changed`);
    return { store: saved, profile: saved[collectionKey].find((item) => item.id === profile.id) || profile };
  }

  async function deleteComponentProfile(type, profileId) {
    const store = await loadStore();
    const collectionKey = type === "monitor" ? "monitorProfiles" : (type === "target" ? "targetProfiles" : null);
    const defaultKey = type === "monitor" ? "defaultMonitorProfileId" : (type === "target" ? "defaultTargetProfileId" : null);
    if (!collectionKey) throw new Error(`Unsupported component profile type: ${type}.`);
    const collection = store[collectionKey];
    if (collection.length <= 1) throw new Error(`At least one ${type} profile must remain.`);
    if (store[defaultKey] === profileId) {
      throw new Error(`Choose another default ${type === "monitor" ? "Monitor" : "Target"} profile before deleting this one.`);
    }
    const profileToDelete = collection.find((item) => item.id === profileId);
    if (!profileToDelete) throw new Error(`${type} profile not found.`);
    await createSettingsSnapshot("before_component_profile_delete", `Before deleting ${type} profile: ${profileToDelete.name}`, store);
    store[collectionKey] = collection.filter((item) => item.id !== profileId);
    await saveStore(store);
    await broadcast(`${type}-profile-deleted`);
  }

  function uniqueImportedProfileName(existingProfiles, requestedName) {
    const base = String(requestedName || "Imported profile").trim() || "Imported profile";
    const occupied = new Set(existingProfiles.map((profile) => String(profile?.name || "").trim().toLocaleLowerCase()));
    if (!occupied.has(base.toLocaleLowerCase())) return base;
    const importedBase = `${base} (imported)`;
    if (!occupied.has(importedBase.toLocaleLowerCase())) return importedBase;
    let index = 2;
    while (occupied.has(`${importedBase} ${index}`.toLocaleLowerCase())) index += 1;
    return `${importedBase} ${index}`;
  }

  function mergeImportedProfilesSafely(existing, incoming, operations) {
    const result = existing.map((item) => Settings.clone(item));
    let created = 0;
    let skipped = 0;
    let collisionCopies = 0;
    let renamed = 0;
    for (const rawProfile of incoming) {
      const profile = operations.normalize(rawProfile);
      const fingerprint = operations.fingerprint(profile);
      const normalizedName = String(profile.name || "Profile").trim() || "Profile";
      const existingById = result.find((item) => item.id === profile.id) || null;
      const equivalent = result.find((item) =>
        String(item.name || "").trim().toLocaleLowerCase() === normalizedName.toLocaleLowerCase() &&
        operations.fingerprint(item) === fingerprint
      ) || null;
      if (equivalent || (existingById &&
        String(existingById.name || "").trim() === normalizedName &&
        operations.fingerprint(existingById) === fingerprint)) {
        skipped += 1;
        continue;
      }
      let id = profile.id;
      if (existingById) {
        id = operations.makeId();
        collisionCopies += 1;
      }
      const name = uniqueImportedProfileName(result, normalizedName);
      if (name !== normalizedName) renamed += 1;
      result.push(operations.create(profile, id, name));
      created += 1;
    }
    return { profiles: result, created, updated: 0, skipped, collisionCopies, renamed };
  }

  async function exportProfileBundle(type) {
    if (type === "local-action") {
      const store = await loadLocalActionStore();
      return Settings.buildProfileBundle(type, store.profiles, { defaultProfileId: store.defaultProfileId });
    }
    const store = await loadStore();
    if (type === "configuration") {
      return Settings.buildProfileBundle(type, store.profiles, { defaultProfileId: store.defaultProfileId });
    }
    if (type === "monitor") {
      return Settings.buildProfileBundle(type, store.monitorProfiles, { defaultProfileId: store.defaultMonitorProfileId });
    }
    if (type === "target") {
      return Settings.buildProfileBundle(type, store.targetProfiles, { defaultProfileId: store.defaultTargetProfileId });
    }
    throw new Error(`Unsupported profile type: ${type}.`);
  }

  async function importProfileBundle(type, text) {
    const bundle = Settings.parseProfileBundle(text, type);
    if (!bundle.profiles.length) throw new Error("The selected profile bundle does not contain any profiles.");

    if (type === "local-action") {
      const store = await loadLocalActionStore();
      const merged = mergeImportedProfilesSafely(store.profiles, bundle.profiles, {
        normalize(item) {
          const profile = LocalActions.normalizeProfile(item);
          const validation = LocalActions.validateConfig(profile.config);
          if (!validation.ok) throw new Error(validation.errors.join("\n"));
          profile.config = validation.config;
          return profile;
        },
        fingerprint(profile) {
          return WorkingSession.localActionConfigFingerprint(profile.config);
        },
        makeId() {
          return LocalActions.makeId("local-profile");
        },
        create(profile, id, name) {
          return LocalActions.createProfile(name, profile.config, id);
        }
      });
      store.profiles = merged.profiles;
      // Imported profile data must not erase per-tab working drafts or frozen download/shell values.
      // Profile-bundle import is intentionally non-destructive: keep the local default,
      // existing profile IDs and running tabs.
      await saveLocalActionStore(store);
      await broadcast("local-action-profiles-imported");
      return merged;
    }

    const store = await loadStore();
    await createSettingsSnapshot("before_profile_bundle_import", `Before importing ${type} profiles`, store);
    let merged;
    if (type === "configuration") {
      merged = mergeImportedProfilesSafely(store.profiles, bundle.profiles, {
        normalize(item) {
          const profile = Settings.normalizeProfile(item);
          const validation = Settings.validateConfig(profile.config);
          if (!validation.ok) throw new Error(validation.errors.join("\n"));
          profile.config = validation.config;
          return profile;
        },
        fingerprint(profile) {
          return WorkingSession.configFingerprint(profile.config);
        },
        makeId() {
          return Settings.makeId("profile");
        },
        create(profile, id, name) {
          return Settings.createProfile(name, profile.config, id);
        }
      });
      store.profiles = merged.profiles;
    } else if (type === "monitor") {
      merged = mergeImportedProfilesSafely(store.monitorProfiles, bundle.profiles, {
        normalize(item) {
          const profile = Settings.normalizeMonitorProfile(item);
          validateComponentProfile(type, profile);
          return profile;
        },
        fingerprint(profile) {
          return JSON.stringify(profile.monitor);
        },
        makeId() {
          return Settings.makeId("monitor-profile");
        },
        create(profile, id, name) {
          return Settings.createMonitorProfile(name, profile.monitor, id);
        }
      });
      store.monitorProfiles = merged.profiles;
    } else if (type === "target") {
      merged = mergeImportedProfilesSafely(store.targetProfiles, bundle.profiles, {
        normalize(item) {
          const profile = Settings.normalizeTargetProfile(item);
          validateComponentProfile(type, profile);
          return profile;
        },
        fingerprint(profile) {
          return JSON.stringify(profile.target);
        },
        makeId() {
          return Settings.makeId("target-profile");
        },
        create(profile, id, name) {
          return Settings.createTargetProfile(name, profile.target, id);
        }
      });
      store.targetProfiles = merged.profiles;
    } else {
      throw new Error(`Unsupported profile type: ${type}.`);
    }
    await saveStore(store);
    // Do not adopt the bundle's default profile and do not refresh active sessions.
    // Imports add safe library copies only; applying a profile remains explicit.
    await broadcast(`${type}-profiles-imported`);
    return merged;
  }

  async function createProfile(name, baseProfileId = null, rawConfig = null) {
    const store = await loadStore();
    const base = Settings.profileById(store, baseProfileId);
    const validation = Settings.validateConfig(rawConfig || base?.config || Settings.defaultConfig());
    if (!validation.ok) throw new Error(validation.errors.join("\n"));
    const profileName = manualProfileName(store.profiles, name, null, "Automation", "New profile");
    const profile = Settings.createProfile(profileName, validation.config);
    store.profiles.push(profile);
    const saved = await saveStore(store);
    await broadcast("profile-created");
    return { store: saved, profileId: profile.id };
  }

  async function saveProfile(rawProfile) {
    const store = await loadStore();
    const incoming = Settings.normalizeProfile(rawProfile);
    const validation = Settings.validateConfig(incoming.config);
    if (!validation.ok) {
      throw new Error(validation.errors.join("\n"));
    }
    incoming.config = validation.config;
    incoming.updatedAt = Settings.nowIso();
    const index = store.profiles.findIndex((profile) => profile.id === incoming.id);
    if (index < 0) {
      throw new Error("Could not find the profile to save.");
    }
    incoming.name = manualProfileName(store.profiles, incoming.name, incoming.id, "Automation", store.profiles[index].name);
    incoming.createdAt = store.profiles[index].createdAt;
    await createSettingsSnapshot("before_profile_save", `Before saving profile: ${store.profiles[index].name}`, store);
    store.profiles[index] = incoming;
    const saved = await saveStore(store);
    const persistedProfile = Settings.profileById(saved, incoming.id);
    if (!persistedProfile) {
      throw new Error("The saved profile was not found in storage.");
    }
    assertPersistedConfig(incoming.config, persistedProfile.config, "Save profile");
    await updateProfileSessions(incoming.id, saved);
    await broadcast("profile-saved");
    scheduleAutoActivationScan("profile-saved", 80);
    return saved;
  }

  async function setDefaultProfile(profileId) {
    const store = await loadStore();
    const profile = Settings.profileById(store, profileId);
    if (!profile) throw new Error("Automation profile not found.");
    if (store.defaultProfileId === profile.id) return { store, profile };
    await createSettingsSnapshot("before_default_profile_change", `Before setting default profile: ${profile.name}`, store);
    store.defaultProfileId = profile.id;
    const saved = await saveStore(store);
    await broadcast("default-profile-changed");
    return { store: saved, profile: Settings.profileById(saved, profile.id) };
  }

  async function deleteProfile(profileId) {
    const store = await loadStore();
    if (store.profiles.length <= 1) {
      throw new Error("At least one profile must remain.");
    }
    if (profileId === store.defaultProfileId) {
      throw new Error("The default profile cannot be deleted.");
    }
    const profileToDelete = Settings.profileById(store, profileId);
    if (!profileToDelete) {
      throw new Error("Profile not found.");
    }
    await createSettingsSnapshot("before_profile_delete", `Before deleting profile: ${profileToDelete.name}`, store);
    store.profiles = store.profiles.filter((profile) => profile.id !== profileId);
    const saved = await saveStore(store);
    const preservedTabs = await reconcileDeletedAutomationProfileTabs(profileToDelete, saved);
    await broadcast("profile-deleted");
    return { store: saved, profile: profileToDelete, preservedTabs };
  }

  async function refreshSessionsForStore(previousStore, saved, reason = "configuration replacement") {
    // Full configuration import/recovery changes the global Automation library, not the
    // effective values of tabs that are already open. If a referenced profile was
    // removed or changed, preserve that tab's previous effective values as a tab
    // override and rebase only the profile reference used as its library fallback.
    const report = { preservedActiveTabs: 0, preservedStoppedTabs: 0 };
    const tabs = await browser.tabs.query({});
    for (const tab of tabs) {
      if (!Number.isInteger(tab?.id)) continue;
      const session = sessions.get(tab.id);
      if (session) {
        const previousEffective = Settings.normalizeConfig(sessionConfig(session, previousStore));
        const referencedProfile = Settings.profileById(saved, session.profileId);
        const profileStillMatches = Boolean(referencedProfile) &&
          configFingerprint(referencedProfile.config) === configFingerprint(previousEffective);
        let preserved = false;

        if (session.configMode === CONFIG_MODE.TAB) {
          session.tabConfig = Settings.normalizeConfig(session.tabConfig || previousEffective);
          if (!referencedProfile) {
            const replacement = replacementAutomationProfile(saved, session.url || tab.url || "");
            if (!replacement) throw new Error("No Automation profile is available after configuration replacement.");
            session.profileId = replacement.id;
            preserved = true;
          }
        } else if (!profileStillMatches) {
          const replacement = referencedProfile || replacementAutomationProfile(saved, session.url || tab.url || "");
          if (!replacement) throw new Error("No Automation profile is available after configuration replacement.");
          session.profileId = replacement.id;
          session.configMode = CONFIG_MODE.TAB;
          session.tabConfig = previousEffective;
          preserved = true;
        }

        if (preserved) {
          appendLog(session, "user", "configuration-library-replaced-config-preserved", `${reason}: current automation values were preserved as a tab override.`);
          report.preservedActiveTabs += 1;
        }
        session.configRevision += 1;
        await persistSession(session);
        await updateBadge(session, saved);
        continue;
      }

      const snapshot = await loadStoppedTabConfigSnapshot(tab.id);
      if (!snapshot) continue;
      const referencedProfile = Settings.profileById(saved, snapshot.profileId);
      const profileStillMatches = Boolean(referencedProfile) &&
        configFingerprint(referencedProfile.config) === configFingerprint(snapshot.effectiveConfig);
      const needsPreservation = !referencedProfile ||
        (snapshot.configMode === CONFIG_MODE.PROFILE && !profileStillMatches);
      if (!needsPreservation) continue;
      const replacement = referencedProfile || replacementAutomationProfile(saved, tab.url || snapshot.url || "");
      if (!replacement) throw new Error("No Automation profile is available after configuration replacement.");
      await saveStoppedTabConfigSnapshot(tab.id, {
        ...snapshot,
        profileId: replacement.id,
        configMode: CONFIG_MODE.TAB,
        tabConfig: snapshot.effectiveConfig,
        effectiveConfig: snapshot.effectiveConfig
      });
      report.preservedStoppedTabs += 1;
    }
    return report;
  }

  async function refreshSessionsForLocalActionStore(previousStore, savedStore, reason = "Local action configuration replacement") {
    // Full configuration replacement changes the global Local action library, but it must
    // not silently change download/shell values for tabs that are already active or stopped.
    const report = { preservedActiveTabs: 0, preservedStoppedTabs: 0, clearedBindings: 0 };
    const tabs = await browser.tabs.query({});
    for (const tab of tabs) {
      if (!Number.isInteger(tab?.id)) continue;
      let explicitProfileId = null;
      try {
        explicitProfileId = await browser.sessions.getTabValue(tab.id, TAB_LOCAL_ACTION_PROFILE_KEY);
      } catch (_error) {
        explicitProfileId = null;
      }
      const explicitMissing = Boolean(explicitProfileId) && !LocalActions.profileById(savedStore, explicitProfileId);
      if (explicitMissing) {
        await clearTabLocalActionProfileId(tab.id);
        report.clearedBindings += 1;
      }

      const session = sessions.get(tab.id);
      if (session) {
        const previousProfile = LocalActions.profileById(previousStore, session.localActionProfileId);
        const referencedProfile = LocalActions.profileById(savedStore, session.localActionProfileId);
        const profileStillMatches = Boolean(previousProfile && referencedProfile) &&
          LocalActions.configFingerprint(previousProfile.config) === LocalActions.configFingerprint(referencedProfile.config);
        const resolution = sessionLocalActionResolution(session, previousStore);
        const hasWorkingDraft = resolution.source === "tab-working-draft" || resolution.source === "tab-working-snapshot";
        const preservedDraft = hasWorkingDraft ? captureWorkingLocalActionDraft(session) : null;
        let preserved = false;
        let changed = false;

        if (!referencedProfile) {
          const replacement = replacementLocalActionProfile(savedStore, session.url || tab.url || "");
          if (!replacement.profile) throw new Error("No Local action profile is available after configuration replacement.");
          session.localActionProfileId = replacement.profile.id;
          if (session.localActionConfigMode === CONFIG_MODE.PROFILE && !hasWorkingDraft) {
            session.localActionConfigMode = CONFIG_MODE.TAB;
            session.localActionTabConfig = LocalActions.normalizeConfig(resolution.config);
            preserved = true;
          }
          changed = true;
        } else if (session.localActionConfigMode === CONFIG_MODE.PROFILE && !profileStillMatches && !hasWorkingDraft) {
          session.localActionConfigMode = CONFIG_MODE.TAB;
          session.localActionTabConfig = LocalActions.normalizeConfig(resolution.config);
          preserved = true;
          changed = true;
        }

        if (changed) {
          session.localActionRevision = Number(session.localActionRevision || 0) + 1;
          if (preservedDraft) restoreWorkingLocalActionDraft(session, preservedDraft);
          if (preserved) {
            appendLog(session, "user", "local-action-library-replaced-config-preserved", `${reason}: current download and shell values were preserved as a tab override.`);
            report.preservedActiveTabs += 1;
          }
          await persistSession(session);
        }
        continue;
      }

      const snapshot = await loadStoppedTabConfigSnapshot(tab.id);
      if (!snapshot) continue;
      const previousProfile = LocalActions.profileById(previousStore, snapshot.localActionProfileId);
      const referencedProfile = LocalActions.profileById(savedStore, snapshot.localActionProfileId);
      const profileStillMatches = Boolean(previousProfile && referencedProfile) &&
        LocalActions.configFingerprint(previousProfile.config) === LocalActions.configFingerprint(referencedProfile.config);
      const hasWorkingDraft = Boolean(snapshot.localActionWorkingConfig);
      let next = { ...snapshot };
      let changed = false;
      let preserved = false;

      if (!referencedProfile) {
        const replacement = replacementLocalActionProfile(savedStore, tab.url || snapshot.url || "");
        if (!replacement.profile) throw new Error("No Local action profile is available after configuration replacement.");
        next.localActionProfileId = replacement.profile.id;
        next.localActionBinding = replacement.binding;
        if (snapshot.localActionConfigMode === CONFIG_MODE.PROFILE && !hasWorkingDraft) {
          next.localActionConfigMode = CONFIG_MODE.TAB;
          next.localActionTabConfig = LocalActions.normalizeConfig(snapshot.effectiveLocalActions);
          preserved = true;
        }
        changed = true;
      } else if (snapshot.localActionConfigMode === CONFIG_MODE.PROFILE && !profileStillMatches && !hasWorkingDraft) {
        next.localActionConfigMode = CONFIG_MODE.TAB;
        next.localActionTabConfig = LocalActions.normalizeConfig(snapshot.effectiveLocalActions);
        preserved = true;
        changed = true;
      }

      if (changed) {
        next.effectiveLocalActions = LocalActions.normalizeConfig(snapshot.effectiveLocalActions);
        await saveStoppedTabConfigSnapshot(tab.id, next);
        if (preserved) report.preservedStoppedTabs += 1;
      }
    }
    return report;
  }

  async function commitFullConfigurationBundle(bundle) {
    const normalized = ConfigurationBundle.normalizeBundle(bundle);
    const [previousAutomationStore, previousLocalActionStore, previousCommandPresetStore, previousPromptTemplateStore, sidebarResult] = await Promise.all([
      loadStore(),
      loadLocalActionStore(),
      loadCommandPresetStore(),
      PromptTemplates.loadStore(browser),
      browser.storage.local.get(ConfigurationBundle.SIDEBAR_UI_STORAGE_KEY)
    ]);

    const savedAutomationStore = Settings.normalizeStore(normalized.automationStore);
    savedAutomationStore.revision += 1;
    const savedLocalActionStore = LocalActions.normalizeStore(normalized.localActionStore);
    savedLocalActionStore.revision += 1;
    const savedCommandPresetStore = CommandPresets.normalizeStore(normalized.commandPresetStore);
    const savedPromptTemplateStore = PromptTemplates.normalizeStore(normalized.promptTemplateStore);
    const preferences = ConfigurationBundle.normalizeSidebarPreferences(normalized.sidebarPreferences);
    const existingSidebarPreferences = sidebarResult[ConfigurationBundle.SIDEBAR_UI_STORAGE_KEY] && typeof sidebarResult[ConfigurationBundle.SIDEBAR_UI_STORAGE_KEY] === "object"
      ? sidebarResult[ConfigurationBundle.SIDEBAR_UI_STORAGE_KEY]
      : {};
    const savedSidebarPreferences = {
      ...existingSidebarPreferences,
      collapsedGroups: preferences.collapsedGroups,
      featurePreset: preferences.featurePreset,
      visibleFeatures: preferences.visibleFeatures,
      autoProfileByUrl: preferences.autoProfileByUrl
    };

    const nextPayload = {
      [Settings.STORAGE_KEY]: savedAutomationStore,
      [LocalActions.STORAGE_KEY]: savedLocalActionStore,
      [CommandPresets.STORAGE_KEY]: savedCommandPresetStore,
      [PromptTemplates.STORAGE_KEY]: savedPromptTemplateStore,
      [ConfigurationBundle.SIDEBAR_UI_STORAGE_KEY]: savedSidebarPreferences
    };
    const rollbackPayload = {
      [Settings.STORAGE_KEY]: previousAutomationStore,
      [LocalActions.STORAGE_KEY]: previousLocalActionStore,
      [CommandPresets.STORAGE_KEY]: previousCommandPresetStore,
      [PromptTemplates.STORAGE_KEY]: previousPromptTemplateStore,
      [ConfigurationBundle.SIDEBAR_UI_STORAGE_KEY]: existingSidebarPreferences
    };

    try {
      // One storage write keeps the five reusable/global configuration stores on one commit boundary.
      await browser.storage.local.set(nextPayload);
    } catch (error) {
      // Storage-provider failures can be ambiguous. Restore the previous coherent
      // five-store payload before surfacing the error whenever rollback is possible.
      try {
        await browser.storage.local.set(rollbackPayload);
      } catch (rollbackError) {
        throw new Error(`Full configuration commit failed and rollback also failed: ${error instanceof Error ? error.message : String(error)}; rollback: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
      }
      throw new Error(`Full configuration commit failed; previous configuration was restored: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Do not advance in-memory caches until the multi-key storage commit succeeds.
    storePromise = Promise.resolve(savedAutomationStore);
    localActionStorePromise = Promise.resolve(savedLocalActionStore);
    return {
      previousAutomationStore,
      previousLocalActionStore,
      savedAutomationStore: clone(savedAutomationStore),
      savedLocalActionStore: LocalActions.clone(savedLocalActionStore),
      savedCommandPresetStore: CommandPresets.clone(savedCommandPresetStore),
      savedPromptTemplateStore: PromptTemplates.clone(savedPromptTemplateStore),
      savedSidebarPreferences: ConfigurationBundle.clone(preferences)
    };
  }

  async function replaceFullConfigurationBundle(bundle, reason = "Full configuration replacement") {
    const committed = await commitFullConfigurationBundle(bundle);
    const [automationPreservation, localActionPreservation] = await Promise.all([
      refreshSessionsForStore(committed.previousAutomationStore, committed.savedAutomationStore, reason),
      refreshSessionsForLocalActionStore(committed.previousLocalActionStore, committed.savedLocalActionStore, reason)
    ]);
    return {
      store: committed.savedAutomationStore,
      localActionStore: committed.savedLocalActionStore,
      automationPreservation,
      localActionPreservation
    };
  }

  async function previewSettingsImport(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error(`The selected configuration file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (parsed && typeof parsed === "object" && Object.prototype.hasOwnProperty.call(parsed, "format")) {
      if (!ConfigurationBundle.isBundle(parsed)) {
        throw new Error("The selected file uses an unsupported Firefox ChatAI Assistant configuration-bundle format or version.");
      }
      const bundle = ConfigurationBundle.normalizeBundle(parsed);
      return {
        scope: "all-configuration",
        automationProfiles: bundle.automationStore.profiles.length,
        monitorProfiles: bundle.automationStore.monitorProfiles.length,
        targetProfiles: bundle.automationStore.targetProfiles.length,
        localActionProfiles: bundle.localActionStore.profiles.length,
        commandPresets: bundle.commandPresetStore.presets.length,
        customPromptTemplates: bundle.promptTemplateStore.customTemplates.length,
        sidebarFeaturePreset: bundle.sidebarPreferences.featurePreset,
        visibleSidebarFeatures: bundle.sidebarPreferences.visibleFeatures.length
      };
    }

    const store = Settings.normalizeStore(parsed);
    return {
      scope: "legacy-automation-only",
      automationProfiles: store.profiles.length,
      monitorProfiles: store.monitorProfiles.length,
      targetProfiles: store.targetProfiles.length,
      localActionProfiles: null,
      commandPresets: null,
      customPromptTemplates: null,
      sidebarFeaturePreset: null,
      visibleSidebarFeatures: null
    };
  }

  async function importSettings(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error(`The selected configuration file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (parsed && typeof parsed === "object" && Object.prototype.hasOwnProperty.call(parsed, "format")) {
      if (!ConfigurationBundle.isBundle(parsed)) {
        throw new Error("The selected file uses an unsupported Firefox ChatAI Assistant configuration-bundle format or version.");
      }
      await createSettingsSnapshot("before_full_configuration_import", "Before full configuration import");
      const importedBundle = ConfigurationBundle.normalizeBundle(parsed);
      const result = await replaceFullConfigurationBundle(importedBundle, "Full configuration import");
      await broadcast("settings-imported");
      return { ...result, scope: "all-configuration" };
    }

    // Backward compatibility: releases before v0.40.9 exported only the Automation store.
    const current = await loadStore();
    await createSettingsSnapshot("before_settings_import", "Before legacy Automation configuration import", current);
    const imported = Settings.normalizeStore(parsed);
    const saved = await saveStore(imported);
    for (const importedProfile of imported.profiles) {
      const persistedProfile = Settings.profileById(saved, importedProfile.id);
      if (!persistedProfile) {
        throw new Error(`Import settings: profile ${importedProfile.id} was not found after saving.`);
      }
      assertPersistedConfig(importedProfile.config, persistedProfile.config, `Import profile ${importedProfile.name}`);
    }
    const preservation = await refreshSessionsForStore(current, saved, "Legacy Automation configuration import");
    await broadcast("settings-imported");
    return { store: saved, preservation, scope: "legacy-automation-only" };
  }

  async function restoreSettingsSnapshot(snapshotId) {
    const collection = await loadSnapshotCollection();
    const snapshot = Snapshots.findSnapshot(collection, snapshotId);
    if (!snapshot) {
      throw new Error("Settings snapshot not found.");
    }
    await createSettingsSnapshot("before_snapshot_restore", "Before snapshot restore");
    if (snapshot.configurationBundle) {
      const result = await replaceFullConfigurationBundle(snapshot.configurationBundle, "Full recovery snapshot restore");
      await broadcast("settings-snapshot-restored");
      return { ...result, scope: "all-configuration" };
    }

    // Legacy snapshots created before v0.40.9 contain Automation settings only.
    const current = await loadStore();
    const saved = await saveStore(snapshot.store);
    const preservation = await refreshSessionsForStore(current, saved, "Legacy Automation recovery snapshot restore");
    await broadcast("settings-snapshot-restored");
    return { store: saved, preservation, scope: "legacy-automation-only" };
  }

  function supportNativeState() {
    return SupportBundle.sanitizeValue({
      connected: nativeState.connected,
      hostName: nativeState.hostName,
      hostVersion: nativeState.hostVersion,
      lastError: nativeState.lastError,
      lastSeenAt: nativeState.lastSeenAt,
      runs: [...shellRuns.values()].map((run) => ({
        tabId: run.tabId,
        runId: run.runId,
        mode: run.mode,
        status: run.status,
        pid: run.pid,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
        returnCode: run.returnCode,
        stopped: run.stopped,
        error: run.error,
        outputEntryCount: Array.isArray(run.output) ? run.output.length : 0,
        logBytes: Number(run.logBytes) || 0,
        hasFileBackedLog: Boolean(run.logId)
      }))
    });
  }

  function supportSessionSummary(session, store) {
    return SupportBundle.sanitizeValue({
      tabId: session.tabId,
      windowId: session.windowId,
      index: session.index,
      url: session.url,
      mode: session.mode,
      source: session.source,
      activatedAt: session.activatedAt,
      updatedAt: session.updatedAt,
      error: session.error,
      profileId: session.profileId,
      profileName: profileName(session, store),
      configMode: session.configMode,
      configRevision: session.configRevision,
      runtime: session.runtime,
      effectiveConfig: sessionConfig(session, store),
      shellHistoryCount: Array.isArray(session.shellHistory) ? session.shellHistory.length : 0
    });
  }

  async function buildSupportBundle() {
    await recoverAll();
    const store = await loadStore();
    const manifest = browser.runtime.getManifest();
    const [platform, browserInfo] = await Promise.all([
      browser.runtime.getPlatformInfo().catch(() => null),
      typeof browser.runtime.getBrowserInfo === "function"
        ? browser.runtime.getBrowserInfo().catch(() => null)
        : Promise.resolve(null)
    ]);
    const orderedSessions = [...sessions.values()].sort((left, right) => left.tabId - right.tabId);
    const logs = {};
    for (const session of orderedSessions) {
      const normalized = normalizeLogs(session.logs);
      logs[`tab-${session.tabId}-user.json`] = SupportBundle.sanitizeValue(normalized.user);
      logs[`tab-${session.tabId}-debug.json`] = SupportBundle.sanitizeValue(normalized.debug);
    }
    const modes = orderedSessions.reduce((result, session) => {
      result[session.mode] = (result[session.mode] || 0) + 1;
      return result;
    }, {});
    return {
      formatVersion: 1,
      generatedAt: Settings.nowIso(),
      extension: {
        name: manifest.name,
        version: manifest.version,
        manifestVersion: manifest.manifest_version,
        protocolVersion: globalThis.FCI_PROTOCOL.VERSION,
      keyboardCommands,
      pendingShortcutAction: clone(pendingShortcutAction),
        settingsSchemaVersion: Settings.SCHEMA_VERSION
      },
      environment: SupportBundle.sanitizeValue({ platform, browser: browserInfo }),
      privacy: {
        sanitized: true,
        excludes: [
          "session tokens",
          "tab titles",
          "shell command text",
          "working directories",
          "shell output",
          "command history entries",
          "URL query strings and fragments"
        ]
      },
      diagnostics: {
        sessionCount: orderedSessions.length,
        sessionModes: modes,
        profileCount: store.profiles.length,
        nativeConnected: nativeState.connected,
        activeShellRunCount: [...shellRuns.values()].filter((run) => ["starting", "running", "terminal", "stopping"].includes(run.status)).length
      },
      settings: SupportBundle.sanitizeValue(store),
      sessions: orderedSessions.map((session) => supportSessionSummary(session, store)),
      logs,
      nativeHost: supportNativeState()
    };
  }

  async function listWorkingSessionTabs() {
    const [store, localStore] = await Promise.all([loadStore(), loadLocalActionStore()]);
    const tabs = await browser.tabs.query({});
    const records = [];
    for (const tab of tabs.filter((item) => Number.isInteger(item.id) && WorkingSession.isSupportedUrl(item.url))) {
      const session = sessions.get(tab.id);
      const boundLocalActionProfileId = session?.localActionProfileId || await loadTabLocalActionProfileId(tab.id, localStore);
      const boundLocalActionProfile = LocalActions.profileById(localStore, boundLocalActionProfileId);
      records.push({
          tabId: tab.id,
          windowId: tab.windowId,
          title: WorkingSession.cleanTitle(session?.customTitle || session?.runtime?.originalTitle || tab.title || ""),
          customTitle: session?.customTitle || "",
          pageTitle: session?.pageTitle || tab.title || "",
          url: tab.url,
          addOnActive: Boolean(session),
          mode: session?.mode || MODE.INACTIVE,
          profileId: session?.profileId || null,
          profileName: session ? profileName(session, store) : null,
          localActionProfileId: boundLocalActionProfile?.id || null,
          localActionProfileName: boundLocalActionProfile?.name || null
      });
    }
    return records.sort((left, right) => left.windowId - right.windowId || left.tabId - right.tabId);
  }

  async function exportWorkingSession(rawTabIds) {
    const selectedIds = new Set((Array.isArray(rawTabIds) ? rawTabIds : []).map(Number).filter(Number.isInteger));
    if (!selectedIds.size) {
      throw new Error("Select at least one tab to save in the working session.");
    }
    const [store, localStore] = await Promise.all([loadStore(), loadLocalActionStore()]);
    const tabs = await browser.tabs.query({});
    const records = [];
    for (const tab of tabs) {
      if (!selectedIds.has(tab.id) || !WorkingSession.isSupportedUrl(tab.url)) continue;
      const session = sessions.get(tab.id);
      const routedProfile = Settings.routeProfile(store, tab.url).profile || Settings.profileById(store, store.defaultProfileId) || store.profiles[0];
      const profile = session
        ? (Settings.profileById(store, session.profileId) || routedProfile)
        : routedProfile;
      const effectiveConfig = session ? sessionConfig(session, store) : Settings.normalizeConfig(profile.config);
      const routedLocalProfile = LocalActions.routeProfile(localStore, tab.url).profile || LocalActions.profileById(localStore, localStore.defaultProfileId) || localStore.profiles[0];
      const boundLocalActionProfileId = session?.localActionProfileId || await loadTabLocalActionProfileId(tab.id, localStore);
      const localProfile = LocalActions.profileById(localStore, boundLocalActionProfileId) || routedLocalProfile;
      const effectiveLocalActions = session ? sessionLocalActionConfig(session, localStore) : LocalActions.normalizeConfig(localProfile.config);
      records.push({
        sourceTabId: tab.id,
        url: tab.url,
        title: WorkingSession.cleanTitle(session?.customTitle || session?.runtime?.originalTitle || tab.title || ""),
        customTitle: session?.customTitle || (await loadCustomTitleState(tab.id, tab.title || "")).customTitle,
        pageTitle: session?.pageTitle || tab.title || "",
        addOnActive: Boolean(session),
        mode: session?.mode || MODE.INACTIVE,
        profileId: profile.id,
        profile,
        configMode: session?.configMode || CONFIG_MODE.PROFILE,
        tabConfig: session?.configMode === CONFIG_MODE.TAB ? session.tabConfig : null,
        effectiveConfig,
        localActionProfileId: localProfile.id,
        localActionProfile: localProfile,
        localActionConfigMode: session?.localActionConfigMode || CONFIG_MODE.PROFILE,
        localActionTabConfig: session?.localActionConfigMode === CONFIG_MODE.TAB ? session.localActionTabConfig : null,
        effectiveLocalActions
      });
    }
    const manifest = browser.runtime.getManifest();
    return WorkingSession.build(records, { extensionVersion: manifest.version, exportedAt: Settings.nowIso() });
  }

  function selectedWorkingSessionBundle(bundle, rawIndexes) {
    const normalized = WorkingSession.normalize(bundle);
    const indexes = new Set((Array.isArray(rawIndexes) ? rawIndexes : normalized.tabs.map((_tab, index) => index))
      .map(Number).filter((index) => Number.isInteger(index) && index >= 0 && index < normalized.tabs.length));
    if (!indexes.size) throw new Error("Select at least one saved tab to restore.");
    return WorkingSession.build(
      normalized.tabs.filter((_tab, index) => indexes.has(index)),
      normalized
    );
  }

  async function saveWorkingSessionEntry(name, rawTabIds, entryId = null, description = "") {
    const bundle = await exportWorkingSession(rawTabIds);
    const catalog = await loadWorkingSessionCatalog();
    const existing = entryId ? WorkingSession.catalogEntryById(catalog, entryId) : null;
    if (entryId && !existing) throw new Error("The selected saved working session no longer exists.");
    const entry = WorkingSession.createCatalogEntry(name || existing?.name, bundle, {
      id: existing?.id || null,
      description: description || existing?.description || "",
      createdAt: existing?.createdAt || null,
      lastRestoredAt: existing?.lastRestoredAt || ""
    });
    const saved = await saveWorkingSessionCatalog(WorkingSession.upsertCatalogEntry(catalog, entry));
    await broadcast(existing ? "working-session-entry-updated" : "working-session-entry-created");
    return { catalog: WorkingSession.catalogSummary(saved), entryId: entry.id };
  }

  async function renameWorkingSessionEntry(entryId, name) {
    const catalog = await loadWorkingSessionCatalog();
    const existing = WorkingSession.catalogEntryById(catalog, entryId);
    if (!existing) throw new Error("The selected saved working session no longer exists.");
    const renamed = WorkingSession.createCatalogEntry(name, existing.bundle, {
      id: existing.id,
      description: existing.description,
      createdAt: existing.createdAt,
      lastRestoredAt: existing.lastRestoredAt
    });
    const saved = await saveWorkingSessionCatalog(WorkingSession.upsertCatalogEntry(catalog, renamed));
    await broadcast("working-session-entry-renamed");
    return WorkingSession.catalogSummary(saved);
  }

  async function duplicateWorkingSessionEntry(entryId, name) {
    const catalog = await loadWorkingSessionCatalog();
    const result = WorkingSession.duplicateCatalogEntry(catalog, entryId, name);
    const saved = await saveWorkingSessionCatalog(result.catalog);
    await broadcast("working-session-entry-duplicated");
    return { catalog: WorkingSession.catalogSummary(saved), entryId: result.entry.id };
  }

  async function deleteWorkingSessionEntry(entryId) {
    const catalog = await loadWorkingSessionCatalog();
    if (!WorkingSession.catalogEntryById(catalog, entryId)) {
      throw new Error("The selected saved working session no longer exists.");
    }
    const saved = await saveWorkingSessionCatalog(WorkingSession.removeCatalogEntry(catalog, entryId));
    await broadcast("working-session-entry-deleted");
    return WorkingSession.catalogSummary(saved);
  }

  async function restoreWorkingSessionEntry(entryId, rawIndexes) {
    const catalog = await loadWorkingSessionCatalog();
    const entry = WorkingSession.catalogEntryById(catalog, entryId);
    if (!entry) throw new Error("The selected saved working session no longer exists.");
    const subset = selectedWorkingSessionBundle(entry.bundle, rawIndexes);
    const report = await importWorkingSession(WorkingSession.stringify(subset));
    const restoredEntry = WorkingSession.createCatalogEntry(entry.name, entry.bundle, {
      id: entry.id,
      description: entry.description,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      lastRestoredAt: Settings.nowIso()
    });
    await saveWorkingSessionCatalog(WorkingSession.upsertCatalogEntry(catalog, restoredEntry));
    await broadcast("working-session-entry-restored");
    return report;
  }

  async function importWorkingSessionEntry(text, name = "") {
    const bundle = WorkingSession.parse(text);
    const catalog = await loadWorkingSessionCatalog();
    const entry = WorkingSession.createCatalogEntry(
      name || `Imported session ${new Date().toISOString().slice(0, 10)}`,
      bundle
    );
    const saved = await saveWorkingSessionCatalog(WorkingSession.upsertCatalogEntry(catalog, entry));
    await broadcast("working-session-entry-imported");
    return { catalog: WorkingSession.catalogSummary(saved), entryId: entry.id };
  }

  async function importWorkingSessionCatalog(text) {
    const incoming = WorkingSession.parseCatalog(text);
    const current = await loadWorkingSessionCatalog();
    const merged = WorkingSession.mergeCatalog(current, incoming);
    const saved = await saveWorkingSessionCatalog(merged.catalog);
    await broadcast("working-session-catalog-imported");
    return { catalog: WorkingSession.catalogSummary(saved), report: merged.report };
  }

  function exactWorkingSessionAutomationProfile(store, savedTab) {
    const profileId = String(savedTab?.profileId || savedTab?.profile?.id || "").trim();
    if (!profileId) return null;
    const profile = Settings.profileById(store, profileId);
    if (!profile) return null;
    const savedProfileConfig = Settings.normalizeConfig(savedTab?.profile?.config || savedTab?.effectiveConfig);
    return WorkingSession.configFingerprint(profile.config) === WorkingSession.configFingerprint(savedProfileConfig)
      ? profile
      : null;
  }

  function workingSessionAutomationRestorePlan(store, savedTab) {
    const exactProfile = exactWorkingSessionAutomationProfile(store, savedTab);
    const fallbackProfile = exactProfile || Settings.routeProfile(store, savedTab.url).profile ||
      Settings.profileById(store, store.defaultProfileId) || store.profiles[0];
    if (!fallbackProfile) throw new Error("No Automation profile is available for working-session restore.");
    const requestedMode = savedTab.configMode === CONFIG_MODE.TAB ? CONFIG_MODE.TAB : CONFIG_MODE.PROFILE;
    if (requestedMode === CONFIG_MODE.PROFILE && exactProfile) {
      return { profileId: exactProfile.id, configMode: CONFIG_MODE.PROFILE, tabConfig: null, source: "existing-profile" };
    }
    const tabConfig = Settings.normalizeConfig(
      requestedMode === CONFIG_MODE.TAB
        ? (savedTab.tabConfig || savedTab.effectiveConfig || savedTab.profile?.config)
        : (savedTab.effectiveConfig || savedTab.profile?.config)
    );
    return {
      profileId: fallbackProfile.id,
      configMode: CONFIG_MODE.TAB,
      tabConfig,
      source: requestedMode === CONFIG_MODE.TAB ? "saved-tab-override" : "session-snapshot"
    };
  }

  function exactWorkingSessionLocalActionProfile(localStore, savedTab) {
    const profileId = String(savedTab?.localActionProfileId || savedTab?.localActionProfile?.id || "").trim();
    if (!profileId) return null;
    const profile = LocalActions.profileById(localStore, profileId);
    if (!profile) return null;
    const savedProfileConfig = LocalActions.normalizeConfig(savedTab?.localActionProfile?.config || savedTab?.effectiveLocalActions);
    return WorkingSession.localActionConfigFingerprint(profile.config) === WorkingSession.localActionConfigFingerprint(savedProfileConfig)
      ? profile
      : null;
  }

  function workingSessionLocalActionRestorePlan(localStore, savedTab) {
    const exactProfile = exactWorkingSessionLocalActionProfile(localStore, savedTab);
    const fallbackProfile = exactProfile || LocalActions.routeProfile(localStore, savedTab.url).profile ||
      LocalActions.profileById(localStore, localStore.defaultProfileId) || localStore.profiles[0];
    if (!fallbackProfile) throw new Error("No Local action profile is available for working-session restore.");
    const requestedMode = savedTab.localActionConfigMode === CONFIG_MODE.TAB ? CONFIG_MODE.TAB : CONFIG_MODE.PROFILE;
    if (requestedMode === CONFIG_MODE.PROFILE && exactProfile) {
      return { profileId: exactProfile.id, configMode: CONFIG_MODE.PROFILE, tabConfig: null, source: "existing-profile" };
    }
    const tabConfig = LocalActions.normalizeConfig(
      requestedMode === CONFIG_MODE.TAB
        ? (savedTab.localActionTabConfig || savedTab.effectiveLocalActions || savedTab.localActionProfile?.config)
        : (savedTab.effectiveLocalActions || savedTab.localActionProfile?.config)
    );
    return {
      profileId: fallbackProfile.id,
      configMode: CONFIG_MODE.TAB,
      tabConfig,
      source: requestedMode === CONFIG_MODE.TAB ? "saved-tab-override" : "session-snapshot"
    };
  }

  async function importWorkingSession(text) {
    const bundle = WorkingSession.parse(text);
    // Working-session restore is intentionally session-scoped. The embedded
    // profile/config snapshots are used only to recreate each tab's effective
    // state; they never create, overwrite, rename or select global profiles.
    const [store, localStore] = await Promise.all([loadStore(), loadLocalActionStore()]);
    const report = {
      restored: 0,
      openedTabIds: [],
      failed: [],
      automationSnapshotFallbacks: 0,
      localActionSnapshotFallbacks: 0
    };

    for (const [index, savedTab] of bundle.tabs.entries()) {
      let tab = null;
      try {
        tab = await browser.tabs.create({ url: savedTab.url, active: false });
        report.openedTabIds.push(tab.id);
        if (savedTab.customTitle) {
          await saveCustomTitleState(tab.id, {
            customTitle: savedTab.customTitle,
            pageTitle: savedTab.pageTitle || savedTab.title || "",
            updatedAt: Settings.nowIso()
          });
        }
        if (!savedTab.addOnActive) {
          continue;
        }
        const automationPlan = workingSessionAutomationRestorePlan(store, savedTab);
        const localActionPlan = workingSessionLocalActionRestorePlan(localStore, savedTab);
        if (automationPlan.source === "session-snapshot") report.automationSnapshotFallbacks += 1;
        if (localActionPlan.source === "session-snapshot") report.localActionSnapshotFallbacks += 1;
        const session = makeSession(tab, automationPlan.profileId, "working-session-import", localActionPlan.profileId);
        applyCustomTitleStateToSession(session, {
          customTitle: savedTab.customTitle || "",
          pageTitle: savedTab.pageTitle || savedTab.title || tab.title || "",
          updatedAt: Settings.nowIso()
        }, tab.title || savedTab.pageTitle || savedTab.title || "");
        session.configMode = automationPlan.configMode;
        session.tabConfig = automationPlan.tabConfig;
        session.configRevision += 1;
        session.localActionConfigMode = localActionPlan.configMode;
        session.localActionTabConfig = localActionPlan.tabConfig;
        session.localActionRevision += 1;
        if (!(await hasHostPermission(savedTab.url))) {
          throw new Error("Firefox site permission is missing for this URL.");
        }
        await ensureContentScripts(tab.id);
        await applySessionToContent(session, store, MESSAGE.CONTENT_ACTIVATE);
        sessions.set(tab.id, session);
        if (savedTab.mode === MODE.PAUSED) {
          await pauseTab(tab.id);
        } else {
          await persistSession(session);
          await updateBadge(session, store);
        }
        report.restored += 1;
      } catch (error) {
        report.failed.push({
          index,
          tabId: tab?.id || null,
          url: savedTab.url,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    await broadcast("working-session-imported");
    return report;
  }

  function shortcutAction(action, tabId, command, message = "") {
    pendingShortcutAction = {
      id: `shortcut-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      action: String(action || "message"),
      tabId: Number.isInteger(Number(tabId)) ? Number(tabId) : null,
      command: String(command || ""),
      message: String(message || ""),
      createdAt: Settings.nowIso()
    };
    return clone(pendingShortcutAction);
  }

  async function keyboardCommandsDashboard() {
    if (!browser.commands?.getAll) return [];
    try {
      const commands = await browser.commands.getAll();
      return commands.map((item) => ({
        name: String(item?.name || ""),
        description: String(item?.description || ""),
        shortcut: String(item?.shortcut || ""),
        assigned: Boolean(String(item?.shortcut || "").trim())
      }));
    } catch (error) {
      return [{ name: "", description: "Keyboard shortcut status unavailable", shortcut: "", assigned: false, error: error instanceof Error ? error.message : String(error) }];
    }
  }

  async function acknowledgeAlertByShortcut(tabId) {
    const session = sessions.get(tabId);
    if (!session) throw new Error("This tab is not activated.");
    await ensureInteractiveTab(tabId);
    const response = await browser.tabs.sendMessage(tabId, { type: MESSAGE.CONTENT_ACKNOWLEDGE_ALERT });
    if (!response?.ok) throw new Error(response?.error || "Could not acknowledge the current alert.");
    if (response.runtime) session.runtime = { ...session.runtime, ...response.runtime };
    session.updatedAt = Settings.nowIso();
    appendLog(session, "user", "alert-acknowledged-shortcut", "Alert acknowledged from a keyboard shortcut.");
    const store = await loadStore();
    await persistSession(session);
    await clearNotification(tabId);
    await updateBadge(session, store);
    await broadcast("keyboard-shortcut-alert-acknowledged", tabId);
    return true;
  }

  async function handleKeyboardCommand(command) {
    const tab = await currentTab();
    if (!Number.isInteger(tab?.id)) throw new Error("Could not determine the current tab.");
    const tabId = tab.id;
    const session = sessions.get(tabId);
    switch (command) {
      case KEYBOARD_COMMAND.OPEN_SIDEBAR:
        shortcutAction("message", tabId, command, "Open the current browser side panel.");
        await browser.sidebarAction.open({ tabId });
        await broadcast("keyboard-shortcut-open-sidebar", tabId);
        return true;
      case KEYBOARD_COMMAND.TOGGLE_CURRENT_TAB:
        if (!session) return activateTab(tab, "keyboard-shortcut");
        if (session.mode === MODE.PAUSED) return resumeTab(tabId);
        if (session.mode === MODE.ACTIVE) return pauseTab(tabId);
        await stopTab(tabId, tab);
        return activateTab(tab, "keyboard-shortcut");
      case KEYBOARD_COMMAND.ACKNOWLEDGE_CURRENT_ALERT:
        return acknowledgeAlertByShortcut(tabId);
      case KEYBOARD_COMMAND.RUN_CURRENT_TARGET_ACTION: {
        if (!session) throw new Error("Activate this tab before running its target action.");
        const store = await loadStore();
        return testTargetAction(tabId, sessionConfig(session, store), true);
      }
      case KEYBOARD_COMMAND.OPEN_CURRENT_COMMAND_LOG:
        shortcutAction("open-shell-log", tabId, command, "Open the current tab command log.");
        await browser.sidebarAction.open();
        await broadcast("keyboard-shortcut-open-command-log", tabId);
        return true;
      case KEYBOARD_COMMAND.STOP_CURRENT_TAB:
        if (!session) throw new Error("This tab is not activated.");
        return stopTab(tabId, tab);
      default:
        return false;
    }
  }

  async function handleKeyboardCommandFailure(command, error) {
    const tab = await currentTab().catch(() => null);
    const tabId = Number.isInteger(tab?.id) ? tab.id : null;
    const message = error instanceof Error ? error.message : String(error);
    if (Number.isInteger(tabId)) await applyBadge(tabId, "!", "#cf222e").catch(() => {});
    shortcutAction("message", tabId, command, message);
    try { await browser.sidebarAction.open(); } catch (_error) {}
    await broadcast("keyboard-shortcut-error", tabId);
    console.error(`FirefoxChatImprover: keyboard command ${command} failed`, error);
  }

  async function promptTemplateLibrary() {
    // The complete Firefox/Chromium manifests load prompt_templates.js before
    // background.js. Legacy dashboard-bootstrap VMs intentionally load only the
    // older shared modules, so this optional feature must not prevent the core
    // dashboard from starting.
    if (!PromptTemplates?.loadStore || !PromptTemplates?.library) {
      return PROMPT_TEMPLATE_LIBRARY_FALLBACK;
    }
    const store = await PromptTemplates.loadStore(browser);
    return PromptTemplates.library(store);
  }

  function requirePromptTemplateMethod(method) {
    if (typeof PromptTemplates?.[method] === "function") return;
    throw new Error("Prompt templates are unavailable because the shared module was not loaded. Reload the extension.");
  }

  async function savePromptTemplate(rawTemplate, sender) {
    assertSidebarSender(sender);
    requirePromptTemplateMethod("upsertCustom");
    const result = await PromptTemplates.upsertCustom(browser, rawTemplate);
    await broadcast("prompt-template-library-changed");
    return result;
  }

  async function deletePromptTemplate(templateId, sender) {
    assertSidebarSender(sender);
    requirePromptTemplateMethod("deleteCustom");
    const result = await PromptTemplates.deleteCustom(browser, templateId);
    await broadcast("prompt-template-library-changed");
    return result;
  }

  async function fillPromptTemplate(tabId, rawText, sender) {
    assertSidebarSender(sender);
    const numericTabId = Number(tabId);
    if (!Number.isInteger(numericTabId)) throw new Error("The selected tab has no valid tab ID.");
    const text = String(rawText || "");
    if (!text.trim()) throw new Error("Prompt text is empty.");
    const maxPromptLength = Number(PromptTemplates?.MAX_PROMPT_LENGTH) || PROMPT_TEMPLATE_MAX_LENGTH_FALLBACK;
    if (text.length > maxPromptLength) throw new Error("Prompt text is too long.");
    const [tab, active] = await Promise.all([browser.tabs.get(numericTabId), currentTab()]);
    if (!Number.isInteger(active?.id) || active.id !== numericTabId) {
      throw new Error("Prompt filling is allowed only in the currently displayed tab.");
    }
    if (!isSupportedUrl(tab.url)) {
      throw new Error("Prompt filling is allowed only on normal HTTP or HTTPS pages.");
    }
    try {
      await browser.scripting.executeScript({
        target: { tabId: numericTabId },
        files: ["shared/browser_compat.js", "shared/protocol.js", "content/prompt_fill.js"]
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`The browser could not access this page to fill the prompt. Grant site access or activate the tab first. ${detail}`);
    }
    const response = await browser.tabs.sendMessage(numericTabId, {
      type: MESSAGE.CONTENT_FILL_PROMPT,
      payload: { text }
    });
    if (!response?.ok) throw new Error(response?.error || "Could not fill a prompt input in the current page.");
    return response.result;
  }

  async function dashboard() {
    await recoverAll();
    const [store, localActionStore, workingSessionCatalog, keyboardCommands, promptTemplates] = await Promise.all([loadStore(), loadLocalActionStore(), loadWorkingSessionCatalog(), keyboardCommandsDashboard(), promptTemplateLibrary()]);
    const snapshotCollection = await loadSnapshotCollection();
    const tab = await currentTab();
    const currentTabMeta = await tabMetaWithCustomTitle(tab);
    const currentSession = Number.isInteger(tab?.id) ? sessions.get(tab.id) : null;
    const currentStoppedConfig = Number.isInteger(tab?.id) && !currentSession
      ? await loadStoppedTabConfigSnapshot(tab.id)
      : null;
    currentTabMeta.stoppedConfig = currentStoppedConfig ? clone(currentStoppedConfig) : null;
    const currentExplicitLocalActionProfileId = Number.isInteger(tab?.id)
      ? await loadTabLocalActionProfileId(tab.id, localActionStore)
      : null;
    const currentLocalActionRoute = LocalActions.routeProfile(localActionStore, tab?.url || "");
    const currentFallbackLocalActionProfile = currentLocalActionRoute.profile ||
      LocalActions.profileById(localActionStore, localActionStore.defaultProfileId) || localActionStore.profiles[0] || null;
    currentTabMeta.localActionProfileId = currentSession?.localActionProfileId || currentExplicitLocalActionProfileId || currentStoppedConfig?.localActionProfileId || currentFallbackLocalActionProfile?.id || null;
    currentTabMeta.localActionProfileBinding = currentExplicitLocalActionProfileId
      ? "explicit-tab"
      : (currentStoppedConfig?.localActionBinding || (currentStoppedConfig ? "stopped-snapshot" : (currentLocalActionRoute.matched ? "url-route" : "default")));
    const publicSessions = [];
    for (const session of [...sessions.values()].sort((left, right) => left.tabId - right.tabId)) {
      const publicValue = publicSession(session, store, localActionStore);
      const explicitProfileId = await loadTabLocalActionProfileId(session.tabId, localActionStore);
      const routedProfile = LocalActions.routeProfile(localActionStore, session.url || "");
      publicValue.localActionProfileBinding = explicitProfileId
        ? "explicit-tab"
        : (routedProfile.matched ? "url-route" : "default");
      publicSessions.push(publicValue);
    }
    const routingPreview = Settings.routeProfile(store, tab?.url || "");
    const autoActivationPreview = Settings.routeAutoActivation(store, tab?.url || "");
    const localActionRoutingPreview = LocalActions.routeProfile(localActionStore, tab?.url || "");
    return {
      protocolVersion: globalThis.FCI_PROTOCOL.VERSION,
      keyboardCommands,
      promptTemplates,
      pendingShortcutAction: clone(pendingShortcutAction),
      currentTab: currentTabMeta,
      sessions: publicSessions,
      store,
      localActionStore,
      localActionRoutingPreview: {
        matched: localActionRoutingPreview.matched,
        profileId: localActionRoutingPreview.profileId,
        profileName: localActionRoutingPreview.profileName,
        candidates: localActionRoutingPreview.candidates
      },
      autoActivation: {
        current: Number.isInteger(tab?.id) ? clone(autoActivationAudit.get(tab.id) || null) : null,
        preview: {
          url: autoActivationPreview.url,
          matched: autoActivationPreview.matched,
          profileId: autoActivationPreview.profileId,
          profileName: autoActivationPreview.profileName,
          candidates: autoActivationPreview.candidates
        },
        recent: [...autoActivationAudit.values()].slice(-20).map((item) => clone(item))
      },
      routingPreview: {
        url: routingPreview.url,
        matched: routingPreview.matched,
        usedFallback: routingPreview.usedFallback,
        profileId: routingPreview.profileId,
        profileName: routingPreview.profileName,
        candidates: routingPreview.candidates
      },
      nativeHost: nativeDashboardState(),
      nativeLogRetention: nativeLogRetentionPolicy(store),
      settingsSnapshots: snapshotCollection.snapshots.map(Snapshots.summary),
      workingSessionCatalog: WorkingSession.catalogSummary(workingSessionCatalog),
      pickers: [...pickerStates.values()].map((state) => clone(state))
    };
  }

  function errorResponse(error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }

  async function setVolatileLocalActionDraft(tabId, rawConfig, clear = false, expectedContext = {}) {
    const numericTabId = Number(tabId);
    if (!Number.isInteger(numericTabId)) throw new Error("The volatile local-action draft has no valid tab ID.");
    const session = sessions.get(numericTabId);
    if (!session) throw new Error("This tab is not activated.");

    const suppliedContext = expectedContext && typeof expectedContext === "object" ? expectedContext : {};
    const hasContext = Boolean(suppliedContext.sessionToken || suppliedContext.localActionProfileId || suppliedContext.localActionRevision !== undefined);
    if (hasContext && !localActionContextMatches(session, suppliedContext)) {
      const [store, localStore] = await Promise.all([loadStore(), loadLocalActionStore()]);
      return { stale: true, session: publicSession(session, store, localStore) };
    }

    if (clear) {
      clearWorkingLocalActionSnapshot(session);
    } else {
      const validation = LocalActions.validateConfig(rawConfig);
      if (!validation.ok) throw new Error(validation.errors.join("\n"));
      const context = currentLocalActionContext(session);
      const config = validation.config;
      volatileLocalActionDrafts.set(numericTabId, { config, context });
      session.localActionWorkingConfig = LocalActions.clone(config);
      session.localActionWorkingContext = { ...context, updatedAt: Settings.nowIso(), fingerprint: LocalActions.configFingerprint(config) };
    }
    session.updatedAt = Settings.nowIso();
    await persistSession(session);
    const [store, localStore] = await Promise.all([loadStore(), loadLocalActionStore()]);
    await broadcast(clear ? "volatile-local-actions-cleared" : "volatile-local-actions-updated", numericTabId);
    return { stale: false, session: publicSession(session, store, localStore) };
  }

  async function handleRequest(message, sender = null) {
    try {
      switch (message.type) {
        case MESSAGE.GET_DASHBOARD:
          return { ok: true, dashboard: await dashboard() };

        case MESSAGE.ACK_SHORTCUT_ACTION:
          if (!message.actionId || pendingShortcutAction?.id === String(message.actionId)) pendingShortcutAction = null;
          return { ok: true, dashboard: await dashboard() };

        case MESSAGE.ACTIVATE_CURRENT: {
          const requestedTabId = Number(message.tabId);
          const tab = Number.isInteger(requestedTabId)
            ? await browser.tabs.get(requestedTabId)
            : await currentTab();
          await activateTab(
            tab,
            "sidebar",
            message.profileId || null,
            message.localActionProfileId || null,
            message.restoreStoppedConfig === true,
            message.discardStoppedConfig === true
          );
          return { ok: true, dashboard: await dashboard() };
        }

        case MESSAGE.RUN_AUTO_ACTIVATION_SCAN: {
          const report = await scanAutoActivationTabs(
            message.reason || "sidebar-scan",
            Number.isInteger(Number(message.tabId)) ? Number(message.tabId) : null
          );
          return { ok: true, report, dashboard: await dashboard() };
        }

        case MESSAGE.PAUSE_TAB:
          await pauseTab(Number(message.tabId));
          return { ok: true, dashboard: await dashboard() };

        case MESSAGE.RESUME_TAB:
          await resumeTab(Number(message.tabId));
          return { ok: true, dashboard: await dashboard() };

        case MESSAGE.STOP_TAB:
          await stopTab(Number(message.tabId), null, message.drafts || null);
          return { ok: true, dashboard: await dashboard() };

        case MESSAGE.ASSIGN_PROFILE:
          await assignProfile(Number(message.tabId), message.profileId);
          return { ok: true, dashboard: await dashboard() };

        case MESSAGE.SAVE_TAB_CONFIG:
          await saveTabConfig(Number(message.tabId), message.config);
          return { ok: true, savedSession: publicSession(sessions.get(Number(message.tabId)), await loadStore()), dashboard: await dashboard() };

        case MESSAGE.RESET_TAB_CONFIG:
          await resetTabConfig(Number(message.tabId));
          return { ok: true, dashboard: await dashboard() };

        case MESSAGE.CREATE_PROFILE: {
          const result = await createProfile(message.name, message.baseProfileId, message.config);
          return { ok: true, profileId: result.profileId, savedProfile: Settings.profileById(result.store, result.profileId), dashboard: await dashboard() };
        }

        case MESSAGE.DUPLICATE_PROFILE: {
          const store = await loadStore();
          const base = Settings.profileById(store, message.profileId);
          if (!base) {
            throw new Error("Could not find the profile to duplicate.");
          }
          const result = await createProfile(message.name || `${base.name} - copy`, base.id);
          return { ok: true, profileId: result.profileId, savedProfile: Settings.profileById(result.store, result.profileId), dashboard: await dashboard() };
        }

        case MESSAGE.SAVE_PROFILE: {
          const saved = await saveProfile(message.profile);
          return { ok: true, savedProfile: Settings.profileById(saved, message.profile.id), dashboard: await dashboard() };
        }

        case MESSAGE.DELETE_PROFILE: {
          const result = await deleteProfile(message.profileId);
          return { ok: true, deletedProfile: result.profile, preservedTabs: result.preservedTabs, dashboard: await dashboard() };
        }

        case MESSAGE.SET_DEFAULT_PROFILE: {
          const result = await setDefaultProfile(message.profileId);
          return { ok: true, defaultProfileId: result.profile.id, dashboard: await dashboard() };
        }

        case MESSAGE.CREATE_COMPONENT_PROFILE: {
          const profile = await createComponentProfile(message.profileType, message.name, message.config);
          return { ok: true, profileType: message.profileType, componentProfileId: profile.id, savedProfile: profile, dashboard: await dashboard() };
        }

        case MESSAGE.SAVE_COMPONENT_PROFILE: {
          const profile = await saveComponentProfile(message.profileType, message.profile);
          return { ok: true, profileType: message.profileType, componentProfileId: profile.id, savedProfile: profile, dashboard: await dashboard() };
        }

        case MESSAGE.DELETE_COMPONENT_PROFILE:
          await deleteComponentProfile(message.profileType, message.profileId);
          return { ok: true, profileType: message.profileType, dashboard: await dashboard() };

        case MESSAGE.SET_DEFAULT_COMPONENT_PROFILE: {
          const result = await setDefaultComponentProfile(message.profileType, message.profileId);
          return { ok: true, profileType: message.profileType, componentProfileId: result.profile.id, dashboard: await dashboard() };
        }

        case MESSAGE.EXPORT_PROFILE_BUNDLE: {
          const bundle = await exportProfileBundle(message.profileType);
          return { ok: true, profileType: message.profileType, text: JSON.stringify(bundle, null, 2), count: bundle.profiles.length };
        }

        case MESSAGE.IMPORT_PROFILE_BUNDLE: {
          const result = await importProfileBundle(message.profileType, message.text);
          return {
            ok: true,
            profileType: message.profileType,
            imported: result.created,
            created: result.created,
            updated: 0,
            skipped: result.skipped || 0,
            collisionCopies: result.collisionCopies || 0,
            renamed: result.renamed || 0,
            dashboard: await dashboard()
          };
        }

        case MESSAGE.SET_TAB_CUSTOM_TITLE: {
          const titleState = await setTabCustomTitle(Number(message.tabId), message.title);
          return { ok: true, titleState, dashboard: await dashboard() };
        }

        case MESSAGE.EXPORT_SETTINGS: {
          const bundle = await buildFullConfigurationBundle();
          return { ok: true, text: ConfigurationBundle.stringify(bundle), scope: "all-configuration" };
        }

        case MESSAGE.EXPORT_SUPPORT_BUNDLE:
          return { ok: true, bundle: await buildSupportBundle() };

        case MESSAGE.PREVIEW_SETTINGS_IMPORT:
          return { ok: true, preview: await previewSettingsImport(message.text) };

        case MESSAGE.IMPORT_SETTINGS: {
          const result = await importSettings(message.text);
          return { ok: true, ...result, dashboard: await dashboard() };
        }

        case MESSAGE.CREATE_SETTINGS_SNAPSHOT: {
          const result = await createSettingsSnapshot("manual", message.label || "Manual snapshot");
          return { ok: true, snapshot: result.snapshot, added: result.added, dashboard: await dashboard() };
        }

        case MESSAGE.RESTORE_SETTINGS_SNAPSHOT: {
          const result = await restoreSettingsSnapshot(message.snapshotId);
          return { ok: true, ...result, dashboard: await dashboard() };
        }

        case MESSAGE.DELETE_SETTINGS_SNAPSHOT:
          await deleteSettingsSnapshot(message.snapshotId);
          return { ok: true, dashboard: await dashboard() };

        case MESSAGE.LIST_WORKING_SESSION_TABS:
          return { ok: true, tabs: await listWorkingSessionTabs() };

        case MESSAGE.EXPORT_WORKING_SESSION: {
          const bundle = await exportWorkingSession(message.tabIds);
          return { ok: true, text: WorkingSession.stringify(bundle), tabCount: bundle.tabs.length };
        }

        case MESSAGE.IMPORT_WORKING_SESSION: {
          const report = await importWorkingSession(message.text);
          return { ok: true, report, dashboard: await dashboard() };
        }

        case MESSAGE.SAVE_WORKING_SESSION_ENTRY: {
          const result = await saveWorkingSessionEntry(message.name, message.tabIds, message.entryId, message.description);
          return { ok: true, ...result, dashboard: await dashboard() };
        }

        case MESSAGE.RENAME_WORKING_SESSION_ENTRY:
          return { ok: true, catalog: await renameWorkingSessionEntry(message.entryId, message.name), dashboard: await dashboard() };

        case MESSAGE.DUPLICATE_WORKING_SESSION_ENTRY: {
          const result = await duplicateWorkingSessionEntry(message.entryId, message.name);
          return { ok: true, ...result, dashboard: await dashboard() };
        }

        case MESSAGE.DELETE_WORKING_SESSION_ENTRY:
          return { ok: true, catalog: await deleteWorkingSessionEntry(message.entryId), dashboard: await dashboard() };

        case MESSAGE.RESTORE_WORKING_SESSION_ENTRY: {
          const report = await restoreWorkingSessionEntry(message.entryId, message.tabIndexes);
          return { ok: true, report, dashboard: await dashboard() };
        }

        case MESSAGE.EXPORT_WORKING_SESSION_ENTRY: {
          const catalog = await loadWorkingSessionCatalog();
          const entry = WorkingSession.catalogEntryById(catalog, message.entryId);
          if (!entry) throw new Error("The selected saved working session no longer exists.");
          return { ok: true, text: WorkingSession.stringify(entry.bundle), name: entry.name, tabCount: entry.bundle.tabs.length };
        }

        case MESSAGE.IMPORT_WORKING_SESSION_ENTRY: {
          const result = await importWorkingSessionEntry(message.text, message.name);
          return { ok: true, ...result, dashboard: await dashboard() };
        }

        case MESSAGE.EXPORT_WORKING_SESSION_CATALOG: {
          const catalog = await loadWorkingSessionCatalog();
          return { ok: true, text: WorkingSession.stringifyCatalog(catalog), entryCount: catalog.entries.length };
        }

        case MESSAGE.IMPORT_WORKING_SESSION_CATALOG: {
          const result = await importWorkingSessionCatalog(message.text);
          return { ok: true, ...result, dashboard: await dashboard() };
        }

        case MESSAGE.CREATE_LOCAL_ACTION_PROFILE: {
          const result = await createLocalActionProfile(message.name, message.baseProfileId, message.config);
          return { ok: true, localActionProfileId: result.profileId, savedProfile: LocalActions.profileById(result.store, result.profileId), dashboard: await dashboard() };
        }

        case MESSAGE.SAVE_LOCAL_ACTION_PROFILE: {
          const saved = await saveLocalActionProfile(message.profile);
          return { ok: true, savedProfile: LocalActions.profileById(saved, message.profile?.id), dashboard: await dashboard() };
        }

        case MESSAGE.DELETE_LOCAL_ACTION_PROFILE: {
          const result = await deleteLocalActionProfile(message.profileId);
          return { ok: true, deletedProfile: result.profile, preservedTabs: result.preservedTabs, dashboard: await dashboard() };
        }

        case MESSAGE.SET_DEFAULT_LOCAL_ACTION_PROFILE: {
          const result = await setDefaultLocalActionProfile(message.profileId);
          return { ok: true, defaultProfileId: result.profile.id, dashboard: await dashboard() };
        }

        case MESSAGE.ASSIGN_LOCAL_ACTION_PROFILE: {
          const tabId = Number(message.tabId);
          volatileLocalActionDrafts.delete(tabId);
          const assignment = await assignLocalActionProfile(tabId, message.profileId);
          return { ok: true, assignment, localActionProfileId: assignment.profileId, dashboard: await dashboard() };
        }

        case MESSAGE.CLEAR_LOCAL_ACTION_PROFILE_BINDING: {
          const tabId = Number(message.tabId);
          volatileLocalActionDrafts.delete(tabId);
          const assignment = await clearLocalActionProfileBinding(tabId);
          return { ok: true, assignment, localActionProfileId: assignment.profileId, dashboard: await dashboard() };
        }

        case MESSAGE.SAVE_TAB_LOCAL_ACTIONS: { if (message.volatile === true) { assertSidebarSender(sender); const result = await setVolatileLocalActionDraft(Number(message.tabId), message.config, Boolean(message.clear), message.context); return { ok: true, savedSession: result.session, stale: result.stale, volatile: true, dashboard: await dashboard() }; } volatileLocalActionDrafts.delete(Number(message.tabId));
          const tabId = Number(message.tabId);
          await saveTabLocalActions(tabId, message.config);
          const [store, localStore] = await Promise.all([loadStore(), loadLocalActionStore()]);
          const savedSession = sessions.get(tabId);
          return {
            ok: true,
            savedSession: savedSession ? publicSession(savedSession, store, localStore) : null,
            dashboard: await dashboard()
          };
        }

        case MESSAGE.RESET_TAB_LOCAL_ACTIONS:
          
        volatileLocalActionDrafts.delete(Number(message.tabId));await resetTabLocalActions(Number(message.tabId));
          return { ok: true, dashboard: await dashboard() };

        case MESSAGE.START_ELEMENT_PICKER:
          return {
            ok: true,
            picker: await startElementPicker(Number(message.tabId), message.kind),
            dashboard: await dashboard()
          };

        case MESSAGE.CANCEL_ELEMENT_PICKER:
          return {
            ok: true,
            picker: await cancelElementPicker(Number(message.tabId), message.reason || "sidebar-cancel"),
            dashboard: await dashboard()
          };

        case MESSAGE.TEST_SELECTOR:
          return {
            ok: true,
            result: await testSelector(
              Number(message.tabId),
              message.selector,
              message.visibility || "any",
              message.config || null,
              message.kind || "selector"
            )
          };

        case MESSAGE.TEST_TARGET_ACTION:
          return {
            ok: true,
            result: await testTargetAction(
              Number(message.tabId),
              message.config,
              Boolean(message.click)
            ),
            dashboard: await dashboard()
          };

        case MESSAGE.CLEAR_HIGHLIGHTS:
          return {
            ok: true,
            result: await clearHighlights(Number(message.tabId))
          };

        case MESSAGE.CLEAR_SESSION_LOGS:
          await clearSessionLogs(Number(message.tabId));
          return { ok: true, dashboard: await dashboard() };

        case MESSAGE.RESET_RULE_STATISTICS:
          assertSidebarSender(sender);
          await resetRuleStatistics(Number(message.tabId));
          return { ok: true, dashboard: await dashboard() };

        case MESSAGE.SAVE_PROMPT_TEMPLATE: {
          const result = await savePromptTemplate(message.template, sender);
          return { ok: true, template: result.template, promptTemplates: result.library, dashboard: await dashboard() };
        }

        case MESSAGE.DELETE_PROMPT_TEMPLATE: {
          const result = await deletePromptTemplate(message.templateId, sender);
          return { ok: true, deletedId: result.deletedId, promptTemplates: result.library, dashboard: await dashboard() };
        }

        case MESSAGE.FILL_PROMPT_TEMPLATE:
          return { ok: true, result: await fillPromptTemplate(Number(message.tabId), message.text, sender) };

        case MESSAGE.GET_NATIVE_STATUS:
          return { ok: true, nativeHost: await checkNativeStatus(sender), dashboard: await dashboard() };

        case MESSAGE.SAVE_NATIVE_LOG_RETENTION:
          return { ok: true, nativeLogRetention: await saveNativeLogRetention(message.policy), dashboard: await dashboard() };

        case MESSAGE.RUN_NATIVE_LOG_CLEANUP:
          return { ok: true, cleanup: await runNativeLogCleanup("manual", { force: true, dryRun: Boolean(message.dryRun) }), dashboard: await dashboard() };

        case MESSAGE.RUN_SHELL:
          return { ok: true, shellRun: await runShell(message, sender), dashboard: await dashboard() };

        case MESSAGE.STOP_SHELL:
          return { ok: true, shellRun: await stopShell(message, sender), dashboard: await dashboard() };

        case MESSAGE.CLEAR_SHELL_OUTPUT:
          return { ok: true, shellRun: await clearShellOutput(message, sender), dashboard: await dashboard() };

        case MESSAGE.CLEAR_SHELL_HISTORY:
          return { ok: true, shellHistory: await clearShellHistory(message, sender), dashboard: await dashboard() };

        case MESSAGE.READ_SHELL_LOG:
          return { ok: true, logChunk: await readShellLog(message, sender) };

        case MESSAGE.DELETE_SHELL_LOG:
          return { ok: true, deletedLog: await deleteShellLog(message, sender), dashboard: await dashboard() };

        case MESSAGE.ACKNOWLEDGE_SHELL_LOG:
          return { ok: true, shellNotice: await acknowledgeShellLog(message, sender), dashboard: await dashboard() };

        case MESSAGE.ARM_DOWNLOAD_CAPTURE:
          return { ok: true, capture: await armDownloadCaptureFromContent(message, sender), dashboard: await dashboard() };

        case MESSAGE.GET_DOWNLOAD_STATE:
          return { ok: true, download: publicDownloadState(Number(message.tabId)), dashboard: await dashboard() };

        case MESSAGE.RETRY_DOWNLOAD_MOVE:
          return { ok: true, download: await retryDownloadMove(message, sender), dashboard: await dashboard() };

        case MESSAGE.RUN_COMPLETED_DOWNLOAD_SHELL: {
          const shellRun = await runCompletedDownloadShell(message, sender);
          return { ok: true, shellRun, dashboard: await dashboard() };
        }

        case MESSAGE.CONTENT_RUNTIME_EVENT:
          return { ok: true, runtime: await updateRuntimeFromContent(message, sender) };

        case MESSAGE.CONTENT_PICKER_RESULT:
          return { ok: true, result: await handleElementPickerResult(message, sender) };

        default:
          return undefined;
      }
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (browser.commands?.onCommand) {
    browser.commands.onCommand.addListener((command) => {
      void handleKeyboardCommand(command).catch((error) => handleKeyboardCommandFailure(command, error));
    });
  }
  if (browser.commands?.onChanged) {
    browser.commands.onChanged.addListener(() => {
      void broadcast("keyboard-shortcuts-changed");
    });
  }

  browser.action.onClicked.addListener((tab) => {
    void browser.sidebarAction.open().catch((error) => {
      console.error("FirefoxChatImprover: cannot open sidebar", error);
    });
    void activateTab(tab, "toolbar").catch(async (error) => {
      if (Number.isInteger(tab?.id)) {
        await applyBadge(tab.id, "!", "#cf222e");
      }
      await broadcast("activation-error", tab?.id || null);
      console.error("FirefoxChatImprover: activation failed", error);
    });
  });

  const requestTypes = new Set([
    MESSAGE.GET_DASHBOARD,
    MESSAGE.ACK_SHORTCUT_ACTION,
    MESSAGE.ACTIVATE_CURRENT,
    MESSAGE.RUN_AUTO_ACTIVATION_SCAN,
    MESSAGE.PAUSE_TAB,
    MESSAGE.RESUME_TAB,
    MESSAGE.STOP_TAB,
    MESSAGE.ASSIGN_PROFILE,
    MESSAGE.SAVE_TAB_CONFIG,
    MESSAGE.RESET_TAB_CONFIG,
    MESSAGE.CREATE_PROFILE,
    MESSAGE.DUPLICATE_PROFILE,
    MESSAGE.SAVE_PROFILE,
    MESSAGE.DELETE_PROFILE,
    MESSAGE.SET_DEFAULT_PROFILE,
    MESSAGE.CREATE_COMPONENT_PROFILE,
    MESSAGE.SAVE_COMPONENT_PROFILE,
    MESSAGE.DELETE_COMPONENT_PROFILE,
    MESSAGE.SET_DEFAULT_COMPONENT_PROFILE,
    MESSAGE.EXPORT_PROFILE_BUNDLE,
    MESSAGE.IMPORT_PROFILE_BUNDLE,
    MESSAGE.SET_TAB_CUSTOM_TITLE,
    MESSAGE.EXPORT_SETTINGS,
    MESSAGE.EXPORT_SUPPORT_BUNDLE,
    MESSAGE.PREVIEW_SETTINGS_IMPORT,
    MESSAGE.IMPORT_SETTINGS,
    MESSAGE.CREATE_SETTINGS_SNAPSHOT,
    MESSAGE.RESTORE_SETTINGS_SNAPSHOT,
    MESSAGE.DELETE_SETTINGS_SNAPSHOT,
    MESSAGE.LIST_WORKING_SESSION_TABS,
    MESSAGE.EXPORT_WORKING_SESSION,
    MESSAGE.IMPORT_WORKING_SESSION,
    MESSAGE.SAVE_WORKING_SESSION_ENTRY,
    MESSAGE.RENAME_WORKING_SESSION_ENTRY,
    MESSAGE.DUPLICATE_WORKING_SESSION_ENTRY,
    MESSAGE.DELETE_WORKING_SESSION_ENTRY,
    MESSAGE.RESTORE_WORKING_SESSION_ENTRY,
    MESSAGE.EXPORT_WORKING_SESSION_ENTRY,
    MESSAGE.IMPORT_WORKING_SESSION_ENTRY,
    MESSAGE.EXPORT_WORKING_SESSION_CATALOG,
    MESSAGE.IMPORT_WORKING_SESSION_CATALOG,
    MESSAGE.TEST_SELECTOR,
    MESSAGE.START_ELEMENT_PICKER,
    MESSAGE.CANCEL_ELEMENT_PICKER,
    MESSAGE.TEST_TARGET_ACTION,
    MESSAGE.CLEAR_HIGHLIGHTS,
    MESSAGE.CLEAR_SESSION_LOGS,
    MESSAGE.GET_NATIVE_STATUS,
    MESSAGE.SAVE_NATIVE_LOG_RETENTION,
    MESSAGE.RUN_NATIVE_LOG_CLEANUP,
    MESSAGE.RUN_SHELL,
    MESSAGE.STOP_SHELL,
    MESSAGE.CLEAR_SHELL_OUTPUT,
    MESSAGE.CLEAR_SHELL_HISTORY,
    MESSAGE.CREATE_LOCAL_ACTION_PROFILE,
    MESSAGE.SAVE_LOCAL_ACTION_PROFILE,
    MESSAGE.DELETE_LOCAL_ACTION_PROFILE,
    MESSAGE.SET_DEFAULT_LOCAL_ACTION_PROFILE,
    MESSAGE.ASSIGN_LOCAL_ACTION_PROFILE,
    MESSAGE.SAVE_TAB_LOCAL_ACTIONS,
    MESSAGE.RESET_TAB_LOCAL_ACTIONS,
    MESSAGE.ARM_DOWNLOAD_CAPTURE,
    MESSAGE.GET_DOWNLOAD_STATE,
    MESSAGE.RETRY_DOWNLOAD_MOVE,
    MESSAGE.CONTENT_RUNTIME_EVENT,
    MESSAGE.CONTENT_PICKER_RESULT,
    MESSAGE.RUN_COMPLETED_DOWNLOAD_SHELL
  ]);


  const SIDEBAR_REQUEST_TYPES = new Set([
    MESSAGE.GET_DASHBOARD,
    MESSAGE.ACK_SHORTCUT_ACTION,
    MESSAGE.ACTIVATE_CURRENT,
    MESSAGE.RUN_AUTO_ACTIVATION_SCAN,
    MESSAGE.PAUSE_TAB,
    MESSAGE.RESUME_TAB,
    MESSAGE.STOP_TAB,
    MESSAGE.ASSIGN_PROFILE,
    MESSAGE.SAVE_TAB_CONFIG,
    MESSAGE.RESET_TAB_CONFIG,
    MESSAGE.CREATE_PROFILE,
    MESSAGE.DUPLICATE_PROFILE,
    MESSAGE.SAVE_PROFILE,
    MESSAGE.DELETE_PROFILE,
    MESSAGE.SET_DEFAULT_PROFILE,
    MESSAGE.CREATE_COMPONENT_PROFILE,
    MESSAGE.SAVE_COMPONENT_PROFILE,
    MESSAGE.DELETE_COMPONENT_PROFILE,
    MESSAGE.SET_DEFAULT_COMPONENT_PROFILE,
    MESSAGE.EXPORT_PROFILE_BUNDLE,
    MESSAGE.IMPORT_PROFILE_BUNDLE,
    MESSAGE.SET_TAB_CUSTOM_TITLE,
    MESSAGE.EXPORT_SETTINGS,
    MESSAGE.EXPORT_SUPPORT_BUNDLE,
    MESSAGE.PREVIEW_SETTINGS_IMPORT,
    MESSAGE.IMPORT_SETTINGS,
    MESSAGE.CREATE_SETTINGS_SNAPSHOT,
    MESSAGE.RESTORE_SETTINGS_SNAPSHOT,
    MESSAGE.DELETE_SETTINGS_SNAPSHOT,
    MESSAGE.LIST_WORKING_SESSION_TABS,
    MESSAGE.EXPORT_WORKING_SESSION,
    MESSAGE.IMPORT_WORKING_SESSION,
    MESSAGE.SAVE_WORKING_SESSION_ENTRY,
    MESSAGE.RENAME_WORKING_SESSION_ENTRY,
    MESSAGE.DUPLICATE_WORKING_SESSION_ENTRY,
    MESSAGE.DELETE_WORKING_SESSION_ENTRY,
    MESSAGE.RESTORE_WORKING_SESSION_ENTRY,
    MESSAGE.EXPORT_WORKING_SESSION_ENTRY,
    MESSAGE.IMPORT_WORKING_SESSION_ENTRY,
    MESSAGE.EXPORT_WORKING_SESSION_CATALOG,
    MESSAGE.IMPORT_WORKING_SESSION_CATALOG,
    MESSAGE.TEST_SELECTOR,
    MESSAGE.START_ELEMENT_PICKER,
    MESSAGE.CANCEL_ELEMENT_PICKER,
    MESSAGE.TEST_TARGET_ACTION,
    MESSAGE.CLEAR_HIGHLIGHTS,
    MESSAGE.CLEAR_SESSION_LOGS,
    MESSAGE.GET_NATIVE_STATUS,
    MESSAGE.SAVE_NATIVE_LOG_RETENTION,
    MESSAGE.RUN_NATIVE_LOG_CLEANUP,
    MESSAGE.RUN_SHELL,
    MESSAGE.STOP_SHELL,
    MESSAGE.CLEAR_SHELL_OUTPUT,
    MESSAGE.CLEAR_SHELL_HISTORY,
    MESSAGE.CREATE_LOCAL_ACTION_PROFILE,
    MESSAGE.SAVE_LOCAL_ACTION_PROFILE,
    MESSAGE.DELETE_LOCAL_ACTION_PROFILE,
    MESSAGE.SET_DEFAULT_LOCAL_ACTION_PROFILE,
    MESSAGE.ASSIGN_LOCAL_ACTION_PROFILE,
    MESSAGE.SAVE_TAB_LOCAL_ACTIONS,
    MESSAGE.RESET_TAB_LOCAL_ACTIONS,
    MESSAGE.GET_DOWNLOAD_STATE,
    MESSAGE.RETRY_DOWNLOAD_MOVE
  ]);

  function validateRequestSender(message, sender) {
    if ([MESSAGE.CONTENT_RUNTIME_EVENT, MESSAGE.CONTENT_PICKER_RESULT, MESSAGE.ARM_DOWNLOAD_CAPTURE, MESSAGE.RUN_COMPLETED_DOWNLOAD_SHELL].includes(message.type)) {
      if (!Number.isInteger(sender?.tab?.id)) {
        throw new Error("Content events are accepted only from a content script in a tab.");
      }
      return;
    }
    if (SIDEBAR_REQUEST_TYPES.has(message.type)) {
      if (sender?.tab) {
        throw new Error("Administrative requests may be sent only from the sidebar, not from content scripts.");
      }
      const sidebarPrefix = browser.runtime.getURL("sidebar/");
      if (typeof sender?.url !== "string" || !sender.url.startsWith(sidebarPrefix)) {
        throw new Error("The administrative request did not originate from the valid sidebar.");
      }
    }
  }

  browser.runtime.onMessage.addListener((message, sender) => {
    if (!message || !requestTypes.has(message.type)) {
      return undefined;
    }
    try {
      validateRequestSender(message, sender);
    } catch (error) {
      return Promise.resolve(errorResponse(error));
    }
    return handleRequest(message, sender);
  });

  if (browser.webRequest?.onHeadersReceived) {
    try {
      browser.webRequest.onHeadersReceived.addListener(
        interceptDownloadResponse,
        { urls: ["<all_urls>"], types: ["main_frame", "sub_frame", "xmlhttprequest", "other"] },
        ["blocking", "responseHeaders"]
      );
    } catch (error) {
      console.error("FirefoxChatImprover: managed HTTP download interception is unavailable", error);
    }
  }

  if (browser.downloads?.onCreated && browser.downloads?.onChanged) {
    browser.downloads.onCreated.addListener((item) => {
      void onBrowserDownloadCreated(item).catch((error) => {
        console.error("FirefoxChatImprover: download create handler failed", error);
      });
    });

    browser.downloads.onChanged.addListener((delta) => {
      void onBrowserDownloadChanged(delta).catch((error) => {
        console.error("FirefoxChatImprover: download change handler failed", error);
      });
    });
  }

  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const session = sessions.get(tabId);
    if (!session) {
      if (changeInfo.status === "complete") {
        void attemptAutoActivation(tab, "tab-complete").catch((error) => {
          console.error("FirefoxChatImprover: automatic URL activation failed", error);
        });
      }
      return;
    }

    const urlChanged = typeof changeInfo.url === "string" && changeInfo.url !== session.url;
    if (changeInfo.status === "loading" || urlChanged) {
      session.url = tab.url || changeInfo.url || session.url;
      if (!session.customTitle && tab.title) session.pageTitle = tab.title;
      session.title = session.customTitle || session.pageTitle || tab.title || session.title;
      session.runtime = {
        ...session.runtime,
        customTitle: session.customTitle || "",
        pageTitle: session.pageTitle || ""
      };
      session.windowId = tab.windowId;
      session.index = tab.index;
      session.runtime = {
        ...recoveryRuntime(session, "tab-navigation"),
        recoveryState: Recovery.STATE.NAVIGATION_PENDING,
        recoveryReason: "Waiting for the page to finish loading before reconnecting the monitor.",
        navigationPending: true,
        recoveryAttempts: Number(session.runtime?.recoveryAttempts || 0)
      };
      session.updatedAt = Settings.nowIso();
      void clearNotification(tabId);
      void persistSession(session);
      void loadStore().then((store) => updateBadge(session, store));
      void broadcast("tab-navigation-pending", tabId);
      return;
    }

    if (changeInfo.status === "complete" && session.runtime?.navigationPending) {
      void loadStore().then((store) => reattachSession(session, store, "tab-navigation")).catch(async (error) => {
        session.runtime = {
          ...session.runtime,
          recoveryState: Recovery.STATE.FAILED,
          recoveryReason: error instanceof Error ? error.message : String(error),
          navigationPending: false
        };
        appendLog(session, "user", "session-recovery-failed", session.runtime.recoveryReason);
        await persistSession(session);
        await broadcast("session-recovery-failed", tabId);
      });
      return;
    }

    if (typeof changeInfo.title === "string" && !session.runtime?.alertActive && !session.customTitle) {
      session.pageTitle = changeInfo.title;
      session.title = changeInfo.title;
      session.runtime = { ...session.runtime, pageTitle: changeInfo.title, customTitle: "" };
      session.updatedAt = Settings.nowIso();
      void persistSession(session);
      void broadcast("tab-title-updated", tabId);
    }
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== "complete") return;
    void (async () => {
      const state = await loadCustomTitleState(tabId, tab?.title || "");
      if (!state.customTitle) return;
      const refreshed = normalizeCustomTitleState({
        ...state,
        pageTitle: tab?.title || sessions.get(tabId)?.pageTitle || state.pageTitle,
        updatedAt: state.updatedAt
      }, tab?.title || "");
      await saveCustomTitleState(tabId, refreshed);
      const session = sessions.get(tabId);
      if (session) {
        applyCustomTitleStateToSession(session, refreshed, refreshed.pageTitle);
        const store = await loadStore();
        await applySessionToContent(session, store);
        await persistSession(session);
      } else {
        await applyPlainCustomTitle(tabId, refreshed.customTitle, true);
      }
      await broadcast("tab-custom-title-restored", tabId);
    })().catch(() => { /* Site permission or navigation may temporarily block title restoration. */ });
  });

  browser.tabs.onActivated.addListener((activeInfo) => {
    void clearViewedShellNoticeForActiveTab(activeInfo.tabId)
      .then((cleared) => cleared || broadcast("active-tab-changed", activeInfo.tabId))
      .catch(() => broadcast("active-tab-changed", activeInfo.tabId));
  });

  browser.tabs.onRemoved.addListener((tabId) => { volatileLocalActionDrafts.delete(Number(tabId)); autoActivationInFlight.delete(Number(tabId)); autoActivationAudit.delete(Number(tabId));
    const shellRun = shellRuns.get(tabId);
    if (shellRun?.runId && ["starting", "running", "terminal", "stopping"].includes(shellRun.status)) {
      try {
        ensureNativePort().postMessage({ action: "stop", runId: shellRun.runId, tabId });
      } catch (_error) {
        // Native host may already be unavailable during browser shutdown.
      }
    }
    shellRuns.delete(tabId);
    pickerStates.delete(tabId);
    clearDownloadCaptureExpiryTimer(tabId);
    downloadCaptures.delete(tabId);
    for (const [captureId, pending] of managedDownloadStarts.entries()) {
      if (Number(pending?.tabId) === Number(tabId)) managedDownloadStarts.delete(captureId);
    }
    const removedDownloadJob = downloadJobs.get(tabId);
    clearDownloadRoutingKeys(removedDownloadJob);
    downloadJobs.delete(tabId);
    for (const [key, value] of downloadMoveToTab.entries()) {
      if (Number(value) === Number(tabId)) {
        downloadMoveToTab.delete(key);
        if (Number.isInteger(key)) managedDownloadIds.delete(key);
      }
    }
    const timer = shellBroadcastTimers.get(tabId);
    if (timer) {
      clearTimeout(timer);
      shellBroadcastTimers.delete(tabId);
    }
    if (shellRun?.runId) {
      runToTab.delete(shellRun.runId);
    }
    if (!sessions.has(tabId)) {
      return;
    }
    sessions.delete(tabId);
    void clearNotification(tabId);
    void broadcast("tab-removed", tabId);
  });

  browser.notifications.onClicked.addListener((notificationId) => {
    const match = /^fci-tab-(\d+)$/.exec(notificationId);
    if (!match) {
      return;
    }
    const tabId = Number(match[1]);
    const session = sessions.get(tabId);
    if (!session) {
      return;
    }
    void browser.windows.update(session.windowId, { focused: true }).catch(() => { });
    void browser.tabs.update(tabId, { active: true }).catch(() => { });
    void clearNotification(tabId);
  });

  void recoverAll()
    .then(() => restoreAllCustomTabTitles())
    .then(() => scanAutoActivationTabs("background-startup"))
    .then(() => scheduleNativeLogCleanup("startup", 2500))
    .catch((error) => {
      console.error("FirefoxChatImprover: startup session recovery failed", error);
    });

})();
