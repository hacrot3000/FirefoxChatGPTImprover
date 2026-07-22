(() => {
  "use strict";

  const INSTANCE_KEY = "__firefoxChatImproverPhase01Runtime";
  if (globalThis[INSTANCE_KEY]) {
    return;
  }

  const { MESSAGE, MODE } = globalThis.FCI_PROTOCOL;
  let state = {
    mode: MODE.INACTIVE,
    activatedAt: null,
    updatedAt: new Date().toISOString(),
    source: null,
    url: location.href
  };

  function applyDocumentMarker() {
    const root = document.documentElement;
    if (!root) {
      return;
    }

    if (state.mode === MODE.ACTIVE || state.mode === MODE.PAUSED) {
      root.dataset.firefoxChatImprover = state.mode;
    } else {
      delete root.dataset.firefoxChatImprover;
    }
  }

  function snapshot() {
    return {
      protocolVersion: globalThis.FCI_PROTOCOL.VERSION,
      mode: state.mode,
      activatedAt: state.activatedAt,
      updatedAt: state.updatedAt,
      source: state.source,
      url: location.href
    };
  }

  function setMode(mode, payload = {}) {
    const now = new Date().toISOString();
    state = {
      ...state,
      ...payload,
      mode,
      activatedAt:
        mode === MODE.ACTIVE && !state.activatedAt
          ? now
          : state.activatedAt,
      updatedAt: now,
      url: location.href
    };
    applyDocumentMarker();
    return snapshot();
  }

  browser.runtime.onMessage.addListener((message) => {
    if (!message || typeof message.type !== "string") {
      return undefined;
    }

    switch (message.type) {
      case MESSAGE.CONTENT_ACTIVATE:
        return Promise.resolve(
          setMode(MODE.ACTIVE, {
            source: message.payload?.source || "unknown"
          })
        );

      case MESSAGE.CONTENT_PAUSE:
        return Promise.resolve(setMode(MODE.PAUSED));

      case MESSAGE.CONTENT_STOP:
        return Promise.resolve(setMode(MODE.INACTIVE));

      case MESSAGE.CONTENT_STATUS:
        return Promise.resolve(snapshot());

      default:
        return undefined;
    }
  });

  globalThis[INSTANCE_KEY] = Object.freeze({
    snapshot
  });
  applyDocumentMarker();
})();
