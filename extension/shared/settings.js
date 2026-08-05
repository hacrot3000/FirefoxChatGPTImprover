(() => {
  "use strict";

  if (globalThis.FCI_SETTINGS?.SCHEMA_VERSION >= 17) {
    return;
  }

  const SCHEMA_VERSION = 17;
  // Keep the v2 storage key so existing profiles migrate in place.
  const STORAGE_KEY = "firefoxChatImprover.settings.v2";
  const DEFAULT_PROFILE_ID = "default";
  const DEFAULT_MONITOR_PROFILE_ID = "monitor-default";
  const DEFAULT_TARGET_PROFILE_ID = "target-default";
  const SELECTOR_KINDS = new Set(["css", "id", "class", "attribute"]);
  const VISIBILITY_TRANSITIONS = new Set(["none", "hidden_to_visible", "visible_to_hidden"]);
  const CONDITION_OPERATORS = new Set([
    "exists",
    "not_exists",
    "equals",
    "not_equals",
    "contains",
    "not_contains",
    "regex",
    "not_regex"
  ]);

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function safeString(value, fallback = "") {
    return typeof value === "string" ? value : fallback;
  }

  function safeBoolean(value, fallback = false) {
    return typeof value === "boolean" ? value : fallback;
  }

  function safeInteger(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isInteger(number)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, number));
  }

  function makeId(prefix = "profile") {
    const random = crypto.getRandomValues(new Uint32Array(2));
    return `${prefix}-${Date.now().toString(36)}-${random[0].toString(36)}${random[1].toString(36)}`;
  }

  function defaultSelector(value = "") {
    return {
      tag: "button",
      kind: "css",
      value,
      attributeName: ""
    };
  }

  function defaultCondition() {
    return {
      enabled: true,
      attribute: "aria-label",
      operator: "equals",
      value: "",
      caseSensitive: true
    };
  }

  function defaultMonitorConfig() {
    return {
      selector: defaultSelector("#composer-submit-button"),
      visibilityTransition: "none",
      matchStableMs: 0,
      resetStableMs: 0,
      conditionJoin: "all",
      conditions: [defaultCondition()]
    };
  }

  function defaultTargetConfig() {
    return {
      enabled: false,
      selector: defaultSelector(""),
      clickStrategy: "newest",
      visibleOnly: true,
      enabledOnly: true,
      dryRun: true,
      maxClicksPerCycle: 1,
      fingerprintAttributes: [
        "data-message-id",
        "data-testid",
        "id",
        "href",
        "aria-label"
      ],
      pipeline: {
        enabled: false,
        preActionDelayMs: 0,
        postActionDelayMs: 0,
        verifyEnabled: false,
        verifySelector: defaultSelector(""),
        verifyExpectation: "exists",
        verifyTimeoutMs: 5000,
        verifyPollIntervalMs: 150
      }
    };
  }

  function createMonitorProfile(name = "Default monitor", monitor = null, id = null) {
    const timestamp = nowIso();
    return {
      id: id || makeId("monitor-profile"),
      name: safeString(name, "Monitor profile").trim() || "Monitor profile",
      createdAt: timestamp,
      updatedAt: timestamp,
      monitor: normalizeMonitorConfig(monitor || defaultMonitorConfig())
    };
  }

  function normalizeMonitorProfile(raw, fallbackId = null) {
    const source = raw && typeof raw === "object" ? raw : {};
    const timestamp = nowIso();
    return {
      id: safeString(source.id, fallbackId || makeId("monitor-profile")).trim() || makeId("monitor-profile"),
      name: safeString(source.name, "Monitor profile").trim() || "Monitor profile",
      createdAt: safeString(source.createdAt, timestamp),
      updatedAt: safeString(source.updatedAt, timestamp),
      monitor: normalizeMonitorConfig(source.monitor || source.config)
    };
  }

  function createTargetProfile(name = "Default target", target = null, id = null) {
    const timestamp = nowIso();
    return {
      id: id || makeId("target-profile"),
      name: safeString(name, "Target profile").trim() || "Target profile",
      createdAt: timestamp,
      updatedAt: timestamp,
      target: normalizeTargetConfig(target || defaultTargetConfig())
    };
  }

  function normalizeTargetProfile(raw, fallbackId = null) {
    const source = raw && typeof raw === "object" ? raw : {};
    const timestamp = nowIso();
    return {
      id: safeString(source.id, fallbackId || makeId("target-profile")).trim() || makeId("target-profile"),
      name: safeString(source.name, "Target profile").trim() || "Target profile",
      createdAt: safeString(source.createdAt, timestamp),
      updatedAt: safeString(source.updatedAt, timestamp),
      target: normalizeTargetConfig(source.target || source.config)
    };
  }

  function defaultCommandAction() {
    return {
      enabled: false,
      presetId: "",
      trigger: "on_match",
      allowDryRun: false
    };
  }

  function defaultRule(name = "Rule 1", id = "rule-default") {
    return {
      id,
      name,
      enabled: true,
      monitor: defaultMonitorConfig(),
      target: defaultTargetConfig(),
      commandAction: defaultCommandAction()
    };
  }

  function defaultShellPreset(name = "Command preset", id = null) {
    return {
      id: id || makeId("command-preset"),
      name,
      enabled: true,
      workingDirectory: "",
      command: "",
      mode: "terminal",
      confirmBeforeRun: true
    };
  }

  function defaultNativeLogRetention() {
    return {
      enabled: true,
      maxAgeDays: 90,
      maxTotalMiB: 512,
      maxFiles: 500,
      runOnStartup: true,
      runAfterCommand: true
    };
  }

  function normalizeNativeLogRetention(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const fallback = defaultNativeLogRetention();
    return {
      enabled: safeBoolean(source.enabled, fallback.enabled),
      maxAgeDays: safeInteger(source.maxAgeDays, fallback.maxAgeDays, 1, 3650),
      maxTotalMiB: safeInteger(source.maxTotalMiB, fallback.maxTotalMiB, 16, 16384),
      maxFiles: safeInteger(source.maxFiles, fallback.maxFiles, 10, 10000),
      runOnStartup: safeBoolean(source.runOnStartup, fallback.runOnStartup),
      runAfterCommand: safeBoolean(source.runAfterCommand, fallback.runAfterCommand)
    };
  }

  function defaultConfig() {
    const rule = defaultRule();
    return {
      activation: {
        requireUrlMatch: false,
        urlPatterns: [],
        routingEnabled: true,
        routingPriority: 0
      },
      activeRuleId: rule.id,
      rules: [rule],
      // Legacy projections keep older tools/tests and single-rule consumers compatible.
      monitor: clone(rule.monitor),
      target: clone(rule.target),
      alerts: {
        titleBlink: true,
        titlePrefix: "⚠ AI READY",
        blinkIntervalMs: 700,
        badge: true,
        sidebar: true,
        notification: false,
        sound: {
          enabled: false,
          tone: "soft-chime",
          volume: 0.45,
          repeatCount: 1,
          repeatIntervalMs: 900
        },
        dismissOnUserActivity: true,
        activeTabTimeoutSeconds: 10
      },
      shell: {
        workingDirectory: "",
        command: "",
        mode: "terminal",
        confirmBeforeRun: true,
        requirePresetMatch: false,
        rememberHistory: true,
        historyLimit: 20,
        selectedPresetId: "",
        presets: []
      }
    };
  }

  function normalizeSelector(raw, fallback = defaultSelector()) {
    const source = raw && typeof raw === "object" ? raw : {};
    const kind = SELECTOR_KINDS.has(source.kind) ? source.kind : fallback.kind;
    return {
      tag: safeString(source.tag, fallback.tag || "*").trim() || "*",
      kind,
      value: safeString(source.value, fallback.value).trim(),
      attributeName: safeString(source.attributeName, fallback.attributeName).trim()
    };
  }

  function normalizeCondition(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    return {
      enabled: safeBoolean(source.enabled, true),
      attribute: safeString(source.attribute, "aria-label").trim(),
      operator: CONDITION_OPERATORS.has(source.operator) ? source.operator : "equals",
      value: safeString(source.value),
      caseSensitive: safeBoolean(source.caseSensitive, true)
    };
  }

  function normalizeMonitorConfig(raw, fallback = defaultMonitorConfig()) {
    const source = raw && typeof raw === "object" ? raw : {};
    const conditions = Array.isArray(source.conditions)
      ? source.conditions.map(normalizeCondition)
      : clone(fallback.conditions || []);
    const legacyVisibilityTransition = source.visibility === "visible"
      ? "hidden_to_visible"
      : (source.visibility === "hidden" ? "visible_to_hidden" : "none");
    const visibilityTransition = VISIBILITY_TRANSITIONS.has(source.visibilityTransition)
      ? source.visibilityTransition
      : legacyVisibilityTransition;
    return {
      selector: normalizeSelector(source.selector, fallback.selector),
      visibilityTransition,
      matchStableMs: safeInteger(source.matchStableMs, fallback.matchStableMs, 0, 60000),
      resetStableMs: safeInteger(source.resetStableMs, fallback.resetStableMs, 0, 60000),
      conditionJoin: source.conditionJoin === "any" ? "any" : "all",
      conditions
    };
  }

  function normalizeTargetConfig(raw, fallback = defaultTargetConfig()) {
    const source = raw && typeof raw === "object" ? raw : {};
    const fingerprintAttributes = Array.isArray(source.fingerprintAttributes)
      ? source.fingerprintAttributes
      : fallback.fingerprintAttributes;
    const pipeline = source.pipeline && typeof source.pipeline === "object" ? source.pipeline : {};
    return {
      enabled: safeBoolean(source.enabled, false),
      selector: normalizeSelector(source.selector, fallback.selector),
      clickStrategy: ["oldest", "newest", "all"].includes(source.clickStrategy)
        ? source.clickStrategy
        : "newest",
      visibleOnly: safeBoolean(source.visibleOnly, true),
      enabledOnly: safeBoolean(source.enabledOnly, true),
      dryRun: safeBoolean(source.dryRun, true),
      maxClicksPerCycle: safeInteger(source.maxClicksPerCycle, 1, 1, 100),
      fingerprintAttributes: [...new Set(
        fingerprintAttributes.map((item) => safeString(item).trim()).filter(Boolean)
      )],
      pipeline: {
        enabled: safeBoolean(pipeline.enabled, false),
        preActionDelayMs: safeInteger(pipeline.preActionDelayMs, 0, 0, 60000),
        postActionDelayMs: safeInteger(pipeline.postActionDelayMs, 0, 0, 60000),
        verifyEnabled: safeBoolean(pipeline.verifyEnabled, false),
        verifySelector: normalizeSelector(pipeline.verifySelector, fallback.pipeline.verifySelector),
        verifyExpectation: ["exists", "not_exists", "visible", "hidden"].includes(pipeline.verifyExpectation)
          ? pipeline.verifyExpectation
          : "exists",
        verifyTimeoutMs: safeInteger(pipeline.verifyTimeoutMs, 5000, 100, 120000),
        verifyPollIntervalMs: safeInteger(pipeline.verifyPollIntervalMs, 150, 50, 5000)
      }
    };
  }

  function migrateGeneratedRuleName(value, fallback) {
    const name = safeString(value, fallback).trim() || fallback;
    const match = /^Quy tắc\s+(\d+)$/u.exec(name);
    return match ? `Rule ${match[1]}` : name;
  }

  function migrateGeneratedProfileName(value, fallback) {
    const name = safeString(value, fallback).trim() || fallback;
    if (name === "Mặc định") return "Default";
    if (name === "Profile mới") return "New profile";
    return name;
  }

  function normalizeCommandAction(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    return {
      enabled: safeBoolean(source.enabled, false),
      presetId: safeString(source.presetId).trim(),
      trigger: ["on_match", "after_target", "after_verify"].includes(source.trigger)
        ? source.trigger
        : "on_match",
      allowDryRun: safeBoolean(source.allowDryRun, false)
    };
  }

  function normalizeRule(raw, index = 0) {
    const source = raw && typeof raw === "object" ? raw : {};
    const fallbackId = index === 0 ? "rule-default" : `rule-${index + 1}`;
    const id = safeString(source.id, fallbackId).trim() || fallbackId;
    return {
      id,
      name: migrateGeneratedRuleName(source.name, `Rule ${index + 1}`),
      enabled: safeBoolean(source.enabled, true),
      monitor: normalizeMonitorConfig(source.monitor),
      target: normalizeTargetConfig(source.target),
      commandAction: normalizeCommandAction(source.commandAction)
    };
  }

  function normalizeShellPreset(raw, index = 0) {
    const source = raw && typeof raw === "object" ? raw : {};
    const fallbackId = `command-preset-${index + 1}`;
    return {
      id: safeString(source.id, fallbackId).trim() || fallbackId,
      name: safeString(source.name, `Command preset ${index + 1}`).trim() || `Command preset ${index + 1}`,
      enabled: safeBoolean(source.enabled, true),
      workingDirectory: safeString(source.workingDirectory).trim(),
      command: safeString(source.command),
      mode: source.mode === "background" ? "background" : "terminal",
      confirmBeforeRun: safeBoolean(source.confirmBeforeRun, true)
    };
  }

  function matchingShellPreset(rawConfig, rawCommand) {
    const config = normalizeConfig(rawConfig);
    const command = rawCommand && typeof rawCommand === "object" ? rawCommand : {};
    const cwd = safeString(command.workingDirectory ?? command.cwd).trim();
    const text = safeString(command.command);
    const mode = command.mode === "background" ? "background" : "terminal";
    return config.shell.presets.find((preset) =>
      preset.enabled &&
      preset.workingDirectory === cwd &&
      preset.command === text &&
      preset.mode === mode
    ) || null;
  }

  function normalizeConfig(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const defaults = defaultConfig();
    const activation = source.activation || {};
    const alerts = source.alerts || {};
    const shell = source.shell || {};
    const patterns = Array.isArray(activation.urlPatterns)
      ? activation.urlPatterns
      : safeString(activation.urlPatterns).split(/\r?\n/);

    const legacyMonitor = normalizeMonitorConfig(source.monitor, defaults.monitor);
    const legacyTarget = normalizeTargetConfig(source.target, defaults.target);
    const rawRules = Array.isArray(source.rules) && source.rules.length
      ? source.rules
      : [{
          id: safeString(source.activeRuleId, "rule-default") || "rule-default",
          name: "Rule 1",
          enabled: true,
          monitor: legacyMonitor,
          target: legacyTarget
        }];
    const rules = [];
    const usedRuleIds = new Set();
    rawRules.forEach((rawRule, index) => {
      const rule = normalizeRule(rawRule, index);
      let id = rule.id;
      let suffix = 2;
      while (usedRuleIds.has(id)) {
        id = `${rule.id}-${suffix++}`;
      }
      usedRuleIds.add(id);
      rules.push({ ...rule, id });
    });
    if (!rules.length) {
      rules.push(defaultRule());
    }
    const requestedRuleId = safeString(source.activeRuleId);
    let activeRule = rules.find((rule) => rule.id === requestedRuleId) || rules[0];

    const presets = [];
    const usedPresetIds = new Set();
    const rawPresets = Array.isArray(shell.presets) ? shell.presets : [];
    rawPresets.forEach((rawPreset, index) => {
      const preset = normalizeShellPreset(rawPreset, index);
      let id = preset.id;
      let suffix = 2;
      while (usedPresetIds.has(id)) {
        id = `${preset.id}-${suffix++}`;
      }
      usedPresetIds.add(id);
      presets.push({ ...preset, id });
    });
    const requestedPresetId = safeString(shell.selectedPresetId);
    const selectedPresetId = presets.some((preset) => preset.id === requestedPresetId)
      ? requestedPresetId
      : "";

    return {
      activation: {
        requireUrlMatch: safeBoolean(activation.requireUrlMatch, false),
        urlPatterns: [...new Set(patterns.map((item) => safeString(item).trim()).filter(Boolean))],
        routingEnabled: safeBoolean(activation.routingEnabled, true),
        routingPriority: safeInteger(activation.routingPriority, 0, -1000, 1000)
      },
      activeRuleId: activeRule.id,
      rules,
      monitor: clone(activeRule.monitor),
      target: clone(activeRule.target),
      alerts: {
        titleBlink: safeBoolean(alerts.titleBlink, true),
        titlePrefix: safeString(alerts.titlePrefix, defaults.alerts.titlePrefix).trim() || defaults.alerts.titlePrefix,
        blinkIntervalMs: safeInteger(alerts.blinkIntervalMs, defaults.alerts.blinkIntervalMs, 250, 5000),
        badge: safeBoolean(alerts.badge, true),
        sidebar: safeBoolean(alerts.sidebar, true),
        notification: safeBoolean(alerts.notification, false),
        sound: (() => {
          const sound = alerts.sound && typeof alerts.sound === "object" ? alerts.sound : {};
          const tone = ["soft-chime", "double-beep", "urgent"].includes(sound.tone)
            ? sound.tone
            : defaults.alerts.sound.tone;
          const volume = Number(sound.volume);
          return {
            enabled: safeBoolean(sound.enabled, defaults.alerts.sound.enabled),
            tone,
            volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : defaults.alerts.sound.volume,
            repeatCount: safeInteger(sound.repeatCount, defaults.alerts.sound.repeatCount, 1, 5),
            repeatIntervalMs: safeInteger(sound.repeatIntervalMs, defaults.alerts.sound.repeatIntervalMs, 250, 10000)
          };
        })(),
        dismissOnUserActivity: safeBoolean(alerts.dismissOnUserActivity, true),
        activeTabTimeoutSeconds: safeInteger(alerts.activeTabTimeoutSeconds, defaults.alerts.activeTabTimeoutSeconds, 0, 3600)
      },
      shell: {
        workingDirectory: safeString(shell.workingDirectory).trim(),
        command: safeString(shell.command),
        mode: shell.mode === "background" ? "background" : "terminal",
        confirmBeforeRun: safeBoolean(shell.confirmBeforeRun, true),
        requirePresetMatch: safeBoolean(shell.requirePresetMatch, false),
        rememberHistory: safeBoolean(shell.rememberHistory, true),
        historyLimit: safeInteger(shell.historyLimit, 20, 1, 100),
        selectedPresetId,
        presets
      }
    };
  }

  function configForRule(rawConfig, ruleId) {
    const config = normalizeConfig(rawConfig);
    const rule = config.rules.find((item) => item.id === ruleId) || config.rules[0];
    return normalizeConfig({ ...config, activeRuleId: rule.id, monitor: rule.monitor, target: rule.target });
  }

  function cssEscape(value) {
    const text = safeString(value);
    if (globalThis.CSS && typeof globalThis.CSS.escape === "function") {
      return globalThis.CSS.escape(text);
    }
    return text.replace(/[^a-zA-Z0-9_-]/g, (character) => {
      return `\\${character.codePointAt(0).toString(16)} `;
    });
  }

  function selectorToCss(raw) {
    const selector = normalizeSelector(raw);
    const tag = selector.tag && selector.tag !== "*" ? cssEscape(selector.tag) : "";

    if (selector.kind === "css") {
      return selector.value || tag || "*";
    }

    if (selector.kind === "id") {
      const value = selector.value.replace(/^#/, "").trim();
      if (!value) {
        throw new Error("The ID selector has no value.");
      }
      return `${tag}#${cssEscape(value)}`;
    }

    if (selector.kind === "class") {
      const classes = selector.value
        .replaceAll(".", " ")
        .split(/\s+/)
        .map((item) => item.trim())
        .filter(Boolean);
      if (!classes.length) {
        throw new Error("The class selector has no value.");
      }
      return `${tag}${classes.map((item) => `.${cssEscape(item)}`).join("")}`;
    }

    if (selector.kind === "attribute") {
      const name = selector.attributeName.trim();
      if (!name || !/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name)) {
        throw new Error("The attribute name is invalid.");
      }
      return selector.value
        ? `${tag}[${name}=${JSON.stringify(selector.value)}]`
        : `${tag}[${name}]`;
    }

    throw new Error("The selector type is not supported.");
  }

  function createProfile(name = "Default", baseConfig = null, id = null) {
    const timestamp = nowIso();
    return {
      id: id || makeId(),
      name: migrateGeneratedProfileName(name, "New profile"),
      createdAt: timestamp,
      updatedAt: timestamp,
      config: normalizeConfig(baseConfig || defaultConfig())
    };
  }

  function normalizeProfile(raw, fallbackId = null) {
    const source = raw && typeof raw === "object" ? raw : {};
    const id = safeString(source.id, fallbackId || makeId()).trim() || makeId();
    const timestamp = nowIso();
    return {
      id,
      name: migrateGeneratedProfileName(source.name, "Profile"),
      createdAt: safeString(source.createdAt, timestamp),
      updatedAt: safeString(source.updatedAt, timestamp),
      config: normalizeConfig(source.config)
    };
  }

  function defaultStore() {
    const profile = createProfile("Default", defaultConfig(), DEFAULT_PROFILE_ID);
    const monitorProfile = createMonitorProfile("Default monitor", defaultMonitorConfig(), DEFAULT_MONITOR_PROFILE_ID);
    const targetProfile = createTargetProfile("Default target", defaultTargetConfig(), DEFAULT_TARGET_PROFILE_ID);
    return {
      schemaVersion: SCHEMA_VERSION,
      revision: 1,
      defaultProfileId: DEFAULT_PROFILE_ID,
      defaultMonitorProfileId: DEFAULT_MONITOR_PROFILE_ID,
      defaultTargetProfileId: DEFAULT_TARGET_PROFILE_ID,
      nativeLogRetention: defaultNativeLogRetention(),
      profiles: [profile],
      monitorProfiles: [monitorProfile],
      targetProfiles: [targetProfile]
    };
  }

  function normalizeStore(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const profiles = [];
    const used = new Set();
    const candidates = Array.isArray(source.profiles) ? source.profiles : [];

    for (const candidate of candidates) {
      const profile = normalizeProfile(candidate);
      if (!used.has(profile.id)) {
        used.add(profile.id);
        profiles.push(profile);
      }
    }

    if (!profiles.length) {
      profiles.push(createProfile("Default", defaultConfig(), DEFAULT_PROFILE_ID));
      used.add(DEFAULT_PROFILE_ID);
    }

    const monitorProfiles = [];
    const usedMonitorIds = new Set();
    for (const candidate of Array.isArray(source.monitorProfiles) ? source.monitorProfiles : []) {
      const profile = normalizeMonitorProfile(candidate);
      if (!usedMonitorIds.has(profile.id)) {
        usedMonitorIds.add(profile.id);
        monitorProfiles.push(profile);
      }
    }
    if (!monitorProfiles.length) {
      const legacyMonitor = profiles[0]?.config?.monitor || defaultMonitorConfig();
      monitorProfiles.push(createMonitorProfile("Default monitor", legacyMonitor, DEFAULT_MONITOR_PROFILE_ID));
      usedMonitorIds.add(DEFAULT_MONITOR_PROFILE_ID);
    }

    const targetProfiles = [];
    const usedTargetIds = new Set();
    for (const candidate of Array.isArray(source.targetProfiles) ? source.targetProfiles : []) {
      const profile = normalizeTargetProfile(candidate);
      if (!usedTargetIds.has(profile.id)) {
        usedTargetIds.add(profile.id);
        targetProfiles.push(profile);
      }
    }
    if (!targetProfiles.length) {
      const legacyTarget = profiles[0]?.config?.target || defaultTargetConfig();
      targetProfiles.push(createTargetProfile("Default target", legacyTarget, DEFAULT_TARGET_PROFILE_ID));
      usedTargetIds.add(DEFAULT_TARGET_PROFILE_ID);
    }

    let defaultProfileId = safeString(source.defaultProfileId);
    if (!used.has(defaultProfileId)) defaultProfileId = profiles[0].id;
    let defaultMonitorProfileId = safeString(source.defaultMonitorProfileId);
    if (!usedMonitorIds.has(defaultMonitorProfileId)) defaultMonitorProfileId = monitorProfiles[0].id;
    let defaultTargetProfileId = safeString(source.defaultTargetProfileId);
    if (!usedTargetIds.has(defaultTargetProfileId)) defaultTargetProfileId = targetProfiles[0].id;

    return {
      schemaVersion: SCHEMA_VERSION,
      revision: safeInteger(source.revision, 1, 1, Number.MAX_SAFE_INTEGER),
      defaultProfileId,
      defaultMonitorProfileId,
      defaultTargetProfileId,
      nativeLogRetention: normalizeNativeLogRetention(source.nativeLogRetention),
      profiles,
      monitorProfiles,
      targetProfiles
    };
  }

  function profileById(store, profileId) {
    return normalizeStore(store).profiles.find((profile) => profile.id === profileId) || null;
  }

  function monitorProfileById(store, profileId) {
    return normalizeStore(store).monitorProfiles.find((profile) => profile.id === profileId) || null;
  }

  function targetProfileById(store, profileId) {
    return normalizeStore(store).targetProfiles.find((profile) => profile.id === profileId) || null;
  }

  function wildcardToRegExp(pattern) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
    return new RegExp(`^${escaped}$`, "i");
  }

  function matchingUrlPatterns(config, url) {
    const activation = normalizeConfig(config).activation;
    if (!activation.urlPatterns.length || typeof url !== "string") {
      return [];
    }
    return activation.urlPatterns.filter((pattern) => {
      try {
        return wildcardToRegExp(pattern).test(url);
      } catch (_error) {
        return false;
      }
    });
  }

  function urlAllowed(config, url) {
    const activation = normalizeConfig(config).activation;
    if (!activation.requireUrlMatch) {
      return true;
    }
    return matchingUrlPatterns(config, url).length > 0;
  }

  function patternSpecificity(pattern) {
    const text = safeString(pattern);
    const literalLength = text.replaceAll("*", "").length;
    const wildcardPenalty = (text.match(/\*/g) || []).length * 8;
    const exactBonus = text.includes("*") ? 0 : 10000;
    return exactBonus + literalLength - wildcardPenalty;
  }

  function profileRouteCandidates(rawStore, url) {
    const store = normalizeStore(rawStore);
    const candidates = [];
    store.profiles.forEach((profile, profileIndex) => {
      const activation = normalizeConfig(profile.config).activation;
      if (!activation.routingEnabled) {
        return;
      }
      const patterns = matchingUrlPatterns(profile.config, url);
      if (!patterns.length) {
        return;
      }
      const rankedPatterns = patterns
        .map((pattern) => ({ pattern, specificity: patternSpecificity(pattern) }))
        .sort((left, right) => right.specificity - left.specificity || left.pattern.localeCompare(right.pattern));
      candidates.push({
        profileId: profile.id,
        profileName: profile.name,
        priority: activation.routingPriority,
        bestPattern: rankedPatterns[0].pattern,
        specificity: rankedPatterns[0].specificity,
        matchedPatterns: rankedPatterns.map((item) => item.pattern),
        profileIndex
      });
    });
    candidates.sort((left, right) =>
      right.priority - left.priority ||
      right.specificity - left.specificity ||
      left.profileIndex - right.profileIndex
    );
    return candidates;
  }

  function routeProfile(rawStore, url, options = {}) {
    const store = normalizeStore(rawStore);
    const candidates = profileRouteCandidates(store, url);
    const matched = candidates.length > 0;
    const selectedId = matched
      ? candidates[0].profileId
      : (options.fallbackToDefault === false ? null : store.defaultProfileId);
    const profile = selectedId ? profileById(store, selectedId) : null;
    return {
      url: safeString(url),
      matched,
      usedFallback: Boolean(profile && !matched),
      profileId: profile?.id || null,
      profileName: profile?.name || null,
      profile,
      candidates
    };
  }

  function validateConfig(raw) {
    const config = normalizeConfig(raw);
    const errors = [];

    for (const rule of config.rules) {
      const labelPrefix = `Rule “${rule.name}”`;
      for (const [label, selector] of [
        ["monitor", rule.monitor.selector],
        ["target", rule.target.selector],
        ["verify", rule.target.pipeline.verifySelector]
      ]) {
        if (label === "verify") {
          if (!rule.target.pipeline.verifyEnabled) {
            continue;
          }
          if (!selector.value) {
            errors.push(`${labelPrefix}, Verification selector: value is missing.`);
            continue;
          }
        }
        try {
          const css = selectorToCss(selector);
          if (typeof document !== "undefined") {
            document.createDocumentFragment().querySelector(css);
          }
        } catch (error) {
          errors.push(`${labelPrefix}, Selector ${label}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      if (rule.commandAction.enabled) {
        if (!rule.commandAction.presetId) {
          errors.push(`${labelPrefix}, command action: select an enabled command preset.`);
        }
      }

      for (const condition of rule.monitor.conditions) {
        if (!condition.enabled) {
          continue;
        }
        if (!condition.attribute) {
          errors.push(`${labelPrefix}, condition: attribute name is missing.`);
        }
        if (["regex", "not_regex"].includes(condition.operator)) {
          try {
            new RegExp(condition.value);
          } catch (_error) {
            errors.push(`${labelPrefix}, condition ${condition.attribute}: regex is invalid.`);
          }
        }
      }
    }

    return { ok: errors.length === 0, errors, config };
  }

  const PROFILE_BUNDLE_FORMAT = "firefox-chat-improver-profile-bundle";
  const PROFILE_BUNDLE_VERSION = 1;
  const PROFILE_TYPES = new Set(["configuration", "monitor", "target", "local-action"]);

  function buildProfileBundle(type, profiles, metadata = {}) {
    if (!PROFILE_TYPES.has(type)) throw new Error(`Unsupported profile type: ${type}.`);
    return {
      format: PROFILE_BUNDLE_FORMAT,
      version: PROFILE_BUNDLE_VERSION,
      profileType: type,
      exportedAt: safeString(metadata.exportedAt, nowIso()),
      defaultProfileId: safeString(metadata.defaultProfileId),
      profiles: clone(Array.isArray(profiles) ? profiles : [])
    };
  }

  function parseProfileBundle(text, expectedType = null) {
    const source = JSON.parse(text);
    if (!source || source.format !== PROFILE_BUNDLE_FORMAT || Number(source.version) !== PROFILE_BUNDLE_VERSION) {
      throw new Error("The selected JSON file is not a supported Firefox ChatAI Assistant profile bundle.");
    }
    const type = safeString(source.profileType).trim();
    if (!PROFILE_TYPES.has(type)) throw new Error(`Unsupported profile bundle type: ${type || "unknown"}.`);
    if (expectedType && type !== expectedType) {
      throw new Error(`This file contains ${type} profiles, not ${expectedType} profiles.`);
    }
    return {
      format: PROFILE_BUNDLE_FORMAT,
      version: PROFILE_BUNDLE_VERSION,
      profileType: type,
      exportedAt: safeString(source.exportedAt),
      defaultProfileId: safeString(source.defaultProfileId),
      profiles: Array.isArray(source.profiles) ? clone(source.profiles) : []
    };
  }

  function exportStore(store) {
    return JSON.stringify(normalizeStore(store), null, 2);
  }

  function importStore(text) {
    const parsed = JSON.parse(text);
    return normalizeStore(parsed);
  }

  Object.defineProperty(globalThis, "FCI_SETTINGS", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({
      SCHEMA_VERSION,
      STORAGE_KEY,
      DEFAULT_PROFILE_ID,
      DEFAULT_MONITOR_PROFILE_ID,
      DEFAULT_TARGET_PROFILE_ID,
      clone,
      nowIso,
      makeId,
      defaultConfig,
      defaultRule,
      defaultMonitorConfig,
      defaultTargetConfig,
      defaultCommandAction,
      defaultShellPreset,
      defaultNativeLogRetention,
      normalizeNativeLogRetention,
      defaultStore,
      normalizeConfig,
      normalizeRule,
      normalizeShellPreset,
      matchingShellPreset,
      configForRule,
      normalizeProfile,
      createMonitorProfile,
      normalizeMonitorProfile,
      monitorProfileById,
      createTargetProfile,
      normalizeTargetProfile,
      targetProfileById,
      normalizeStore,
      createProfile,
      profileById,
      selectorToCss,
      matchingUrlPatterns,
      profileRouteCandidates,
      routeProfile,
      urlAllowed,
      validateConfig,
      PROFILE_BUNDLE_FORMAT,
      PROFILE_BUNDLE_VERSION,
      buildProfileBundle,
      parseProfileBundle,
      exportStore,
      importStore
    })
  });
})();
