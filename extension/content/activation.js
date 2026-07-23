(() => {
  "use strict";

  const INSTANCE_KEY = "__firefoxChatImproverRuntimeV6";
  const RUNTIME_VERSION = 15;
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
