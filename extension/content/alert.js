(() => {
  "use strict";

  if (globalThis.FCI_ALERT_ENGINE?.VERSION >= 7) {
    return;
  }

  const { MODE, MONITOR_STATE } = globalThis.FCI_PROTOCOL;
  const Settings = globalThis.FCI_SETTINGS;
  const MONITOR_SPINNER_FRAMES = Object.freeze(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]);
  const TITLE_BASE_ATTRIBUTE = "data-fci-base-title";
  const TITLE_PREFIX_ATTRIBUTE = "data-fci-title-prefix";

  function escapeRegExp(value) {
    return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function stripManagedTitleDecorations(value, prefixes = []) {
    let title = String(value ?? "").trim();
    const exactPrefixes = [...new Set([
      ...prefixes,
      "⚠ AI READY",
      "AI READY",
      "READY",
      "RUNNING",
      "MATCHED",
      "MONITORING",
      "⌘ COMMAND RUNNING",
      "✓ COMMAND LOG",
      "COMMAND RUNNING",
      "COMMAND LOG"
    ].map((item) => String(item || "").trim()).filter(Boolean))];

    for (let pass = 0; pass < 20 && title; pass += 1) {
      const before = title;
      title = title.replace(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s*/u, "").trimStart();
      for (const prefix of exactPrefixes) {
        const escaped = escapeRegExp(prefix);
        title = title.replace(new RegExp(`^\\[${escaped}\\]\\s*`, "iu"), "").trimStart();
        title = title.replace(new RegExp(`^${escaped}(?:\\s*[-:|·]\\s*|\\s+)`, "iu"), "").trimStart();
      }
      title = title.replace(/^\[[^\]]*(?:READY|RUNNING|MATCHED|MONITORING|ALERT|COMMAND|CMD|LOG)[^\]]*\]\s*/iu, "").trimStart();
      title = title.replace(/^(?:AI\s*)?(?:READY|RUNNING|MATCHED|MONITORING|COMMAND\s+RUNNING|COMMAND\s+LOG)\s*(?:[-:|·]\s*)/iu, "").trimStart();
      if (title === before) break;
    }
    return title;
  }

  function storedBaseTitle(prefix) {
    const root = document.documentElement;
    const stored = typeof root?.getAttribute === "function" ? (root.getAttribute(TITLE_BASE_ATTRIBUTE) || "") : "";
    const storedPrefix = typeof root?.getAttribute === "function" ? (root.getAttribute(TITLE_PREFIX_ATTRIBUTE) || "") : "";
    const cleanedStored = stripManagedTitleDecorations(stored, [prefix, storedPrefix]);
    const cleanedCurrent = stripManagedTitleDecorations(document.title || "", [prefix, storedPrefix]);
    const value = cleanedStored || cleanedCurrent;
    if (typeof root?.setAttribute === "function" && value) root.setAttribute(TITLE_BASE_ATTRIBUTE, value);
    return value;
  }

  function rememberBaseTitle(value, prefix) {
    const root = document.documentElement;
    const storedPrefix = typeof root?.getAttribute === "function" ? root.getAttribute(TITLE_PREFIX_ATTRIBUTE) : "";
    const clean = stripManagedTitleDecorations(value, [prefix, storedPrefix]);
    if (typeof root?.setAttribute === "function" && clean) root.setAttribute(TITLE_BASE_ATTRIBUTE, clean);
    if (typeof root?.setAttribute === "function" && prefix) root.setAttribute(TITLE_PREFIX_ATTRIBUTE, String(prefix));
    return clean;
  }

  function shouldSpinMonitorTitle(runtime, mode) {
    return Boolean(mode === MODE.ACTIVE && runtime?.monitorState === MONITOR_STATE.WAITING);
  }

  function monitorTitle(frame, baseTitle) {
    const cleanFrame = String(frame || MONITOR_SPINNER_FRAMES[0]).trim() || MONITOR_SPINNER_FRAMES[0];
    const cleanBase = String(baseTitle || "").trim();
    return cleanBase ? `${cleanFrame} ${cleanBase}` : cleanFrame;
  }

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

  function commandTitlePrefix(runtime) {
    if (runtime?.shellCommandState === "running") return "⌘ COMMAND RUNNING";
    if (runtime?.shellCommandState === "unread") return "✓ COMMAND LOG";
    return "";
  }

  function combinedTitlePrefix(alertPrefix, runtime, includeAlert = true) {
    const parts = [];
    if (includeAlert) parts.push(String(alertPrefix || "⚠ AI READY").trim() || "⚠ AI READY");
    const command = commandTitlePrefix(runtime);
    if (command) parts.push(command);
    return parts.join(" · ");
  }

  function createAlertController({ onRuntime, clock } = {}) {
    const customClock = clock && typeof clock === "object" ? clock : null;
    const scheduler = customClock
      ? {
        now: () => typeof customClock.now === "function" ? Reflect.apply(customClock.now, customClock, []) : Date.now(),
        setTimeout: (callback, delay) => typeof customClock.setTimeout === "function"
          ? Reflect.apply(customClock.setTimeout, customClock, [callback, delay])
          : setTimeout(callback, delay),
        clearTimeout: (timerId) => typeof customClock.clearTimeout === "function"
          ? Reflect.apply(customClock.clearTimeout, customClock, [timerId])
          : clearTimeout(timerId),
        setInterval: (callback, delay) => typeof customClock.setInterval === "function"
          ? Reflect.apply(customClock.setInterval, customClock, [callback, delay])
          : setInterval(callback, delay),
        clearInterval: (timerId) => typeof customClock.clearInterval === "function"
          ? Reflect.apply(customClock.clearInterval, customClock, [timerId])
          : clearInterval(timerId)
      }
      : {
        // Firefox content-script timer methods can reject a wrapper object as
        // `this`. Calling the lexical browser globals directly avoids the
        // "does not implement interface Window" failure seen during recovery.
        now: () => Date.now(),
        setTimeout: (callback, delay) => setTimeout(callback, delay),
        clearTimeout: (timerId) => clearTimeout(timerId),
        setInterval: (callback, delay) => setInterval(callback, delay),
        clearInterval: (timerId) => clearInterval(timerId)
      };
    let config = Settings.defaultConfig();
    let mode = MODE.INACTIVE;
    let runtime = {};
    let active = false;
    let blinkTimer = null;
    let blinkOn = false;
    let monitorSpinTimer = null;
    let monitorSpinIndex = 0;
    let titleObserver = null;
    let baseTitle = storedBaseTitle("⚠ AI READY") || document.title || "";
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
        const cleaned = rememberBaseTitle(current, config.alerts.titlePrefix);
        if (cleaned) {
          baseTitle = cleaned;
        }
        applyCurrentTitleFrame();
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
        scheduler.clearInterval(blinkTimer);
        blinkTimer = null;
      }
    }

    function clearMonitorSpinTimer() {
      if (monitorSpinTimer) {
        scheduler.clearInterval(monitorSpinTimer);
        monitorSpinTimer = null;
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
      clearMonitorSpinTimer();
      blinkOn = false;
      monitorSpinIndex = 0;
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
        monitorTitleSpinning: Boolean(monitorSpinTimer),
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

    function monitorSpinWanted() {
      return shouldSpinMonitorTitle(runtime, mode) && !commandTitlePrefix(runtime) && !(active && config.alerts.titleBlink);
    }

    function applyCurrentTitleFrame() {
      const commandPrefix = commandTitlePrefix(runtime);
      if (active && config.alerts.titleBlink) {
        writeTitle(blinkOn
          ? alertTitle(combinedTitlePrefix(config.alerts.titlePrefix, runtime, true), baseTitle)
          : (commandPrefix ? alertTitle(commandPrefix, baseTitle) : baseTitle));
        return;
      }
      if (commandPrefix) {
        writeTitle(alertTitle(commandPrefix, baseTitle));
        return;
      }
      if (monitorSpinWanted()) {
        writeTitle(monitorTitle(MONITOR_SPINNER_FRAMES[monitorSpinIndex], baseTitle));
      }
    }

    function refreshTitlePresentation() {
      if (active && config.alerts.titleBlink) {
        clearMonitorSpinTimer();
        ensureTitleObserver();
        if (!blinkTimer) {
          blinkOn = true;
          blinkTimer = scheduler.setInterval(() => {
            blinkOn = !blinkOn;
            applyCurrentTitleFrame();
          }, config.alerts.blinkIntervalMs);
        }
        applyCurrentTitleFrame();
        return;
      }
      if (commandTitlePrefix(runtime)) {
        clearBlinkTimer();
        clearMonitorSpinTimer();
        ensureTitleObserver();
        applyCurrentTitleFrame();
        return;
      }
      if (monitorSpinWanted()) {
        clearBlinkTimer();
        ensureTitleObserver();
        if (!monitorSpinTimer) {
          monitorSpinIndex = 0;
          monitorSpinTimer = scheduler.setInterval(() => {
            monitorSpinIndex = (monitorSpinIndex + 1) % MONITOR_SPINNER_FRAMES.length;
            applyCurrentTitleFrame();
          }, 180);
        }
        applyCurrentTitleFrame();
        return;
      }
      restoreTitle();
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
        baseTitle = rememberBaseTitle(runtime?.originalTitle || document.title || baseTitle || "", config.alerts.titlePrefix) || baseTitle || "";
      }
      refreshTitlePresentation();
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
      refreshTitlePresentation();
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
      const cleanedTitle = rememberBaseTitle(baseTitle || document.title || "", config.alerts.titlePrefix);
      if (cleanedTitle) {
        baseTitle = cleanedTitle;
      }
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
        refreshTitlePresentation();
        if (!activeTimeoutTimer) {
          scheduleActiveTimeout();
        }
      } else {
        refreshTitlePresentation();
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
      VERSION: 7,
      TITLE_BASE_ATTRIBUTE,
      TITLE_PREFIX_ATTRIBUTE,
      stripManagedTitleDecorations,
      MONITOR_SPINNER_FRAMES,
      alertChannelsEnabled,
      shouldAlert,
      shouldSpinMonitorTitle,
      deriveAlertDecision,
      alertTitle,
      commandTitlePrefix,
      combinedTitlePrefix,
      monitorTitle,
      createAlertController
    })
  });
})();
