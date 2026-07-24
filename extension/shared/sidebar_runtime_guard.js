(() => {
  "use strict";

  const GUARD_VERSION = "0.26.0";
  const PANEL_ID = "fciSidebarRuntimeRecovery";
  const MAX_FAILURES = 12;
  const state = {
    startedAt: new Date().toISOString(),
    ready: false,
    retryHandler: null,
    failures: []
  };

  function errorMessage(error) {
    if (error instanceof Error) return error.message || error.name;
    if (error && typeof error === "object" && typeof error.message === "string") return error.message;
    return String(error || "Unknown sidebar error");
  }

  function errorStack(error) {
    if (error instanceof Error && error.stack) return String(error.stack);
    if (error && typeof error === "object" && error.stack) return String(error.stack);
    return "";
  }

  function setBodyState(value, ready = false) {
    const body = document.body;
    if (!body) return;
    body.dataset.sidebarStartup = value;
    body.dataset.sidebarReady = ready ? "true" : "false";
  }

  function createElement(tagName, options = {}) {
    const element = document.createElement(tagName);
    if (options.id) element.id = options.id;
    if (options.className) element.className = options.className;
    if (options.text !== undefined) element.textContent = options.text;
    if (options.type) element.type = options.type;
    return element;
  }

  function ensurePanel() {
    const existing = document.getElementById(PANEL_ID);
    if (existing) return existing;
    const host = document.body || document.documentElement;
    if (!host) return null;

    const panel = createElement("aside", { id: PANEL_ID, className: "sidebar-runtime-recovery" });
    panel.hidden = true;
    panel.setAttribute("role", "alert");
    panel.setAttribute("aria-live", "assertive");

    const header = createElement("div", { className: "sidebar-runtime-recovery-header" });
    const title = createElement("strong", { text: "Sidebar startup recovery" });
    const badge = createElement("span", { id: "fciSidebarRuntimeBadge", className: "sidebar-runtime-recovery-badge", text: "STARTUP" });
    header.append(title, badge);

    const summary = createElement("p", { id: "fciSidebarRuntimeSummary", text: "A sidebar component failed to initialize." });
    const details = createElement("pre", { id: "fciSidebarRuntimeDetails", className: "sidebar-runtime-recovery-details" });

    const actions = createElement("div", { className: "sidebar-runtime-recovery-actions" });
    const retryButton = createElement("button", { id: "fciSidebarRuntimeRetry", className: "compact", text: "Retry dashboard", type: "button" });
    const reloadButton = createElement("button", { id: "fciSidebarRuntimeReload", className: "compact", text: "Reload sidebar", type: "button" });
    const copyButton = createElement("button", { id: "fciSidebarRuntimeCopy", className: "compact", text: "Copy diagnostics", type: "button" });
    retryButton.disabled = true;

    retryButton.addEventListener("click", () => {
      if (typeof state.retryHandler !== "function") return;
      retryButton.disabled = true;
      Promise.resolve().then(() => state.retryHandler()).catch((error) => {
        report("retry-dashboard", error, { fatal: true });
      }).finally(() => {
        retryButton.disabled = typeof state.retryHandler !== "function";
      });
    });
    reloadButton.addEventListener("click", () => globalThis.location?.reload());
    copyButton.addEventListener("click", () => {
      void copyDiagnostics().then(() => {
        copyButton.textContent = "Copied";
        globalThis.setTimeout(() => { copyButton.textContent = "Copy diagnostics"; }, 1200);
      }).catch((error) => {
        report("copy-diagnostics", error, { fatal: false });
      });
    });

    actions.append(retryButton, reloadButton, copyButton);
    panel.append(header, summary, details, actions);
    host.append(panel);
    return panel;
  }

  function diagnosticObject() {
    return {
      guardVersion: GUARD_VERSION,
      extensionVersion: (() => {
        try { return globalThis.browser?.runtime?.getManifest?.().version || "unknown"; }
        catch (_error) { return "unknown"; }
      })(),
      startedAt: state.startedAt,
      capturedAt: new Date().toISOString(),
      ready: state.ready,
      href: String(globalThis.location?.href || ""),
      userAgent: String(globalThis.navigator?.userAgent || ""),
      failures: state.failures.map((failure) => ({ ...failure }))
    };
  }

  function diagnosticText() {
    return JSON.stringify(diagnosticObject(), null, 2);
  }

  function updatePanel() {
    const panel = ensurePanel();
    if (!panel) return;
    const failures = state.failures;
    const fatalCount = failures.filter((failure) => failure.fatal).length;
    panel.hidden = failures.length === 0;
    panel.dataset.state = fatalCount ? "error" : "warning";

    const badge = document.getElementById("fciSidebarRuntimeBadge");
    const summary = document.getElementById("fciSidebarRuntimeSummary");
    const details = document.getElementById("fciSidebarRuntimeDetails");
    const retryButton = document.getElementById("fciSidebarRuntimeRetry");
    if (badge) badge.textContent = fatalCount ? "FAILED" : "DEGRADED";
    if (summary) {
      summary.textContent = fatalCount
        ? `Sidebar startup failed in ${fatalCount} stage${fatalCount === 1 ? "" : "s"}. Other controls may be unavailable.`
        : `Sidebar started with ${failures.length} recoverable warning${failures.length === 1 ? "" : "s"}.`;
    }
    if (details) {
      details.textContent = failures.map((failure) => {
        const stack = failure.stack ? `\n${failure.stack}` : "";
        return `[${failure.time}] ${failure.stage}: ${failure.message}${stack}`;
      }).join("\n\n");
    }
    if (retryButton) retryButton.disabled = typeof state.retryHandler !== "function";
  }

  function report(stage, error, options = {}) {
    const normalizedStage = String(stage || "runtime");
    const message = errorMessage(error);
    const fatal = options.fatal !== false;
    const existing = state.failures.find((failure) => failure.stage === normalizedStage && failure.message === message);
    const record = {
      stage: normalizedStage,
      message,
      stack: errorStack(error),
      fatal,
      time: new Date().toISOString()
    };
    if (existing) Object.assign(existing, record);
    else state.failures.push(record);
    if (state.failures.length > MAX_FAILURES) state.failures.splice(0, state.failures.length - MAX_FAILURES);
    if (fatal) {
      state.ready = false;
      setBodyState("failed", false);
    } else if (!state.ready) {
      setBodyState("degraded", false);
    }
    updatePanel();
    return record;
  }

  function clearStage(stage) {
    const normalizedStage = String(stage || "runtime");
    state.failures = state.failures.filter((failure) => failure.stage !== normalizedStage);
    updatePanel();
  }

  function markStarting() {
    state.ready = false;
    setBodyState("starting", false);
  }

  function markReady(options = {}) {
    state.ready = true;
    const degraded = options.degraded === true || state.failures.length > 0;
    setBodyState(degraded ? "degraded" : "ready", true);
    updatePanel();
  }

  function setRetryHandler(handler) {
    state.retryHandler = typeof handler === "function" ? handler : null;
    updatePanel();
  }

  async function copyDiagnostics() {
    const text = diagnosticText();
    if (globalThis.navigator?.clipboard?.writeText) {
      await globalThis.navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "readonly");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    (document.body || document.documentElement).append(textarea);
    textarea.select();
    const copied = document.execCommand?.("copy");
    textarea.remove();
    if (!copied) throw new Error("Clipboard API is unavailable.");
  }

  globalThis.addEventListener?.("error", (event) => {
    report("window-error", event?.error || event?.message || "Unknown window error", { fatal: true });
  });
  globalThis.addEventListener?.("unhandledrejection", (event) => {
    report("unhandled-rejection", event?.reason || "Unhandled promise rejection", { fatal: true });
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensurePanel, { once: true });
  } else {
    ensurePanel();
  }

  globalThis.FCI_SIDEBAR_RUNTIME_GUARD = Object.freeze({
    version: GUARD_VERSION,
    markStarting,
    markReady,
    report,
    clearStage,
    setRetryHandler,
    diagnostics: diagnosticObject,
    diagnosticText,
    copyDiagnostics
  });
})();
