(() => {
  "use strict";

  if (globalThis.FCI_WORKING_SESSION?.VERSION >= 2) {
    return;
  }

  const FORMAT = "firefox-chat-assistant-working-session";
  const VERSION = 2;
  const MAX_TABS = 200;

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function safeString(value, fallback = "") {
    return typeof value === "string" ? value : fallback;
  }

  function isSupportedUrl(rawUrl) {
    try {
      const url = new URL(safeString(rawUrl));
      return url.protocol === "http:" || url.protocol === "https:";
    } catch (_error) {
      return false;
    }
  }

  function cleanTitle(rawTitle) {
    let title = safeString(rawTitle).trim();
    const prefixes = [
      /^\s*\[(?:READY|RUNNING|WAITING|MATCHED|PAUSED|ERROR)\]\s*/i,
      /^\s*(?:READY|RUNNING|WAITING|MATCHED|PAUSED|ERROR)\s*[:\-–—]\s*/i,
      /^\s*[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s*/u,
      /^\s*⚠\s*/u
    ];
    let changed = true;
    while (changed && title) {
      changed = false;
      for (const pattern of prefixes) {
        const next = title.replace(pattern, "").trim();
        if (next !== title) {
          title = next;
          changed = true;
        }
      }
    }
    return title;
  }

  function configFingerprint(rawConfig) {
    const Settings = globalThis.FCI_SETTINGS;
    const normalized = Settings?.normalizeConfig
      ? Settings.normalizeConfig(rawConfig)
      : clone(rawConfig || {});
    return JSON.stringify(normalized);
  }

  function localActionConfigFingerprint(rawConfig) {
    const LocalActions = globalThis.FCI_LOCAL_ACTIONS;
    const normalized = LocalActions?.normalizeConfig
      ? LocalActions.normalizeConfig(rawConfig)
      : clone(rawConfig || {});
    return JSON.stringify(normalized);
  }

  function normalizeLocalActionProfile(rawProfile, fallbackId = null) {
    const LocalActions = globalThis.FCI_LOCAL_ACTIONS;
    if (LocalActions?.normalizeProfile) {
      return LocalActions.normalizeProfile(rawProfile, fallbackId);
    }
    const source = rawProfile && typeof rawProfile === "object" ? rawProfile : {};
    return {
      id: safeString(source.id, fallbackId || "local-profile"),
      name: safeString(source.name, "Local actions"),
      config: clone(source.config || {})
    };
  }

  function normalizeProfile(rawProfile, fallbackId = null) {
    const Settings = globalThis.FCI_SETTINGS;
    if (Settings?.normalizeProfile) {
      return Settings.normalizeProfile(rawProfile, fallbackId);
    }
    const source = rawProfile && typeof rawProfile === "object" ? rawProfile : {};
    return {
      id: safeString(source.id, fallbackId || "profile"),
      name: safeString(source.name, "Profile"),
      config: clone(source.config || {})
    };
  }

  function normalizeTab(rawTab, index = 0) {
    const Settings = globalThis.FCI_SETTINGS;
    const source = rawTab && typeof rawTab === "object" ? rawTab : {};
    const url = safeString(source.url).trim();
    if (!isSupportedUrl(url)) {
      throw new Error(`Working session tab ${index + 1} has an unsupported URL.`);
    }
    const configMode = source.configMode === "tab" ? "tab" : "profile";
    const effectiveConfig = Settings?.normalizeConfig
      ? Settings.normalizeConfig(source.effectiveConfig || source.tabConfig || source.profile?.config)
      : clone(source.effectiveConfig || source.tabConfig || source.profile?.config || {});
    return {
      sourceTabId: Number.isInteger(Number(source.sourceTabId)) ? Number(source.sourceTabId) : null,
      url,
      title: cleanTitle(source.title),
      addOnActive: source.addOnActive === true,
      mode: source.mode === "paused" ? "paused" : (source.mode === "active" ? "active" : "inactive"),
      profileId: safeString(source.profileId),
      profile: normalizeProfile(source.profile || {}, safeString(source.profileId) || null),
      configMode,
      tabConfig: configMode === "tab" && Settings?.normalizeConfig
        ? Settings.normalizeConfig(source.tabConfig || effectiveConfig)
        : (configMode === "tab" ? clone(source.tabConfig || effectiveConfig) : null),
      effectiveConfig,
      localActionProfileId: safeString(source.localActionProfileId),
      localActionProfile: normalizeLocalActionProfile(source.localActionProfile || {}, safeString(source.localActionProfileId) || null),
      localActionConfigMode: source.localActionConfigMode === "tab" ? "tab" : "profile",
      localActionTabConfig: source.localActionConfigMode === "tab"
        ? (globalThis.FCI_LOCAL_ACTIONS?.normalizeConfig
          ? globalThis.FCI_LOCAL_ACTIONS.normalizeConfig(source.localActionTabConfig || source.effectiveLocalActions || source.localActionProfile?.config)
          : clone(source.localActionTabConfig || source.effectiveLocalActions || source.localActionProfile?.config || {}))
        : null,
      effectiveLocalActions: globalThis.FCI_LOCAL_ACTIONS?.normalizeConfig
        ? globalThis.FCI_LOCAL_ACTIONS.normalizeConfig(source.effectiveLocalActions || source.localActionTabConfig || source.localActionProfile?.config)
        : clone(source.effectiveLocalActions || source.localActionTabConfig || source.localActionProfile?.config || {})
    };
  }

  function build(rawTabs, metadata = {}) {
    const tabs = (Array.isArray(rawTabs) ? rawTabs : [])
      .slice(0, MAX_TABS)
      .map(normalizeTab);
    if (!tabs.length) {
      throw new Error("Select at least one tab to save in the working session.");
    }
    return {
      format: FORMAT,
      version: VERSION,
      exportedAt: safeString(metadata.exportedAt, new Date().toISOString()),
      extensionVersion: safeString(metadata.extensionVersion),
      tabs
    };
  }

  function normalize(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    if (source.format !== FORMAT) {
      throw new Error("The selected JSON file is not a Firefox ChatAI Assistant working session.");
    }
    if (![1, VERSION].includes(Number(source.version))) {
      throw new Error(`Unsupported working session version: ${source.version}.`);
    }
    return build(source.tabs, {
      exportedAt: safeString(source.exportedAt),
      extensionVersion: safeString(source.extensionVersion)
    });
  }

  function parse(text) {
    return normalize(JSON.parse(String(text || "")));
  }

  function stringify(bundle) {
    return JSON.stringify(normalize(bundle), null, 2);
  }

  function requiredOrigins(bundle) {
    const origins = new Set();
    for (const tab of normalize(bundle).tabs) {
      const url = new URL(tab.url);
      origins.add(`${url.protocol}//${url.host}/*`);
    }
    return [...origins].sort();
  }

  Object.defineProperty(globalThis, "FCI_WORKING_SESSION", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({
      FORMAT,
      VERSION,
      MAX_TABS,
      clone,
      cleanTitle,
      isSupportedUrl,
      configFingerprint,
      localActionConfigFingerprint,
      normalizeTab,
      build,
      normalize,
      parse,
      stringify,
      requiredOrigins
    })
  });
})();
