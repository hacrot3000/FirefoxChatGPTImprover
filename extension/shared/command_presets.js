(() => {
  "use strict";

  if (globalThis.FCI_COMMAND_PRESETS?.SCHEMA_VERSION >= 1) return;

  const SCHEMA_VERSION = 1;
  const STORAGE_KEY = "firefoxChatImprover.commandPresets.v1";

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function text(value, fallback = "") {
    return typeof value === "string" ? value : fallback;
  }

  function makeId(prefix = "command-preset") {
    const random = crypto.getRandomValues(new Uint32Array(2));
    return `${prefix}-${Date.now().toString(36)}-${random[0].toString(36)}${random[1].toString(36)}`;
  }

  function normalizePreset(raw, index = 0) {
    const source = raw && typeof raw === "object" ? raw : {};
    const fallbackId = `command-preset-${index + 1}`;
    return {
      id: text(source.id, fallbackId).trim() || fallbackId,
      name: text(source.name, `Command preset ${index + 1}`).trim() || `Command preset ${index + 1}`,
      enabled: source.enabled !== false,
      workingDirectory: text(source.workingDirectory ?? source.cwd).trim(),
      command: text(source.command),
      mode: source.mode === "terminal" ? "terminal" : "background",
      confirmBeforeRun: source.confirmBeforeRun !== false,
      updatedAt: text(source.updatedAt, new Date().toISOString())
    };
  }

  function defaultStore() {
    return { schemaVersion: SCHEMA_VERSION, revision: 1, presets: [] };
  }

  function normalizeStore(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const presets = [];
    const used = new Set();
    (Array.isArray(source.presets) ? source.presets : []).forEach((item, index) => {
      const preset = normalizePreset(item, index);
      let id = preset.id;
      let suffix = 2;
      while (used.has(id)) id = `${preset.id}-${suffix++}`;
      used.add(id);
      presets.push({ ...preset, id });
    });
    return {
      schemaVersion: SCHEMA_VERSION,
      revision: Number.isInteger(source.revision) && source.revision > 0 ? source.revision : 1,
      presets
    };
  }

  function fingerprint(rawPreset) {
    const preset = normalizePreset(rawPreset);
    return JSON.stringify({
      name: preset.name,
      enabled: preset.enabled,
      workingDirectory: preset.workingDirectory,
      command: preset.command,
      mode: preset.mode,
      confirmBeforeRun: preset.confirmBeforeRun
    });
  }

  function mergeLegacy(rawStore, rawLocalActionStore) {
    const store = normalizeStore(rawStore);
    const seen = new Set(store.presets.map(fingerprint));
    const added = [];
    const profiles = Array.isArray(rawLocalActionStore?.profiles) ? rawLocalActionStore.profiles : [];
    for (const profile of profiles) {
      const legacy = Array.isArray(profile?.config?.shell?.presets) ? profile.config.shell.presets : [];
      for (const candidate of legacy) {
        const preset = normalizePreset(candidate, store.presets.length + added.length);
        const key = fingerprint(preset);
        if (!seen.has(key)) {
          seen.add(key);
          added.push({ ...preset, id: makeId("command-preset") });
        }
      }
    }
    return added.length
      ? { schemaVersion: SCHEMA_VERSION, revision: store.revision + 1, presets: [...store.presets, ...added] }
      : store;
  }

  function upsert(rawStore, rawPreset) {
    const store = normalizeStore(rawStore);
    const preset = normalizePreset({ ...rawPreset, updatedAt: new Date().toISOString() }, store.presets.length);
    const id = preset.id || makeId("command-preset");
    const existing = store.presets.some((item) => item.id === id);
    return {
      store: {
        schemaVersion: SCHEMA_VERSION,
        revision: store.revision + 1,
        presets: existing
          ? store.presets.map((item) => item.id === id ? { ...preset, id } : item)
          : [...store.presets, { ...preset, id }]
      },
      preset: { ...preset, id }
    };
  }

  function remove(rawStore, presetId) {
    const store = normalizeStore(rawStore);
    const presets = store.presets.filter((item) => item.id !== presetId);
    return presets.length === store.presets.length
      ? store
      : { schemaVersion: SCHEMA_VERSION, revision: store.revision + 1, presets };
  }

  Object.defineProperty(globalThis, "FCI_COMMAND_PRESETS", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({
      SCHEMA_VERSION,
      STORAGE_KEY,
      clone,
      makeId,
      normalizePreset,
      defaultStore,
      normalizeStore,
      fingerprint,
      mergeLegacy,
      upsert,
      remove
    })
  });
})();
