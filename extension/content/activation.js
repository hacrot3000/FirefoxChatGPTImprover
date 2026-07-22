(() => {
  "use strict";

  const INSTANCE_KEY = "__firefoxChatImproverRuntimeV4";
  if (globalThis[INSTANCE_KEY]) {
    return;
  }

  const { MESSAGE, MODE, MONITOR_STATE } = globalThis.FCI_PROTOCOL;
  const MonitorEngine = globalThis.FCI_MONITOR_ENGINE;
  const TargetEngine = globalThis.FCI_TARGET_ENGINE;
  let state = {
    mode: MODE.INACTIVE,
    activatedAt: null,
    updatedAt: new Date().toISOString(),
    source: null,
    url: location.href,
    profileId: null,
    profileName: null,
    configMode: null,
    configRevision: 0,
    config: null,
    runtime: {
      monitorState: MONITOR_STATE.IDLE,
      cycle: 0,
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
      lastReason: null,
      lastTransition: null,
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
    } else {
      delete root.dataset.firefoxChatImprover;
      delete root.dataset.firefoxChatImproverProfile;
      delete root.dataset.firefoxChatImproverMonitor;
    }
  }

  function snapshot() {
    return {
      protocolVersion: globalThis.FCI_PROTOCOL.VERSION,
      mode: state.mode,
      activatedAt: state.activatedAt,
      updatedAt: state.updatedAt,
      source: state.source,
      url: location.href,
      profileId: state.profileId,
      profileName: state.profileName,
      configMode: state.configMode,
      configRevision: state.configRevision,
      runtime: { ...state.runtime }
    };
  }

  function sendRuntimeEvent(runtime) {
    state.runtime = { ...state.runtime, ...runtime };
    state.updatedAt = runtime.lastEventAt || new Date().toISOString();
    applyDocumentMarker();
    void browser.runtime.sendMessage({
      type: MESSAGE.CONTENT_RUNTIME_EVENT,
      payload: { runtime: { ...state.runtime } }
    }).catch(() => {
      // Extension reload or tab shutdown can invalidate the runtime context.
    });
  }

  const targetAutomation = TargetEngine.createTargetAutomation({ onRuntime: sendRuntimeEvent });
  const monitor = MonitorEngine.createMonitor({
    onRuntime(runtime) {
      sendRuntimeEvent(runtime);
      targetAutomation.handleMonitorRuntime(runtime);
    }
  });

  function applySession(session, mode = null) {
    const now = new Date().toISOString();
    state = {
      ...state,
      mode: mode || session?.mode || state.mode,
      activatedAt: session?.activatedAt || state.activatedAt || now,
      updatedAt: now,
      source: session?.source || state.source,
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
      targetAutomation.pause();
      monitor.pause();
    } else if (state.mode === MODE.ACTIVE) {
      targetAutomation.start(state.config, "session-applied-baseline");
      monitor.start(state.config, "session-applied");
    } else {
      targetAutomation.stop();
      monitor.stop();
    }
    applyDocumentMarker();
    return snapshot();
  }

  function setMode(mode) {
    state.mode = mode;
    state.updatedAt = new Date().toISOString();
    state.url = location.href;

    if (mode === MODE.PAUSED) {
      targetAutomation.pause();
      monitor.pause();
    } else if (mode === MODE.ACTIVE) {
      targetAutomation.resume(state.config);
      monitor.resume(state.config);
    } else {
      targetAutomation.stop();
      monitor.stop();
      state.runtime.monitorState = MONITOR_STATE.IDLE;
    }

    applyDocumentMarker();
    return snapshot();
  }

  browser.runtime.onMessage.addListener((message) => {
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
              message.payload?.visibility || "any",
              message.payload?.durationMs || 8000
            )
          });
        } catch (error) {
          return Promise.resolve({
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      default:
        return undefined;
    }
  });

  globalThis[INSTANCE_KEY] = Object.freeze({ snapshot });
  applyDocumentMarker();
})();
