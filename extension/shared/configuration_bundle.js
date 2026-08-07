(() => {
  "use strict";

  if (globalThis.FCI_CONFIGURATION_BUNDLE?.VERSION >= 1) return;

  const Settings = globalThis.FCI_SETTINGS;
  const LocalActions = globalThis.FCI_LOCAL_ACTIONS;
  const CommandPresets = globalThis.FCI_COMMAND_PRESETS;
  const PromptTemplates = globalThis.FCI_PROMPT_TEMPLATES;

  const VERSION = 1;
  const FORMAT = "firefox-chat-improver-configuration";
  const SIDEBAR_UI_STORAGE_KEY = "firefoxChatImprover.sidebarUi.v1";
  const SIDEBAR_FEATURE_PRESETS = new Set(["simple", "standard", "full", "custom"]);

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function safeString(value, fallback = "") {
    return typeof value === "string" ? value : fallback;
  }

  function normalizeStringArray(raw, max = 64) {
    const output = [];
    const seen = new Set();
    for (const value of Array.isArray(raw) ? raw : []) {
      const text = safeString(value).trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      output.push(text.slice(0, 120));
      if (output.length >= max) break;
    }
    return output;
  }

  function normalizeCollapsedGroups(raw) {
    const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const output = {};
    let count = 0;
    for (const [key, value] of Object.entries(source)) {
      const id = safeString(key).trim().slice(0, 120);
      if (!id) continue;
      output[id] = Boolean(value);
      count += 1;
      if (count >= 64) break;
    }
    return output;
  }

  function normalizeSidebarPreferences(raw) {
    const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const requestedPreset = safeString(source.featurePreset, "standard").trim();
    return {
      collapsedGroups: normalizeCollapsedGroups(source.collapsedGroups),
      featurePreset: SIDEBAR_FEATURE_PRESETS.has(requestedPreset) ? requestedPreset : "standard",
      visibleFeatures: normalizeStringArray(source.visibleFeatures),
      autoProfileByUrl: source.autoProfileByUrl !== false
    };
  }

  function normalizeBundle(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    if (source.format !== FORMAT || Number(source.version) !== VERSION) {
      throw new Error("The selected JSON file is not a supported Firefox ChatAI Assistant full configuration bundle.");
    }
    return {
      format: FORMAT,
      version: VERSION,
      exportedAt: safeString(source.exportedAt),
      automationStore: Settings.normalizeStore(source.automationStore),
      localActionStore: LocalActions.normalizeStore(source.localActionStore),
      commandPresetStore: CommandPresets.normalizeStore(source.commandPresetStore),
      promptTemplateStore: PromptTemplates.normalizeStore(source.promptTemplateStore),
      sidebarPreferences: normalizeSidebarPreferences(source.sidebarPreferences)
    };
  }

  function build(raw = {}) {
    return normalizeBundle({
      format: FORMAT,
      version: VERSION,
      exportedAt: safeString(raw.exportedAt).trim() || new Date().toISOString(),
      automationStore: raw.automationStore,
      localActionStore: raw.localActionStore,
      commandPresetStore: raw.commandPresetStore,
      promptTemplateStore: raw.promptTemplateStore,
      sidebarPreferences: raw.sidebarPreferences
    });
  }

  function parse(text) {
    return normalizeBundle(JSON.parse(text));
  }

  function isBundle(raw) {
    return Boolean(raw && typeof raw === "object" && raw.format === FORMAT && Number(raw.version) === VERSION);
  }

  function canonicalAutomationStore(rawStore) {
    const store = Settings.normalizeStore(rawStore);
    return {
      schemaVersion: store.schemaVersion,
      defaultProfileId: store.defaultProfileId,
      defaultMonitorProfileId: store.defaultMonitorProfileId,
      defaultTargetProfileId: store.defaultTargetProfileId,
      nativeLogRetention: store.nativeLogRetention,
      profiles: store.profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        config: profile.config
      })),
      monitorProfiles: store.monitorProfiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        monitor: profile.monitor
      })),
      targetProfiles: store.targetProfiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        target: profile.target
      }))
    };
  }

  function canonicalLocalActionStore(rawStore) {
    const store = LocalActions.normalizeStore(rawStore);
    return {
      schemaVersion: store.schemaVersion,
      defaultProfileId: store.defaultProfileId,
      profiles: store.profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        config: profile.config
      }))
    };
  }

  function canonicalCommandPresetStore(rawStore) {
    const store = CommandPresets.normalizeStore(rawStore);
    return {
      schemaVersion: store.schemaVersion,
      presets: store.presets.map((preset) => ({
        id: preset.id,
        name: preset.name,
        enabled: preset.enabled,
        workingDirectory: preset.workingDirectory,
        command: preset.command,
        mode: preset.mode,
        confirmBeforeRun: preset.confirmBeforeRun
      }))
    };
  }

  function canonicalPromptTemplateStore(rawStore) {
    const store = PromptTemplates.normalizeStore(rawStore);
    return {
      schema: store.schema,
      customTemplates: store.customTemplates.map((template) => ({
        id: template.id,
        name: template.name,
        prompt: template.prompt
      }))
    };
  }

  function canonical(raw) {
    const bundle = normalizeBundle(raw);
    return {
      format: bundle.format,
      version: bundle.version,
      automationStore: canonicalAutomationStore(bundle.automationStore),
      localActionStore: canonicalLocalActionStore(bundle.localActionStore),
      commandPresetStore: canonicalCommandPresetStore(bundle.commandPresetStore),
      promptTemplateStore: canonicalPromptTemplateStore(bundle.promptTemplateStore),
      sidebarPreferences: bundle.sidebarPreferences
    };
  }

  function fingerprint(raw) {
    return JSON.stringify(canonical(raw));
  }

  function stringify(raw) {
    return JSON.stringify(normalizeBundle(raw), null, 2);
  }

  Object.defineProperty(globalThis, "FCI_CONFIGURATION_BUNDLE", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({
      VERSION,
      FORMAT,
      SIDEBAR_UI_STORAGE_KEY,
      clone,
      normalizeSidebarPreferences,
      normalizeBundle,
      build,
      parse,
      isBundle,
      canonicalAutomationStore,
      canonicalLocalActionStore,
      canonicalCommandPresetStore,
      canonicalPromptTemplateStore,
      canonical,
      fingerprint,
      stringify
    })
  });
})();
