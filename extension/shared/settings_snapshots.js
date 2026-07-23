(() => {
  "use strict";

  if (globalThis.FCI_SETTINGS_SNAPSHOTS?.VERSION >= 1) {
    return;
  }

  const Settings = globalThis.FCI_SETTINGS;
  const VERSION = 1;
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
    return {
      id: safeString(options.id).trim() || makeId(options.now),
      createdAt: safeString(options.createdAt).trim() || new Date(options.now || Date.now()).toISOString(),
      reason: safeString(reason, "manual").trim() || "manual",
      label: safeString(label, "Settings snapshot").trim() || "Settings snapshot",
      fingerprint: storeFingerprint(store),
      store
    };
  }

  function normalizeSnapshot(raw, index = 0) {
    const source = raw && typeof raw === "object" ? raw : {};
    const store = Settings.normalizeStore(source.store);
    const createdAt = safeString(source.createdAt).trim() || new Date(0).toISOString();
    return {
      id: safeString(source.id).trim() || `snapshot-imported-${index + 1}`,
      createdAt,
      reason: safeString(source.reason, "imported").trim() || "imported",
      label: safeString(source.label, `Snapshot ${index + 1}`).trim() || `Snapshot ${index + 1}`,
      fingerprint: storeFingerprint(store),
      store
    };
  }

  function normalizeCollection(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const seenIds = new Set();
    const snapshots = [];
    for (const [index, candidate] of (Array.isArray(source.snapshots) ? source.snapshots : []).entries()) {
      const snapshot = normalizeSnapshot(candidate, index);
      if (seenIds.has(snapshot.id)) {
        continue;
      }
      seenIds.add(snapshot.id);
      snapshots.push(snapshot);
    }
    snapshots.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return {
      version: VERSION,
      snapshots: snapshots.slice(0, MAX_SNAPSHOTS)
    };
  }

  function addSnapshot(rawCollection, rawSnapshot) {
    const collection = normalizeCollection(rawCollection);
    const snapshot = normalizeSnapshot(rawSnapshot);
    const existing = collection.snapshots.find((item) => item.fingerprint === snapshot.fingerprint);
    if (existing) {
      return {
        collection,
        snapshot: existing,
        added: false
      };
    }
    return {
      collection: normalizeCollection({ snapshots: [snapshot, ...collection.snapshots] }),
      snapshot,
      added: true
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
    return {
      id: snapshot.id,
      createdAt: snapshot.createdAt,
      reason: snapshot.reason,
      label: snapshot.label,
      revision: snapshot.store.revision,
      profileCount: snapshot.store.profiles.length,
      defaultProfileId: snapshot.store.defaultProfileId
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
