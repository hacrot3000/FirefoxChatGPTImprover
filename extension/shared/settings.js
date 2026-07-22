(() => {
  "use strict";

  if (globalThis.FCI_SETTINGS?.SCHEMA_VERSION >= 7) {
    return;
  }

  const SCHEMA_VERSION = 7;
  // Keep the v2 storage key so existing profiles migrate in place.
  const STORAGE_KEY = "firefoxChatImprover.settings.v2";
  const DEFAULT_PROFILE_ID = "default";
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

  function defaultConfig() {
    return {
      activation: {
        requireUrlMatch: false,
        urlPatterns: []
      },
      monitor: {
        selector: defaultSelector("#composer-submit-button"),
        visibilityTransition: "none",
        conditionJoin: "all",
        conditions: [defaultCondition()]
      },
      target: {
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
        ]
      },
      alerts: {
        titleBlink: true,
        titlePrefix: "⚠ AI READY",
        blinkIntervalMs: 700,
        badge: true,
        sidebar: true,
        notification: false,
        dismissOnUserActivity: true,
        activeTabTimeoutSeconds: 10
      },
      shell: {
        workingDirectory: "",
        command: "",
        mode: "terminal",
        confirmBeforeRun: true
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

  function normalizeConfig(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const defaults = defaultConfig();
    const activation = source.activation || {};
    const monitor = source.monitor || {};
    const target = source.target || {};
    const alerts = source.alerts || {};
    const shell = source.shell || {};
    const patterns = Array.isArray(activation.urlPatterns)
      ? activation.urlPatterns
      : safeString(activation.urlPatterns).split(/\r?\n/);
    const fingerprintAttributes = Array.isArray(target.fingerprintAttributes)
      ? target.fingerprintAttributes
      : defaults.target.fingerprintAttributes;
    const conditions = Array.isArray(monitor.conditions)
      ? monitor.conditions.map(normalizeCondition)
      : defaults.monitor.conditions;
    const legacyVisibilityTransition = monitor.visibility === "visible"
      ? "hidden_to_visible"
      : (monitor.visibility === "hidden" ? "visible_to_hidden" : "none");
    const visibilityTransition = VISIBILITY_TRANSITIONS.has(monitor.visibilityTransition)
      ? monitor.visibilityTransition
      : legacyVisibilityTransition;

    return {
      activation: {
        requireUrlMatch: safeBoolean(activation.requireUrlMatch, false),
        urlPatterns: [...new Set(patterns.map((item) => safeString(item).trim()).filter(Boolean))]
      },
      monitor: {
        selector: normalizeSelector(monitor.selector, defaults.monitor.selector),
        visibilityTransition,
        conditionJoin: monitor.conditionJoin === "any" ? "any" : "all",
        conditions
      },
      target: {
        enabled: safeBoolean(target.enabled, false),
        selector: normalizeSelector(target.selector, defaults.target.selector),
        clickStrategy: ["oldest", "newest", "all"].includes(target.clickStrategy)
          ? target.clickStrategy
          : "newest",
        visibleOnly: safeBoolean(target.visibleOnly, true),
        enabledOnly: safeBoolean(target.enabledOnly, true),
        dryRun: safeBoolean(target.dryRun, true),
        maxClicksPerCycle: safeInteger(target.maxClicksPerCycle, 1, 1, 100),
        fingerprintAttributes: [...new Set(
          fingerprintAttributes.map((item) => safeString(item).trim()).filter(Boolean)
        )]
      },
      alerts: {
        titleBlink: safeBoolean(alerts.titleBlink, true),
        titlePrefix: safeString(alerts.titlePrefix, defaults.alerts.titlePrefix).trim() || defaults.alerts.titlePrefix,
        blinkIntervalMs: safeInteger(alerts.blinkIntervalMs, defaults.alerts.blinkIntervalMs, 250, 5000),
        badge: safeBoolean(alerts.badge, true),
        sidebar: safeBoolean(alerts.sidebar, true),
        notification: safeBoolean(alerts.notification, false),
        dismissOnUserActivity: safeBoolean(alerts.dismissOnUserActivity, true),
        activeTabTimeoutSeconds: safeInteger(alerts.activeTabTimeoutSeconds, defaults.alerts.activeTabTimeoutSeconds, 0, 3600)
      },
      shell: {
        workingDirectory: safeString(shell.workingDirectory).trim(),
        command: safeString(shell.command),
        mode: shell.mode === "background" ? "background" : "terminal",
        confirmBeforeRun: safeBoolean(shell.confirmBeforeRun, true)
      }
    };
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
        throw new Error("Selector ID chưa có giá trị.");
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
        throw new Error("Selector class chưa có giá trị.");
      }
      return `${tag}${classes.map((item) => `.${cssEscape(item)}`).join("")}`;
    }

    if (selector.kind === "attribute") {
      const name = selector.attributeName.trim();
      if (!name || !/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name)) {
        throw new Error("Tên attribute không hợp lệ.");
      }
      return selector.value
        ? `${tag}[${name}=${JSON.stringify(selector.value)}]`
        : `${tag}[${name}]`;
    }

    throw new Error("Kiểu selector không được hỗ trợ.");
  }

  function createProfile(name = "Mặc định", baseConfig = null, id = null) {
    const timestamp = nowIso();
    return {
      id: id || makeId(),
      name: safeString(name, "Profile mới").trim() || "Profile mới",
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
      name: safeString(source.name, "Profile").trim() || "Profile",
      createdAt: safeString(source.createdAt, timestamp),
      updatedAt: safeString(source.updatedAt, timestamp),
      config: normalizeConfig(source.config)
    };
  }

  function defaultStore() {
    const profile = createProfile("Mặc định", defaultConfig(), DEFAULT_PROFILE_ID);
    return {
      schemaVersion: SCHEMA_VERSION,
      revision: 1,
      defaultProfileId: DEFAULT_PROFILE_ID,
      profiles: [profile]
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
      return defaultStore();
    }

    let defaultProfileId = safeString(source.defaultProfileId);
    if (!used.has(defaultProfileId)) {
      defaultProfileId = profiles[0].id;
    }

    return {
      schemaVersion: SCHEMA_VERSION,
      revision: safeInteger(source.revision, 1, 1, Number.MAX_SAFE_INTEGER),
      defaultProfileId,
      profiles
    };
  }

  function profileById(store, profileId) {
    return store.profiles.find((profile) => profile.id === profileId) || null;
  }

  function wildcardToRegExp(pattern) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
    return new RegExp(`^${escaped}$`, "i");
  }

  function urlAllowed(config, url) {
    const activation = normalizeConfig(config).activation;
    if (!activation.requireUrlMatch) {
      return true;
    }
    if (!activation.urlPatterns.length || typeof url !== "string") {
      return false;
    }
    return activation.urlPatterns.some((pattern) => {
      try {
        return wildcardToRegExp(pattern).test(url);
      } catch (_error) {
        return false;
      }
    });
  }

  function validateConfig(raw) {
    const config = normalizeConfig(raw);
    const errors = [];

    for (const [label, selector] of [
      ["monitor", config.monitor.selector],
      ["target", config.target.selector]
    ]) {
      try {
        const css = selectorToCss(selector);
        if (typeof document !== "undefined") {
          document.createDocumentFragment().querySelector(css);
        }
      } catch (error) {
        errors.push(`Selector ${label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    for (const condition of config.monitor.conditions) {
      if (!condition.enabled) {
        continue;
      }
      if (!condition.attribute) {
        errors.push("Condition: thiếu tên attribute.");
      }
      if (["regex", "not_regex"].includes(condition.operator)) {
        try {
          new RegExp(condition.value);
        } catch (_error) {
          errors.push(`Condition ${condition.attribute}: regex không hợp lệ.`);
        }
      }
    }

    return { ok: errors.length === 0, errors, config };
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
      clone,
      nowIso,
      makeId,
      defaultConfig,
      defaultStore,
      normalizeConfig,
      normalizeProfile,
      normalizeStore,
      createProfile,
      profileById,
      selectorToCss,
      urlAllowed,
      validateConfig,
      exportStore,
      importStore
    })
  });
})();
