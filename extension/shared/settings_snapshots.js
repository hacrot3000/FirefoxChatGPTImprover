(() => {
  "use strict";

  if (globalThis.FCI_SETTINGS_SNAPSHOTS?.VERSION >= 5) {
    return;
  }

  const Settings = globalThis.FCI_SETTINGS;
  const ConfigurationBundle = globalThis.FCI_CONFIGURATION_BUNDLE || null;
  const VERSION = 5;
  const STORAGE_KEY = "firefoxChatImprover.settingsSnapshots.v1";
  const MAX_SNAPSHOTS = 20;

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function safeString(value, fallback = "") {
    return typeof value === "string" ? value : fallback;
  }

  function canonicalStore(rawStore) {
    const store = Settings.normalizeStore(rawStore);
    return {
      defaultProfileId: store.defaultProfileId,
      profiles: store.profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        createdAt: profile.createdAt,
        config: profile.config
      }))
    };
  }

  function storeFingerprint(rawStore) {
    return JSON.stringify(canonicalStore(rawStore));
  }

  function makeId(now = Date.now()) {
    const random = globalThis.crypto?.getRandomValues
      ? globalThis.crypto.getRandomValues(new Uint32Array(2))
      : new Uint32Array([Math.floor(Math.random() * 0xffffffff), Math.floor(Math.random() * 0xffffffff)]);
    return `snapshot-${Number(now).toString(36)}-${random[0].toString(36)}${random[1].toString(36)}`;
  }

  function makeSnapshot(rawStore, reason = "manual", label = "Manual snapshot", options = {}) {
    const store = Settings.normalizeStore(rawStore);
    const configurationBundle = options.configurationBundle && ConfigurationBundle
      ? ConfigurationBundle.normalizeBundle(options.configurationBundle)
      : null;
    return {
      id: safeString(options.id).trim() || makeId(options.now),
      createdAt: safeString(options.createdAt).trim() || new Date(options.now || Date.now()).toISOString(),
      reason: safeString(reason, "manual").trim() || "manual",
      label: safeString(label, "Settings snapshot").trim() || "Settings snapshot",
      scope: configurationBundle ? "all-configuration" : "legacy-automation-only",
      fingerprint: configurationBundle && ConfigurationBundle
        ? ConfigurationBundle.fingerprint(configurationBundle)
        : storeFingerprint(store),
      store,
      configurationBundle
    };
  }

  function normalizeSnapshot(raw, index = 0) {
    const source = raw && typeof raw === "object" ? raw : {};
    let configurationBundle = null;
    if (source.configurationBundle && ConfigurationBundle) {
      try {
        configurationBundle = ConfigurationBundle.normalizeBundle(source.configurationBundle);
      } catch (_error) {
        configurationBundle = null;
      }
    }
    const store = configurationBundle
      ? Settings.normalizeStore(configurationBundle.automationStore)
      : Settings.normalizeStore(source.store);
    const createdAt = safeString(source.createdAt).trim() || new Date(0).toISOString();
    return {
      id: safeString(source.id).trim() || `snapshot-imported-${index + 1}`,
      createdAt,
      reason: safeString(source.reason, "imported").trim() || "imported",
      label: safeString(source.label, `Snapshot ${index + 1}`).trim() || `Snapshot ${index + 1}`,
      scope: configurationBundle ? "all-configuration" : "legacy-automation-only",
      fingerprint: configurationBundle && ConfigurationBundle
        ? ConfigurationBundle.fingerprint(configurationBundle)
        : storeFingerprint(store),
      store,
      configurationBundle
    };
  }

  function normalizeCollectionPhase63Base(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const seenIds = new Set();
    const candidates = [];
    for (const [index, candidate] of (Array.isArray(source.snapshots) ? source.snapshots : []).entries()) {
      const snapshot = normalizeSnapshot(candidate, index);
      if (seenIds.has(snapshot.id)) {
        continue;
      }
      seenIds.add(snapshot.id);
      candidates.push(snapshot);
    }
    candidates.sort((left, right) => right.createdAt.localeCompare(left.createdAt));

    // Snapshot creation has always treated equal fingerprints as duplicates. Re-apply
    // that rule while loading so collections produced by older full-bundle fingerprints
    // are compacted after volatile revision/timestamp fields stop affecting identity.
    const seenFingerprints = new Set();
    const snapshots = [];
    for (const snapshot of candidates) {
      if (seenFingerprints.has(snapshot.fingerprint)) {
        continue;
      }
      seenFingerprints.add(snapshot.fingerprint);
      snapshots.push(snapshot);
      if (snapshots.length >= MAX_SNAPSHOTS) {
        break;
      }
    }
    return {
      version: VERSION,
      snapshots
    };
  }

  function normalizeCollection(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const candidates = (Array.isArray(source.snapshots) ? source.snapshots : [])
      .map((candidate, index) => normalizeSnapshot(candidate, index))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

    // Phase 64: preselect semantic duplicates before the existing normalizer.
    // Manual intent beats automatic safety snapshots. Because candidates are
    // newest-first, duplicates within the same class naturally keep the newest.
    const byFingerprint = new Map();
    for (const snapshot of candidates) {
      const existing = byFingerprint.get(snapshot.fingerprint);
      if (!existing || (existing.reason !== "manual" && snapshot.reason === "manual")) {
        byFingerprint.set(snapshot.fingerprint, snapshot);
      }
    }
    const selected = Array.from(byFingerprint.values())
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return normalizeCollectionPhase63Base({ ...source, snapshots: selected });
  }

  function addSnapshot(rawCollection, rawSnapshot) {
    const collection = normalizeCollection(rawCollection);
    const snapshot = normalizeSnapshot(rawSnapshot);
    const existing = collection.snapshots.find((item) => item.fingerprint === snapshot.fingerprint);
    if (existing) {
      const shouldPromoteManual = snapshot.reason === "manual" && existing.reason !== "manual";
      if (shouldPromoteManual) {
        const withoutExisting = collection.snapshots.filter((item) => item.id !== existing.id);
        return {
          collection: normalizeCollection({ snapshots: [snapshot, ...withoutExisting] }),
          snapshot,
          added: true,
          promoted: true
        };
      }
      return {
        collection,
        snapshot: existing,
        added: false,
        promoted: false
      };
    }
    return {
      collection: normalizeCollection({ snapshots: [snapshot, ...collection.snapshots] }),
      snapshot,
      added: true,
      promoted: false
    };
  }

  function removeSnapshot(rawCollection, snapshotId) {
    const collection = normalizeCollection(rawCollection);
    return normalizeCollection({
      snapshots: collection.snapshots.filter((snapshot) => snapshot.id !== snapshotId)
    });
  }

  function findSnapshot(rawCollection, snapshotId) {
    return normalizeCollection(rawCollection).snapshots.find((snapshot) => snapshot.id === snapshotId) || null;
  }

  function summary(rawSnapshot) {
    const snapshot = normalizeSnapshot(rawSnapshot);
    const bundle = snapshot.configurationBundle;
    return {
      id: snapshot.id,
      createdAt: snapshot.createdAt,
      reason: snapshot.reason,
      label: snapshot.label,
      scope: snapshot.scope,
      revision: snapshot.store.revision,
      profileCount: snapshot.store.profiles.length,
      defaultProfileId: snapshot.store.defaultProfileId,
      localActionProfileCount: bundle?.localActionStore?.profiles?.length || 0,
      commandPresetCount: bundle?.commandPresetStore?.presets?.length || 0,
      customPromptTemplateCount: bundle?.promptTemplateStore?.customTemplates?.length || 0
    };
  }

  Object.defineProperty(globalThis, "FCI_SETTINGS_SNAPSHOTS", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({
      VERSION,
      STORAGE_KEY,
      MAX_SNAPSHOTS,
      clone,
      canonicalStore,
      storeFingerprint,
      makeSnapshot,
      normalizeSnapshot,
      normalizeCollection,
      addSnapshot,
      removeSnapshot,
      findSnapshot,
      summary
    })
  });
})();
