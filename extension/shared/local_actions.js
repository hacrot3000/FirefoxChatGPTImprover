(() => {
  "use strict";

  if (globalThis.FCI_LOCAL_ACTIONS?.SCHEMA_VERSION >= 1) {
    return;
  }

  const SCHEMA_VERSION = 1;
  const STORAGE_KEY = "firefoxChatImprover.localActions.v1";
  const DEFAULT_PROFILE_ID = "local-default";

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function text(value, fallback = "") {
    return typeof value === "string" ? value : fallback;
  }

  function bool(value, fallback = false) {
    return typeof value === "boolean" ? value : fallback;
  }

  function integer(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isInteger(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function makeId(prefix = "local-action") {
    const random = crypto.getRandomValues(new Uint32Array(2));
    return `${prefix}-${Date.now().toString(36)}-${random[0].toString(36)}${random[1].toString(36)}`;
  }

  function defaultCommandPreset(name = "Command preset", id = null) {
    return {
      id: id || makeId("local-command"),
      name,
      enabled: true,
      workingDirectory: "",
      command: "",
      mode: "background",
      confirmBeforeRun: true
    };
  }

  function defaultConfig() {
    return {
      routing: {
        enabled: true,
        priority: 0,
        urlPatterns: []
      },
      download: {
        enabled: false,
        destinationDirectory: "",
        captureWindowSeconds: 20,
        conflictAction: "uniquify",
        showCompletionDialog: true,
        executeShellAfterMove: false
      },
      shell: {
        workingDirectory: "",
        command: "",
        mode: "background",
        confirmBeforeRun: true,
        requirePresetMatch: false,
        rememberHistory: true,
        historyLimit: 20,
        selectedPresetId: "",
        presets: []
      }
    };
  }

  function normalizeCommandPreset(raw, index = 0) {
    const source = raw && typeof raw === "object" ? raw : {};
    const fallbackId = `local-command-${index + 1}`;
    return {
      id: text(source.id, fallbackId).trim() || fallbackId,
      name: text(source.name, `Command preset ${index + 1}`).trim() || `Command preset ${index + 1}`,
      enabled: bool(source.enabled, true),
      workingDirectory: text(source.workingDirectory).trim(),
      command: text(source.command),
      mode: source.mode === "terminal" ? "terminal" : "background",
      confirmBeforeRun: bool(source.confirmBeforeRun, true)
    };
  }

  function normalizeConfig(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const routing = source.routing && typeof source.routing === "object" ? source.routing : {};
    const download = source.download && typeof source.download === "object" ? source.download : {};
    const shell = source.shell && typeof source.shell === "object" ? source.shell : {};
    const rawPatterns = Array.isArray(routing.urlPatterns)
      ? routing.urlPatterns
      : text(routing.urlPatterns).split(/\r?\n/);
    const presets = [];
    const used = new Set();
    (Array.isArray(shell.presets) ? shell.presets : []).forEach((item, index) => {
      const preset = normalizeCommandPreset(item, index);
      let id = preset.id;
      let suffix = 2;
      while (used.has(id)) id = `${preset.id}-${suffix++}`;
      used.add(id);
      presets.push({ ...preset, id });
    });
    const requestedPresetId = text(shell.selectedPresetId).trim();
    return {
      routing: {
        enabled: bool(routing.enabled, true),
        priority: integer(routing.priority, 0, -1000, 1000),
        urlPatterns: [...new Set(rawPatterns.map((item) => text(item).trim()).filter(Boolean))]
      },
      download: {
        enabled: bool(download.enabled, false),
        destinationDirectory: text(download.destinationDirectory).trim(),
        captureWindowSeconds: integer(download.captureWindowSeconds, 20, 3, 300),
        conflictAction: ["uniquify", "overwrite", "fail"].includes(download.conflictAction)
          ? download.conflictAction
          : "uniquify",
        showCompletionDialog: bool(download.showCompletionDialog, true),
        executeShellAfterMove: bool(download.executeShellAfterMove, false)
      },
      shell: {
        workingDirectory: text(shell.workingDirectory).trim(),
        command: text(shell.command),
        mode: shell.mode === "terminal" ? "terminal" : "background",
        confirmBeforeRun: bool(shell.confirmBeforeRun, true),
        requirePresetMatch: bool(shell.requirePresetMatch, false),
        rememberHistory: bool(shell.rememberHistory, true),
        historyLimit: integer(shell.historyLimit, 20, 1, 100),
        selectedPresetId: presets.some((item) => item.id === requestedPresetId) ? requestedPresetId : "",
        presets
      }
    };
  }

  function createProfile(name = "Default local actions", config = null, id = null) {
    const stamp = nowIso();
    return {
      id: id || makeId("local-profile"),
      name: text(name, "Local actions").trim() || "Local actions",
      createdAt: stamp,
      updatedAt: stamp,
      config: normalizeConfig(config || defaultConfig())
    };
  }

  function normalizeProfile(raw, fallbackId = null) {
    const source = raw && typeof raw === "object" ? raw : {};
    const stamp = nowIso();
    return {
      id: text(source.id, fallbackId || makeId("local-profile")).trim() || makeId("local-profile"),
      name: text(source.name, "Local actions").trim() || "Local actions",
      createdAt: text(source.createdAt, stamp),
      updatedAt: text(source.updatedAt, stamp),
      config: normalizeConfig(source.config)
    };
  }

  function fromLegacyShell(rawShell) {
    const shell = rawShell && typeof rawShell === "object" ? rawShell : {};
    return normalizeConfig({ shell });
  }

  function defaultStore(legacyShell = null) {
    const profile = createProfile(
      "Default local actions",
      legacyShell ? fromLegacyShell(legacyShell) : defaultConfig(),
      DEFAULT_PROFILE_ID
    );
    return {
      schemaVersion: SCHEMA_VERSION,
      revision: 1,
      defaultProfileId: DEFAULT_PROFILE_ID,
      profiles: [profile]
    };
  }

  function normalizeStore(raw, legacyShell = null) {
    const source = raw && typeof raw === "object" ? raw : {};
    const profiles = [];
    const used = new Set();
    for (const candidate of Array.isArray(source.profiles) ? source.profiles : []) {
      const profile = normalizeProfile(candidate);
      if (!used.has(profile.id)) {
        used.add(profile.id);
        profiles.push(profile);
      }
    }
    if (!profiles.length) return defaultStore(legacyShell);
    let defaultProfileId = text(source.defaultProfileId).trim();
    if (!used.has(defaultProfileId)) defaultProfileId = profiles[0].id;
    return {
      schemaVersion: SCHEMA_VERSION,
      revision: integer(source.revision, 1, 1, Number.MAX_SAFE_INTEGER),
      defaultProfileId,
      profiles
    };
  }

  function profileById(store, profileId) {
    return normalizeStore(store).profiles.find((profile) => profile.id === profileId) || null;
  }

  function wildcardToRegExp(pattern) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
    return new RegExp(`^${escaped}$`, "i");
  }

  function matchingPatterns(config, url) {
    const value = normalizeConfig(config);
    if (!value.routing.urlPatterns.length || typeof url !== "string") return [];
    return value.routing.urlPatterns.filter((pattern) => {
      try {
        return wildcardToRegExp(pattern).test(url);
      } catch (_error) {
        return false;
      }
    });
  }

  function specificity(pattern) {
    const raw = text(pattern);
    return (raw.includes("*") ? 0 : 10000) + raw.replaceAll("*", "").length - (raw.match(/\*/g) || []).length * 8;
  }

  function routeProfile(rawStore, url) {
    const store = normalizeStore(rawStore);
    const candidates = [];
    store.profiles.forEach((profile, profileIndex) => {
      if (!profile.config.routing.enabled) return;
      const patterns = matchingPatterns(profile.config, url);
      if (!patterns.length) return;
      const bestPattern = [...patterns].sort((left, right) => specificity(right) - specificity(left))[0];
      candidates.push({
        profileId: profile.id,
        profileName: profile.name,
        priority: profile.config.routing.priority,
        specificity: specificity(bestPattern),
        bestPattern,
        profileIndex
      });
    });
    candidates.sort((left, right) =>
      right.priority - left.priority ||
      right.specificity - left.specificity ||
      left.profileIndex - right.profileIndex
    );
    const profileId = candidates[0]?.profileId || store.defaultProfileId;
    const profile = profileById(store, profileId) || store.profiles[0];
    return {
      profile,
      profileId: profile?.id || null,
      profileName: profile?.name || null,
      matched: candidates.length > 0,
      candidates
    };
  }

  function matchingPreset(rawConfig, rawCommand) {
    const config = normalizeConfig(rawConfig);
    const command = rawCommand && typeof rawCommand === "object" ? rawCommand : {};
    const cwd = text(command.workingDirectory ?? command.cwd).trim();
    const value = text(command.command);
    const mode = command.mode === "terminal" ? "terminal" : "background";
    return config.shell.presets.find((preset) =>
      preset.enabled && preset.workingDirectory === cwd && preset.command === value && preset.mode === mode
    ) || null;
  }

  function createExecutionSnapshot(rawConfig) {
    const config = normalizeConfig(rawConfig);
    return {
      snapshotVersion: 1,
      download: clone(config.download),
      shell: clone(config.shell)
    };
  }

  function normalizeExecutionSnapshot(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    return createExecutionSnapshot({
      download: source.download,
      shell: source.shell
    });
  }

  function configFingerprint(rawConfig) {
    return JSON.stringify(normalizeConfig(rawConfig));
  }

  function validateConfig(raw) {
    const config = normalizeConfig(raw);
    const errors = [];
    if (config.download.enabled && !config.download.destinationDirectory.startsWith("/")) {
      errors.push("Download destination must be an absolute path.");
    }
    for (const preset of config.shell.presets) {
      if (!preset.enabled) continue;
      if (!preset.workingDirectory.startsWith("/")) {
        errors.push(`Command preset “${preset.name}”: working directory must be an absolute path.`);
      }
      if (!preset.command.trim()) {
        errors.push(`Command preset “${preset.name}”: command is empty.`);
      }
    }
    if (config.shell.workingDirectory && !config.shell.workingDirectory.startsWith("/")) {
      errors.push("Shell working directory must be an absolute path.");
    }
    return { ok: errors.length === 0, errors, config };
  }

  Object.defineProperty(globalThis, "FCI_LOCAL_ACTIONS", {
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
      defaultCommandPreset,
      defaultConfig,
      normalizeCommandPreset,
      normalizeConfig,
      createProfile,
      normalizeProfile,
      defaultStore,
      normalizeStore,
      profileById,
      routeProfile,
      matchingPreset,
      createExecutionSnapshot,
      normalizeExecutionSnapshot,
      configFingerprint,
      validateConfig
    })
  });
})();
