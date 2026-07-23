(() => {
  "use strict";

  if (globalThis.FCI_RECOVERY?.VERSION >= 1) {
    return;
  }

  const STATE = Object.freeze({
    NONE: "none",
    ATTACHED: "attached",
    RECOVERING: "recovering",
    NAVIGATION_PENDING: "navigation-pending",
    PERMISSION_REQUIRED: "permission-required",
    URL_BLOCKED: "url-blocked",
    FAILED: "failed"
  });

  function prepareRuntime(runtime, mode, reason, nowIso) {
    const current = runtime && typeof runtime === "object" ? runtime : {};
    return {
      ...current,
      monitorState: mode === "paused" ? "paused" : "idle",
      pendingMonitorState: null,
      stabilityStartedAt: null,
      stabilityDueAt: null,
      stabilityDelayMs: 0,
      conditionMatched: false,
      baselineCount: 0,
      candidateCount: 0,
      targetTotalCount: 0,
      targetEligibleCount: 0,
      targetState: mode === "paused" ? "paused" : (current.targetEnabled ? "waiting" : "disabled"),
      pipelineState: "idle",
      pipelineBusy: false,
      pipelineStartedAt: null,
      verifyResult: null,
      alertActive: false,
      titleBlinking: false,
      alertStartedAt: null,
      activeVisibleSince: null,
      navigationPending: false,
      recoveryState: STATE.RECOVERING,
      recoveryReason: String(reason || "recovery"),
      recoveryStartedAt: nowIso,
      recoveredAt: null,
      recoveryAttempts: Math.max(0, Number(current.recoveryAttempts) || 0) + 1
    };
  }

  function decision({ supportedUrl, urlAllowed, hostPermission }) {
    if (!supportedUrl || !urlAllowed) {
      return STATE.URL_BLOCKED;
    }
    if (!hostPermission) {
      return STATE.PERMISSION_REQUIRED;
    }
    return STATE.ATTACHED;
  }

  const api = Object.freeze({ VERSION: 1, STATE, prepareRuntime, decision });
  Object.defineProperty(globalThis, "FCI_RECOVERY", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: api
  });
})();
