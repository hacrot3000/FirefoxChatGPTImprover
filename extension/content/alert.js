(() => {
  "use strict";

  if (globalThis.FCI_ALERT_ENGINE?.VERSION >= 2) {
    return;
  }

  const { MODE, MONITOR_STATE } = globalThis.FCI_PROTOCOL;
  const Settings = globalThis.FCI_SETTINGS;

  function shouldAlert(runtime, mode, config) {
    const normalized = Settings.normalizeConfig(config);
    const enabled = normalized.alerts.titleBlink || normalized.alerts.badge ||
      normalized.alerts.sidebar || normalized.alerts.notification;
    return Boolean(enabled && mode === MODE.ACTIVE && runtime?.monitorState === MONITOR_STATE.MATCHED);
  }

  function alertTitle(prefix, baseTitle) {
    const cleanPrefix = String(prefix || "⚠ AI READY").trim() || "⚠ AI READY";
    const cleanBase = String(baseTitle || "").trim();
    return cleanBase ? `[${cleanPrefix}] ${cleanBase}` : `[${cleanPrefix}]`;
  }

  function createAlertController({ onRuntime } = {}) {
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
    let lastSignature = "";

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

    function restoreTitle() {
      clearBlinkTimer();
      blinkOn = false;
      if (lastWrittenTitle !== null && document.title === lastWrittenTitle) {
        writeTitle(baseTitle);
      }
      lastWrittenTitle = null;
    }

    function emit(reason, force = false) {
      const snapshot = {
        alertActive: active,
        titleBlinking: Boolean(active && config.alerts.titleBlink),
        originalTitle: baseTitle,
        displayedTitle: document.title || "",
        alertStartedAt,
        lastAlertReason: reason
      };
      const signature = JSON.stringify(snapshot);
      if (!force && signature === lastSignature) {
        return snapshot;
      }
      lastSignature = signature;
      onRuntime?.({ ...snapshot, lastEventAt: new Date().toISOString() });
      return snapshot;
    }

    function startAlert(reason) {
      if (!active) {
        active = true;
        alertStartedAt = new Date().toISOString();
        baseTitle = document.title || baseTitle || "";
      }
      ensureTitleObserver();
      clearBlinkTimer();
      if (config.alerts.titleBlink) {
        blinkOn = true;
        writeTitle(alertTitle(config.alerts.titlePrefix, baseTitle));
        blinkTimer = setInterval(() => {
          blinkOn = !blinkOn;
          writeTitle(blinkOn ? alertTitle(config.alerts.titlePrefix, baseTitle) : baseTitle);
        }, config.alerts.blinkIntervalMs);
      } else {
        restoreTitle();
      }
      return emit(reason, true);
    }

    function stopAlert(reason) {
      const wasActive = active;
      active = false;
      alertStartedAt = null;
      restoreTitle();
      return emit(reason, wasActive);
    }

    function apply(nextConfig, nextRuntime, nextMode, reason = "apply") {
      config = Settings.normalizeConfig(nextConfig);
      runtime = { ...(nextRuntime || {}) };
      mode = nextMode || MODE.INACTIVE;
      if (shouldAlert(runtime, mode, config)) {
        return startAlert(reason);
      }
      return stopAlert(reason);
    }

    function stop(reason = "stop") {
      mode = MODE.INACTIVE;
      runtime = {};
      const snapshot = stopAlert(reason);
      titleObserver?.disconnect();
      titleObserver = null;
      return snapshot;
    }

    return Object.freeze({
      apply,
      stop,
      snapshot() {
        return {
          alertActive: active,
          titleBlinking: Boolean(active && config.alerts.titleBlink),
          originalTitle: baseTitle,
          displayedTitle: document.title || "",
          alertStartedAt
        };
      }
    });
  }

  Object.defineProperty(globalThis, "FCI_ALERT_ENGINE", {
    configurable: true,
    enumerable: false,
    writable: false,
    value: Object.freeze({
      VERSION: 2,
      shouldAlert,
      alertTitle,
      createAlertController
    })
  });
})();
