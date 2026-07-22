(() => {
  "use strict";

  if (globalThis.FCI_TARGET_ENGINE?.VERSION >= 1) {
    return;
  }

  const Settings = globalThis.FCI_SETTINGS;
  const MonitorEngine = globalThis.FCI_MONITOR_ENGINE;
  const { MONITOR_STATE, TARGET_STATE } = globalThis.FCI_PROTOCOL;
  const ACTION_HIGHLIGHT_ATTR = "data-fci-target-action-highlight";
  const ACTION_HIGHLIGHT_STYLE_ID = "fci-target-action-highlight-style";
  const ACTION_TOAST_ID = "fci-target-action-toast";
  let activeActionCleanup = null;

  function normalizeText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 180);
  }

  function elementFingerprint(element, rawAttributes = []) {
    const attributes = Array.isArray(rawAttributes) ? rawAttributes : [];
    const parts = [`tag=${String(element?.tagName || "unknown").toLowerCase()}`];
    let stableValueCount = 0;

    for (const attribute of attributes) {
      const name = String(attribute || "").trim();
      if (!name) {
        continue;
      }
      let value = null;
      if (name === "textContent") {
        value = normalizeText(element?.textContent);
      } else if (typeof element?.getAttribute === "function") {
        value = element.getAttribute(name);
      }
      if (value !== null && String(value) !== "") {
        stableValueCount += 1;
        parts.push(`${name}=${normalizeText(value)}`);
      }
    }

    if (!stableValueCount) {
      const fallbackAttributes = ["name", "type", "role", "title", "value"];
      for (const name of fallbackAttributes) {
        const value = typeof element?.getAttribute === "function" ? element.getAttribute(name) : null;
        if (value !== null && String(value) !== "") {
          parts.push(`${name}=${normalizeText(value)}`);
        }
      }
      const text = normalizeText(element?.textContent);
      if (text) {
        parts.push(`text=${text}`);
      }
    }

    return parts.join("|");
  }

  function elementEnabled(element) {
    if (!(element instanceof Element)) {
      return false;
    }
    if (element.disabled === true || element.hasAttribute("disabled")) {
      return false;
    }
    if (element.getAttribute("aria-disabled")?.toLowerCase() === "true") {
      return false;
    }
    try {
      if (getComputedStyle(element).pointerEvents === "none") {
        return false;
      }
    } catch (_error) {
      // Detached nodes are rejected by isConnected below.
    }
    return element.isConnected;
  }

  function fingerprintCounts(elements, attributes) {
    const counts = new Map();
    for (const element of elements) {
      const fingerprint = elementFingerprint(element, attributes);
      counts.set(fingerprint, (counts.get(fingerprint) || 0) + 1);
    }
    return counts;
  }

  function newSlotCount(currentCount, baselineCount, handledCount) {
    return Math.max(0, Number(currentCount || 0) - Number(baselineCount || 0) - Number(handledCount || 0));
  }

  function clearActionHighlights() {
    if (activeActionCleanup) {
      activeActionCleanup();
      activeActionCleanup = null;
    }
  }

  function highlightAction(elements, dryRun, durationMs = 8000) {
    clearActionHighlights();
    if (!elements.length) {
      return;
    }
    const token = `a${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    const changed = [];
    for (const element of elements) {
      changed.push({
        element,
        existed: element.hasAttribute(ACTION_HIGHLIGHT_ATTR),
        previous: element.getAttribute(ACTION_HIGHLIGHT_ATTR)
      });
      element.setAttribute(ACTION_HIGHLIGHT_ATTR, token);
    }

    const style = document.createElement("style");
    style.id = ACTION_HIGHLIGHT_STYLE_ID;
    style.textContent = `
      [${ACTION_HIGHLIGHT_ATTR}="${token}"] {
        outline: 4px ${dryRun ? "dashed" : "solid"} #00b894 !important;
        outline-offset: 4px !important;
        box-shadow: 0 0 0 8px rgba(0, 184, 148, .25) !important;
      }
    `;
    (document.head || document.documentElement).append(style);

    const toast = document.createElement("div");
    toast.id = ACTION_TOAST_ID;
    toast.textContent = dryRun
      ? `FirefoxChatImprover dry-run: đánh dấu ${elements.length} target mới, chưa click.`
      : `FirefoxChatImprover: đã click ${elements.length} target mới.`;
    Object.assign(toast.style, {
      position: "fixed",
      zIndex: "2147483647",
      top: "58px",
      right: "12px",
      maxWidth: "min(520px, calc(100vw - 24px))",
      padding: "10px 14px",
      border: "2px solid #00b894",
      borderRadius: "8px",
      background: "#111",
      color: "#fff",
      font: "600 13px/1.4 system-ui, sans-serif",
      boxShadow: "0 8px 30px rgba(0,0,0,.35)",
      pointerEvents: "none"
    });
    (document.body || document.documentElement).append(toast);

    let cleaned = false;
    const timer = setTimeout(clearActionHighlights, Math.max(1000, durationMs));
    activeActionCleanup = () => {
      if (cleaned) {
        return;
      }
      cleaned = true;
      clearTimeout(timer);
      for (const entry of changed) {
        if (!entry.element.isConnected) {
          continue;
        }
        if (entry.existed) {
          entry.element.setAttribute(ACTION_HIGHLIGHT_ATTR, entry.previous ?? "");
        } else {
          entry.element.removeAttribute(ACTION_HIGHLIGHT_ATTR);
        }
      }
      style.remove();
      toast.remove();
    };
  }

  function createTargetAutomation({ onRuntime }) {
    let config = Settings.defaultConfig();
    let observer = null;
    let debounceTimer = null;
    let stopped = true;
    let monitorMatched = false;
    let monitorCycle = 0;
    let baselineNodes = new WeakSet();
    let baselineCounts = new Map();
    let handledNodes = new WeakSet();
    let handledCounts = new Map();
    let addedOrder = new WeakMap();
    let nextAddedOrder = 1;
    let actionsThisCycle = 0;
    let clickedThisCycle = 0;
    let dryRunThisCycle = 0;
    let targetState = TARGET_STATE.DISABLED;
    let lastSignature = "";
    let lastRuntime = null;
    let currentCss = "";

    function runtime(fields = {}) {
      return {
        targetState,
        targetEnabled: Boolean(config.target.enabled),
        targetSelector: currentCss,
        baselineCount: 0,
        targetTotalCount: 0,
        targetEligibleCount: 0,
        candidateCount: 0,
        handledCount: actionsThisCycle,
        clickedCount: clickedThisCycle,
        dryRunCount: dryRunThisCycle,
        targetCycle: monitorCycle,
        lastTargetAction: null,
        lastTargetAt: null,
        lastTargetError: null,
        ...fields
      };
    }

    function emit(fields = {}, force = false) {
      const next = runtime(fields);
      const signature = JSON.stringify({
        targetState: next.targetState,
        targetEnabled: next.targetEnabled,
        targetSelector: next.targetSelector,
        baselineCount: next.baselineCount,
        targetTotalCount: next.targetTotalCount,
        targetEligibleCount: next.targetEligibleCount,
        candidateCount: next.candidateCount,
        handledCount: next.handledCount,
        clickedCount: next.clickedCount,
        dryRunCount: next.dryRunCount,
        targetCycle: next.targetCycle,
        lastTargetAction: next.lastTargetAction,
        lastTargetError: next.lastTargetError
      });
      lastRuntime = next;
      if (!force && signature === lastSignature) {
        return;
      }
      lastSignature = signature;
      onRuntime?.({ ...next, lastEventAt: new Date().toISOString() });
    }

    function queryTargetElements() {
      if (!config.target.enabled) {
        currentCss = "";
        return [];
      }
      currentCss = Settings.selectorToCss(config.target.selector);
      return [...document.querySelectorAll(currentCss)];
    }

    function resetCycleAccounting() {
      handledNodes = new WeakSet();
      handledCounts = new Map();
      addedOrder = new WeakMap();
      nextAddedOrder = 1;
      actionsThisCycle = 0;
      clickedThisCycle = 0;
      dryRunThisCycle = 0;
    }

    function establishBaseline(reason = "baseline") {
      if (!config.target.enabled) {
        baselineNodes = new WeakSet();
        baselineCounts = new Map();
        currentCss = "";
        targetState = TARGET_STATE.DISABLED;
        resetCycleAccounting();
        emit({ lastTargetAction: reason }, true);
        return;
      }
      const elements = queryTargetElements();
      baselineNodes = new WeakSet(elements);
      baselineCounts = fingerprintCounts(elements, config.target.fingerprintAttributes);
      resetCycleAccounting();
      targetState = monitorMatched ? TARGET_STATE.ARMED : TARGET_STATE.WAITING;
      emit({
        baselineCount: elements.length,
        targetTotalCount: elements.length,
        targetEligibleCount: elements.filter((element) => {
          const visibleOk = !config.target.visibleOnly || MonitorEngine.inspectVisibility(element).visible;
          const enabledOk = !config.target.enabledOnly || elementEnabled(element);
          return visibleOk && enabledOk;
        }).length,
        lastTargetAction: reason
      }, true);
    }

    function rememberAddedNode(node) {
      if (!(node instanceof Element) || !currentCss) {
        return;
      }
      try {
        if (node.matches(currentCss)) {
          addedOrder.set(node, nextAddedOrder++);
        }
        for (const descendant of node.querySelectorAll(currentCss)) {
          addedOrder.set(descendant, nextAddedOrder++);
        }
      } catch (_error) {
        // Selector errors are reported by scan/evaluate, not from mutation bookkeeping.
      }
    }

    function collectCandidates(elements) {
      const groups = new Map();
      for (const element of elements) {
        const fingerprint = elementFingerprint(element, config.target.fingerprintAttributes);
        if (!groups.has(fingerprint)) {
          groups.set(fingerprint, []);
        }
        groups.get(fingerprint).push(element);
      }

      const candidates = [];
      for (const [fingerprint, group] of groups.entries()) {
        const slots = newSlotCount(
          group.length,
          baselineCounts.get(fingerprint),
          handledCounts.get(fingerprint)
        );
        if (!slots) {
          continue;
        }
        const pool = group.filter((element) => !baselineNodes.has(element) && !handledNodes.has(element));
        pool.sort((left, right) => {
          const leftOrder = addedOrder.get(left) || Number.MAX_SAFE_INTEGER;
          const rightOrder = addedOrder.get(right) || Number.MAX_SAFE_INTEGER;
          return leftOrder - rightOrder;
        });
        const selected = pool.slice(Math.max(0, pool.length - slots));
        for (const element of selected) {
          candidates.push({ element, fingerprint });
        }
      }
      candidates.sort((left, right) => {
        const position = left.element.compareDocumentPosition(right.element);
        return position & Node.DOCUMENT_POSITION_PRECEDING ? 1 : -1;
      });
      return candidates;
    }

    function markHandled(item, dryRun) {
      handledNodes.add(item.element);
      handledCounts.set(item.fingerprint, (handledCounts.get(item.fingerprint) || 0) + 1);
      actionsThisCycle += 1;
      if (dryRun) {
        dryRunThisCycle += 1;
      } else {
        clickedThisCycle += 1;
      }
    }

    function scan(reason = "target-mutation") {
      if (stopped || !config.target.enabled) {
        return;
      }
      try {
        const elements = queryTargetElements();
        const eligible = elements.filter((element) => {
          const visibleOk = !config.target.visibleOnly || MonitorEngine.inspectVisibility(element).visible;
          const enabledOk = !config.target.enabledOnly || elementEnabled(element);
          return visibleOk && enabledOk;
        });
        let candidates = collectCandidates(elements).filter((item) => eligible.includes(item.element));

        if (!monitorMatched) {
          targetState = TARGET_STATE.WAITING;
          emit({
            baselineCount: [...baselineCounts.values()].reduce((sum, count) => sum + count, 0),
            targetTotalCount: elements.length,
            targetEligibleCount: eligible.length,
            candidateCount: candidates.length,
            lastTargetAction: reason
          });
          return;
        }

        const remainingLimit = Math.max(0, config.target.maxClicksPerCycle - actionsThisCycle);
        let selected = [];
        if (remainingLimit > 0 && candidates.length) {
          if (config.target.clickStrategy === "oldest") {
            selected = candidates.slice(0, 1);
          } else if (config.target.clickStrategy === "newest") {
            selected = candidates.slice(-1);
          } else {
            selected = candidates.slice(0, remainingLimit);
          }
          selected = selected.slice(0, remainingLimit);
        }

        let lastError = null;
        const actedElements = [];
        for (const item of selected) {
          markHandled(item, config.target.dryRun);
          actedElements.push(item.element);
          if (!config.target.dryRun) {
            try {
              item.element.click();
            } catch (error) {
              lastError = error instanceof Error ? error.message : String(error);
            }
          }
        }
        if (actedElements.length) {
          highlightAction(actedElements, config.target.dryRun);
          targetState = TARGET_STATE.ACTED;
        } else {
          targetState = TARGET_STATE.ARMED;
        }

        candidates = collectCandidates(elements).filter((item) => eligible.includes(item.element));
        emit({
          baselineCount: [...baselineCounts.values()].reduce((sum, count) => sum + count, 0),
          targetTotalCount: elements.length,
          targetEligibleCount: eligible.length,
          candidateCount: candidates.length,
          lastTargetAction: actedElements.length
            ? (config.target.dryRun ? `dry-run:${actedElements.length}` : `click:${actedElements.length}`)
            : reason,
          lastTargetAt: actedElements.length ? new Date().toISOString() : lastRuntime?.lastTargetAt || null,
          lastTargetError: lastError
        }, Boolean(actedElements.length || lastError));
      } catch (error) {
        targetState = TARGET_STATE.ERROR;
        emit({
          lastTargetAction: reason,
          lastTargetError: error instanceof Error ? error.message : String(error)
        }, true);
      }
    }

    function schedule(reason = "target-mutation") {
      if (stopped || debounceTimer) {
        return;
      }
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        scan(reason);
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

    function start(nextConfig, reason = "activation-baseline") {
      config = Settings.normalizeConfig(nextConfig);
      disconnectObserver();
      stopped = false;
      monitorMatched = false;
      monitorCycle = 0;
      establishBaseline(reason);
      observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes || []) {
            rememberAddedNode(node);
          }
        }
        if (monitorMatched) {
          schedule("target-mutation");
        }
      });
      observer.observe(document.documentElement, {
        attributes: true,
        childList: true,
        subtree: true
      });
    }

    function handleMonitorRuntime(monitorRuntime) {
      if (stopped) {
        return;
      }
      monitorCycle = Number(monitorRuntime?.cycle || monitorCycle || 0);
      const matched = monitorRuntime?.monitorState === MONITOR_STATE.MATCHED;
      if (matched && !monitorMatched) {
        monitorMatched = true;
        resetCycleAccounting();
        targetState = config.target.enabled ? TARGET_STATE.ARMED : TARGET_STATE.DISABLED;
        scan("monitor-matched");
      } else if (!matched && monitorMatched) {
        monitorMatched = false;
        establishBaseline("monitor-rearmed-baseline");
      } else if (matched) {
        scan("monitor-still-matched");
      }
    }

    function pause() {
      disconnectObserver();
      stopped = true;
      targetState = TARGET_STATE.PAUSED;
      clearActionHighlights();
      emit({ lastTargetAction: "pause" }, true);
    }

    function stop() {
      disconnectObserver();
      stopped = true;
      monitorMatched = false;
      targetState = config.target.enabled ? TARGET_STATE.WAITING : TARGET_STATE.DISABLED;
      clearActionHighlights();
      lastSignature = "";
    }

    return Object.freeze({
      start,
      resume(nextConfig) {
        start(nextConfig || config, "resume-baseline");
      },
      updateConfig(nextConfig) {
        start(nextConfig, "config-updated-baseline");
      },
      pause,
      stop,
      handleMonitorRuntime,
      scan,
      snapshot() {
        return lastRuntime ? { ...lastRuntime } : runtime();
      }
    });
  }

  Object.defineProperty(globalThis, "FCI_TARGET_ENGINE", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({
      VERSION: 1,
      elementFingerprint,
      elementEnabled,
      fingerprintCounts,
      newSlotCount,
      clearActionHighlights,
      createTargetAutomation
    })
  });
})();
