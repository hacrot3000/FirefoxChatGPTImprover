(() => {
  "use strict";

  if (globalThis.FCI_ALERT_ENGINE?.VERSION >= 15) {
    return;
  }

  const { MODE, MONITOR_STATE } = globalThis.FCI_PROTOCOL;
  const Settings = globalThis.FCI_SETTINGS;
  const AlertSound = globalThis.FCI_ALERT_SOUND;
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
      "⚠ RD",
      "RD",
      "READY",
      "RUNNING",
      "MATCHED",
      "MONITORING",
      "⌘",
      "✓",
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
        // RD is intentionally compact and therefore too generic to treat as
        // an unbracketed managed prefix. The extension writes it as [RD].
        // Preserving plain titles such as "RD Station" avoids corrupting the
        // real page title while still cleaning our own decoration.
        if (!/^RD$/iu.test(prefix)) {
          title = title.replace(new RegExp(`^${escaped}(?:\\s*[-:|·]\\s*|\\s+)`, "iu"), "").trimStart();
        }
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
    return Boolean(
      mode === MODE.ACTIVE &&
      runtime?.monitorState === MONITOR_STATE.WAITING
    );
  }

  function shouldShowReadyTitle(runtime, mode) {
    return Boolean(
      mode === MODE.ACTIVE &&
      runtime?.monitorState === MONITOR_STATE.MATCHED
    );
  }

  function monitorTitle(frame, baseTitle) {
    const cleanFrame = String(frame || MONITOR_SPINNER_FRAMES[0]).trim() || MONITOR_SPINNER_FRAMES[0];
    const cleanBase = String(baseTitle || "").trim();
    return cleanBase ? `${cleanFrame} ${cleanBase}` : cleanFrame;
  }

  function alertChannelsEnabled(config) {
    const normalized = Settings.normalizeConfig(config);
    return Boolean(normalized.alerts.titleBlink || normalized.alerts.badge ||
      normalized.alerts.sidebar || normalized.alerts.notification || normalized.alerts.sound?.enabled);
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

  function compactReadyPrefix(prefix) {
    const clean = String(prefix || "RD").trim() || "RD";
    if (/^(?:⚠️?\s*)?(?:AI\s+READY|READY|RD)$/iu.test(clean)) return "RD";
    return clean;
  }

  function alertTitle(prefix, baseTitle) {
    const cleanPrefix = compactReadyPrefix(prefix);
    const cleanBase = String(baseTitle || "").trim();
    return cleanBase ? `[${cleanPrefix}] ${cleanBase}` : `[${cleanPrefix}]`;
  }

  function quietAlertPrefix(prefix) {
    const clean = compactReadyPrefix(prefix);
    const quiet = clean.replace(/^[^\p{L}\p{N}]+/u, "").trim();
    return quiet || "RD";
  }

  function hasDistinctTitleBlinkFrame(prefix) {
    return compactReadyPrefix(prefix) !== quietAlertPrefix(prefix);
  }

  function commandTitlePrefix(runtime) {
    if (runtime?.shellCommandState === "running") return "⌘";
    if (runtime?.shellCommandState === "unread") return "✓";
    return "";
  }

  function combinedTitlePrefix(alertPrefix, runtime, includeAlert = true) {
    const parts = [];
    if (includeAlert) parts.push(compactReadyPrefix(alertPrefix));
    const command = commandTitlePrefix(runtime);
    if (command) parts.push(command);
    return parts.join(" · ");
  }

  function createAlertController({ onRuntime, clock, soundPlayer = null } = {}) {
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
    let customTitle = "";
    let baseTitle = storedBaseTitle("RD") || document.title || "";
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
    const audioPlayer = soundPlayer || AlertSound?.createPlayer?.() || { play: async () => ({ started: false, reason: "sound-engine-unavailable" }), stop() {} };
    let lastSoundCycle = 0;
    let soundAlertState = "idle";
    let soundAlertError = null;

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
        if (customTitle) {
          baseTitle = rememberBaseTitle(customTitle, config.alerts.titlePrefix) || customTitle;
          applyCurrentTitleFrame();
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
        titleBlinking: Boolean(active && config.alerts.titleBlink && hasDistinctTitleBlinkFrame(config.alerts.titlePrefix)),
        monitorTitleSpinning: Boolean(monitorSpinTimer),
        originalTitle: baseTitle,
        displayedTitle: document.title || "",
        alertStartedAt,
        alertAcknowledgedAt,
        alertDismissReason,
        lastUserActivityAt,
        activeVisibleSince: activeVisibleSince ? new Date(activeVisibleSince).toISOString() : null,
        soundAlertState,
        soundAlertCycle: lastSoundCycle,
        soundAlertError,
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
      return shouldSpinMonitorTitle(runtime, mode) && !(active && config.alerts.titleBlink);
    }

    function applyCurrentTitleFrame() {
      const commandPrefix = commandTitlePrefix(runtime);
      if (active && config.alerts.titleBlink && hasDistinctTitleBlinkFrame(config.alerts.titlePrefix)) {
        const primaryPrefix = blinkOn
          ? config.alerts.titlePrefix
          : quietAlertPrefix(config.alerts.titlePrefix);
        writeTitle(alertTitle(combinedTitlePrefix(primaryPrefix, runtime, true), baseTitle));
        return;
      }
      if (shouldShowReadyTitle(runtime, mode)) {
        writeTitle(alertTitle(combinedTitlePrefix(config.alerts.titlePrefix, runtime, true), baseTitle));
        return;
      }
      if (monitorSpinWanted()) {
        const decoratedBase = commandPrefix ? `[${commandPrefix}] ${baseTitle}` : baseTitle;
        writeTitle(monitorTitle(MONITOR_SPINNER_FRAMES[monitorSpinIndex], decoratedBase));
        return;
      }
      if (commandPrefix) {
        writeTitle(alertTitle(commandPrefix, baseTitle));
      }
    }

    function refreshTitlePresentation() {
      if (active && config.alerts.titleBlink && hasDistinctTitleBlinkFrame(config.alerts.titlePrefix)) {
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
      if (shouldShowReadyTitle(runtime, mode)) {
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
      if (commandTitlePrefix(runtime)) {
        clearBlinkTimer();
        clearMonitorSpinTimer();
        ensureTitleObserver();
        applyCurrentTitleFrame();
        return;
      }
      restoreTitle();
    }

    function playSoundForCycle(cycle, restored) {
      const soundConfig = config.alerts.sound || {};
      const persistedSoundCycle = Math.max(0, Number(runtime?.soundAlertCycle || 0));
      lastSoundCycle = Math.max(lastSoundCycle, persistedSoundCycle);
      if (restored || !soundConfig.enabled || cycle <= lastSoundCycle) {
        return;
      }
      lastSoundCycle = cycle;
      soundAlertState = "scheduled";
      soundAlertError = null;
      Promise.resolve(audioPlayer.play(soundConfig)).then((result) => {
        soundAlertState = result?.started ? "played" : "unavailable";
        soundAlertError = result?.started ? null : String(result?.reason || "Sound could not be played.");
        emit("sound-alert", true, true);
      }).catch((error) => {
        soundAlertState = "error";
        soundAlertError = error instanceof Error ? error.message : String(error);
        emit("sound-alert-error", true, true);
      });
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
      playSoundForCycle(alertCycle, restored);
      return emit(reason, true);
    }

    function stopAlert(reason, { acknowledge = false, notify = false } = {}) {
      const wasActive = active;
      active = false;
      clearActiveTimeout();
      audioPlayer.stop?.();
      if (wasActive) soundAlertState = "idle";
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
      runtime = { ...(nextRuntime || {}) };
      customTitle = String(runtime.customTitle || "").trim();
      const preferredBaseTitle = customTitle || String(runtime.pageTitle || "").trim() || baseTitle || document.title || "";
      const cleanedTitle = rememberBaseTitle(preferredBaseTitle, config.alerts.titlePrefix);
      if (cleanedTitle) {
        baseTitle = cleanedTitle;
      }
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
        lastSoundCycle = Math.max(lastSoundCycle, Number(runtime.soundAlertCycle || 0));
        soundAlertState = runtime.soundAlertState || soundAlertState;
        soundAlertError = runtime.soundAlertError || soundAlertError;
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
      VERSION: 15,
      TITLE_BASE_ATTRIBUTE,
      TITLE_PREFIX_ATTRIBUTE,
      stripManagedTitleDecorations,
      MONITOR_SPINNER_FRAMES,
      alertChannelsEnabled,
      shouldAlert,
      shouldSpinMonitorTitle,
    shouldShowReadyTitle,
      deriveAlertDecision,
      compactReadyPrefix,
      alertTitle,
      quietAlertPrefix,
      hasDistinctTitleBlinkFrame,
      commandTitlePrefix,
      combinedTitlePrefix,
      monitorTitle,
      createAlertController
    })
  });
})();
