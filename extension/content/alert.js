(() => {
  "use strict";

  if (globalThis.FCI_ALERT_ENGINE?.VERSION >= 3) {
    return;
  }

  const { MODE, MONITOR_STATE } = globalThis.FCI_PROTOCOL;
  const Settings = globalThis.FCI_SETTINGS;

  function alertChannelsEnabled(config) {
    const normalized = Settings.normalizeConfig(config);
    return Boolean(normalized.alerts.titleBlink || normalized.alerts.badge ||
      normalized.alerts.sidebar || normalized.alerts.notification);
  }

  function shouldAlert(runtime, mode, config) {
    return Boolean(
      alertChannelsEnabled(config) &&
      mode === MODE.ACTIVE &&
      runtime?.alertActive
    );
  }

  function deriveAlertDecision({ active = false, alertCycle = 0 } = {}, runtime, mode, config) {
    const normalized = Settings.normalizeConfig(config);
    const currentCycle = Math.max(0, Number(runtime?.cycle || 0));
    const persistedCycle = Math.max(0, Number(runtime?.alertCycle || 0));
    const knownCycle = Math.max(alertCycle, persistedCycle);

    if (mode !== MODE.ACTIVE || !alertChannelsEnabled(normalized)) {
      return { action: "stop", cycle: Math.max(knownCycle, currentCycle) };
    }
    if (runtime?.alertActive && !active) {
      return { action: "restore", cycle: Math.max(knownCycle, currentCycle) };
    }
    if (runtime?.monitorState === MONITOR_STATE.MATCHED && currentCycle > knownCycle) {
      return { action: "start", cycle: currentCycle };
    }
    return { action: active ? "keep" : "idle", cycle: knownCycle };
  }

  function alertTitle(prefix, baseTitle) {
    const cleanPrefix = String(prefix || "⚠ AI READY").trim() || "⚠ AI READY";
    const cleanBase = String(baseTitle || "").trim();
    return cleanBase ? `[${cleanPrefix}] ${cleanBase}` : `[${cleanPrefix}]`;
  }

  function createAlertController({ onRuntime, clock } = {}) {
    const scheduler = {
      now: typeof clock?.now === "function" ? clock.now : () => Date.now(),
      setTimeout: typeof clock?.setTimeout === "function" ? clock.setTimeout : setTimeout,
      clearTimeout: typeof clock?.clearTimeout === "function" ? clock.clearTimeout : clearTimeout
    };
    let config = Settings.defaultConfig();
    let mode = MODE.INACTIVE;
    let runtime = {};
    let active = false;
    let blinkTimer = null;
    let blinkOn = false;
    let titleObserver = null;
    let baseTitle = document.title || "";
    let lastWrittenTitle = null;
    let alertStartedAt = null;
    let alertCycle = 0;
    let alertAcknowledgedAt = null;
    let alertDismissReason = null;
    let lastUserActivityAt = null;
    let activeVisibleSince = null;
    let activeTimeoutTimer = null;
    let listenersInstalled = false;
    let lastSignature = "";

    function nowIso() {
      return new Date(scheduler.now()).toISOString();
    }

    function isDocumentVisible() {
      return document.visibilityState !== "hidden";
    }

    function ensureTitleObserver() {
      if (titleObserver) {
        return;
      }
      const target = document.querySelector("title") || document.head || document.documentElement;
      if (!target) {
        return;
      }
      titleObserver = new MutationObserver(() => {
        const current = document.title || "";
        if (current === lastWrittenTitle) {
          return;
        }
        baseTitle = current;
        if (active && config.alerts.titleBlink) {
          writeTitle(blinkOn ? alertTitle(config.alerts.titlePrefix, baseTitle) : baseTitle);
        }
      });
      titleObserver.observe(target, { childList: true, characterData: true, subtree: true });
    }

    function writeTitle(value) {
      const text = String(value ?? "");
      lastWrittenTitle = text;
      if (document.title !== text) {
        document.title = text;
      }
    }

    function clearBlinkTimer() {
      if (blinkTimer) {
        clearInterval(blinkTimer);
        blinkTimer = null;
      }
    }

    function clearActiveTimeout() {
      if (activeTimeoutTimer) {
        scheduler.clearTimeout(activeTimeoutTimer);
        activeTimeoutTimer = null;
      }
      activeVisibleSince = null;
    }

    function restoreTitle() {
      clearBlinkTimer();
      blinkOn = false;
      if (lastWrittenTitle !== null && document.title === lastWrittenTitle) {
        writeTitle(baseTitle);
      }
      lastWrittenTitle = null;
    }

    function snapshot(reason = null) {
      return {
        alertActive: active,
        alertCycle,
        titleBlinking: Boolean(active && config.alerts.titleBlink),
        originalTitle: baseTitle,
        displayedTitle: document.title || "",
        alertStartedAt,
        alertAcknowledgedAt,
        alertDismissReason,
        lastUserActivityAt,
        activeVisibleSince: activeVisibleSince ? new Date(activeVisibleSince).toISOString() : null,
        lastAlertReason: reason
      };
    }

    function emit(reason, force = false, notify = false) {
      const value = snapshot(reason);
      const signature = JSON.stringify(value);
      if (!force && signature === lastSignature) {
        return value;
      }
      lastSignature = signature;
      if (notify) {
        onRuntime?.({ ...value, lastEventAt: nowIso() });
      }
      return value;
    }

    function scheduleActiveTimeout() {
      clearActiveTimeout();
      const seconds = Number(config.alerts.activeTabTimeoutSeconds || 0);
      if (!active || seconds <= 0 || !isDocumentVisible()) {
        return;
      }
      activeVisibleSince = scheduler.now();
      activeTimeoutTimer = scheduler.setTimeout(() => {
        activeTimeoutTimer = null;
        if (!active || !isDocumentVisible()) {
          activeVisibleSince = null;
          return;
        }
        acknowledge("active-tab-timeout");
      }, seconds * 1000);
    }

    function refreshTitleBlink() {
      clearBlinkTimer();
      if (!active || !config.alerts.titleBlink) {
        restoreTitle();
        return;
      }
      ensureTitleObserver();
      blinkOn = true;
      writeTitle(alertTitle(config.alerts.titlePrefix, baseTitle));
      blinkTimer = setInterval(() => {
        blinkOn = !blinkOn;
        writeTitle(blinkOn ? alertTitle(config.alerts.titlePrefix, baseTitle) : baseTitle);
      }, config.alerts.blinkIntervalMs);
    }

    function startAlert(reason, cycle, restored = false) {
      const nextCycle = Math.max(1, Number(cycle || runtime?.cycle || 1));
      const newCycle = nextCycle !== alertCycle;
      active = true;
      alertCycle = nextCycle;
      if (newCycle || !alertStartedAt) {
        alertStartedAt = restored && runtime?.alertStartedAt ? runtime.alertStartedAt : nowIso();
      }
      alertAcknowledgedAt = null;
      alertDismissReason = null;
      if (newCycle || !baseTitle) {
        baseTitle = runtime?.originalTitle || document.title || baseTitle || "";
      }
      refreshTitleBlink();
      scheduleActiveTimeout();
      return emit(reason, true);
    }

    function stopAlert(reason, { acknowledge = false, notify = false } = {}) {
      const wasActive = active;
      active = false;
      clearActiveTimeout();
      restoreTitle();
      if (acknowledge) {
        alertAcknowledgedAt = nowIso();
        alertDismissReason = reason;
      } else if (wasActive) {
        alertDismissReason = reason;
      }
      return emit(reason, wasActive || acknowledge, notify);
    }

    function acknowledge(reason = "user-activity") {
      if (!active) {
        return snapshot(reason);
      }
      if (reason.startsWith("user-activity")) {
        lastUserActivityAt = nowIso();
      }
      return stopAlert(reason, { acknowledge: true, notify: true });
    }

    function onUserActivity(event) {
      if (!active || !config.alerts.dismissOnUserActivity || !isDocumentVisible()) {
        return;
      }
      if (event?.isTrusted === false) {
        return;
      }
      acknowledge(`user-activity:${event?.type || "interaction"}`);
    }

    function onVisibilityChange() {
      if (!active) {
        return;
      }
      if (isDocumentVisible()) {
        scheduleActiveTimeout();
      } else {
        clearActiveTimeout();
      }
    }

    function ensureActivityListeners() {
      if (listenersInstalled) {
        return;
      }
      listenersInstalled = true;
      document.addEventListener("pointerdown", onUserActivity, true);
      document.addEventListener("keydown", onUserActivity, true);
      document.addEventListener("wheel", onUserActivity, { capture: true, passive: true });
      document.addEventListener("touchstart", onUserActivity, { capture: true, passive: true });
      document.addEventListener("visibilitychange", onVisibilityChange, true);
    }

    function removeActivityListeners() {
      if (!listenersInstalled) {
        return;
      }
      listenersInstalled = false;
      document.removeEventListener("pointerdown", onUserActivity, true);
      document.removeEventListener("keydown", onUserActivity, true);
      document.removeEventListener("wheel", onUserActivity, true);
      document.removeEventListener("touchstart", onUserActivity, true);
      document.removeEventListener("visibilitychange", onVisibilityChange, true);
    }

    function apply(nextConfig, nextRuntime, nextMode, reason = "apply") {
      config = Settings.normalizeConfig(nextConfig);
      runtime = { ...(nextRuntime || {}) };
      mode = nextMode || MODE.INACTIVE;
      ensureActivityListeners();

      const decision = deriveAlertDecision({ active, alertCycle }, runtime, mode, config);
      alertCycle = Math.max(alertCycle, decision.cycle);

      if (decision.action === "start") {
        return startAlert(reason, decision.cycle, false);
      }
      if (decision.action === "restore") {
        alertStartedAt = runtime.alertStartedAt || alertStartedAt;
        alertAcknowledgedAt = runtime.alertAcknowledgedAt || alertAcknowledgedAt;
        alertDismissReason = runtime.alertDismissReason || alertDismissReason;
        lastUserActivityAt = runtime.lastUserActivityAt || lastUserActivityAt;
        return startAlert(reason, decision.cycle, true);
      }
      if (decision.action === "stop") {
        if (runtime?.monitorState === MONITOR_STATE.MATCHED) {
          alertCycle = Math.max(alertCycle, Number(runtime?.cycle || 0));
        }
        return stopAlert(reason);
      }
      if (decision.action === "keep") {
        refreshTitleBlink();
        if (!activeTimeoutTimer) {
          scheduleActiveTimeout();
        }
      }
      return emit(reason);
    }

    function stop(reason = "stop") {
      mode = MODE.INACTIVE;
      runtime = {};
      const value = stopAlert(reason);
      titleObserver?.disconnect();
      titleObserver = null;
      removeActivityListeners();
      return value;
    }

    return Object.freeze({
      apply,
      acknowledge,
      stop,
      snapshot() {
        return snapshot();
      }
    });
  }

  Object.defineProperty(globalThis, "FCI_ALERT_ENGINE", {
    configurable: true,
    enumerable: false,
    writable: false,
    value: Object.freeze({
      VERSION: 3,
      alertChannelsEnabled,
      shouldAlert,
      deriveAlertDecision,
      alertTitle,
      createAlertController
    })
  });
})();
