(() => {
  "use strict";

  const { MESSAGE, MODE, CONFIG_MODE, MONITOR_STATE } = globalThis.FCI_PROTOCOL;
  const Settings = globalThis.FCI_SETTINGS;
  const Snapshots = globalThis.FCI_SETTINGS_SNAPSHOTS;
  const Recovery = globalThis.FCI_RECOVERY;
  const SupportBundle = globalThis.FCI_SUPPORT_BUNDLE;
  const WorkingSession = globalThis.FCI_WORKING_SESSION;
  const LocalActions = globalThis.FCI_LOCAL_ACTIONS;
  const TAB_SESSION_KEY = "firefoxChatImprover.tabSession.v2";
  const sessions = new Map();
  const pickerStates = new Map();
  let storePromise = null;
  let localActionStorePromise = null;
  let snapshotPromise = null;
  let recoveryPromise = null;

  const NATIVE_HOST_NAME = "com.duongtc.firefox_chat_assistant";
  const SHELL_OUTPUT_LIMIT = 500;
  const SHELL_OUTPUT_CHAR_LIMIT = 200000; // UI tail only; the Native Host keeps the complete file-backed log.
  const SHELL_LOG_READ_MAX_BYTES = 256 * 1024;
  const shellRuns = new Map();
  const downloadCaptures = new Map();
  const downloadJobs = new Map();
  const managedDownloadIds = new Set();
  const downloadMoveToTab = new Map();
  const runToTab = new Map();
  const shellBroadcastTimers = new Map();
  const runtimeBroadcastTimers = new Map();
  const pendingNativeRequests = new Map();
  let nativePort = null;
  let nativeState = {
    connected: false,
    hostName: NATIVE_HOST_NAME,
    hostVersion: null,
    lastError: null,
    lastSeenAt: null
  };

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

  function emptyDownloadState(tabId) {
    return {
      tabId,
      captureId: null,
      sessionToken: null,
      localActionProfileId: null,
      localActionRevision: 0,
      configSnapshot: null,
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
      retryable: false,
      recoveryNote: null,
      error: null,
      completedAt: null,
      showCompletionDialog: false,
      executeShellAfterMove: false
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
      configSnapshot,
      downloadId: Number.isInteger(source.downloadId) ? source.downloadId : null,
      moveAttempt: Math.max(0, Number(source.moveAttempt) || 0),
      retryable: Boolean(source.retryable),
      showCompletionDialog: Boolean(source.showCompletionDialog),
      executeShellAfterMove: Boolean(source.executeShellAfterMove)
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

  function activeDownloadCapture(tabId) {
    const capture = downloadCaptures.get(Number(tabId));
    if (!capture) return null;
    if (Date.now() > capture.expiresAtMs) {
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
    const session = sessions.get(Number(tabId));
    if (!session) throw new Error("This tab is not activated.");
    const localStore = await loadLocalActionStore();
    const config = sessionLocalActionConfig(session, localStore);
    if (!config.download.enabled) {
      return { armed: false, reason: "disabled" };
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
      config: configSnapshot,
      armedAtMs: Date.now(),
      expiresAtMs: Date.now() + seconds * 1000,
      claimed: false
    };
    downloadCaptures.set(Number(tabId), capture);
    downloadJobs.set(Number(tabId), {
      ...emptyDownloadState(Number(tabId)),
      captureId,
      sessionToken: session.sessionToken,
      localActionProfileId: session.localActionProfileId,
      localActionRevision: Number(session.localActionRevision || 0),
      configSnapshot,
      status: "armed",
      armedAt: Settings.nowIso(),
      expiresAt: new Date(capture.expiresAtMs).toISOString(),
      destinationDirectory: config.download.destinationDirectory,
      showCompletionDialog: config.download.showCompletionDialog,
      executeShellAfterMove: config.download.executeShellAfterMove
    });
    session.downloadJob = publicDownloadState(Number(tabId));
    appendLog(session, "debug", "download-capture-armed", "Managed download capture armed before target click.", {
      captureId, ruleId: capture.ruleId, cycle: capture.cycle, expiresAt: capture.expiresAtMs
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
    if (matching.length) {
      return matching.sort((left, right) => right.armedAtMs - left.armedAtMs)[0] || null;
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
      configSnapshot: LocalActions.normalizeExecutionSnapshot(capture.config),
      destinationDirectory: capture.config.download.destinationDirectory,
      showCompletionDialog: capture.config.download.showCompletionDialog,
      executeShellAfterMove: capture.config.download.executeShellAfterMove,
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

  async function startManagedDownload(capture, url, filename) {
    if (!capture || capture.claimed) return;
    const safeName = cleanDownloadFilename(filename || (() => {
      try { return new URL(url).pathname.split("/").pop(); } catch (_error) { return "download.bin"; }
    })());
    const relative = `FirefoxChatImprover/${capture.captureId}/${safeName}`;
    const downloadId = await browser.downloads.download({
      url,
      filename: relative,
      saveAs: false,
      conflictAction: "uniquify"
    });
    managedDownloadIds.add(downloadId);
    const results = await browser.downloads.search({ id: downloadId });
    await claimDownload(capture, results[0] || { id: downloadId, url, filename: "" }, "managed-http-download");
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
    job.retryable = false;
    job.recoveryNote = options.recovery ? "Resumed after background recovery." : (options.retry ? "Manual relocation retry." : null);
    job.error = null;
    downloadMoveToTab.set(moveId, numericTabId);
    try {
      const port = ensureNativePort();
      port.postMessage({
        action: "move_download",
        moveId,
        tabId: numericTabId,
        sourcePath,
        destinationDirectory: config.download.destinationDirectory,
        conflictAction: config.download.conflictAction
      });
    } catch (error) {
      downloadMoveToTab.delete(moveId);
      job.status = "error";
      job.retryable = true;
      job.error = error instanceof Error ? error.message : String(error);
      job.completedAt = Settings.nowIso();
      await persistDownloadState(numericTabId);
      await broadcast("download-move-error", numericTabId);
      return;
    }
    appendLog(session, "debug", "download-move-request", "Native Host download relocation requested from the captured immutable local-action snapshot.", {
      moveId,
      sourcePath,
      destinationDirectory: config.download.destinationDirectory,
      localActionProfileId: job.localActionProfileId,
      localActionRevision: job.localActionRevision,
      moveAttempt: job.moveAttempt
    });
    await persistDownloadState(numericTabId);
    await broadcast("download-moving", numericTabId);
  }

  async function handleNativeDownloadMessage(message) {
    const moveId = String(message?.moveId || "");
    const tabId = Number(message?.tabId ?? downloadMoveToTab.get(moveId));
    if (!Number.isInteger(tabId)) return;
    const job = downloadJobs.get(tabId) || emptyDownloadState(tabId);
    const session = sessions.get(tabId);
    if (message.event === "download_moved") {
      Object.assign(job, {
        status: "completed",
        destinationPath: String(message.destinationPath || ""),
        filename: String(message.filename || job.filename || ""),
        size: Number(message.size || 0),
        completedAt: Settings.nowIso(),
        retryable: false,
        recoveryNote: null,
        error: null
      });
      appendLog(session, "user", "download-completed", `Downloaded file moved to ${job.destinationPath}.`, {
        destinationPath: job.destinationPath, size: job.size
      });
      downloadMoveToTab.delete(moveId);
      if (Number.isInteger(job.downloadId)) {
        void browser.downloads.erase({ id: job.downloadId }).catch(() => []);
      }
      if (session) {
        session.downloadJob = publicDownloadState(tabId);
        await persistSession(session);
      }
      if (session && job.sessionToken === session.sessionToken) {
        const localConfig = jobExecutionConfig(job);
        if (localConfig.download.executeShellAfterMove) {
          try {
            if (localConfig.shell.confirmBeforeRun) {
              appendLog(session, "user", "download-command-skipped", "Automatic shell execution was skipped because confirmation is enabled.");
            } else {
              const shell = validateShellPayload({
                tabId,
                cwd: localConfig.shell.workingDirectory,
                command: localConfig.shell.command,
                mode: localConfig.shell.mode
              }, localConfig);
              await startShellRunForSession(session, localConfig, shell, {
                source: "download",
                trigger: "download-moved"
              });
            }
          } catch (error) {
            appendLog(session, "user", "download-command-error", error instanceof Error ? error.message : String(error));
            await persistSession(session);
          }
        }
      } else if (session && job.executeShellAfterMove) {
        appendLog(session, "user", "download-command-skipped", "Automatic shell execution was skipped because the original download session is no longer current.", {
          captureId: job.captureId,
          originalSessionToken: job.sessionToken,
          currentSessionToken: session.sessionToken
        });
        await persistSession(session);
      }
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
    downloadMoveToTab.delete(moveId);
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
    downloadCaptures.delete(capture.tabId);
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
    if (managedDownloadIds.has(item.id)) return;
    const capture = captureForDownloadItem(item);
    if (!capture) return;
    await claimDownload(capture, item, "browser-download-fallback");
  }

  async function onBrowserDownloadChanged(delta) {
    const tabId = downloadMoveToTab.get(delta.id);
    if (!Number.isInteger(tabId)) return;
    const job = downloadJobs.get(tabId);
    if (!job) return;
    if (delta.filename?.current) {
      job.sourcePath = delta.filename.current;
      job.filename = cleanDownloadFilename(delta.filename.current);
    }
    if (delta.error?.current) {
      job.status = "error";
      job.retryable = false;
      job.error = String(delta.error.current);
      job.completedAt = Settings.nowIso();
      await persistDownloadState(tabId);
      await broadcast("download-error", tabId);
      return;
    }
    if (delta.state?.current !== "complete") return;
    const results = await browser.downloads.search({ id: delta.id });
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
      throw new Error("The managed download relocation is not retryable.");
    }
    await moveCompletedDownload(tabId, { id: job.downloadId, filename: job.sourcePath }, { retry: true, force: true });
    return publicDownloadState(tabId);
  }

  async function recoverDownloadJob(session) {
    const tabId = Number(session?.tabId);
    if (!Number.isInteger(tabId) || !session?.downloadJob) return;
    const job = normalizeDownloadState(session.downloadJob, tabId);
    downloadJobs.set(tabId, job);
    if (Number.isInteger(job.downloadId)) {
      downloadMoveToTab.set(job.downloadId, tabId);
    }
    if (job.status === "armed") {
      job.status = "error";
      job.retryable = false;
      job.error = "The download capture window was interrupted by a background restart; trigger the target again.";
      job.completedAt = Settings.nowIso();
    } else if (job.status === "moving") {
      // A move may already have completed while the background was unavailable.
      // Never issue a duplicate move automatically; expose a deliberate retry.
      job.status = "error";
      job.retryable = Boolean(job.sourcePath);
      job.error = "Download relocation was interrupted. Use Retry relocation after checking the destination.";
      job.recoveryNote = "Recovered an interrupted relocation without replaying it automatically.";
      job.completedAt = Settings.nowIso();
    } else if (job.status === "downloading" && Number.isInteger(job.downloadId)) {
      const results = await browser.downloads.search({ id: job.downloadId }).catch(() => []);
      const item = results[0];
      if (item?.state === "complete") {
        await moveCompletedDownload(tabId, item, { recovery: true, force: true });
        return;
      }
      if (item?.state === "interrupted") {
        job.status = "error";
        job.retryable = false;
        job.error = item.error || "The browser download was interrupted.";
        job.completedAt = Settings.nowIso();
      }
    }
    session.downloadJob = publicDownloadState(tabId);
    await persistSession(session);
  }

  function nativeDashboardState() {
    return {
      ...clone(nativeState),
      runs: [...shellRuns.values()].map((run) => clone(run)),
      downloads: [...downloadJobs.values()].map((job) => clone(job))
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

  function nativeRequest(action, payload = {}, timeoutMs = 15000) {
    const requestId = crypto.randomUUID();
    const port = ensureNativePort();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingNativeRequests.delete(requestId);
        reject(new Error(`Native Host request timed out: ${action}`));
      }, timeoutMs);
      pendingNativeRequests.set(requestId, { resolve, reject, timer });
      port.postMessage({ action, requestId, ...payload });
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

    const event = String(message?.event || "");
    const requestId = String(message?.requestId || "");
    if (requestId && pendingNativeRequests.has(requestId)) {
      const pending = pendingNativeRequests.get(requestId);
      pendingNativeRequests.delete(requestId);
      clearTimeout(pending.timer);
      if (event === "error" || event === "fatal") {
        pending.reject(new Error(String(message.error || "The Native Host request failed.")));
      } else {
        pending.resolve(clone(message));
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
      if (run.source === "automation") {
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
    }
    await broadcast("native-shell-event", tabId);
  }

  function handleNativeDisconnect(port) {
    if (nativePort !== port) {
      return;
    }
    nativePort = null;
    const lastError = browser.runtime.lastError?.message || "The Native Host disconnected.";
    nativeState = {
      ...nativeState,
      connected: false,
      lastError,
      lastSeenAt: Settings.nowIso()
    };
    for (const run of shellRuns.values()) {
      if (["starting", "running", "terminal", "stopping"].includes(run.status)) {
        run.status = "error";
        run.error = lastError;
        run.endedAt = Settings.nowIso();
        appendShellOutput(run, "stderr", `[native disconnected] ${lastError}\n`);
      }
    }
    runToTab.clear();
    for (const [requestId, pending] of pendingNativeRequests.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(lastError));
      pendingNativeRequests.delete(requestId);
    }
    void broadcast("native-disconnected");
  }

  function ensureNativePort() {
    if (nativePort) {
      return nativePort;
    }
    try {
      const port = browser.runtime.connectNative(NATIVE_HOST_NAME);
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
      port.onDisconnect.addListener(() => handleNativeDisconnect(port));
      port.postMessage({ action: "ping" });
      return port;
    } catch (error) {
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
    return entries.filter((entry) => entry && typeof entry === "object").slice(0, safeLimit).map((entry) => ({
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
      logBytes: Math.max(0, Number(entry.logBytes) || 0)
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
      logBytes: Math.max(Number(run.logBytes) || 0, Number(entry.logBytes) || 0)
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
    port.postMessage({ action: "ping" });
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
      startedAt: Settings.nowIso()
    };
    shellRuns.set(tabId, run);
    runToTab.set(runId, tabId);
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
        logBytes: 0
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
    const port = ensureNativePort();
    port.postMessage({ action: "run", runId, tabId, cwd, command, mode });
    await broadcast("native-shell-starting", tabId);
    return publicShellRun(tabId);
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
    return startShellRunForSession(session, localConfig, {
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
    port.postMessage({ action: "stop", runId: run.runId, tabId });
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
    const logId = String(message.logId || "");
    if (!session || !ownedShellLog(session, run, logId)) {
      throw new Error("The requested shell log does not belong to this tab session.");
    }
    return nativeRequest("read_log", {
      logId,
      offset: Math.max(0, Number(message.offset) || 0),
      maxBytes: Math.min(SHELL_LOG_READ_MAX_BYTES, Math.max(1, Number(message.maxBytes) || SHELL_LOG_READ_MAX_BYTES)),
      fromEnd: Boolean(message.fromEnd)
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
    await persistSession(session);
    await broadcast("shell-log-deleted", tabId);
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

  async function createSettingsSnapshot(reason = "manual", label = "Manual snapshot", rawStore = null) {
    const store = rawStore ? Settings.normalizeStore(rawStore) : await loadStore();
    const collection = await loadSnapshotCollection();
    const result = Snapshots.addSnapshot(collection, Snapshots.makeSnapshot(store, reason, label));
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

  function sessionLocalActionConfig(session, localStore) {
    if (session.localActionConfigMode === CONFIG_MODE.TAB && session.localActionTabConfig) {
      return LocalActions.normalizeConfig(session.localActionTabConfig);
    }
    const profile = LocalActions.profileById(localStore, session.localActionProfileId) ||
      LocalActions.profileById(localStore, localStore.defaultProfileId) || localStore.profiles[0];
    return LocalActions.normalizeConfig(profile.config);
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
    if (localStore) {
      publicValue.localActionProfileName = localActionProfileName(session, localStore);
      publicValue.effectiveLocalActions = sessionLocalActionConfig(session, localStore);
    }
    return publicValue;
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
      runtime: newRuntime(),
      logs: { user: [], debug: [] },
      downloadJob: emptyDownloadState(tab.id),
      shellHistory: [],
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
      await applyBadge(session.tabId, "!", "#cf222e");
      return;
    }
    if (session.mode === MODE.ACTIVE) {
      await applyBadge(session.tabId, "ON", "#238636");
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
    session.title = tab.title || session.title;
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
      sessionToken: stored.sessionToken || Settings.makeId("session"),
      runtime: { ...newRuntime(), ...(stored.runtime || {}) },
      logs: normalizeLogs(stored.logs),
      downloadJob: normalizeDownloadState(stored.downloadJob, tab.id),
      shellHistory: normalizeShellHistory(stored.shellHistory, 100)
    };
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
    sessions.set(tab.id, recovered);
    try {
      await recoverDownloadJob(recovered);
      await reattachSession(recovered, store, "background-startup");
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
        "shared/protocol.js",
        "shared/settings.js",
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

  async function activateTab(tab, source, requestedProfileId = null) {
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

    const routing = requestedProfileId ? null : Settings.routeProfile(store, tab.url);
    const profile = Settings.profileById(store, requestedProfileId) ||
      routing?.profile ||
      Settings.profileById(store, store.defaultProfileId) || store.profiles[0];
    if (!Settings.urlAllowed(profile.config, tab.url)) {
      throw new Error("The current URL does not match the selected profile allowlist.");
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

    const localRouting = LocalActions.routeProfile(localStore, tab.url);
    const session = makeSession(tab, profile.id, source, localRouting.profileId || localStore.defaultProfileId);
    try {
      await applySessionToContent(session, store, MESSAGE.CONTENT_ACTIVATE);
      appendLog(session, "user", "activated", `Tab activated by ${source}.`, {
        url: tab.url,
        profileId: profile.id,
        profileRouting: requestedProfileId ? "manual" : (routing?.matched ? "url-match" : "default-fallback"),
        matchedPattern: routing?.candidates?.[0]?.bestPattern || null,
        localActionProfileId: session.localActionProfileId,
        localActionRouting: localRouting.matched ? "url-match" : "default-fallback",
        localActionMatchedPattern: localRouting.candidates?.[0]?.bestPattern || null
      });
      sessions.set(tab.id, session);
      await persistSession(session);
      await updateBadge(session, store);
      await broadcast("activated", tab.id);
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

  async function stopTab(tabId, fallbackTab = null) {
    const session = sessions.get(tabId);
    try {
      await browser.tabs.sendMessage(tabId, { type: MESSAGE.CONTENT_STOP });
    } catch (_error) {
      // Navigation or shutdown may remove the content context first.
    }
    pickerStates.delete(tabId);
    sessions.delete(tabId);
    await removePersistedSession(tabId);
    await clearNotification(tabId);
    await applyBadge(tabId, "", null);
    await broadcast("stopped", tabId);
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
    const localStore = await loadLocalActionStore();
    const session = sessions.get(tabId);
    const profile = LocalActions.profileById(localStore, profileId);
    if (!session) throw new Error("This tab is not activated.");
    if (!profile) throw new Error("Local-action profile not found.");
    session.localActionProfileId = profile.id;
    session.localActionConfigMode = CONFIG_MODE.PROFILE;
    session.localActionTabConfig = null;
    session.localActionRevision = Number(session.localActionRevision || 0) + 1;
    appendLog(session, "user", "local-action-profile-assigned", `Local-action profile “${profile.name}” applied to this tab.`);
    await persistSession(session);
    await broadcast("local-action-profile-assigned", tabId);
  }

  async function saveTabLocalActions(tabId, rawConfig) {
    const session = sessions.get(tabId);
    if (!session) throw new Error("This tab is not activated.");
    const validation = LocalActions.validateConfig(rawConfig);
    if (!validation.ok) throw new Error(validation.errors.join("\n"));
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
    session.localActionConfigMode = CONFIG_MODE.PROFILE;
    session.localActionTabConfig = null;
    session.localActionRevision = Number(session.localActionRevision || 0) + 1;
    appendLog(session, "user", "tab-local-actions-reset", "This tab now uses its local-action profile.");
    await persistSession(session);
    await broadcast("tab-local-actions-reset", tabId);
  }

  async function createLocalActionProfile(name, baseProfileId = null) {
    const store = await loadLocalActionStore();
    const base = LocalActions.profileById(store, baseProfileId) || LocalActions.profileById(store, store.defaultProfileId);
    const profile = LocalActions.createProfile(name || "New local actions", base?.config || LocalActions.defaultConfig());
    store.profiles.push(profile);
    await saveLocalActionStore(store);
    await broadcast("local-action-profile-created");
    return profile.id;
  }

  async function saveLocalActionProfile(rawProfile) {
    const store = await loadLocalActionStore();
    const profile = LocalActions.normalizeProfile(rawProfile);
    const validation = LocalActions.validateConfig(profile.config);
    if (!validation.ok) throw new Error(validation.errors.join("\n"));
    const index = store.profiles.findIndex((item) => item.id === profile.id);
    if (index < 0) throw new Error("Local-action profile not found.");
    profile.config = validation.config;
    profile.createdAt = store.profiles[index].createdAt;
    profile.updatedAt = LocalActions.nowIso();
    store.profiles[index] = profile;
    const saved = await saveLocalActionStore(store);
    await broadcast("local-action-profile-saved");
    return saved;
  }

  async function deleteLocalActionProfile(profileId) {
    const store = await loadLocalActionStore();
    if (store.profiles.length <= 1) throw new Error("At least one local-action profile must remain.");
    if (!LocalActions.profileById(store, profileId)) throw new Error("Local-action profile not found.");
    store.profiles = store.profiles.filter((item) => item.id !== profileId);
    if (store.defaultProfileId === profileId) store.defaultProfileId = store.profiles[0].id;
    const saved = await saveLocalActionStore(store);
    for (const session of sessions.values()) {
      if (session.localActionProfileId !== profileId) continue;
      const routed = LocalActions.routeProfile(saved, session.url || "");
      session.localActionProfileId = routed.profileId || saved.defaultProfileId;
      session.localActionConfigMode = CONFIG_MODE.PROFILE;
      session.localActionTabConfig = null;
      session.localActionRevision = Number(session.localActionRevision || 0) + 1;
      await persistSession(session);
    }
    await broadcast("local-action-profile-deleted");
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

  async function createProfile(name, baseProfileId = null) {
    const store = await loadStore();
    const base = Settings.profileById(store, baseProfileId);
    const profile = Settings.createProfile(name, base?.config || Settings.defaultConfig());
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
    return saved;
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
    for (const session of sessions.values()) {
      if (session.profileId === profileId) {
        session.profileId = saved.defaultProfileId;
        session.configMode = CONFIG_MODE.PROFILE;
        session.tabConfig = null;
        session.configRevision += 1;
        await applySessionToContent(session, saved);
        await persistSession(session);
        await updateBadge(session, saved);
      }
    }
    await broadcast("profile-deleted");
    return saved;
  }

  async function refreshSessionsForStore(saved) {
    for (const session of sessions.values()) {
      if (!Settings.profileById(saved, session.profileId)) {
        session.profileId = saved.defaultProfileId;
        session.configMode = CONFIG_MODE.PROFILE;
        session.tabConfig = null;
      }
      session.configRevision += 1;
      await applySessionToContent(session, saved);
      await persistSession(session);
      await updateBadge(session, saved);
    }
  }

  async function importSettings(text) {
    const current = await loadStore();
    await createSettingsSnapshot("before_settings_import", "Before settings import", current);
    const imported = Settings.importStore(text);
    const saved = await saveStore(imported);
    for (const importedProfile of imported.profiles) {
      const persistedProfile = Settings.profileById(saved, importedProfile.id);
      if (!persistedProfile) {
        throw new Error(`Import settings: profile ${importedProfile.id} was not found after saving.`);
      }
      assertPersistedConfig(importedProfile.config, persistedProfile.config, `Import profile ${importedProfile.name}`);
    }
    await refreshSessionsForStore(saved);
    await broadcast("settings-imported");
    return saved;
  }

  async function restoreSettingsSnapshot(snapshotId) {
    const collection = await loadSnapshotCollection();
    const snapshot = Snapshots.findSnapshot(collection, snapshotId);
    if (!snapshot) {
      throw new Error("Settings snapshot not found.");
    }
    const current = await loadStore();
    await createSettingsSnapshot("before_snapshot_restore", "Before snapshot restore", current);
    const saved = await saveStore(snapshot.store);
    await refreshSessionsForStore(saved);
    await broadcast("settings-snapshot-restored");
    return saved;
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
    return tabs
      .filter((tab) => Number.isInteger(tab.id) && WorkingSession.isSupportedUrl(tab.url))
      .map((tab) => {
        const session = sessions.get(tab.id);
        return {
          tabId: tab.id,
          windowId: tab.windowId,
          title: WorkingSession.cleanTitle(session?.runtime?.originalTitle || tab.title || ""),
          url: tab.url,
          addOnActive: Boolean(session),
          mode: session?.mode || MODE.INACTIVE,
          profileId: session?.profileId || null,
          profileName: session ? profileName(session, store) : null,
          localActionProfileId: session?.localActionProfileId || null,
          localActionProfileName: session ? localActionProfileName(session, localStore) : null
        };
      })
      .sort((left, right) => left.windowId - right.windowId || left.tabId - right.tabId);
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
      const localProfile = session
        ? (LocalActions.profileById(localStore, session.localActionProfileId) || routedLocalProfile)
        : routedLocalProfile;
      const effectiveLocalActions = session ? sessionLocalActionConfig(session, localStore) : LocalActions.normalizeConfig(localProfile.config);
      records.push({
        sourceTabId: tab.id,
        url: tab.url,
        title: WorkingSession.cleanTitle(session?.runtime?.originalTitle || tab.title || ""),
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

  function mergeWorkingSessionProfiles(store, bundle) {
    const saved = Settings.normalizeStore(store);
    const profileMap = new Map();
    for (const tab of bundle.tabs) {
      const incoming = Settings.normalizeProfile(tab.profile, tab.profileId || null);
      const existingById = Settings.profileById(saved, incoming.id);
      if (existingById && WorkingSession.configFingerprint(existingById.config) === WorkingSession.configFingerprint(incoming.config)) {
        profileMap.set(tab.profileId, existingById.id);
        continue;
      }
      const equivalent = saved.profiles.find((profile) =>
        profile.name === incoming.name &&
        WorkingSession.configFingerprint(profile.config) === WorkingSession.configFingerprint(incoming.config)
      );
      if (equivalent) {
        profileMap.set(tab.profileId, equivalent.id);
        continue;
      }
      const id = existingById ? Settings.makeId("profile") : incoming.id;
      const imported = Settings.createProfile(existingById ? `${incoming.name} (session import)` : incoming.name, incoming.config, id);
      saved.profiles.push(imported);
      profileMap.set(tab.profileId, imported.id);
    }
    return { store: saved, profileMap };
  }

  function mergeWorkingSessionLocalActionProfiles(store, bundle) {
    const saved = LocalActions.normalizeStore(store);
    const profileMap = new Map();
    for (const tab of bundle.tabs) {
      const incoming = LocalActions.normalizeProfile(tab.localActionProfile, tab.localActionProfileId || null);
      const existingById = LocalActions.profileById(saved, incoming.id);
      if (existingById && WorkingSession.localActionConfigFingerprint(existingById.config) === WorkingSession.localActionConfigFingerprint(incoming.config)) {
        profileMap.set(tab.localActionProfileId, existingById.id);
        continue;
      }
      const equivalent = saved.profiles.find((profile) =>
        profile.name === incoming.name &&
        WorkingSession.localActionConfigFingerprint(profile.config) === WorkingSession.localActionConfigFingerprint(incoming.config)
      );
      if (equivalent) {
        profileMap.set(tab.localActionProfileId, equivalent.id);
        continue;
      }
      const id = existingById ? LocalActions.makeId("local-profile") : incoming.id;
      const imported = LocalActions.createProfile(existingById ? `${incoming.name} (session import)` : incoming.name, incoming.config, id);
      saved.profiles.push(imported);
      profileMap.set(tab.localActionProfileId, imported.id);
    }
    return { store: saved, profileMap };
  }

  async function importWorkingSession(text) {
    const bundle = WorkingSession.parse(text);
    const [currentStore, currentLocalStore] = await Promise.all([loadStore(), loadLocalActionStore()]);
    await createSettingsSnapshot("before_working_session_import", "Before working session import", currentStore);
    const merged = mergeWorkingSessionProfiles(currentStore, bundle);
    const mergedLocal = mergeWorkingSessionLocalActionProfiles(currentLocalStore, bundle);
    const [store, localStore] = await Promise.all([saveStore(merged.store), saveLocalActionStore(mergedLocal.store)]);
    const report = { restored: 0, openedTabIds: [], failed: [] };

    for (const [index, savedTab] of bundle.tabs.entries()) {
      let tab = null;
      try {
        tab = await browser.tabs.create({ url: savedTab.url, active: false });
        report.openedTabIds.push(tab.id);
        if (!savedTab.addOnActive) {
          continue;
        }
        const profileId = merged.profileMap.get(savedTab.profileId) || store.defaultProfileId;
        const localActionProfileId = mergedLocal.profileMap.get(savedTab.localActionProfileId) || localStore.defaultProfileId;
        const session = makeSession(tab, profileId, "working-session-import", localActionProfileId);
        session.configMode = savedTab.configMode === CONFIG_MODE.TAB ? CONFIG_MODE.TAB : CONFIG_MODE.PROFILE;
        session.tabConfig = session.configMode === CONFIG_MODE.TAB
          ? Settings.normalizeConfig(savedTab.tabConfig || savedTab.effectiveConfig)
          : null;
        session.configRevision += 1;
        session.localActionConfigMode = savedTab.localActionConfigMode === CONFIG_MODE.TAB ? CONFIG_MODE.TAB : CONFIG_MODE.PROFILE;
        session.localActionTabConfig = session.localActionConfigMode === CONFIG_MODE.TAB
          ? LocalActions.normalizeConfig(savedTab.localActionTabConfig || savedTab.effectiveLocalActions)
          : null;
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

  async function dashboard() {
    await recoverAll();
    const [store, localActionStore] = await Promise.all([loadStore(), loadLocalActionStore()]);
    const snapshotCollection = await loadSnapshotCollection();
    const tab = await currentTab();
    const publicSessions = [...sessions.values()]
      .map((session) => publicSession(session, store, localActionStore))
      .sort((left, right) => left.tabId - right.tabId);
    const routingPreview = Settings.routeProfile(store, tab?.url || "");
    const localActionRoutingPreview = LocalActions.routeProfile(localActionStore, tab?.url || "");
    return {
      protocolVersion: globalThis.FCI_PROTOCOL.VERSION,
      currentTab: tabMeta(tab),
      sessions: publicSessions,
      store,
      localActionStore,
      localActionRoutingPreview: {
        matched: localActionRoutingPreview.matched,
        profileId: localActionRoutingPreview.profileId,
        profileName: localActionRoutingPreview.profileName,
        candidates: localActionRoutingPreview.candidates
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
      settingsSnapshots: snapshotCollection.snapshots.map(Snapshots.summary),
      pickers: [...pickerStates.values()].map((state) => clone(state))
    };
  }

  function errorResponse(error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }

  async function handleRequest(message, sender = null) {
    try {
      switch (message.type) {
        case MESSAGE.GET_DASHBOARD:
          return { ok: true, dashboard: await dashboard() };

        case MESSAGE.ACTIVATE_CURRENT: {
          const requestedTabId = Number(message.tabId);
          const tab = Number.isInteger(requestedTabId)
            ? await browser.tabs.get(requestedTabId)
            : await currentTab();
          await activateTab(tab, "sidebar", message.profileId || null);
          return { ok: true, dashboard: await dashboard() };
        }

        case MESSAGE.PAUSE_TAB:
          await pauseTab(Number(message.tabId));
          return { ok: true, dashboard: await dashboard() };

        case MESSAGE.RESUME_TAB:
          await resumeTab(Number(message.tabId));
          return { ok: true, dashboard: await dashboard() };

        case MESSAGE.STOP_TAB:
          await stopTab(Number(message.tabId));
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
          const result = await createProfile(message.name, message.baseProfileId);
          return { ok: true, profileId: result.profileId, dashboard: await dashboard() };
        }

        case MESSAGE.DUPLICATE_PROFILE: {
          const store = await loadStore();
          const base = Settings.profileById(store, message.profileId);
          if (!base) {
            throw new Error("Could not find the profile to duplicate.");
          }
          const result = await createProfile(message.name || `${base.name} - copy`, base.id);
          return { ok: true, profileId: result.profileId, dashboard: await dashboard() };
        }

        case MESSAGE.SAVE_PROFILE: {
          const saved = await saveProfile(message.profile);
          return { ok: true, savedProfile: Settings.profileById(saved, message.profile.id), dashboard: await dashboard() };
        }

        case MESSAGE.DELETE_PROFILE:
          await deleteProfile(message.profileId);
          return { ok: true, dashboard: await dashboard() };

        case MESSAGE.EXPORT_SETTINGS: {
          const store = await loadStore();
          return { ok: true, text: Settings.exportStore(store) };
        }

        case MESSAGE.EXPORT_SUPPORT_BUNDLE:
          return { ok: true, bundle: await buildSupportBundle() };

        case MESSAGE.IMPORT_SETTINGS:
          await importSettings(message.text);
          return { ok: true, dashboard: await dashboard() };

        case MESSAGE.CREATE_SETTINGS_SNAPSHOT: {
          const result = await createSettingsSnapshot("manual", message.label || "Manual snapshot");
          return { ok: true, snapshot: result.snapshot, added: result.added, dashboard: await dashboard() };
        }

        case MESSAGE.RESTORE_SETTINGS_SNAPSHOT:
          await restoreSettingsSnapshot(message.snapshotId);
          return { ok: true, dashboard: await dashboard() };

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

        case MESSAGE.CREATE_LOCAL_ACTION_PROFILE: {
          const profileId = await createLocalActionProfile(message.name, message.baseProfileId);
          return { ok: true, localActionProfileId: profileId, dashboard: await dashboard() };
        }

        case MESSAGE.SAVE_LOCAL_ACTION_PROFILE: {
          const saved = await saveLocalActionProfile(message.profile);
          return { ok: true, savedProfile: LocalActions.profileById(saved, message.profile?.id), dashboard: await dashboard() };
        }

        case MESSAGE.DELETE_LOCAL_ACTION_PROFILE:
          await deleteLocalActionProfile(message.profileId);
          return { ok: true, dashboard: await dashboard() };

        case MESSAGE.ASSIGN_LOCAL_ACTION_PROFILE:
          await assignLocalActionProfile(Number(message.tabId), message.profileId);
          return { ok: true, dashboard: await dashboard() };

        case MESSAGE.SAVE_TAB_LOCAL_ACTIONS:
          await saveTabLocalActions(Number(message.tabId), message.config);
          return { ok: true, dashboard: await dashboard() };

        case MESSAGE.RESET_TAB_LOCAL_ACTIONS:
          await resetTabLocalActions(Number(message.tabId));
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

        case MESSAGE.GET_NATIVE_STATUS:
          return { ok: true, nativeHost: await checkNativeStatus(sender), dashboard: await dashboard() };

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

        case MESSAGE.ARM_DOWNLOAD_CAPTURE:
          return { ok: true, capture: await armDownloadCaptureFromContent(message, sender), dashboard: await dashboard() };

        case MESSAGE.GET_DOWNLOAD_STATE:
          return { ok: true, download: publicDownloadState(Number(message.tabId)), dashboard: await dashboard() };

        case MESSAGE.RETRY_DOWNLOAD_MOVE:
          return { ok: true, download: await retryDownloadMove(message, sender), dashboard: await dashboard() };

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
    MESSAGE.ACTIVATE_CURRENT,
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
    MESSAGE.EXPORT_SETTINGS,
    MESSAGE.EXPORT_SUPPORT_BUNDLE,
    MESSAGE.IMPORT_SETTINGS,
    MESSAGE.CREATE_SETTINGS_SNAPSHOT,
    MESSAGE.RESTORE_SETTINGS_SNAPSHOT,
    MESSAGE.DELETE_SETTINGS_SNAPSHOT,
    MESSAGE.LIST_WORKING_SESSION_TABS,
    MESSAGE.EXPORT_WORKING_SESSION,
    MESSAGE.IMPORT_WORKING_SESSION,
    MESSAGE.TEST_SELECTOR,
    MESSAGE.START_ELEMENT_PICKER,
    MESSAGE.CANCEL_ELEMENT_PICKER,
    MESSAGE.TEST_TARGET_ACTION,
    MESSAGE.CLEAR_HIGHLIGHTS,
    MESSAGE.CLEAR_SESSION_LOGS,
    MESSAGE.GET_NATIVE_STATUS,
    MESSAGE.RUN_SHELL,
    MESSAGE.STOP_SHELL,
    MESSAGE.CLEAR_SHELL_OUTPUT,
    MESSAGE.CLEAR_SHELL_HISTORY,
    MESSAGE.CREATE_LOCAL_ACTION_PROFILE,
    MESSAGE.SAVE_LOCAL_ACTION_PROFILE,
    MESSAGE.DELETE_LOCAL_ACTION_PROFILE,
    MESSAGE.ASSIGN_LOCAL_ACTION_PROFILE,
    MESSAGE.SAVE_TAB_LOCAL_ACTIONS,
    MESSAGE.RESET_TAB_LOCAL_ACTIONS,
    MESSAGE.ARM_DOWNLOAD_CAPTURE,
    MESSAGE.GET_DOWNLOAD_STATE,
    MESSAGE.RETRY_DOWNLOAD_MOVE,
    MESSAGE.CONTENT_RUNTIME_EVENT,
    MESSAGE.CONTENT_PICKER_RESULT
  ]);


  const SIDEBAR_REQUEST_TYPES = new Set([
    MESSAGE.GET_DASHBOARD,
    MESSAGE.ACTIVATE_CURRENT,
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
    MESSAGE.EXPORT_SETTINGS,
    MESSAGE.EXPORT_SUPPORT_BUNDLE,
    MESSAGE.IMPORT_SETTINGS,
    MESSAGE.CREATE_SETTINGS_SNAPSHOT,
    MESSAGE.RESTORE_SETTINGS_SNAPSHOT,
    MESSAGE.DELETE_SETTINGS_SNAPSHOT,
    MESSAGE.LIST_WORKING_SESSION_TABS,
    MESSAGE.EXPORT_WORKING_SESSION,
    MESSAGE.IMPORT_WORKING_SESSION,
    MESSAGE.TEST_SELECTOR,
    MESSAGE.START_ELEMENT_PICKER,
    MESSAGE.CANCEL_ELEMENT_PICKER,
    MESSAGE.TEST_TARGET_ACTION,
    MESSAGE.CLEAR_HIGHLIGHTS,
    MESSAGE.CLEAR_SESSION_LOGS,
    MESSAGE.GET_NATIVE_STATUS,
    MESSAGE.RUN_SHELL,
    MESSAGE.STOP_SHELL,
    MESSAGE.CLEAR_SHELL_OUTPUT,
    MESSAGE.CLEAR_SHELL_HISTORY,
    MESSAGE.CREATE_LOCAL_ACTION_PROFILE,
    MESSAGE.SAVE_LOCAL_ACTION_PROFILE,
    MESSAGE.DELETE_LOCAL_ACTION_PROFILE,
    MESSAGE.ASSIGN_LOCAL_ACTION_PROFILE,
    MESSAGE.SAVE_TAB_LOCAL_ACTIONS,
    MESSAGE.RESET_TAB_LOCAL_ACTIONS,
    MESSAGE.GET_DOWNLOAD_STATE,
    MESSAGE.RETRY_DOWNLOAD_MOVE
  ]);

  function validateRequestSender(message, sender) {
    if ([MESSAGE.CONTENT_RUNTIME_EVENT, MESSAGE.CONTENT_PICKER_RESULT, MESSAGE.ARM_DOWNLOAD_CAPTURE].includes(message.type)) {
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
      return;
    }

    const urlChanged = typeof changeInfo.url === "string" && changeInfo.url !== session.url;
    if (changeInfo.status === "loading" || urlChanged) {
      session.url = tab.url || changeInfo.url || session.url;
      session.title = tab.title || session.title;
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

    if (typeof changeInfo.title === "string" && !session.runtime?.alertActive) {
      session.title = changeInfo.title;
      session.updatedAt = Settings.nowIso();
      void persistSession(session);
      void broadcast("tab-title-updated", tabId);
    }
  });

  browser.tabs.onActivated.addListener((activeInfo) => {
    void broadcast("active-tab-changed", activeInfo.tabId);
  });

  browser.tabs.onRemoved.addListener((tabId) => {
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
    downloadCaptures.delete(tabId);
    downloadJobs.delete(tabId);
    for (const [key, value] of downloadMoveToTab.entries()) {
      if (Number(value) === Number(tabId)) downloadMoveToTab.delete(key);
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

  void recoverAll().catch((error) => {
    console.error("FirefoxChatImprover: startup session recovery failed", error);
  });

})();
