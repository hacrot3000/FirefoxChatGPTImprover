(() => {
  "use strict";

  const { MESSAGE, MODE } = globalThis.FCI_PROTOCOL;
  const activeTabs = new Map();

  function isSupportedUrl(rawUrl) {
    if (typeof rawUrl !== "string" || rawUrl.length === 0) {
      return false;
    }

    try {
      const url = new URL(rawUrl);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch (_error) {
      return false;
    }
  }

  function stateFor(tab, mode = MODE.INACTIVE, extra = {}) {
    return {
      protocolVersion: globalThis.FCI_PROTOCOL.VERSION,
      tabId: Number.isInteger(tab?.id) ? tab.id : null,
      windowId: Number.isInteger(tab?.windowId) ? tab.windowId : null,
      url: typeof tab?.url === "string" ? tab.url : "",
      title: typeof tab?.title === "string" ? tab.title : "",
      mode,
      activatedAt: null,
      updatedAt: new Date().toISOString(),
      source: null,
      error: null,
      ...extra
    };
  }

  function publicErrorState(tab, error) {
    return stateFor(tab, MODE.ERROR, {
      error: error instanceof Error ? error.message : String(error)
    });
  }

  async function setBadge(tabId, mode) {
    if (!Number.isInteger(tabId)) {
      return;
    }

    const badge = {
      [MODE.ACTIVE]: { text: "ON", color: "#238636" },
      [MODE.PAUSED]: { text: "II", color: "#9a6700" },
      [MODE.ERROR]: { text: "!", color: "#cf222e" },
      [MODE.INACTIVE]: { text: "", color: null }
    }[mode] || { text: "", color: null };

    await browser.action.setBadgeText({ tabId, text: badge.text });
    if (badge.color) {
      await browser.action.setBadgeBackgroundColor({
        tabId,
        color: badge.color
      });
    }
  }

  async function broadcastState(state) {
    try {
      await browser.runtime.sendMessage({
        type: MESSAGE.STATE_CHANGED,
        state
      });
    } catch (_error) {
      // The sidebar may not be open yet. Its initial GET_STATUS request will
      // retrieve the current state later.
    }
  }

  async function currentTab() {
    const tabs = await browser.tabs.query({
      active: true,
      currentWindow: true
    });
    return tabs[0] || null;
  }

  async function activateTab(tab, source) {
    if (!Number.isInteger(tab?.id)) {
      throw new Error("Không xác định được tab hiện tại.");
    }
    if (!isSupportedUrl(tab.url)) {
      throw new Error("Chỉ có thể kích hoạt trên trang HTTP hoặc HTTPS thông thường.");
    }

    await browser.scripting.executeScript({
      target: { tabId: tab.id },
      files: [
        "shared/protocol.js",
        "content/activation.js"
      ]
    });

    const contentState = await browser.tabs.sendMessage(tab.id, {
      type: MESSAGE.CONTENT_ACTIVATE,
      payload: {
        source,
        url: tab.url
      }
    });

    const state = stateFor(tab, MODE.ACTIVE, {
      activatedAt: contentState?.activatedAt || new Date().toISOString(),
      updatedAt: contentState?.updatedAt || new Date().toISOString(),
      source,
      error: null
    });

    activeTabs.set(tab.id, state);
    await setBadge(tab.id, MODE.ACTIVE);
    await broadcastState(state);
    return state;
  }

  async function pauseTab(tabId) {
    const known = activeTabs.get(tabId);
    if (!known) {
      throw new Error("Tab hiện tại chưa được kích hoạt.");
    }

    const contentState = await browser.tabs.sendMessage(tabId, {
      type: MESSAGE.CONTENT_PAUSE
    });
    const state = {
      ...known,
      mode: MODE.PAUSED,
      updatedAt: contentState?.updatedAt || new Date().toISOString(),
      error: null
    };

    activeTabs.set(tabId, state);
    await setBadge(tabId, MODE.PAUSED);
    await broadcastState(state);
    return state;
  }

  async function stopTab(tabId, fallbackTab = null) {
    const known = activeTabs.get(tabId);

    try {
      await browser.tabs.sendMessage(tabId, {
        type: MESSAGE.CONTENT_STOP
      });
    } catch (_error) {
      // Navigation or page shutdown can remove the content context first.
    }

    activeTabs.delete(tabId);
    await setBadge(tabId, MODE.INACTIVE);

    let tab = fallbackTab;
    if (!tab) {
      try {
        tab = await browser.tabs.get(tabId);
      } catch (_error) {
        tab = { id: tabId };
      }
    }

    const state = stateFor(tab, MODE.INACTIVE, {
      activatedAt: known?.activatedAt || null
    });
    await broadcastState(state);
    return state;
  }

  async function statusForTab(tab) {
    if (!tab || !Number.isInteger(tab.id)) {
      return stateFor(null);
    }

    const known = activeTabs.get(tab.id);
    if (known) {
      return {
        ...known,
        url: typeof tab.url === "string" ? tab.url : known.url,
        title: typeof tab.title === "string" ? tab.title : known.title
      };
    }

    try {
      const contentState = await browser.tabs.sendMessage(tab.id, {
        type: MESSAGE.CONTENT_STATUS
      });
      if (contentState?.mode === MODE.ACTIVE || contentState?.mode === MODE.PAUSED) {
        const recovered = stateFor(tab, contentState.mode, {
          activatedAt: contentState.activatedAt || null,
          updatedAt: contentState.updatedAt || new Date().toISOString(),
          source: contentState.source || "recovered"
        });
        activeTabs.set(tab.id, recovered);
        await setBadge(tab.id, recovered.mode);
        return recovered;
      }
    } catch (_error) {
      // No content bootstrap exists on this tab.
    }

    return stateFor(tab);
  }

  async function handleRequest(message) {
    const tab = await currentTab();

    switch (message.type) {
      case MESSAGE.GET_STATUS:
        return { ok: true, state: await statusForTab(tab) };

      case MESSAGE.ACTIVATE_CURRENT:
        try {
          return {
            ok: true,
            state: await activateTab(tab, "sidebar")
          };
        } catch (error) {
          const state = publicErrorState(tab, error);
          if (Number.isInteger(tab?.id)) {
            await setBadge(tab.id, MODE.ERROR);
          }
          await broadcastState(state);
          return { ok: false, error: state.error, state };
        }

      case MESSAGE.PAUSE_CURRENT:
        try {
          if (!Number.isInteger(tab?.id)) {
            throw new Error("Không xác định được tab hiện tại.");
          }
          return { ok: true, state: await pauseTab(tab.id) };
        } catch (error) {
          const state = publicErrorState(tab, error);
          await broadcastState(state);
          return { ok: false, error: state.error, state };
        }

      case MESSAGE.STOP_CURRENT:
        try {
          if (!Number.isInteger(tab?.id)) {
            throw new Error("Không xác định được tab hiện tại.");
          }
          return { ok: true, state: await stopTab(tab.id, tab) };
        } catch (error) {
          const state = publicErrorState(tab, error);
          await broadcastState(state);
          return { ok: false, error: state.error, state };
        }

      default:
        return undefined;
    }
  }

  browser.action.onClicked.addListener((tab) => {
    // sidebarAction.open() must be initiated directly by the toolbar user
    // action, so start it before awaiting script injection.
    void browser.sidebarAction.open().catch((error) => {
      console.error("FirefoxChatImprover: cannot open sidebar", error);
    });

    void activateTab(tab, "toolbar").catch(async (error) => {
      const state = publicErrorState(tab, error);
      if (Number.isInteger(tab?.id)) {
        await setBadge(tab.id, MODE.ERROR);
      }
      await broadcastState(state);
      console.error("FirefoxChatImprover: activation failed", error);
    });
  });

  browser.runtime.onMessage.addListener((message) => {
    if (!message || typeof message.type !== "string") {
      return undefined;
    }

    if (
      message.type === MESSAGE.GET_STATUS ||
      message.type === MESSAGE.ACTIVATE_CURRENT ||
      message.type === MESSAGE.PAUSE_CURRENT ||
      message.type === MESSAGE.STOP_CURRENT
    ) {
      return handleRequest(message);
    }

    return undefined;
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!activeTabs.has(tabId)) {
      return;
    }

    const known = activeTabs.get(tabId);
    const navigated =
      changeInfo.status === "loading" ||
      (typeof changeInfo.url === "string" && changeInfo.url !== known.url);

    if (navigated) {
      void stopTab(tabId, tab);
    }
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    if (!activeTabs.has(tabId)) {
      return;
    }
    activeTabs.delete(tabId);
    void broadcastState(stateFor({ id: tabId }, MODE.INACTIVE));
  });
})();
