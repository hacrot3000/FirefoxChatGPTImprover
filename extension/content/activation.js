(() => {
  "use strict";

  const INSTANCE_KEY = "__firefoxChatImproverRuntimeV6";
  const RUNTIME_VERSION = 20;
  const previousRuntime = globalThis[INSTANCE_KEY];
  if (previousRuntime?.VERSION >= RUNTIME_VERSION) {
    return;
  }
  if (typeof previousRuntime?.shutdown === "function") {
    previousRuntime.shutdown("runtime-upgrade");
  }

  const { MESSAGE, MODE, MONITOR_STATE } = globalThis.FCI_PROTOCOL;
  const MonitorEngine = globalThis.FCI_MONITOR_ENGINE;
  const TargetEngine = globalThis.FCI_TARGET_ENGINE;
  const RuleEngine = globalThis.FCI_RULE_ENGINE;
  const AlertEngine = globalThis.FCI_ALERT_ENGINE;
  let state = {
    mode: MODE.INACTIVE,
    activatedAt: null,
    updatedAt: new Date().toISOString(),
    source: null,
    tabId: null,
    sessionToken: null,
    url: location.href,
    profileId: null,
    profileName: null,
    configMode: null,
    configRevision: 0,
    config: null,
    runtime: {
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
      monitorTitleSpinning: false,
      originalTitle: document.title || "",
      displayedTitle: document.title || "",
      alertStartedAt: null,
      alertAcknowledgedAt: null,
      alertDismissReason: null,
      lastUserActivityAt: null,
      activeVisibleSince: null,
      lastAlertReason: null,
      lastEventAt: null
    }
  };

  function applyDocumentMarker() {
    const root = document.documentElement;
    if (!root) {
      return;
    }
    if (state.mode === MODE.ACTIVE || state.mode === MODE.PAUSED) {
      root.dataset.firefoxChatImprover = state.mode;
      root.dataset.firefoxChatImproverProfile = state.profileId || "";
      root.dataset.firefoxChatImproverMonitor = state.runtime.monitorState || "";
      root.dataset.firefoxChatImproverAlert = state.runtime.alertActive ? "active" : "inactive";
    } else {
      delete root.dataset.firefoxChatImprover;
      delete root.dataset.firefoxChatImproverProfile;
      delete root.dataset.firefoxChatImproverMonitor;
      delete root.dataset.firefoxChatImproverAlert;
    }
  }

  function snapshot() {
    return {
      protocolVersion: globalThis.FCI_PROTOCOL.VERSION,
      mode: state.mode,
      activatedAt: state.activatedAt,
      updatedAt: state.updatedAt,
      source: state.source,
      tabId: state.tabId,
      sessionToken: state.sessionToken,
      url: location.href,
      profileId: state.profileId,
      profileName: state.profileName,
      configMode: state.configMode,
      configRevision: state.configRevision,
      runtime: { ...state.runtime }
    };
  }

  function publishRuntimeEvent(runtime) {
    const commandRequest = runtime?.commandRequest || null;
    const persistentRuntime = { ...(runtime || {}) };
    delete persistentRuntime.commandRequest;
    state.runtime = { ...state.runtime, ...persistentRuntime };
    state.updatedAt = persistentRuntime.lastEventAt || new Date().toISOString();
    applyDocumentMarker();
    void browser.runtime.sendMessage({
      type: MESSAGE.CONTENT_RUNTIME_EVENT,
      payload: {
        tabId: state.tabId,
        sessionToken: state.sessionToken,
        runtime: {
          ...state.runtime,
          ...(commandRequest ? { commandRequest } : {})
        }
      }
    }).catch(() => {
      // Extension reload or tab shutdown can invalidate the runtime context.
    });
  }

  const alertController = AlertEngine.createAlertController({
    onRuntime(runtime) {
      publishRuntimeEvent(runtime);
    }
  });

  function sendRuntimeEvent(runtime) {
    state.runtime = { ...state.runtime, ...runtime };
    const alertRuntime = alertController.apply(
      state.config,
      state.runtime,
      state.mode,
      runtime.lastTransition || runtime.lastTargetAction || runtime.lastReason || "runtime"
    );
    publishRuntimeEvent({ ...state.runtime, ...alertRuntime, lastEventAt: runtime.lastEventAt });
  }

  async function armDownloadCapture(detail = {}) {
    if (!Number.isInteger(state.tabId) || !state.sessionToken) return { armed: false, reason: "no-session" };
    const response = await browser.runtime.sendMessage({
      type: MESSAGE.ARM_DOWNLOAD_CAPTURE,
      payload: {
        tabId: state.tabId,
        sessionToken: state.sessionToken,
        ruleId: detail.ruleId || null,
        ruleName: detail.ruleName || null,
        cycle: Number(detail.cycle || state.runtime.cycle || 0),
        targetCount: Number(detail.targetCount || 0)
      }
    });
    if (!response?.ok) throw new Error(response?.error || "Could not arm managed download capture.");
    return response.capture || { armed: false };
  }


  const DOWNLOAD_COMPLETION_HOST_ID = "__firefoxChatImproverDownloadCompletion"; /* Phase 28 v0.28.8: popup shell readiness follows run state, not editor mode. */
  let downloadCompletionHost = null;

  function removeDownloadCompletionOverlay() {
    if (downloadCompletionHost?.isConnected) {
      downloadCompletionHost.remove();
    }
    downloadCompletionHost = null;
  }

  function showDownloadCompletionOverlay(payload = {}) {
    removeDownloadCompletionOverlay();
    const destinationPath = String(payload.destinationPath || "").trim();
    if (!destinationPath) {
      return { ok: false, shown: false, error: "The completed download did not include a destination path." };
    }

    const host = document.createElement("div");
    host.id = DOWNLOAD_COMPLETION_HOST_ID;
    host.setAttribute("data-firefox-chat-improver-overlay", "download-completion");
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      .backdrop { position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center; padding: 20px; background: rgb(0 0 0 / .58); font-family: system-ui, sans-serif; }
      .panel { width: min(620px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto; box-sizing: border-box; padding: 22px; border: 2px solid #1f9d55; border-radius: 16px; background: #fff; color: #15202b; box-shadow: 0 24px 80px rgb(0 0 0 / .42); }
      .title { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
      .icon { display: grid; place-items: center; flex: 0 0 42px; width: 42px; height: 42px; border-radius: 999px; background: #1f9d55; color: #fff; font-size: 26px; font-weight: 800; }
      h2 { margin: 0; font-size: 22px; line-height: 1.2; }
      p { margin: 6px 0 14px; font-size: 14px; line-height: 1.5; }
      .note { color: #52606d; font-size: 12px; }
      label { display: grid; gap: 6px; margin-top: 12px; font-size: 12px; font-weight: 700; }
      textarea { width: 100%; min-height: 68px; box-sizing: border-box; resize: vertical; padding: 10px; border: 1px solid #9aa5b1; border-radius: 8px; background: #f7f9fb; color: #15202b; font: 12px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace; }
      .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 16px; }
      button { min-height: 36px; padding: 7px 14px; border: 1px solid #7b8794; border-radius: 8px; background: #fff; color: #15202b; font: 600 13px system-ui, sans-serif; cursor: pointer; }
      button:hover { background: #f0f4f8; }
      button.primary { border-color: #147d45; background: #1f9d55; color: #fff; }
      button.primary:hover { background: #147d45; }
      button:disabled { opacity: .5; cursor: default; }
      .status { min-height: 20px; margin-top: 10px; color: #334e68; font-size: 12px; white-space: pre-wrap; }
      @media (prefers-color-scheme: dark) {
        .panel { background: #1d232a; color: #f5f7fa; }
        textarea { border-color: #66788a; background: #11161b; color: #f5f7fa; }
        button { border-color: #7b8794; background: #2c343d; color: #f5f7fa; }
        button:hover { background: #3b4652; }
        .note, .status { color: #c4ced8; }
      }
    `;

    const backdrop = document.createElement("div");
    backdrop.className = "backdrop";
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");
    backdrop.setAttribute("aria-labelledby", "fci-download-completion-title");
    const panel = document.createElement("section");
    panel.className = "panel";

    const title = document.createElement("div");
    title.className = "title";
    const icon = document.createElement("span");
    icon.className = "icon";
    icon.textContent = "✓";
    const heading = document.createElement("h2");
    heading.id = "fci-download-completion-title";
    heading.textContent = "Download completed";
    title.append(icon, heading);

    const message = document.createElement("p");
    message.textContent = payload.retry
      ? "The existing staging file was relocated successfully. Retry relocation does not download the file from the website again."
      : "The managed download was moved successfully.";
    const note = document.createElement("p");
    note.className = "note";
    note.textContent = "The destination below is the verified path returned by the Native Host.";

    const label = document.createElement("label");
    label.textContent = "Destination";
    const pathBox = document.createElement("textarea");
    pathBox.readOnly = true;
    pathBox.spellcheck = false;
    pathBox.value = destinationPath;
    pathBox.setAttribute("aria-label", "Download destination path");
    label.append(pathBox);

    const status = document.createElement("div");
    status.className = "status";
    status.setAttribute("aria-live", "polite");

    const actions = document.createElement("div");
    actions.className = "actions";
    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.textContent = "Copy path";
    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(destinationPath);
        status.textContent = "Destination path copied.";
      } catch (_error) {
        pathBox.focus();
        pathBox.select();
        status.textContent = "Press Ctrl+C to copy the selected path.";
      }
    });

    const shellButton = document.createElement("button"); shellButton.type = "button"; const shellMode = ["disabled", "manual", "automatic"].includes(payload.shellExecutionMode) ? payload.shellExecutionMode : "manual"; const shellStatus = String(payload.shellStatus || "idle"); const shellRunId = String(payload.shellRunId || ""); const shellBusy = ["starting", "running", "stopping"].includes(shellStatus); const shellAlreadyStarted = Boolean(shellRunId); const declaredReady = typeof payload.shellReady === "boolean" ? payload.shellReady : Boolean(payload.shellAvailable); const shellReady = Boolean(declaredReady && !shellBusy && !shellAlreadyStarted); const manualFallback = Boolean(payload.manualFallback || (shellMode === "automatic" && shellReady)); shellButton.textContent = shellBusy || shellAlreadyStarted ? "Shell command already started" : "Execute shell command"; shellButton.disabled = !shellReady; shellButton.title = String(payload.shellReason || (!declaredReady ? "No shell command is ready for this download." : (shellBusy || shellAlreadyStarted ? "The frozen command has already been started for this download." : "Run the shell command captured with this download in background mode."))); if (shellBusy || shellAlreadyStarted) { status.textContent = "The shell command has already been started. The complete console remains available in the add-on."; } else if (manualFallback) { status.textContent = "Automatic start did not create a run. A manual fallback is available."; } shellButton.addEventListener("click", async () => {
      if (payload.confirmBeforeRun && !window.confirm("Execute the configured shell command for this completed download?")) {
        return;
      }
      shellButton.disabled = true;
      status.textContent = "Starting shell command…";
      try {
        const response = await browser.runtime.sendMessage({
          type: MESSAGE.RUN_COMPLETED_DOWNLOAD_SHELL,
          payload: {
            captureId: String(payload.captureId || ""),
            confirmed: true
          }
        });
        if (!response?.ok) throw new Error(response?.error || "Could not start the shell command.");
        status.textContent = "Shell command started in background mode. The complete console will open in the add-on when it finishes and remains available afterward.";
      } catch (error) {
        shellButton.disabled = false;
        status.textContent = error instanceof Error ? error.message : String(error);
      }
    });

    const okButton = document.createElement("button");
    okButton.type = "button";
    okButton.className = "primary";
    okButton.textContent = "OK";
    okButton.addEventListener("click", removeDownloadCompletionOverlay);
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) removeDownloadCompletionOverlay();
    });
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        removeDownloadCompletionOverlay();
        window.removeEventListener("keydown", onKeyDown, true);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);

    actions.append(copyButton, shellButton, okButton);
    panel.append(title, message, note, label, status, actions);
    backdrop.append(panel);
    shadow.append(style, backdrop);
    document.documentElement.append(host);
    downloadCompletionHost = host;
    okButton.focus();
    return { ok: true, shown: true };
  }

  const ruleAutomation = RuleEngine.createRuleAutomation({
    onRuntime: sendRuntimeEvent,
    onBeforeTargetClick: armDownloadCapture
  });

  function applySession(session, mode = null) {
    const now = new Date().toISOString();
    state = {
      ...state,
      mode: mode || session?.mode || state.mode,
      activatedAt: session?.activatedAt || state.activatedAt || now,
      updatedAt: now,
      source: session?.source || state.source,
      tabId: Number.isInteger(session?.tabId) ? session.tabId : state.tabId,
      sessionToken: session?.sessionToken || state.sessionToken,
      url: location.href,
      profileId: session?.profileId || state.profileId,
      profileName: session?.profileName || state.profileName,
      configMode: session?.configMode || state.configMode,
      configRevision: Number(session?.configRevision || state.configRevision || 0),
      config: session?.effectiveConfig || state.config,
      runtime: {
        ...state.runtime,
        ...(session?.runtime || {})
      }
    };

    if (state.mode === MODE.PAUSED) {
      ruleAutomation.start(state.config, "session-applied-paused-baseline", state.runtime.cycle);
      ruleAutomation.pause();
    } else if (state.mode === MODE.ACTIVE) {
      ruleAutomation.start(state.config, "session-applied", state.runtime.cycle);
    } else {
      ruleAutomation.stop();
    }
    state.runtime = {
      ...state.runtime,
      ...alertController.apply(state.config, state.runtime, state.mode, "session-applied")
    };
    applyDocumentMarker();
    return snapshot();
  }

  function setMode(mode) {
    state.mode = mode;
    state.updatedAt = new Date().toISOString();
    state.url = location.href;

    if (mode === MODE.PAUSED) {
      ruleAutomation.pause();
      state.runtime = { ...state.runtime, ...alertController.apply(state.config, state.runtime, mode, "pause") };
    } else if (mode === MODE.ACTIVE) {
      ruleAutomation.resume(state.config);
      state.runtime = { ...state.runtime, ...alertController.apply(state.config, state.runtime, mode, "resume") };
    } else {
      ruleAutomation.stop();
      MonitorEngine.clearSelectorHighlights();
      TargetEngine.clearActionHighlights();
      state.runtime.monitorState = MONITOR_STATE.IDLE;
      state.runtime = { ...state.runtime, ...alertController.stop("stop") };
    }

    applyDocumentMarker();
    return snapshot();
  }

  function clearHighlights() {
    MonitorEngine.clearSelectorHighlights();
    TargetEngine.clearActionHighlights();
    return { cleared: true, updatedAt: new Date().toISOString() };
  }

  function onRuntimeMessage(message) {
    if (!message || typeof message.type !== "string") {
      return undefined;
    }
    switch (message.type) {
      case MESSAGE.CONTENT_ACTIVATE:
        return Promise.resolve(applySession(message.payload?.session, MODE.ACTIVE));
      case MESSAGE.CONTENT_APPLY_SESSION:
        return Promise.resolve(applySession(message.payload?.session));
      case MESSAGE.CONTENT_PAUSE:
        return Promise.resolve(setMode(MODE.PAUSED));
      case MESSAGE.CONTENT_RESUME:
        return Promise.resolve(setMode(MODE.ACTIVE));
      case MESSAGE.CONTENT_STOP:
        return Promise.resolve(setMode(MODE.INACTIVE));
      case MESSAGE.CONTENT_STATUS:
        return Promise.resolve(snapshot());
      case MESSAGE.CONTENT_TEST_SELECTOR:
        try {
          return Promise.resolve({
            ok: true,
            result: MonitorEngine.highlightSelector(
              message.payload?.selector,
              {
                visibility: message.payload?.visibility || "any",
                durationMs: message.payload?.durationMs || 8000,
                monitorConfig: message.payload?.monitorConfig || null
              }
            )
          });
        } catch (error) {
          return Promise.resolve({
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      case MESSAGE.CONTENT_TEST_TARGET_ACTION:
        return (async () => {
          try {
            if (message.payload?.click) {
              await armDownloadCapture({ ruleId: state.config?.activeRuleId || null, cycle: state.runtime.cycle || 0, targetCount: 1 });
            }
            return {
              ok: true,
              result: TargetEngine.testTargetAction(
                message.payload?.config || state.config,
                {
                  click: Boolean(message.payload?.click),
                  durationMs: message.payload?.durationMs || 8000
                }
              )
            };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) };
          }
        })();
      case MESSAGE.CONTENT_CLEAR_HIGHLIGHTS:
        return Promise.resolve({ ok: true, result: clearHighlights() });
      case MESSAGE.CONTENT_SHOW_DOWNLOAD_COMPLETION:
        return Promise.resolve(showDownloadCompletionOverlay(message.payload || {}));
      default:
        return undefined;
    }
  }

  let shutdownDone = false;
  function shutdown(reason = "shutdown") {
    if (shutdownDone) {
      return;
    }
    shutdownDone = true;
    try {
      browser.runtime.onMessage.removeListener(onRuntimeMessage);
    } catch (_error) {
      // Extension reload can invalidate the runtime API before cleanup.
    }
    removeDownloadCompletionOverlay();
    ruleAutomation.stop();
    MonitorEngine.clearSelectorHighlights();
    TargetEngine.clearActionHighlights();
    alertController.stop(reason);
    state.mode = MODE.INACTIVE;
    state.runtime.monitorState = MONITOR_STATE.IDLE;
    applyDocumentMarker();
  }

  browser.runtime.onMessage.addListener(onRuntimeMessage);
  window.addEventListener("pagehide", () => shutdown("pagehide"), { once: true });

  Object.defineProperty(globalThis, INSTANCE_KEY, {
    configurable: true,
    enumerable: false,
    writable: false,
    value: Object.freeze({ VERSION: RUNTIME_VERSION, snapshot, clearHighlights, shutdown })
  });
  applyDocumentMarker();
})();
