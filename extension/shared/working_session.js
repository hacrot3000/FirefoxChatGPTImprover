(() => {
  "use strict";

  if (globalThis.FCI_WORKING_SESSION?.VERSION >= 4) {
    return;
  }

  const FORMAT = "firefox-chat-assistant-working-session";
  const VERSION = 4;
  const MAX_TABS = 200;
  const CATALOG_FORMAT = "firefox-chat-assistant-working-session-catalog";
  const CATALOG_VERSION = 1;
  const CATALOG_STORAGE_KEY = "firefoxChatImprover.workingSessionCatalog.v1";
  const MAX_CATALOG_ENTRIES = 100;

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function safeString(value, fallback = "") {
    return typeof value === "string" ? value : fallback;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function makeId(prefix = "working-session") {
    try {
      const random = crypto.getRandomValues(new Uint32Array(2));
      return `${prefix}-${Date.now().toString(36)}-${random[0].toString(36)}${random[1].toString(36)}`;
    } catch (_error) {
      return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
    }
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
      customTitle: safeString(source.customTitle).trim().slice(0, 240),
      pageTitle: cleanTitle(source.pageTitle || source.title),
      title: cleanTitle(source.customTitle || source.title),
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
      exportedAt: safeString(metadata.exportedAt, nowIso()),
      extensionVersion: safeString(metadata.extensionVersion),
      tabs
    };
  }

  function normalize(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    if (source.format !== FORMAT) {
      throw new Error("The selected JSON file is not a Firefox ChatAI Assistant working session.");
    }
    if (![1, 2, 3, VERSION].includes(Number(source.version))) {
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

  function sessionFingerprint(bundle) {
    return JSON.stringify(normalize(bundle));
  }

  function defaultCatalog() {
    return {
      format: CATALOG_FORMAT,
      version: CATALOG_VERSION,
      updatedAt: nowIso(),
      entries: []
    };
  }

  function createCatalogEntry(name, bundle, metadata = {}) {
    const normalizedBundle = normalize(bundle);
    const timestamp = nowIso();
    return {
      id: safeString(metadata.id).trim() || makeId("saved-session"),
      name: safeString(name, "Saved working session").trim().slice(0, 120) || "Saved working session",
      description: safeString(metadata.description).trim().slice(0, 500),
      createdAt: safeString(metadata.createdAt, timestamp),
      updatedAt: safeString(metadata.updatedAt, timestamp),
      lastRestoredAt: safeString(metadata.lastRestoredAt),
      bundle: normalizedBundle
    };
  }

  function normalizeCatalogEntry(rawEntry, index = 0) {
    const source = rawEntry && typeof rawEntry === "object" ? rawEntry : {};
    return createCatalogEntry(source.name || `Saved working session ${index + 1}`, source.bundle || source.session, {
      id: source.id,
      description: source.description,
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
      lastRestoredAt: source.lastRestoredAt
    });
  }

  function normalizeCatalog(rawCatalog) {
    const source = rawCatalog && typeof rawCatalog === "object" ? rawCatalog : {};
    const entries = (Array.isArray(source.entries) ? source.entries : [])
      .slice(0, MAX_CATALOG_ENTRIES)
      .map(normalizeCatalogEntry);
    const seen = new Set();
    for (const entry of entries) {
      if (seen.has(entry.id)) entry.id = makeId("saved-session");
      seen.add(entry.id);
    }
    return {
      format: CATALOG_FORMAT,
      version: CATALOG_VERSION,
      updatedAt: safeString(source.updatedAt, nowIso()),
      entries
    };
  }

  function parseCatalog(text) {
    const raw = JSON.parse(String(text || ""));
    if (raw?.format !== CATALOG_FORMAT) {
      throw new Error("The selected JSON file is not a Firefox ChatAI Assistant saved-session catalog.");
    }
    if (Number(raw.version) !== CATALOG_VERSION) {
      throw new Error(`Unsupported saved-session catalog version: ${raw.version}.`);
    }
    return normalizeCatalog(raw);
  }

  function stringifyCatalog(catalog) {
    return JSON.stringify(normalizeCatalog(catalog), null, 2);
  }

  function catalogEntryById(catalog, entryId) {
    return normalizeCatalog(catalog).entries.find((entry) => entry.id === String(entryId || "")) || null;
  }

  function upsertCatalogEntry(catalog, rawEntry) {
    const normalized = normalizeCatalog(catalog);
    const incoming = normalizeCatalogEntry(rawEntry);
    const index = normalized.entries.findIndex((entry) => entry.id === incoming.id);
    if (index >= 0) {
      incoming.createdAt = normalized.entries[index].createdAt;
      incoming.updatedAt = nowIso();
      normalized.entries[index] = incoming;
    } else {
      normalized.entries.unshift(incoming);
      normalized.entries = normalized.entries.slice(0, MAX_CATALOG_ENTRIES);
    }
    normalized.updatedAt = nowIso();
    return normalized;
  }

  function removeCatalogEntry(catalog, entryId) {
    const normalized = normalizeCatalog(catalog);
    normalized.entries = normalized.entries.filter((entry) => entry.id !== String(entryId || ""));
    normalized.updatedAt = nowIso();
    return normalized;
  }

  function duplicateCatalogEntry(catalog, entryId, name = "") {
    const normalized = normalizeCatalog(catalog);
    const source = normalized.entries.find((entry) => entry.id === String(entryId || ""));
    if (!source) throw new Error("The selected saved working session no longer exists.");
    const copy = createCatalogEntry(name || `${source.name} - copy`, source.bundle, {
      description: source.description
    });
    normalized.entries.unshift(copy);
    normalized.entries = normalized.entries.slice(0, MAX_CATALOG_ENTRIES);
    normalized.updatedAt = nowIso();
    return { catalog: normalized, entry: copy };
  }

  function mergeCatalog(existingCatalog, importedCatalog) {
    const current = normalizeCatalog(existingCatalog);
    const imported = normalizeCatalog(importedCatalog);
    const report = { created: 0, updated: 0, renamed: 0, total: imported.entries.length };
    for (const rawEntry of imported.entries.slice().reverse()) {
      let entry = normalizeCatalogEntry(rawEntry);
      const byId = current.entries.find((candidate) => candidate.id === entry.id);
      if (byId && sessionFingerprint(byId.bundle) === sessionFingerprint(entry.bundle)) {
        entry.createdAt = byId.createdAt;
        current.entries[current.entries.indexOf(byId)] = entry;
        report.updated += 1;
        continue;
      }
      if (byId) {
        entry = createCatalogEntry(`${entry.name} (imported)`, entry.bundle, {
          description: entry.description
        });
        report.renamed += 1;
      }
      current.entries.unshift(entry);
      report.created += 1;
    }
    current.entries = current.entries.slice(0, MAX_CATALOG_ENTRIES);
    current.updatedAt = nowIso();
    return { catalog: current, report };
  }

  function catalogSummary(rawCatalog) {
    const catalog = normalizeCatalog(rawCatalog);
    return {
      format: catalog.format,
      version: catalog.version,
      updatedAt: catalog.updatedAt,
      entries: catalog.entries.map((entry) => ({
        id: entry.id,
        name: entry.name,
        description: entry.description,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        lastRestoredAt: entry.lastRestoredAt,
        tabCount: entry.bundle.tabs.length,
        tabs: entry.bundle.tabs.map((tab, index) => ({
          index,
          title: cleanTitle(tab.customTitle || tab.title || tab.pageTitle),
          customTitle: tab.customTitle,
          pageTitle: tab.pageTitle,
          url: tab.url,
          addOnActive: tab.addOnActive,
          mode: tab.mode
        }))
      }))
    };
  }

  Object.defineProperty(globalThis, "FCI_WORKING_SESSION", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({
      FORMAT,
      VERSION,
      MAX_TABS,
      CATALOG_FORMAT,
      CATALOG_VERSION,
      CATALOG_STORAGE_KEY,
      MAX_CATALOG_ENTRIES,
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
      requiredOrigins,
      sessionFingerprint,
      makeId,
      defaultCatalog,
      createCatalogEntry,
      normalizeCatalogEntry,
      normalizeCatalog,
      parseCatalog,
      stringifyCatalog,
      catalogEntryById,
      upsertCatalogEntry,
      removeCatalogEntry,
      duplicateCatalogEntry,
      mergeCatalog,
      catalogSummary
    })
  });
})();
