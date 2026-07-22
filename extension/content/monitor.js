(() => {
  "use strict";

  if (globalThis.FCI_MONITOR_ENGINE?.VERSION >= 1) {
    return;
  }

  const Settings = globalThis.FCI_SETTINGS;
  const { MONITOR_STATE } = globalThis.FCI_PROTOCOL;
  const HIGHLIGHT_VISIBLE_ATTR = "data-fci-selector-highlight";
  const HIGHLIGHT_HIDDEN_ATTR = "data-fci-hidden-match-anchor";
  const HIGHLIGHT_STYLE_ID = "fci-selector-highlight-style";
  const HIGHLIGHT_TOAST_ID = "fci-selector-highlight-toast";
  let activeHighlightCleanup = null;

  function inspectVisibility(element) {
    if (!(element instanceof Element)) {
      return { visible: false, reasons: ["not-an-element"] };
    }

    const reasons = [];
    const visibleAttribute = element.getAttribute("visible");
    const ariaHidden = element.getAttribute("aria-hidden");
    let style = null;

    try {
      style = getComputedStyle(element);
    } catch (_error) {
      // A detached element can fail style resolution; getClientRects below remains authoritative.
    }

    if (element.hidden || element.hasAttribute("hidden")) {
      reasons.push("hidden-attribute");
    }
    if (element.visible === false || visibleAttribute?.toLowerCase() === "false") {
      reasons.push("visible-false");
    }
    if (ariaHidden?.toLowerCase() === "true") {
      reasons.push("aria-hidden");
    }
    if (style?.display === "none") {
      reasons.push("display-none");
    }
    if (style && ["hidden", "collapse"].includes(style.visibility)) {
      reasons.push(`visibility-${style.visibility}`);
    }
    if (!element.isConnected) {
      reasons.push("detached");
    }
    if (element.getClientRects().length === 0) {
      reasons.push("no-rendered-box");
    }

    return {
      visible: reasons.length === 0,
      reasons
    };
  }

  function visibilityMatches(info, requirement = "any") {
    if (requirement === "visible") {
      return info.visible;
    }
    if (requirement === "hidden") {
      return !info.visible;
    }
    return true;
  }

  function queryElements(rawSelector) {
    const css = Settings.selectorToCss(rawSelector);
    return {
      css,
      elements: [...document.querySelectorAll(css)]
    };
  }

  function conditionActualValue(element, condition) {
    if (condition.attribute === "textContent") {
      return element.textContent ?? "";
    }
    return element.getAttribute(condition.attribute);
  }

  function compareCondition(element, condition) {
    const actualRaw = conditionActualValue(element, condition);
    const exists = actualRaw !== null;
    const expectedRaw = condition.value ?? "";
    const actual = condition.caseSensitive || actualRaw === null
      ? actualRaw
      : actualRaw.toLowerCase();
    const expected = condition.caseSensitive ? expectedRaw : expectedRaw.toLowerCase();

    switch (condition.operator) {
      case "exists":
        return exists;
      case "not_exists":
        return !exists;
      case "equals":
        return exists && actual === expected;
      case "not_equals":
        return !exists || actual !== expected;
      case "contains":
        return exists && actual.includes(expected);
      case "not_contains":
        return !exists || !actual.includes(expected);
      case "regex":
        return exists && new RegExp(condition.value, condition.caseSensitive ? "" : "i").test(actualRaw);
      case "not_regex":
        return !exists || !new RegExp(condition.value, condition.caseSensitive ? "" : "i").test(actualRaw);
      default:
        return false;
    }
  }

  function elementMatchesMonitor(element, monitorConfig) {
    const visibility = inspectVisibility(element);
    if (!visibilityMatches(visibility, monitorConfig.visibility)) {
      return { matched: false, visibility, conditionResults: [] };
    }

    const enabledConditions = monitorConfig.conditions.filter((condition) => condition.enabled);
    const conditionResults = enabledConditions.map((condition) => {
      try {
        return compareCondition(element, condition);
      } catch (_error) {
        return false;
      }
    });
    const conditionsMatched = conditionResults.length === 0 || (
      monitorConfig.conditionJoin === "any"
        ? conditionResults.some(Boolean)
        : conditionResults.every(Boolean)
    );

    return { matched: conditionsMatched, visibility, conditionResults };
  }

  function evaluateMonitor(rawConfig) {
    const config = Settings.normalizeConfig(rawConfig);
    const query = queryElements(config.monitor.selector);
    const evaluations = query.elements.map((element) => ({
      element,
      ...elementMatchesMonitor(element, config.monitor)
    }));
    const visibleCount = evaluations.filter((item) => item.visibility.visible).length;
    const matchedElements = evaluations.filter((item) => item.matched);

    return {
      selector: query.css,
      totalCount: evaluations.length,
      visibleCount,
      hiddenCount: evaluations.length - visibleCount,
      matchedCount: matchedElements.length,
      matched: matchedElements.length > 0,
      matchedElements
    };
  }

  function nearestVisibleAncestor(element) {
    let candidate = element.parentElement;
    while (candidate) {
      if (inspectVisibility(candidate).visible) {
        return candidate;
      }
      candidate = candidate.parentElement;
    }
    return document.body || document.documentElement;
  }

  function clearSelectorHighlights() {
    if (activeHighlightCleanup) {
      activeHighlightCleanup();
      activeHighlightCleanup = null;
    }
  }

  function highlightSelector(rawSelector, visibility = "any", durationMs = 8000) {
    clearSelectorHighlights();
    const query = queryElements(rawSelector);
    const inspected = query.elements.map((element) => ({
      element,
      visibility: inspectVisibility(element)
    }));
    const selected = inspected.filter((item) => visibilityMatches(item.visibility, visibility));
    const token = `h${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    const changedAttributes = [];
    const hiddenAnchors = new Set();

    function setTemporaryAttribute(element, attribute, value) {
      changedAttributes.push({
        element,
        attribute,
        existed: element.hasAttribute(attribute),
        previous: element.getAttribute(attribute)
      });
      element.setAttribute(attribute, value);
    }

    for (const item of selected) {
      if (item.visibility.visible) {
        setTemporaryAttribute(item.element, HIGHLIGHT_VISIBLE_ATTR, token);
      } else {
        const anchor = nearestVisibleAncestor(item.element);
        if (anchor && !hiddenAnchors.has(anchor)) {
          hiddenAnchors.add(anchor);
          setTemporaryAttribute(anchor, HIGHLIGHT_HIDDEN_ATTR, token);
        }
      }
    }

    const style = document.createElement("style");
    style.id = HIGHLIGHT_STYLE_ID;
    style.textContent = `
      [${HIGHLIGHT_VISIBLE_ATTR}="${token}"] {
        outline: 4px solid #ff2d55 !important;
        outline-offset: 3px !important;
        box-shadow: 0 0 0 7px rgba(255, 45, 85, .25) !important;
      }
      [${HIGHLIGHT_HIDDEN_ATTR}="${token}"] {
        outline: 4px dashed #ff9f0a !important;
        outline-offset: 3px !important;
        box-shadow: 0 0 0 7px rgba(255, 159, 10, .25) !important;
      }
    `;
    (document.head || document.documentElement).append(style);

    const visibleCount = inspected.filter((item) => item.visibility.visible).length;
    const toast = document.createElement("div");
    toast.id = HIGHLIGHT_TOAST_ID;
    toast.textContent = `FirefoxChatImprover: ${selected.length}/${inspected.length} phần tử được chọn · hiện ${visibleCount} · ẩn ${inspected.length - visibleCount}`;
    Object.assign(toast.style, {
      position: "fixed",
      zIndex: "2147483647",
      top: "12px",
      right: "12px",
      maxWidth: "min(520px, calc(100vw - 24px))",
      padding: "10px 14px",
      border: "2px solid #ff2d55",
      borderRadius: "8px",
      background: "#111",
      color: "#fff",
      font: "600 13px/1.4 system-ui, sans-serif",
      boxShadow: "0 8px 30px rgba(0,0,0,.35)",
      pointerEvents: "none"
    });
    (document.body || document.documentElement).append(toast);

    let cleaned = false;
    const timer = setTimeout(clearSelectorHighlights, Math.max(1000, durationMs));
    activeHighlightCleanup = () => {
      if (cleaned) {
        return;
      }
      cleaned = true;
      clearTimeout(timer);
      for (const entry of changedAttributes) {
        if (!entry.element.isConnected) {
          continue;
        }
        if (entry.existed) {
          entry.element.setAttribute(entry.attribute, entry.previous ?? "");
        } else {
          entry.element.removeAttribute(entry.attribute);
        }
      }
      style.remove();
      toast.remove();
    };

    return {
      selector: query.css,
      totalCount: inspected.length,
      selectedCount: selected.length,
      visibleCount,
      hiddenCount: inspected.length - visibleCount,
      highlightedVisibleCount: selected.filter((item) => item.visibility.visible).length,
      highlightedHiddenAnchorCount: hiddenAnchors.size,
      visibility
    };
  }

  function createMonitor({ onRuntime }) {
    let config = Settings.defaultConfig();
    let observer = null;
    let debounceTimer = null;
    let monitorState = MONITOR_STATE.IDLE;
    let cycle = 0;
    let lastSignature = "";
    let lastEvaluation = null;
    let stopped = true;

    function runtimeFromEvaluation(evaluation, reason, transition = null) {
      return {
        monitorState,
        cycle,
        monitorSelector: evaluation?.selector || "",
        monitorCount: evaluation?.totalCount || 0,
        monitorVisibleCount: evaluation?.visibleCount || 0,
        monitorHiddenCount: evaluation?.hiddenCount || 0,
        monitorMatchedCount: evaluation?.matchedCount || 0,
        conditionMatched: Boolean(evaluation?.matched),
        lastReason: reason,
        lastTransition: transition,
        lastEventAt: new Date().toISOString()
      };
    }

    function emit(runtime, force = false) {
      const signature = JSON.stringify({
        monitorState: runtime.monitorState,
        cycle: runtime.cycle,
        monitorSelector: runtime.monitorSelector,
        monitorCount: runtime.monitorCount,
        monitorVisibleCount: runtime.monitorVisibleCount,
        monitorHiddenCount: runtime.monitorHiddenCount,
        monitorMatchedCount: runtime.monitorMatchedCount,
        conditionMatched: runtime.conditionMatched,
        lastTransition: runtime.lastTransition
      });
      if (!force && signature === lastSignature) {
        return;
      }
      lastSignature = signature;
      onRuntime?.(runtime);
    }

    function evaluate(reason = "mutation") {
      if (stopped) {
        return;
      }
      try {
        const evaluation = evaluateMonitor(config);
        lastEvaluation = evaluation;
        const nextState = evaluation.matched ? MONITOR_STATE.MATCHED : MONITOR_STATE.WAITING;
        const previousState = monitorState;
        let transition = null;
        if (nextState !== previousState) {
          transition = `${previousState}->${nextState}`;
          if (nextState === MONITOR_STATE.MATCHED) {
            cycle += 1;
          }
          monitorState = nextState;
        }
        emit(runtimeFromEvaluation(evaluation, reason, transition), Boolean(transition));
      } catch (error) {
        const previousState = monitorState;
        monitorState = MONITOR_STATE.ERROR;
        emit({
          ...runtimeFromEvaluation(null, reason, `${previousState}->${MONITOR_STATE.ERROR}`),
          error: error instanceof Error ? error.message : String(error)
        }, true);
      }
    }

    function schedule(reason = "mutation") {
      if (stopped || debounceTimer) {
        return;
      }
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        evaluate(reason);
      }, 80);
    }

    function disconnectObserver() {
      observer?.disconnect();
      observer = null;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    }

    function start(nextConfig, reason = "start") {
      config = Settings.normalizeConfig(nextConfig);
      disconnectObserver();
      stopped = false;
      observer = new MutationObserver(() => schedule("mutation"));
      observer.observe(document.documentElement, {
        attributes: true,
        childList: true,
        subtree: true
      });
      evaluate(reason);
    }

    function pause() {
      disconnectObserver();
      stopped = true;
      const previousState = monitorState;
      monitorState = MONITOR_STATE.PAUSED;
      emit({
        ...runtimeFromEvaluation(lastEvaluation, "pause", `${previousState}->${MONITOR_STATE.PAUSED}`),
        monitorState: MONITOR_STATE.PAUSED
      }, true);
    }

    function stop() {
      disconnectObserver();
      stopped = true;
      monitorState = MONITOR_STATE.IDLE;
      lastSignature = "";
      clearSelectorHighlights();
    }

    return Object.freeze({
      start,
      pause,
      resume(nextConfig) {
        start(nextConfig || config, "resume");
      },
      updateConfig(nextConfig) {
        start(nextConfig, "config-updated");
      },
      stop,
      evaluate
    });
  }

  Object.defineProperty(globalThis, "FCI_MONITOR_ENGINE", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({
      VERSION: 1,
      inspectVisibility,
      visibilityMatches,
      queryElements,
      evaluateMonitor,
      highlightSelector,
      clearSelectorHighlights,
      createMonitor
    })
  });
})();
