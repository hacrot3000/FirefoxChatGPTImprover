(() => {
  "use strict";

  const INSTANCE_KEY = "__firefoxChatImproverRuntimeV2";
  if (globalThis[INSTANCE_KEY]) {
    return;
  }

  const { MESSAGE, MODE, MONITOR_STATE } = globalThis.FCI_PROTOCOL;
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
    } else {
      delete root.dataset.firefoxChatImprover;
      delete root.dataset.firefoxChatImproverProfile;
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
      state.runtime.monitorState = MONITOR_STATE.PAUSED;
    } else if (state.mode === MODE.ACTIVE && state.runtime.monitorState === MONITOR_STATE.PAUSED) {
      state.runtime.monitorState = MONITOR_STATE.IDLE;
    }
    applyDocumentMarker();
    return snapshot();
  }

  function setMode(mode) {
    state.mode = mode;
    state.updatedAt = new Date().toISOString();
    state.url = location.href;
    state.runtime.monitorState = mode === MODE.PAUSED
      ? MONITOR_STATE.PAUSED
      : MONITOR_STATE.IDLE;
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
      default:
        return undefined;
    }
  });

  globalThis[INSTANCE_KEY] = Object.freeze({ snapshot });
  applyDocumentMarker();
})();
