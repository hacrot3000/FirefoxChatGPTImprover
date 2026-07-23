(() => {
  "use strict";

  if (globalThis.FCI_RULE_ENGINE?.VERSION >= 1) {
    return;
  }

  const Settings = globalThis.FCI_SETTINGS;
  const MonitorEngine = globalThis.FCI_MONITOR_ENGINE;
  const TargetEngine = globalThis.FCI_TARGET_ENGINE;
  const { MONITOR_STATE, TARGET_STATE } = globalThis.FCI_PROTOCOL;

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function ruleConfig(globalConfig, ruleId) {
    return Settings.configForRule(globalConfig, ruleId);
  }

  function createRuleAutomation({ onRuntime } = {}) {
    let config = Settings.defaultConfig();
    let entries = new Map();
    let aggregateCycle = 0;
    let stopped = true;
    let paused = false;
    let lastChangedRuleId = null;
    let lastAggregateSignature = "";

    function activeRules() {
      return config.rules.filter((rule) => rule.enabled);
    }

    function focusedEntry() {
      return entries.get(config.activeRuleId) || entries.values().next().value || null;
    }

    function publicRuleRuntime(entry) {
      return {
        ruleId: entry.rule.id,
        ruleName: entry.rule.name,
        enabled: entry.rule.enabled,
        ...clone(entry.runtime)
      };
    }

    function aggregateRuntime(reason = "rule-runtime", force = false) {
      const values = [...entries.values()];
      const focused = focusedEntry();
      const changed = entries.get(lastChangedRuleId) || focused;
      const matched = values.filter((entry) => entry.runtime.monitorState === MONITOR_STATE.MATCHED);
      const waiting = values.filter((entry) => entry.runtime.monitorState === MONITOR_STATE.WAITING);
      const errored = values.filter((entry) => entry.runtime.monitorState === MONITOR_STATE.ERROR);
      const allPaused = values.length > 0 && values.every((entry) => entry.runtime.monitorState === MONITOR_STATE.PAUSED);
      const monitorState = matched.length
        ? MONITOR_STATE.MATCHED
        : (errored.length ? MONITOR_STATE.ERROR
          : (allPaused ? MONITOR_STATE.PAUSED
            : (waiting.length || values.length ? MONITOR_STATE.WAITING : MONITOR_STATE.IDLE)));
      const source = changed?.runtime || focused?.runtime || {};
      const ruleRuntimes = Object.fromEntries(values.map((entry) => [entry.rule.id, publicRuleRuntime(entry)]));
      const runtime = {
        ...source,
        monitorState,
        cycle: aggregateCycle,
        conditionMatched: matched.length > 0,
        ruleCount: config.rules.length,
        enabledRuleCount: values.length,
        matchedRuleCount: matched.length,
        matchedRuleIds: matched.map((entry) => entry.rule.id),
        activeRuleId: config.activeRuleId,
        lastRuleId: changed?.rule.id || null,
        lastRuleName: changed?.rule.name || null,
        ruleRuntimes,
        monitorCount: values.reduce((sum, entry) => sum + Number(entry.runtime.monitorCount || 0), 0),
        monitorVisibleCount: values.reduce((sum, entry) => sum + Number(entry.runtime.monitorVisibleCount || 0), 0),
        monitorHiddenCount: values.reduce((sum, entry) => sum + Number(entry.runtime.monitorHiddenCount || 0), 0),
        monitorMatchedCount: values.reduce((sum, entry) => sum + Number(entry.runtime.monitorMatchedCount || 0), 0),
        monitorAttributeMatchedCount: values.reduce((sum, entry) => sum + Number(entry.runtime.monitorAttributeMatchedCount || 0), 0),
        baselineCount: values.reduce((sum, entry) => sum + Number(entry.runtime.baselineCount || 0), 0),
        candidateCount: values.reduce((sum, entry) => sum + Number(entry.runtime.candidateCount || 0), 0),
        handledCount: values.reduce((sum, entry) => sum + Number(entry.runtime.handledCount || 0), 0),
        clickedCount: values.reduce((sum, entry) => sum + Number(entry.runtime.clickedCount || 0), 0),
        dryRunCount: values.reduce((sum, entry) => sum + Number(entry.runtime.dryRunCount || 0), 0),
        targetEnabled: values.some((entry) => entry.runtime.targetEnabled),
        targetState: changed?.runtime.targetState || focused?.runtime.targetState || TARGET_STATE.DISABLED,
        lastReason: reason,
        lastEventAt: new Date().toISOString()
      };
      if (source.lastTransition) {
        runtime.lastTransition = changed ? `[${changed.rule.name}] ${source.lastTransition}` : source.lastTransition;
      }
      if (source.lastTargetAction) {
        runtime.lastTargetAction = changed ? `[${changed.rule.name}] ${source.lastTargetAction}` : source.lastTargetAction;
      }
      if (source.lastTargetError) {
        runtime.lastTargetError = changed ? `[${changed.rule.name}] ${source.lastTargetError}` : source.lastTargetError;
      }
      const signature = JSON.stringify({
        monitorState: runtime.monitorState,
        cycle: runtime.cycle,
        matchedRuleIds: runtime.matchedRuleIds,
        activeRuleId: runtime.activeRuleId,
        ruleRuntimes: runtime.ruleRuntimes,
        lastTransition: runtime.lastTransition,
        lastTargetAction: runtime.lastTargetAction,
        lastTargetError: runtime.lastTargetError
      });
      if (!force && signature === lastAggregateSignature) {
        return runtime;
      }
      lastAggregateSignature = signature;
      onRuntime?.(runtime);
      return runtime;
    }

    function onMonitorRuntime(entry, runtime) {
      const previousState = entry.runtime.monitorState;
      entry.runtime = { ...entry.runtime, ...runtime };
      lastChangedRuleId = entry.rule.id;
      if (runtime.monitorState === MONITOR_STATE.MATCHED && previousState !== MONITOR_STATE.MATCHED) {
        aggregateCycle += 1;
      }
      entry.target.handleMonitorRuntime(runtime);
      aggregateRuntime(`monitor:${entry.rule.id}`, Boolean(runtime.lastTransition));
    }

    function onTargetRuntime(entry, runtime) {
      entry.runtime = { ...entry.runtime, ...runtime };
      lastChangedRuleId = entry.rule.id;
      aggregateRuntime(`target:${entry.rule.id}`, Boolean(runtime.lastTargetAction || runtime.lastTargetError));
    }

    function createEntry(rule) {
      const entry = {
        rule,
        config: ruleConfig(config, rule.id),
        runtime: {
          monitorState: MONITOR_STATE.IDLE,
          cycle: 0,
          targetState: rule.target.enabled ? TARGET_STATE.WAITING : TARGET_STATE.DISABLED
        },
        monitor: null,
        target: null
      };
      entry.target = TargetEngine.createTargetAutomation({
        onRuntime(runtime) {
          onTargetRuntime(entry, runtime);
        }
      });
      entry.monitor = MonitorEngine.createMonitor({
        onRuntime(runtime) {
          onMonitorRuntime(entry, runtime);
        }
      });
      return entry;
    }

    function stopEntries() {
      for (const entry of entries.values()) {
        entry.target.stop();
        entry.monitor.stop();
      }
      entries.clear();
    }

    function start(nextConfig, reason = "rules-start", baseCycle = null) {
      config = Settings.normalizeConfig(nextConfig);
      if (baseCycle !== null && baseCycle !== undefined) {
        aggregateCycle = Math.max(aggregateCycle, Number(baseCycle || 0));
      }
      stopEntries();
      stopped = false;
      paused = false;
      lastChangedRuleId = null;
      lastAggregateSignature = "";
      for (const rule of activeRules()) {
        const entry = createEntry(rule);
        entries.set(rule.id, entry);
        entry.target.start(entry.config, `${reason}:target-baseline`);
        entry.monitor.start(entry.config, `${reason}:monitor`);
      }
      return aggregateRuntime(reason, true);
    }

    function pause() {
      if (stopped) {
        return aggregateRuntime("rules-pause-idle", true);
      }
      paused = true;
      for (const entry of entries.values()) {
        entry.target.pause();
        entry.monitor.pause();
      }
      return aggregateRuntime("rules-pause", true);
    }

    function resume(nextConfig = null) {
      if (nextConfig) {
        return start(nextConfig, "rules-resume-config");
      }
      if (stopped) {
        return start(config, "rules-resume");
      }
      paused = false;
      for (const entry of entries.values()) {
        entry.config = ruleConfig(config, entry.rule.id);
        entry.target.resume(entry.config);
        entry.monitor.resume(entry.config);
      }
      return aggregateRuntime("rules-resume", true);
    }

    function stop() {
      stopEntries();
      stopped = true;
      paused = false;
      lastChangedRuleId = null;
      lastAggregateSignature = "";
      return {
        monitorState: MONITOR_STATE.IDLE,
        cycle: aggregateCycle,
        ruleCount: config.rules.length,
        enabledRuleCount: 0,
        matchedRuleCount: 0,
        matchedRuleIds: [],
        ruleRuntimes: {},
        lastReason: "rules-stop",
        lastEventAt: new Date().toISOString()
      };
    }

    function runtimeForRule(ruleId) {
      const entry = entries.get(ruleId);
      return entry ? publicRuleRuntime(entry) : null;
    }

    return Object.freeze({
      start,
      updateConfig(nextConfig) {
        return start(nextConfig, "rules-config-updated");
      },
      pause,
      resume,
      stop,
      runtimeForRule,
      snapshot() {
        return aggregateRuntime(paused ? "rules-paused-snapshot" : "rules-snapshot");
      }
    });
  }

  Object.defineProperty(globalThis, "FCI_RULE_ENGINE", {
    configurable: true,
    enumerable: false,
    writable: false,
    value: Object.freeze({
      VERSION: 1,
      ruleConfig,
      createRuleAutomation
    })
  });
})();
