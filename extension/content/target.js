(() => {
  "use strict";

  if (globalThis.FCI_TARGET_ENGINE?.VERSION >= 5) {
    return;
  }

  const Settings = globalThis.FCI_SETTINGS;
  const MonitorEngine = globalThis.FCI_MONITOR_ENGINE;
  const { MONITOR_STATE, TARGET_STATE } = globalThis.FCI_PROTOCOL;
  const ACTION_HIGHLIGHT_ATTR = "data-fci-target-action-highlight";
  const ACTION_HIGHLIGHT_STYLE_ID = "fci-target-action-highlight-style";
  const ACTION_TOAST_ID = "fci-target-action-toast";
  let activeActionCleanup = null;

  function targetObserverOptionsForConfig(rawConfig) {
    const config = Settings.normalizeConfig(rawConfig);
    const selector = config.target.selector || {};
    const attributes = new Set([
      "id",
      "class",
      "style",
      "hidden",
      "visible",
      "aria-hidden",
      "disabled",
      "aria-disabled"
    ]);
    if (selector.kind === "attribute" && selector.attributeName) {
      attributes.add(String(selector.attributeName));
    }
    if (selector.kind === "css") {
      const value = String(selector.value || "");
      for (const match of value.matchAll(/\[\s*([A-Za-z_][A-Za-z0-9_.:-]*)/g)) {
        attributes.add(match[1]);
      }
    }
    for (const attribute of config.target.fingerprintAttributes || []) {
      attributes.add(attribute);
    }
    return {
      attributes: true,
      attributeFilter: [...attributes].sort(),
      childList: true,
      subtree: true
    };
  }

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

  function highlightAction(elements, dryRun, durationMs = 8000, context = "automation") {
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
    toast.textContent = context === "test"
      ? (dryRun
        ? `FirefoxChatImprover test: highlighted ${elements.length} current target(s) without clicking.`
        : `FirefoxChatImprover test: clicked ${elements.length} current target(s).`)
      : (dryRun
        ? `FirefoxChatImprover dry run: highlighted ${elements.length} new target(s) without clicking.`
        : `FirefoxChatImprover: clicked ${elements.length} new target(s).`);
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

  function testTargetAction(rawConfig, options = {}) {
    const config = Settings.normalizeConfig(rawConfig);
    const click = Boolean(options.click);
    const durationMs = Number(options.durationMs || 8000);
    const css = Settings.selectorToCss(config.target.selector);
    const all = [...document.querySelectorAll(css)];
    const eligible = all.filter((element) => {
      const visibleOk = !config.target.visibleOnly || MonitorEngine.inspectVisibility(element).visible;
      const enabledOk = !config.target.enabledOnly || elementEnabled(element);
      return visibleOk && enabledOk;
    });
    const limit = Math.max(1, Math.min(config.target.maxClicksPerCycle, eligible.length || 1));
    let selected;
    if (config.target.clickStrategy === "oldest") {
      selected = eligible.slice(0, limit);
    } else if (config.target.clickStrategy === "all") {
      selected = eligible.slice(0, limit);
    } else {
      selected = eligible.slice(Math.max(0, eligible.length - limit));
    }

    if (click) {
      for (const element of selected) {
        element.click();
      }
    }
    highlightAction(selected, !click, durationMs, "test");
    return {
      selector: css,
      totalCount: all.length,
      eligibleCount: eligible.length,
      selectedCount: selected.length,
      clicked: click,
      durationMs
    };
  }

  function delay(milliseconds) {
    const value = Math.max(0, Number(milliseconds) || 0);
    return value ? new Promise((resolve) => setTimeout(resolve, value)) : Promise.resolve();
  }

  function verificationSnapshot(rawPipeline) {
    const pipeline = rawPipeline && typeof rawPipeline === "object" ? rawPipeline : {};
    const selector = pipeline.verifySelector || Settings.defaultConfig().target.pipeline.verifySelector;
    const css = Settings.selectorToCss(selector);
    const elements = [...document.querySelectorAll(css)];
    const visibleCount = elements.filter((element) => MonitorEngine.inspectVisibility(element).visible).length;
    const expectation = ["exists", "not_exists", "visible", "hidden"].includes(pipeline.verifyExpectation)
      ? pipeline.verifyExpectation
      : "exists";
    let passed = false;
    if (expectation === "exists") {
      passed = elements.length > 0;
    } else if (expectation === "not_exists") {
      passed = elements.length === 0;
    } else if (expectation === "visible") {
      passed = visibleCount > 0;
    } else if (expectation === "hidden") {
      passed = elements.length > 0 && visibleCount === 0;
    }
    return {
      css,
      expectation,
      passed,
      count: elements.length,
      visibleCount,
      hiddenCount: Math.max(0, elements.length - visibleCount)
    };
  }

  async function waitForVerification(rawPipeline, isCancelled = () => false) {
    const pipeline = rawPipeline && typeof rawPipeline === "object" ? rawPipeline : {};
    const timeoutMs = Math.max(100, Number(pipeline.verifyTimeoutMs) || 5000);
    const pollIntervalMs = Math.max(50, Math.min(timeoutMs, Number(pipeline.verifyPollIntervalMs) || 150));
    const startedAt = Date.now();
    let snapshot = verificationSnapshot(pipeline);
    while (!snapshot.passed && Date.now() - startedAt < timeoutMs) {
      if (isCancelled()) {
        return { ...snapshot, cancelled: true, elapsedMs: Date.now() - startedAt };
      }
      await delay(pollIntervalMs);
      snapshot = verificationSnapshot(pipeline);
    }
    return { ...snapshot, cancelled: false, elapsedMs: Date.now() - startedAt };
  }

  function createTargetAutomation({ onRuntime, onBeforeClick = null }) {
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
    let pipelineToken = 0;
    let pipelineBusy = false;
    let pipelineState = "idle";
    let pipelineStartedAt = null;
    let verifyResult = null;

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
        pipelineEnabled: Boolean(config.target.pipeline?.enabled),
        pipelineState,
        pipelineBusy,
        pipelineStartedAt,
        verifyResult,
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
        pipelineEnabled: next.pipelineEnabled,
        pipelineState: next.pipelineState,
        pipelineBusy: next.pipelineBusy,
        verifyResult: next.verifyResult,
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

    function eligibleElements(elements) {
      return elements.filter((element) => {
        const visibleOk = !config.target.visibleOnly || MonitorEngine.inspectVisibility(element).visible;
        const enabledOk = !config.target.enabledOnly || elementEnabled(element);
        return visibleOk && enabledOk;
      });
    }

    function resetPipelineState() {
      pipelineBusy = false;
      pipelineState = "idle";
      pipelineStartedAt = null;
      verifyResult = null;
    }

    function cancelPipeline(reason = "cancelled", shouldEmit = false) {
      pipelineToken += 1;
      const wasBusy = pipelineBusy;
      resetPipelineState();
      if (shouldEmit && wasBusy) {
        emit({ lastTargetAction: `pipeline-${reason}` }, true);
      }
    }

    function resetCycleAccounting() {
      cancelPipeline("cycle-reset");
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
        targetEligibleCount: eligibleElements(elements).length,
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

    function reserveHandled(item) {
      handledNodes.add(item.element);
      handledCounts.set(item.fingerprint, (handledCounts.get(item.fingerprint) || 0) + 1);
      actionsThisCycle += 1;
    }

    function recordAction(dryRun) {
      if (dryRun) {
        dryRunThisCycle += 1;
      } else {
        clickedThisCycle += 1;
      }
    }

    function selectCandidates(candidates) {
      const remainingLimit = Math.max(0, config.target.maxClicksPerCycle - actionsThisCycle);
      if (!remainingLimit || !candidates.length) {
        return [];
      }
      let selected;
      if (config.target.clickStrategy === "oldest") {
        selected = candidates.slice(0, 1);
      } else if (config.target.clickStrategy === "newest") {
        selected = candidates.slice(-1);
      } else {
        selected = candidates.slice(0, remainingLimit);
      }
      return selected.slice(0, remainingLimit);
    }

    async function performAction(selected) {
      let lastError = null;
      const actedElements = [];
      for (const item of selected) {
        const element = item.element;
        if (!element?.isConnected) {
          lastError = "The target left the DOM before the action ran.";
          continue;
        }
        const visibleOk = !config.target.visibleOnly || MonitorEngine.inspectVisibility(element).visible;
        const enabledOk = !config.target.enabledOnly || elementEnabled(element);
        if (!visibleOk || !enabledOk) {
          lastError = "The target was no longer visible or enabled when the action ran.";
          continue;
        }
        actedElements.push(element);
      }
      if (actedElements.length && !config.target.dryRun && typeof onBeforeClick === "function") {
        try {
          await onBeforeClick({
            ruleId: config.activeRuleId || null,
            cycle: monitorCycle,
            targetCount: actedElements.length
          });
        } catch (error) {
          lastError = `Download capture could not be armed: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
      for (const element of actedElements) {
        recordAction(config.target.dryRun);
        if (!config.target.dryRun) {
          try {
            element.click();
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
          }
        }
      }
      if (actedElements.length) {
        highlightAction(actedElements, config.target.dryRun);
        targetState = TARGET_STATE.ACTED;
      }
      return { actedElements, lastError };
    }

    function pipelineCancelled(token) {
      return token !== pipelineToken || stopped || !monitorMatched;
    }

    async function runPipeline(selected, reason) {
      const pipeline = config.target.pipeline || Settings.defaultConfig().target.pipeline;
      const token = ++pipelineToken;
      pipelineBusy = true;
      pipelineState = pipeline.preActionDelayMs > 0 ? "pre-delay" : "acting";
      pipelineStartedAt = new Date().toISOString();
      verifyResult = null;
      selected.forEach(reserveHandled);
      emit({ lastTargetAction: `pipeline-start:${selected.length}` }, true);

      try {
        await delay(pipeline.preActionDelayMs);
        if (pipelineCancelled(token)) {
          return;
        }
        pipelineState = "acting";
        emit({ lastTargetAction: reason }, true);
        const action = await performAction(selected);
        if (action.lastError) {
          emit({ lastTargetError: action.lastError }, true);
        }
        if (!action.actedElements.length) {
          pipelineState = "failed";
          targetState = TARGET_STATE.ARMED;
          emit({ lastTargetAction: "pipeline-no-action", lastTargetError: action.lastError || "No eligible targets remain." }, true);
          return;
        }

        pipelineState = pipeline.postActionDelayMs > 0 ? "post-delay" : "acted";
        emit({
          lastTargetAction: config.target.dryRun ? `dry-run:${action.actedElements.length}` : `click:${action.actedElements.length}`,
          lastTargetAt: new Date().toISOString(),
          lastTargetError: action.lastError
        }, true);
        await delay(pipeline.postActionDelayMs);
        if (pipelineCancelled(token)) {
          return;
        }

        if (config.target.dryRun || !pipeline.verifyEnabled) {
          pipelineState = config.target.dryRun ? "dry-run-complete" : "completed";
          verifyResult = config.target.dryRun && pipeline.verifyEnabled
            ? { passed: null, skipped: true, reason: "dry-run" }
            : null;
          emit({ lastTargetAction: pipelineState }, true);
          return;
        }

        pipelineState = "verifying";
        emit({ lastTargetAction: "verify-start" }, true);
        const result = await waitForVerification(pipeline, () => pipelineCancelled(token));
        if (result.cancelled || pipelineCancelled(token)) {
          return;
        }
        verifyResult = result;
        pipelineState = result.passed ? "verified" : "verify-failed";
        targetState = result.passed ? TARGET_STATE.ACTED : TARGET_STATE.ERROR;
        emit({
          lastTargetAction: result.passed ? `verify-pass:${result.expectation}` : `verify-fail:${result.expectation}`,
          lastTargetError: result.passed
            ? null
            : `Verification ${result.expectation} was not satisfied after ${result.elapsedMs} ms (${result.count} element(s), ${result.visibleCount} visible).`
        }, true);
      } catch (error) {
        if (!pipelineCancelled(token)) {
          pipelineState = "failed";
          targetState = TARGET_STATE.ERROR;
          emit({
            lastTargetAction: "pipeline-error",
            lastTargetError: error instanceof Error ? error.message : String(error)
          }, true);
        }
      } finally {
        if (token === pipelineToken) {
          pipelineBusy = false;
          schedule("pipeline-complete-rescan");
        }
      }
    }

    async function runImmediate(selected, reason) {
      selected.forEach(reserveHandled);
      const action = await performAction(selected);
      if (!action.actedElements.length) {
        targetState = TARGET_STATE.ARMED;
      }
      emit({
        lastTargetAction: action.actedElements.length
          ? (config.target.dryRun ? `dry-run:${action.actedElements.length}` : `click:${action.actedElements.length}`)
          : reason,
        lastTargetAt: action.actedElements.length ? new Date().toISOString() : lastRuntime?.lastTargetAt || null,
        lastTargetError: action.lastError
      }, Boolean(action.actedElements.length || action.lastError));
    }

    function scan(reason = "target-mutation") {
      if (stopped || !config.target.enabled) {
        return;
      }
      try {
        const elements = queryTargetElements();
        const eligible = eligibleElements(elements);
        const candidates = collectCandidates(elements).filter((item) => eligible.includes(item.element));
        const counts = {
          baselineCount: [...baselineCounts.values()].reduce((sum, count) => sum + count, 0),
          targetTotalCount: elements.length,
          targetEligibleCount: eligible.length,
          candidateCount: candidates.length
        };

        if (!monitorMatched) {
          targetState = TARGET_STATE.WAITING;
          emit({ ...counts, lastTargetAction: reason });
          return;
        }
        if (pipelineBusy) {
          emit({ ...counts, lastTargetAction: `pipeline:${pipelineState}` });
          return;
        }

        const selected = selectCandidates(candidates);
        if (!selected.length) {
          if (targetState !== TARGET_STATE.ERROR) {
            targetState = TARGET_STATE.ARMED;
          }
          emit({ ...counts, lastTargetAction: reason });
          return;
        }

        if (config.target.pipeline?.enabled) {
          void runPipeline(selected, reason);
        } else {
          void runImmediate(selected, reason);
        }
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
      cancelPipeline("restart");
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
      if (!document.documentElement) {
        throw new Error("The document has no documentElement for target observation.");
      }
      observer.observe(document.documentElement, targetObserverOptionsForConfig(config));
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
        cancelPipeline("monitor-rearmed");
        establishBaseline("monitor-rearmed-baseline");
      } else if (matched) {
        scan("monitor-still-matched");
      }
    }

    function pause() {
      disconnectObserver();
      cancelPipeline("pause");
      stopped = true;
      targetState = TARGET_STATE.PAUSED;
      clearActionHighlights();
      emit({ lastTargetAction: "pause" }, true);
    }

    function stop() {
      disconnectObserver();
      cancelPipeline("stop");
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
    configurable: true,
    enumerable: false,
    writable: false,
    value: Object.freeze({
      VERSION: 4,
      targetObserverOptionsForConfig,
      elementFingerprint,
      elementEnabled,
      fingerprintCounts,
      newSlotCount,
      clearActionHighlights,
      testTargetAction,
      verificationSnapshot,
      waitForVerification,
      createTargetAutomation
    })
  });
})();
