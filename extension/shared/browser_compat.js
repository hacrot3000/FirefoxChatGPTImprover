(() => {
  "use strict";

  const root = globalThis;
  const existingBrowser = root.browser;
  const chromeApi = root.chrome;

  // Firefox already provides the complete Promise-based browser namespace,
  // sidebarAction and tab-scoped session values used by the shared engine.
  if (existingBrowser?.runtime?.getBrowserInfo && existingBrowser?.sidebarAction && existingBrowser?.sessions?.setTabValue) {
    root.FCI_BROWSER_COMPAT = Object.freeze({ platform: "firefox", emulated: false });
    return;
  }
  if (!chromeApi?.runtime) {
    root.FCI_BROWSER_COMPAT = Object.freeze({ platform: "unknown", emulated: false });
    return;
  }

  const messageListenerWrappers = new WeakMap();
  const SESSION_PREFIX = "firefoxChatImprover.chromiumTabValue.v1";
  const sessionStorage = chromeApi.storage?.session || chromeApi.storage?.local;

  function bindValue(target, value) {
    return typeof value === "function" ? value.bind(target) : value;
  }

  function namespaceFacade(target, overrides = {}) {
    const source = target || {};
    return new Proxy(source, {
      get(object, property) {
        if (Object.prototype.hasOwnProperty.call(overrides, property)) return overrides[property];
        return bindValue(object, object[property]);
      },
      has(object, property) {
        return Object.prototype.hasOwnProperty.call(overrides, property) || property in object;
      }
    });
  }

  function normalizeError(error) {
    if (error instanceof Error) return error.message;
    if (error && typeof error.message === "string") return error.message;
    return String(error || "Unknown Chromium extension error");
  }

  const runtimeOnMessage = {
    addListener(listener) {
      if (typeof listener !== "function" || messageListenerWrappers.has(listener)) return;
      const wrapped = (message, sender, sendResponse) => {
        let result;
        try {
          result = listener(message, sender);
        } catch (error) {
          sendResponse({ ok: false, error: normalizeError(error) });
          return false;
        }
        if (result && typeof result.then === "function") {
          Promise.resolve(result).then(
            (value) => sendResponse(value),
            (error) => sendResponse({ ok: false, error: normalizeError(error) })
          );
          return true;
        }
        if (result !== undefined) sendResponse(result);
        return result !== undefined;
      };
      messageListenerWrappers.set(listener, wrapped);
      chromeApi.runtime.onMessage.addListener(wrapped);
    },
    removeListener(listener) {
      const wrapped = messageListenerWrappers.get(listener);
      if (!wrapped) return;
      chromeApi.runtime.onMessage.removeListener(wrapped);
      messageListenerWrappers.delete(listener);
    },
    hasListener(listener) {
      const wrapped = messageListenerWrappers.get(listener);
      return Boolean(wrapped && chromeApi.runtime.onMessage.hasListener?.(wrapped));
    },
    hasListeners() {
      return Boolean(chromeApi.runtime.onMessage.hasListeners?.());
    }
  };

  function browserIdentity() {
    const agent = String(root.navigator?.userAgent || "");
    const edge = /Edg\/([\d.]+)/.exec(agent);
    const chrome = /(?:Chrome|Chromium)\/([\d.]+)/.exec(agent);
    return edge
      ? { name: "Microsoft Edge", vendor: "Microsoft", version: edge[1], buildID: null }
      : { name: "Chromium", vendor: "Chromium", version: chrome?.[1] || "unknown", buildID: null };
  }

  function tabValueStorageKey(tabId, key) {
    const numericTabId = Number(tabId);
    if (!Number.isInteger(numericTabId)) throw new Error("A valid tab ID is required for Chromium session storage.");
    return `${SESSION_PREFIX}.${numericTabId}.${encodeURIComponent(String(key || ""))}`;
  }

  const sessionsFacade = namespaceFacade(chromeApi.sessions, {
    async getTabValue(tabId, key) {
      if (!sessionStorage) return null;
      const storageKey = tabValueStorageKey(tabId, key);
      const result = await sessionStorage.get(storageKey);
      return Object.prototype.hasOwnProperty.call(result || {}, storageKey) ? result[storageKey] : null;
    },
    async setTabValue(tabId, key, value) {
      if (!sessionStorage) throw new Error("Chromium session storage is unavailable.");
      const storageKey = tabValueStorageKey(tabId, key);
      await sessionStorage.set({ [storageKey]: value });
    },
    async removeTabValue(tabId, key) {
      if (!sessionStorage) return;
      await sessionStorage.remove(tabValueStorageKey(tabId, key));
    }
  });

  async function activeTab() {
    const tabs = await chromeApi.tabs.query({ active: true, currentWindow: true });
    return Array.isArray(tabs) ? tabs[0] || null : null;
  }

  const sidebarActionFacade = Object.freeze({
    async open(options = {}) {
      if (!chromeApi.sidePanel?.open) throw new Error("The Chromium Side Panel API is unavailable.");
      let tabId = Number(options?.tabId);
      let windowId = Number(options?.windowId);
      if (!Number.isInteger(tabId) && !Number.isInteger(windowId)) {
        const tab = await activeTab();
        tabId = Number(tab?.id);
        windowId = Number(tab?.windowId);
      }
      if (Number.isInteger(tabId)) return chromeApi.sidePanel.open({ tabId });
      if (Number.isInteger(windowId)) return chromeApi.sidePanel.open({ windowId });
      throw new Error("Could not determine the active Chromium tab for the side panel.");
    }
  });

  function shortcutSettingsUrl() {
    return /Edg\//.test(String(root.navigator?.userAgent || ""))
      ? "edge://extensions/shortcuts"
      : "chrome://extensions/shortcuts";
  }

  const commandsFacade = namespaceFacade(chromeApi.commands, {
    async getAll() {
      const commands = await chromeApi.commands.getAll();
      return (commands || []).map((item) => item?.name === "fci-open-side-panel"
        ? { ...item, name: "_execute_sidebar_action" }
        : item);
    },
    async reset(name) {
      const actualName = name === "_execute_sidebar_action" ? "fci-open-side-panel" : name;
      return chromeApi.commands.reset(actualName);
    },
    async openShortcutSettings() {
      await chromeApi.tabs.create({ url: shortcutSettingsUrl() });
    }
  });

  const runtimeFacade = namespaceFacade(chromeApi.runtime, {
    onMessage: runtimeOnMessage,
    async getBrowserInfo() {
      return browserIdentity();
    }
  });

  const facade = new Proxy(chromeApi, {
    get(target, property) {
      if (property === "runtime") return runtimeFacade;
      if (property === "sessions") return sessionsFacade;
      if (property === "sidebarAction") return sidebarActionFacade;
      if (property === "commands") return commandsFacade;
      return bindValue(target, target[property]);
    },
    has(target, property) {
      return ["runtime", "sessions", "sidebarAction", "commands"].includes(property) || property in target;
    }
  });

  try {
    root.browser = facade;
  } catch (_error) {
    try {
      Object.defineProperty(root, "browser", { configurable: true, value: facade });
    } catch (_defineError) {
      // Chrome 148+ can expose a native, non-configurable browser global. Extend
      // that object with the Firefox-only namespaces needed by the shared engine.
    }
  }
  if (root.browser !== facade && root.browser) {
    try { root.browser.sessions = sessionsFacade; } catch (_error) {}
    try { root.browser.sidebarAction = sidebarActionFacade; } catch (_error) {}
    try { root.browser.commands = commandsFacade; } catch (_error) {}
    try {
      if (typeof root.browser.runtime?.getBrowserInfo !== "function") {
        root.browser.runtime.getBrowserInfo = async () => browserIdentity();
      }
    } catch (_error) {}
  }

  root.FCI_BROWSER_COMPAT = Object.freeze({
    platform: /Edg\//.test(String(root.navigator?.userAgent || "")) ? "edge" : "chromium",
    emulated: root.browser === facade,
    sessionStorage: sessionStorage === chromeApi.storage?.session ? "session" : "local"
  });
})();
