(() => {
  "use strict";

  const { MESSAGE, MODE, CONFIG_MODE, MONITOR_STATE } = globalThis.FCI_PROTOCOL;
  const Settings = globalThis.FCI_SETTINGS;
  const TAB_SESSION_KEY = "firefoxChatImprover.tabSession.v2";
  const sessions = new Map();
  const pickerStates = new Map();
  let storePromise = null;
  let recoveryPromise = null;

  const NATIVE_HOST_NAME = "com.duongtc.firefox_chat_assistant";
  const SHELL_OUTPUT_LIMIT = 500;
  const SHELL_OUTPUT_CHAR_LIMIT = 200000;
  const shellRuns = new Map();
  const runToTab = new Map();
  const shellBroadcastTimers = new Map();
  let nativePort = null;
  let nativeState = {
    connected: false,
    hostName: NATIVE_HOST_NAME,
    hostVersion: null,
    lastError: null,
    lastSeenAt: null
  };

  function emptyShellRun(tabId) {
    return {
      tabId,
      runId: null,
      mode: null,
      status: "idle",
      pid: null,
      cwd: "",
      command: "",
      startedAt: null,
      endedAt: null,
      returnCode: null,
      stopped: false,
      error: null,
      output: []
    };
  }

  function shellRunForTab(tabId) {
    if (!shellRuns.has(tabId)) {
      shellRuns.set(tabId, emptyShellRun(tabId));
    }
    return shellRuns.get(tabId);
  }

  function publicShellRun(tabId) {
    return clone(shellRuns.get(tabId) || emptyShellRun(tabId));
  }

  function appendShellOutput(run, stream, text) {
    const value = String(text || "");
    if (!value) {
      return;
    }
    run.output.push({ at: Settings.nowIso(), stream: stream || "system", text: value });
    if (run.output.length > SHELL_OUTPUT_LIMIT) {
      run.output.splice(0, run.output.length - SHELL_OUTPUT_LIMIT);
    }
    let total = run.output.reduce((sum, item) => sum + item.text.length, 0);
    while (total > SHELL_OUTPUT_CHAR_LIMIT && run.output.length > 1) {
      total -= run.output.shift().text.length;
    }
  }

  function nativeDashboardState() {
    return {
      ...clone(nativeState),
      runs: [...shellRuns.values()].map((run) => clone(run))
    };
  }

  function scheduleShellBroadcast(tabId) {
    if (shellBroadcastTimers.has(tabId)) {
      return;
    }
    const timer = setTimeout(() => {
      shellBroadcastTimers.delete(tabId);
      void broadcast("native-shell-output", tabId);
    }, 120);
    shellBroadcastTimers.set(tabId, timer);
  }

  function disconnectNativePort() {
    if (!nativePort) {
      return;
    }
    const port = nativePort;
    nativePort = null;
    try {
      port.disconnect();
    } catch (_error) {
      // Port may already be disconnected.
    }
  }

  async function handleNativeMessage(message) {
    nativeState.connected = true;
    nativeState.lastSeenAt = Settings.nowIso();
    nativeState.lastError = null;
    if (message?.hostName) {
      nativeState.hostName = message.hostName;
    }
    if (message?.hostVersion) {
      nativeState.hostVersion = message.hostVersion;
    }

    const event = String(message?.event || "");
    if (event === "hello" || event === "status") {
      await broadcast("native-status");
      return;
    }

    const tabId = Number(message?.tabId ?? runToTab.get(String(message?.runId || "")));
    if (!Number.isInteger(tabId)) {
      await broadcast("native-event");
      return;
    }
    const run = shellRunForTab(tabId);
    if (message?.runId && run.runId && message.runId !== run.runId) {
      return;
    }

    if (event === "started") {
      run.status = message.mode === "terminal" ? "terminal" : "running";
      run.pid = Number.isInteger(message.pid) ? message.pid : null;
      run.startedAt = run.startedAt || Settings.nowIso();
      run.error = null;
      appendShellOutput(run, "system", `[started] pid=${run.pid ?? "—"} mode=${message.mode || run.mode}\n`);
    } else if (event === "output") {
      appendShellOutput(run, message.stream === "stderr" ? "stderr" : "stdout", message.text);
    } else if (event === "stopping") {
      run.status = "stopping";
      appendShellOutput(run, "system", "[stopping] SIGTERM đã được gửi.\n");
    } else if (event === "killed") {
      appendShellOutput(run, "system", "[killed] Process không dừng đúng hạn và đã nhận SIGKILL.\n");
    } else if (event === "exited") {
      run.status = "exited";
      run.returnCode = Number.isInteger(message.returnCode) ? message.returnCode : null;
      run.stopped = Boolean(message.stopped);
      run.endedAt = Settings.nowIso();
      appendShellOutput(run, "system", `[exited] returnCode=${run.returnCode ?? "—"}${run.stopped ? " stopped=true" : ""}\n`);
      if (run.runId) {
        runToTab.delete(run.runId);
      }
    } else if (event === "error") {
      run.status = "error";
      run.error = String(message.error || "Native host báo lỗi không xác định.");
      run.endedAt = Settings.nowIso();
      appendShellOutput(run, "stderr", `[error] ${run.error}\n`);
      if (run.runId) {
        runToTab.delete(run.runId);
      }
    } else if (event === "fatal") {
      nativeState.lastError = String(message.error || "Native host fatal error.");
    }

    if (event === "output") {
      scheduleShellBroadcast(tabId);
      return;
    }

    const session = sessions.get(tabId);
    if (session && ["started", "stopping", "exited", "error"].includes(event)) {
      appendLog(
        session,
        event === "error" ? "user" : "debug",
        `shell-${event}`,
        event === "error" ? run.error : `Shell ${event}: ${run.command}`,
        { runId: run.runId, pid: run.pid, returnCode: run.returnCode }
      );
      await persistSession(session);
    }
    await broadcast("native-shell-event", tabId);
  }

  function handleNativeDisconnect(port) {
    if (nativePort !== port) {
      return;
    }
    nativePort = null;
    const lastError = browser.runtime.lastError?.message || "Native host đã ngắt kết nối.";
    nativeState = {
      ...nativeState,
      connected: false,
      lastError,
      lastSeenAt: Settings.nowIso()
    };
    for (const run of shellRuns.values()) {
      if (["starting", "running", "terminal", "stopping"].includes(run.status)) {
        run.status = "error";
        run.error = lastError;
        run.endedAt = Settings.nowIso();
        appendShellOutput(run, "stderr", `[native disconnected] ${lastError}\n`);
      }
    }
    runToTab.clear();
    void broadcast("native-disconnected");
  }

  function ensureNativePort() {
    if (nativePort) {
      return nativePort;
    }
    try {
      const port = browser.runtime.connectNative(NATIVE_HOST_NAME);
      nativePort = port;
      nativeState = {
        ...nativeState,
        connected: true,
        lastError: null,
        lastSeenAt: Settings.nowIso()
      };
      port.onMessage.addListener((message) => {
        void handleNativeMessage(message);
      });
      port.onDisconnect.addListener(() => handleNativeDisconnect(port));
      port.postMessage({ action: "ping" });
      return port;
    } catch (error) {
      nativeState = {
        ...nativeState,
        connected: false,
        lastError: error instanceof Error ? error.message : String(error),
        lastSeenAt: Settings.nowIso()
      };
      throw error;
    }
  }

  function assertSidebarSender(sender) {
    if (sender?.tab) {
      throw new Error("Content script không được phép điều khiển Native Messaging.");
    }
    const sidebarPrefix = browser.runtime.getURL("sidebar/");
    if (typeof sender?.url !== "string" || !sender.url.startsWith(sidebarPrefix)) {
      throw new Error("Lệnh shell chỉ được phép gửi trực tiếp từ sidebar của add-on.");
    }
  }

  function validateShellPayload(message) {
    const tabId = Number(message.tabId);
    if (!Number.isInteger(tabId)) {
      throw new Error("tabId của command không hợp lệ.");
    }
    const cwd = String(message.cwd || "").trim();
    if (!cwd.startsWith("/")) {
      throw new Error("Working directory phải là đường dẫn tuyệt đối.");
    }
    const command = String(message.command || "");
    if (!command.trim()) {
      throw new Error("Command đang trống.");
    }
    if (command.includes("\u0000")) {
      throw new Error("Command chứa ký tự NUL không hợp lệ.");
    }
    const mode = message.mode === "terminal" ? "terminal" : "background";
    return { tabId, cwd, command, mode };
  }

  async function checkNativeStatus(sender) {
    assertSidebarSender(sender);
    const port = ensureNativePort();
    port.postMessage({ action: "ping" });
    return nativeDashboardState();
  }

  async function runShell(message, sender) {
    assertSidebarSender(sender);
    const { tabId, cwd, command, mode } = validateShellPayload(message);
    const session = sessions.get(tabId);
    if (!session) {
      throw new Error("Tab này chưa được kích hoạt; không có session để gắn command.");
    }
    const current = shellRunForTab(tabId);
    if (["starting", "running", "terminal", "stopping"].includes(current.status)) {
      throw new Error("Tab này đang có command chưa kết thúc.");
    }
    const runId = `tab-${tabId}-${crypto.randomUUID()}`;
    const run = {
      ...emptyShellRun(tabId),
      runId,
      mode,
      status: "starting",
      cwd,
      command,
      startedAt: Settings.nowIso()
    };
    shellRuns.set(tabId, run);
    runToTab.set(runId, tabId);
    appendShellOutput(run, "system", `[request] cwd=${cwd}\n[command] ${command}\n`);
    appendLog(session, "user", "shell-run-request", `Yêu cầu chạy command ở chế độ ${mode}.`, { runId, cwd, command });
    await persistSession(session);
    const port = ensureNativePort();
    port.postMessage({ action: "run", runId, tabId, cwd, command, mode });
    await broadcast("native-shell-starting", tabId);
    return publicShellRun(tabId);
  }

  async function stopShell(message, sender) {
    assertSidebarSender(sender);
    const tabId = Number(message.tabId);
    const run = shellRuns.get(tabId);
    if (!run?.runId || !["starting", "running", "terminal", "stopping"].includes(run.status)) {
      throw new Error("Tab này không có command đang chạy để dừng.");
    }
    const port = ensureNativePort();
    run.status = "stopping";
    port.postMessage({ action: "stop", runId: run.runId, tabId });
    await broadcast("native-shell-stopping", tabId);
    return publicShellRun(tabId);
  }

  async function clearShellOutput(message, sender) {
    assertSidebarSender(sender);
    const tabId = Number(message.tabId);
    const run = shellRunForTab(tabId);
    run.output = [];
    await broadcast("native-shell-output-cleared", tabId);
    return publicShellRun(tabId);
  }


  function clone(value) {
    return Settings.clone(value);
  }

  function isSupportedUrl(rawUrl) {
    if (typeof rawUrl !== "string" || !rawUrl) {
      return false;
    }
    try {
      const url = new URL(rawUrl);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch (_error) {
      return false;
    }
  }

  function hostPermissionPattern(rawUrl) {
    if (!isSupportedUrl(rawUrl)) {
      return null;
    }
    const url = new URL(rawUrl);
    return `${url.protocol}//${url.host}/*`;
  }

  function tabMeta(tab) {
    return {
      tabId: Number.isInteger(tab?.id) ? tab.id : null,
      windowId: Number.isInteger(tab?.windowId) ? tab.windowId : null,
      url: typeof tab?.url === "string" ? tab.url : "",
      title: typeof tab?.title === "string" ? tab.title : ""
    };
  }

  async function loadStore() {
    if (!storePromise) {
      storePromise = browser.storage.local.get(Settings.STORAGE_KEY).then(async (result) => {
        const store = Settings.normalizeStore(result[Settings.STORAGE_KEY]);
        await browser.storage.local.set({ [Settings.STORAGE_KEY]: store });
        return store;
      });
    }
    return clone(await storePromise);
  }

  async function saveStore(nextStore) {
    const normalized = Settings.normalizeStore(nextStore);
    normalized.revision += 1;
    await browser.storage.local.set({ [Settings.STORAGE_KEY]: normalized });
    storePromise = Promise.resolve(normalized);
    return clone(normalized);
  }

  function sessionConfig(session, store) {
    if (session.configMode === CONFIG_MODE.TAB && session.tabConfig) {
      return Settings.normalizeConfig(session.tabConfig);
    }
    const profile = Settings.profileById(store, session.profileId) ||
      Settings.profileById(store, store.defaultProfileId) || store.profiles[0];
    return Settings.normalizeConfig(profile.config);
  }

  function profileName(session, store) {
    return Settings.profileById(store, session.profileId)?.name || "Profile không tồn tại";
  }

  function publicSession(session, store) {
    return {
      ...clone(session),
      profileName: profileName(session, store),
      effectiveConfig: sessionConfig(session, store)
    };
  }

  function newRuntime() {
    return {
      monitorState: MONITOR_STATE.IDLE,
      cycle: 0,
      baselineCount: 0,
      candidateCount: 0,
      targetState: "disabled",
      targetEnabled: false,
      targetSelector: "",
      targetTotalCount: 0,
      targetEligibleCount: 0,
      handledCount: 0,
      clickedCount: 0,
      dryRunCount: 0,
      targetCycle: 0,
      lastTargetAction: null,
      lastTargetAt: null,
      lastTargetError: null,
      monitorSelector: "",
      monitorCount: 0,
      monitorVisibleCount: 0,
      monitorHiddenCount: 0,
      monitorMatchedCount: 0,
      monitorAttributeMatchedCount: 0,
      visibilityTransitionMode: "none",
      lastVisibilityTransition: null,
      conditionMatched: false,
      lastReason: null,
      lastTransition: null,
      alertActive: false,
      alertCycle: 0,
      titleBlinking: false,
      originalTitle: "",
      displayedTitle: "",
      alertStartedAt: null,
      alertAcknowledgedAt: null,
      alertDismissReason: null,
      lastUserActivityAt: null,
      activeVisibleSince: null,
      lastAlertReason: null,
      lastEventAt: null
    };
  }

  function makeSession(tab, profileId, source) {
    const now = Settings.nowIso();
    return {
      ...tabMeta(tab),
      mode: MODE.ACTIVE,
      activatedAt: now,
      updatedAt: now,
      source,
      error: null,
      profileId,
      configMode: CONFIG_MODE.PROFILE,
      tabConfig: null,
      configRevision: 1,
      runtime: newRuntime(),
      logs: { user: [], debug: [] }
    };
  }

  function serializableSession(session) {
    return clone(session);
  }

  async function persistSession(session) {
    if (!Number.isInteger(session?.tabId)) {
      return;
    }
    await browser.sessions.setTabValue(
      session.tabId,
      TAB_SESSION_KEY,
      serializableSession(session)
    );
  }

  async function removePersistedSession(tabId) {
    try {
      await browser.sessions.removeTabValue(tabId, TAB_SESSION_KEY);
    } catch (_error) {
      // The tab may already be closed.
    }
  }

  function normalizeLogs(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    return {
      user: Array.isArray(source.user) ? source.user.slice(-80) : [],
      debug: Array.isArray(source.debug) ? source.debug.slice(-120) : []
    };
  }

  function appendLog(session, channel, event, message, detail = null) {
    if (!session) {
      return;
    }
    session.logs = normalizeLogs(session.logs);
    const key = channel === "debug" ? "debug" : "user";
    session.logs[key].push({
      at: Settings.nowIso(),
      event: String(event || "event"),
      message: String(message || ""),
      detail: detail === null || detail === undefined ? null : clone(detail)
    });
    const limit = key === "debug" ? 120 : 80;
    if (session.logs[key].length > limit) {
      session.logs[key].splice(0, session.logs[key].length - limit);
    }
  }

  async function applyBadge(tabId, text, color = null) {
    if (!Number.isInteger(tabId)) {
      return;
    }
    await browser.action.setBadgeText({ tabId, text });
    if (color) {
      await browser.action.setBadgeBackgroundColor({ tabId, color });
    }
  }

  async function updateBadge(session, store) {
    if (!session) {
      return;
    }
    const config = sessionConfig(session, store);
    if (session.mode === MODE.ERROR) {
      await applyBadge(session.tabId, "!", "#cf222e");
      return;
    }
    if (session.mode === MODE.PAUSED) {
      await applyBadge(session.tabId, "II", "#9a6700");
      return;
    }
    if (session.mode === MODE.ACTIVE && session.runtime?.alertActive && config.alerts.badge) {
      await applyBadge(session.tabId, "!", "#cf222e");
      return;
    }
    if (session.mode === MODE.ACTIVE) {
      await applyBadge(session.tabId, "ON", "#238636");
      return;
    }
    await applyBadge(session.tabId, "", null);
  }

  async function clearNotification(tabId) {
    try {
      await browser.notifications.clear(`fci-tab-${tabId}`);
    } catch (_error) {
      // Notification may not exist.
    }
  }

  async function showMatchedNotification(session, store) {
    const config = sessionConfig(session, store);
    if (!config.alerts.notification) {
      return;
    }
    await browser.notifications.create(`fci-tab-${session.tabId}`, {
      type: "basic",
      iconUrl: browser.runtime.getURL("icons/icon.svg"),
      title: "Firefox ChatAI Assistant — điều kiện đã đạt",
      message: `${session.runtime.originalTitle || session.title || session.url}
Tab ${session.tabId}, chu kỳ ${session.runtime.cycle || 0}`
    });
  }

  async function broadcast(reason, changedTabId = null) {
    try {
      await browser.runtime.sendMessage({
        type: MESSAGE.DASHBOARD_CHANGED,
        reason,
        changedTabId
      });
    } catch (_error) {
      // Sidebar may be closed.
    }
  }

  async function currentTab() {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  async function applySessionToContent(session, store, messageType = MESSAGE.CONTENT_APPLY_SESSION) {
    const snapshot = publicSession(session, store);
    const response = await browser.tabs.sendMessage(session.tabId, {
      type: messageType,
      payload: { session: snapshot }
    });
    if (response?.runtime) {
      session.runtime = { ...session.runtime, ...response.runtime };
    }
    session.updatedAt = response?.updatedAt || Settings.nowIso();
    return response;
  }

  async function recoverOne(tab, store) {
    if (!Number.isInteger(tab?.id) || sessions.has(tab.id)) {
      return sessions.get(tab?.id) || null;
    }

    let stored;
    try {
      stored = await browser.sessions.getTabValue(tab.id, TAB_SESSION_KEY);
    } catch (_error) {
      return null;
    }
    if (!stored || ![MODE.ACTIVE, MODE.PAUSED].includes(stored.mode)) {
      return null;
    }

    try {
      const content = await browser.tabs.sendMessage(tab.id, {
        type: MESSAGE.CONTENT_STATUS
      });
      if (![MODE.ACTIVE, MODE.PAUSED].includes(content?.mode)) {
        throw new Error("content runtime is not active");
      }
      const recovered = {
        ...stored,
        ...tabMeta(tab),
        mode: content.mode,
        updatedAt: content.updatedAt || Settings.nowIso(),
        runtime: { ...newRuntime(), ...(stored.runtime || {}), ...(content.runtime || {}) },
        logs: normalizeLogs(stored.logs)
      };
      if (!Settings.profileById(store, recovered.profileId)) {
        recovered.profileId = store.defaultProfileId;
        recovered.configMode = CONFIG_MODE.PROFILE;
        recovered.tabConfig = null;
      }
      sessions.set(tab.id, recovered);
      await updateBadge(recovered, store);
      return recovered;
    } catch (_error) {
      await removePersistedSession(tab.id);
      await applyBadge(tab.id, "", null);
      return null;
    }
  }

  async function recoverAll() {
    if (!recoveryPromise) {
      recoveryPromise = (async () => {
        const store = await loadStore();
        const tabs = await browser.tabs.query({});
        await Promise.all(tabs.map((tab) => recoverOne(tab, store)));
      })().finally(() => {
        recoveryPromise = null;
      });
    }
    await recoveryPromise;
  }

  async function ensureContentScripts(tabId) {
    await browser.scripting.executeScript({
      target: { tabId },
      files: [
        "shared/protocol.js",
        "shared/settings.js",
        "content/monitor.js",
        "content/target.js",
        "content/alert.js",
        "content/picker.js",
        "content/activation.js"
      ]
    });
  }

  function publicPickerState(tabId) {
    const state = pickerStates.get(Number(tabId));
    return state ? clone(state) : null;
  }

  async function startElementPicker(tabId, kind) {
    if (!["monitor", "target"].includes(kind)) {
      throw new Error("Loại element picker không hợp lệ.");
    }
    await ensureInteractiveTab(tabId);
    const previous = pickerStates.get(tabId);
    if (previous) {
      try {
        await browser.tabs.sendMessage(tabId, {
          type: MESSAGE.CONTENT_CANCEL_ELEMENT_PICKER,
          payload: { reason: "replaced" }
        });
      } catch (_error) {
        // A stale picker context can be replaced safely.
      }
    }
    const response = await browser.tabs.sendMessage(tabId, {
      type: MESSAGE.CONTENT_START_ELEMENT_PICKER,
      payload: { kind }
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Không thể bắt đầu element picker.");
    }
    const state = {
      tabId,
      kind,
      status: "active",
      startedAt: Settings.nowIso()
    };
    pickerStates.set(tabId, state);
    return clone(state);
  }

  async function cancelElementPicker(tabId, reason = "sidebar-cancel") {
    const existing = pickerStates.get(tabId);
    if (!existing) {
      return { tabId, status: "inactive", cancelled: false };
    }
    try {
      await browser.tabs.sendMessage(tabId, {
        type: MESSAGE.CONTENT_CANCEL_ELEMENT_PICKER,
        payload: { reason }
      });
    } catch (_error) {
      // Navigation may already have removed the picker runtime.
    }
    pickerStates.delete(tabId);
    return { ...clone(existing), status: "inactive", cancelled: true, reason };
  }

  async function handleElementPickerResult(message, sender) {
    const tabId = sender?.tab?.id;
    if (!Number.isInteger(tabId)) {
      throw new Error("Element picker result không có tabId hợp lệ.");
    }
    const activePicker = pickerStates.get(tabId);
    if (!activePicker) {
      return { ignored: true, reason: "no-active-picker" };
    }
    const payload = message.payload && typeof message.payload === "object" ? message.payload : {};
    const kind = payload.kind === activePicker.kind ? activePicker.kind : null;
    if (!kind) {
      throw new Error("Element picker result không khớp phiên chọn đang hoạt động.");
    }
    pickerStates.delete(tabId);
    const result = {
      tabId,
      kind,
      cancelled: Boolean(payload.cancelled),
      reason: String(payload.reason || ""),
      selector: payload.selector || null,
      css: String(payload.css || ""),
      matchCount: Number(payload.matchCount) || 0,
      strategy: String(payload.strategy || ""),
      elementSummary: String(payload.elementSummary || ""),
      completedAt: Settings.nowIso()
    };
    if (!result.cancelled) {
      Settings.selectorToCss(result.selector);
    }
    const session = sessions.get(tabId);
    if (session) {
      appendLog(
        session,
        "user",
        result.cancelled ? "element-picker-cancelled" : "element-picker-selected",
        result.cancelled
          ? `Đã hủy chọn ${kind === "monitor" ? "element theo dõi" : "target"}.`
          : `Đã chọn ${kind === "monitor" ? "element theo dõi" : "target"}: ${result.css}`,
        result
      );
      await persistSession(session);
    }
    try {
      await browser.runtime.sendMessage({ type: MESSAGE.PICKER_RESULT, ...result });
    } catch (_error) {
      // Sidebar may be closed; the selected selector is intentionally not auto-saved.
    }
    return result;
  }

  async function testSelector(tabId, rawSelector, visibility = "any", rawConfig = null, kind = "selector") {
    const tab = await browser.tabs.get(tabId);
    const active = await currentTab();
    if (!Number.isInteger(active?.id) || active.id !== tabId) {
      throw new Error("Chỉ kiểm tra/highlight được tab đang hiển thị hiện tại.");
    }
    if (!isSupportedUrl(tab.url)) {
      throw new Error("Chỉ có thể kiểm tra selector trên trang HTTP hoặc HTTPS thông thường.");
    }

    const origin = hostPermissionPattern(tab.url);
    const granted = origin && await browser.permissions.contains({ origins: [origin] });
    if (!granted) {
      throw new Error("Firefox chưa cấp quyền truy cập website hiện tại.");
    }

    await ensureContentScripts(tabId);
    const response = await browser.tabs.sendMessage(tabId, {
      type: MESSAGE.CONTENT_TEST_SELECTOR,
      payload: {
        selector: rawSelector,
        visibility,
        durationMs: 8000,
        monitorConfig: kind === "monitor" && rawConfig
          ? Settings.normalizeConfig(rawConfig).monitor
          : null
      }
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Không thể kiểm tra selector.");
    }
    return response.result;
  }

  async function ensureInteractiveTab(tabId) {
    const tab = await browser.tabs.get(tabId);
    const active = await currentTab();
    if (!Number.isInteger(active?.id) || active.id !== tabId) {
      throw new Error("Chỉ thao tác thử trên tab đang hiển thị hiện tại.");
    }
    if (!isSupportedUrl(tab.url)) {
      throw new Error("Chỉ có thể thao tác trên trang HTTP hoặc HTTPS thông thường.");
    }
    const origin = hostPermissionPattern(tab.url);
    const granted = origin && await browser.permissions.contains({ origins: [origin] });
    if (!granted) {
      throw new Error("Firefox chưa cấp quyền truy cập website hiện tại.");
    }
    await ensureContentScripts(tabId);
    return tab;
  }

  async function testTargetAction(tabId, rawConfig, click = false) {
    await ensureInteractiveTab(tabId);
    const response = await browser.tabs.sendMessage(tabId, {
      type: MESSAGE.CONTENT_TEST_TARGET_ACTION,
      payload: {
        config: Settings.normalizeConfig(rawConfig),
        click: Boolean(click),
        durationMs: 8000
      }
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Không thể thử target action.");
    }
    const session = sessions.get(tabId);
    if (session) {
      appendLog(
        session,
        "user",
        click ? "target-test-click" : "target-test-dry-run",
        click
          ? `Đã click thử ${response.result.selectedCount} target hiện tại.`
          : `Đã highlight thử ${response.result.selectedCount} target hiện tại.`,
        response.result
      );
      await persistSession(session);
    }
    await broadcast("target-test", tabId);
    return response.result;
  }

  async function clearHighlights(tabId) {
    await ensureInteractiveTab(tabId);
    const response = await browser.tabs.sendMessage(tabId, {
      type: MESSAGE.CONTENT_CLEAR_HIGHLIGHTS
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Không thể xóa highlight.");
    }
    return response.result;
  }

  async function clearSessionLogs(tabId) {
    const session = sessions.get(tabId);
    if (!session) {
      throw new Error("Tab này chưa được kích hoạt.");
    }
    session.logs = { user: [], debug: [] };
    await persistSession(session);
    await broadcast("logs-cleared", tabId);
  }

  async function updateRuntimeFromContent(message, sender) {
    const tabId = sender?.tab?.id;
    if (!Number.isInteger(tabId)) {
      throw new Error("Runtime event không có tabId hợp lệ.");
    }
    const session = sessions.get(tabId);
    if (!session) {
      return null;
    }
    const store = await loadStore();
    const previous = { ...session.runtime };
    const incoming = message.payload?.runtime || {};
    session.runtime = { ...session.runtime, ...incoming };
    session.updatedAt = session.runtime.lastEventAt || Settings.nowIso();

    if (previous.monitorState !== session.runtime.monitorState) {
      appendLog(
        session,
        "user",
        "monitor-state",
        `Monitor ${previous.monitorState || "unknown"} → ${session.runtime.monitorState || "unknown"}`,
        { cycle: session.runtime.cycle, reason: session.runtime.lastReason }
      );
    }
    if (session.runtime.lastTransition && session.runtime.lastTransition !== previous.lastTransition) {
      appendLog(session, "debug", "monitor-transition", session.runtime.lastTransition, incoming);
    }
    if (session.runtime.lastTargetAction && session.runtime.lastTargetAction !== previous.lastTargetAction) {
      appendLog(
        session,
        session.runtime.lastTargetAction.startsWith("click:") || session.runtime.lastTargetAction.startsWith("dry-run:") ? "user" : "debug",
        "target-action",
        session.runtime.lastTargetAction,
        { clicked: session.runtime.clickedCount, dryRun: session.runtime.dryRunCount }
      );
    }
    if (session.runtime.lastTargetError && session.runtime.lastTargetError !== previous.lastTargetError) {
      appendLog(session, "user", "target-error", session.runtime.lastTargetError);
    }
    appendLog(session, "debug", "runtime", session.runtime.lastReason || session.runtime.lastTargetAction || "runtime-update", incoming);

    const alertStarted = Boolean(session.runtime.alertActive) && (
      !previous.alertActive || Number(session.runtime.alertCycle || 0) > Number(previous.alertCycle || 0)
    );
    const alertDismissed = Boolean(previous.alertActive) && !session.runtime.alertActive;
    if (alertStarted) {
      appendLog(
        session,
        "user",
        "alert-started",
        `Cảnh báo chu kỳ ${session.runtime.alertCycle || session.runtime.cycle || 0} đã bật.`,
        { monitorState: session.runtime.monitorState, reason: session.runtime.lastAlertReason }
      );
    }
    if (alertDismissed) {
      appendLog(
        session,
        "user",
        "alert-dismissed",
        `Cảnh báo đã xác nhận: ${session.runtime.alertDismissReason || "unknown"}.`,
        { acknowledgedAt: session.runtime.alertAcknowledgedAt }
      );
    }
    await updateBadge(session, store);
    if (alertStarted) {
      await showMatchedNotification(session, store);
    } else if (alertDismissed) {
      await clearNotification(tabId);
    }
    await persistSession(session);
    await broadcast("runtime-updated", tabId);
    return clone(session.runtime);
  }

  async function activateTab(tab, source, requestedProfileId = null) {
    if (!Number.isInteger(tab?.id)) {
      throw new Error("Không xác định được tab hiện tại.");
    }
    if (!isSupportedUrl(tab.url)) {
      throw new Error("Chỉ có thể kích hoạt trên trang HTTP hoặc HTTPS thông thường.");
    }

    const store = await loadStore();
    const existing = sessions.get(tab.id);
    if (existing) {
      if (existing.mode === MODE.PAUSED) {
        return resumeTab(tab.id);
      }
      return publicSession(existing, store);
    }

    const profile = Settings.profileById(store, requestedProfileId) ||
      Settings.profileById(store, store.defaultProfileId) || store.profiles[0];
    if (!Settings.urlAllowed(profile.config, tab.url)) {
      throw new Error("URL hiện tại không khớp allowlist của profile đã chọn.");
    }

    if (source === "sidebar") {
      const origin = hostPermissionPattern(tab.url);
      const granted = origin && await browser.permissions.contains({ origins: [origin] });
      if (!granted) {
        throw new Error(
          "Firefox chưa cấp quyền truy cập website này. Hãy bấm lại “Kích hoạt tab hiện tại” và chấp nhận hộp thoại quyền."
        );
      }
    }

    await ensureContentScripts(tab.id);

    const session = makeSession(tab, profile.id, source);
    await applySessionToContent(session, store, MESSAGE.CONTENT_ACTIVATE);
    appendLog(session, "user", "activated", `Đã kích hoạt tab bằng ${source}.`, { url: tab.url, profileId: profile.id });
    sessions.set(tab.id, session);
    await persistSession(session);
    await updateBadge(session, store);
    await broadcast("activated", tab.id);
    return publicSession(session, store);
  }

  async function pauseTab(tabId) {
    const session = sessions.get(tabId);
    if (!session) {
      throw new Error("Tab này chưa được kích hoạt.");
    }
    const response = await browser.tabs.sendMessage(tabId, {
      type: MESSAGE.CONTENT_PAUSE
    });
    session.mode = MODE.PAUSED;
    session.updatedAt = response?.updatedAt || Settings.nowIso();
    session.runtime = { ...session.runtime, ...(response?.runtime || {}), monitorState: MONITOR_STATE.PAUSED };
    appendLog(session, "user", "paused", "Đã tạm dừng theo dõi tab.");
    const store = await loadStore();
    await persistSession(session);
    await clearNotification(tabId);
    await updateBadge(session, store);
    await broadcast("paused", tabId);
  }

  async function resumeTab(tabId) {
    const session = sessions.get(tabId);
    if (!session) {
      throw new Error("Tab này chưa được kích hoạt.");
    }
    const response = await browser.tabs.sendMessage(tabId, {
      type: MESSAGE.CONTENT_RESUME
    });
    session.mode = MODE.ACTIVE;
    session.updatedAt = response?.updatedAt || Settings.nowIso();
    session.runtime = { ...session.runtime, ...(response?.runtime || {}), monitorState: MONITOR_STATE.IDLE };
    appendLog(session, "user", "resumed", "Đã tiếp tục theo dõi tab và lập baseline mới.");
    const store = await loadStore();
    await persistSession(session);
    await updateBadge(session, store);
    await broadcast("resumed", tabId);
  }

  async function stopTab(tabId, fallbackTab = null) {
    const session = sessions.get(tabId);
    try {
      await browser.tabs.sendMessage(tabId, { type: MESSAGE.CONTENT_STOP });
    } catch (_error) {
      // Navigation or shutdown may remove the content context first.
    }
    pickerStates.delete(tabId);
    sessions.delete(tabId);
    await removePersistedSession(tabId);
    await clearNotification(tabId);
    await applyBadge(tabId, "", null);
    await broadcast("stopped", tabId);
    return {
      ...tabMeta(fallbackTab || { id: tabId }),
      mode: MODE.INACTIVE,
      activatedAt: session?.activatedAt || null,
      updatedAt: Settings.nowIso()
    };
  }

  async function assignProfile(tabId, profileId) {
    const store = await loadStore();
    const session = sessions.get(tabId);
    const profile = Settings.profileById(store, profileId);
    if (!session) {
      throw new Error("Tab này chưa được kích hoạt.");
    }
    if (!profile) {
      throw new Error("Không tìm thấy profile.");
    }
    if (!Settings.urlAllowed(profile.config, session.url)) {
      throw new Error("URL của tab không khớp allowlist profile.");
    }
    session.profileId = profile.id;
    session.configMode = CONFIG_MODE.PROFILE;
    session.tabConfig = null;
    session.configRevision += 1;
    await applySessionToContent(session, store);
    await persistSession(session);
    await updateBadge(session, store);
    await broadcast("profile-assigned", tabId);
  }

  async function saveTabConfig(tabId, rawConfig) {
    const store = await loadStore();
    const session = sessions.get(tabId);
    if (!session) {
      throw new Error("Tab này chưa được kích hoạt.");
    }
    const validation = Settings.validateConfig(rawConfig);
    if (!validation.ok) {
      throw new Error(validation.errors.join("\n"));
    }
    if (!Settings.urlAllowed(validation.config, session.url)) {
      throw new Error("URL của tab không khớp allowlist trong cấu hình tab.");
    }
    session.configMode = CONFIG_MODE.TAB;
    session.tabConfig = validation.config;
    session.configRevision += 1;
    await applySessionToContent(session, store);
    await persistSession(session);
    await updateBadge(session, store);
    await broadcast("tab-config-saved", tabId);
  }

  async function resetTabConfig(tabId) {
    const store = await loadStore();
    const session = sessions.get(tabId);
    if (!session) {
      throw new Error("Tab này chưa được kích hoạt.");
    }
    session.configMode = CONFIG_MODE.PROFILE;
    session.tabConfig = null;
    session.configRevision += 1;
    await applySessionToContent(session, store);
    await persistSession(session);
    await updateBadge(session, store);
    await broadcast("tab-config-reset", tabId);
  }

  async function updateProfileSessions(profileId, store) {
    for (const session of sessions.values()) {
      if (session.profileId !== profileId || session.configMode !== CONFIG_MODE.PROFILE) {
        continue;
      }
      session.configRevision += 1;
      try {
        await applySessionToContent(session, store);
        await persistSession(session);
        await updateBadge(session, store);
      } catch (error) {
        session.mode = MODE.ERROR;
        session.error = error instanceof Error ? error.message : String(error);
        await updateBadge(session, store);
      }
    }
  }

  async function createProfile(name, baseProfileId = null) {
    const store = await loadStore();
    const base = Settings.profileById(store, baseProfileId);
    const profile = Settings.createProfile(name, base?.config || Settings.defaultConfig());
    store.profiles.push(profile);
    const saved = await saveStore(store);
    await broadcast("profile-created");
    return { store: saved, profileId: profile.id };
  }

  async function saveProfile(rawProfile) {
    const store = await loadStore();
    const incoming = Settings.normalizeProfile(rawProfile);
    const validation = Settings.validateConfig(incoming.config);
    if (!validation.ok) {
      throw new Error(validation.errors.join("\n"));
    }
    incoming.config = validation.config;
    incoming.updatedAt = Settings.nowIso();
    const index = store.profiles.findIndex((profile) => profile.id === incoming.id);
    if (index < 0) {
      throw new Error("Không tìm thấy profile để lưu.");
    }
    incoming.createdAt = store.profiles[index].createdAt;
    store.profiles[index] = incoming;
    const saved = await saveStore(store);
    await updateProfileSessions(incoming.id, saved);
    await broadcast("profile-saved");
    return saved;
  }

  async function deleteProfile(profileId) {
    const store = await loadStore();
    if (store.profiles.length <= 1) {
      throw new Error("Phải giữ lại ít nhất một profile.");
    }
    if (profileId === store.defaultProfileId) {
      throw new Error("Không thể xóa profile mặc định.");
    }
    if (!Settings.profileById(store, profileId)) {
      throw new Error("Không tìm thấy profile.");
    }
    store.profiles = store.profiles.filter((profile) => profile.id !== profileId);
    const saved = await saveStore(store);
    for (const session of sessions.values()) {
      if (session.profileId === profileId) {
        session.profileId = saved.defaultProfileId;
        session.configMode = CONFIG_MODE.PROFILE;
        session.tabConfig = null;
        session.configRevision += 1;
        await applySessionToContent(session, saved);
        await persistSession(session);
        await updateBadge(session, saved);
      }
    }
    await broadcast("profile-deleted");
    return saved;
  }

  async function importSettings(text) {
    const imported = Settings.importStore(text);
    const saved = await saveStore(imported);
    for (const session of sessions.values()) {
      if (!Settings.profileById(saved, session.profileId)) {
        session.profileId = saved.defaultProfileId;
        session.configMode = CONFIG_MODE.PROFILE;
        session.tabConfig = null;
      }
      session.configRevision += 1;
      await applySessionToContent(session, saved);
      await persistSession(session);
      await updateBadge(session, saved);
    }
    await broadcast("settings-imported");
    return saved;
  }

  async function dashboard() {
    await recoverAll();
    const store = await loadStore();
    const tab = await currentTab();
    const publicSessions = [...sessions.values()]
      .map((session) => publicSession(session, store))
      .sort((left, right) => left.tabId - right.tabId);
    return {
      protocolVersion: globalThis.FCI_PROTOCOL.VERSION,
      currentTab: tabMeta(tab),
      sessions: publicSessions,
      store,
      nativeHost: nativeDashboardState(),
      pickers: [...pickerStates.values()].map((state) => clone(state))
    };
  }

  function errorResponse(error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }

  async function handleRequest(message, sender = null) {
    try {
      switch (message.type) {
        case MESSAGE.GET_DASHBOARD:
          return { ok: true, dashboard: await dashboard() };

        case MESSAGE.ACTIVATE_CURRENT: {
          const requestedTabId = Number(message.tabId);
          const tab = Number.isInteger(requestedTabId)
            ? await browser.tabs.get(requestedTabId)
            : await currentTab();
          await activateTab(tab, "sidebar", message.profileId || null);
          return { ok: true, dashboard: await dashboard() };
        }

        case MESSAGE.PAUSE_TAB:
          await pauseTab(Number(message.tabId));
          return { ok: true, dashboard: await dashboard() };

        case MESSAGE.RESUME_TAB:
          await resumeTab(Number(message.tabId));
          return { ok: true, dashboard: await dashboard() };

        case MESSAGE.STOP_TAB:
          await stopTab(Number(message.tabId));
          return { ok: true, dashboard: await dashboard() };

        case MESSAGE.ASSIGN_PROFILE:
          await assignProfile(Number(message.tabId), message.profileId);
          return { ok: true, dashboard: await dashboard() };

        case MESSAGE.SAVE_TAB_CONFIG:
          await saveTabConfig(Number(message.tabId), message.config);
          return { ok: true, dashboard: await dashboard() };

        case MESSAGE.RESET_TAB_CONFIG:
          await resetTabConfig(Number(message.tabId));
          return { ok: true, dashboard: await dashboard() };

        case MESSAGE.CREATE_PROFILE: {
          const result = await createProfile(message.name, message.baseProfileId);
          return { ok: true, profileId: result.profileId, dashboard: await dashboard() };
        }

        case MESSAGE.DUPLICATE_PROFILE: {
          const store = await loadStore();
          const base = Settings.profileById(store, message.profileId);
          if (!base) {
            throw new Error("Không tìm thấy profile để nhân bản.");
          }
          const result = await createProfile(message.name || `${base.name} - bản sao`, base.id);
          return { ok: true, profileId: result.profileId, dashboard: await dashboard() };
        }

        case MESSAGE.SAVE_PROFILE:
          await saveProfile(message.profile);
          return { ok: true, dashboard: await dashboard() };

        case MESSAGE.DELETE_PROFILE:
          await deleteProfile(message.profileId);
          return { ok: true, dashboard: await dashboard() };

        case MESSAGE.EXPORT_SETTINGS: {
          const store = await loadStore();
          return { ok: true, text: Settings.exportStore(store) };
        }

        case MESSAGE.IMPORT_SETTINGS:
          await importSettings(message.text);
          return { ok: true, dashboard: await dashboard() };

        case MESSAGE.START_ELEMENT_PICKER:
          return {
            ok: true,
            picker: await startElementPicker(Number(message.tabId), message.kind),
            dashboard: await dashboard()
          };

        case MESSAGE.CANCEL_ELEMENT_PICKER:
          return {
            ok: true,
            picker: await cancelElementPicker(Number(message.tabId), message.reason || "sidebar-cancel"),
            dashboard: await dashboard()
          };

        case MESSAGE.TEST_SELECTOR:
          return {
            ok: true,
            result: await testSelector(
              Number(message.tabId),
              message.selector,
              message.visibility || "any",
              message.config || null,
              message.kind || "selector"
            )
          };

        case MESSAGE.TEST_TARGET_ACTION:
          return {
            ok: true,
            result: await testTargetAction(
              Number(message.tabId),
              message.config,
              Boolean(message.click)
            ),
            dashboard: await dashboard()
          };

        case MESSAGE.CLEAR_HIGHLIGHTS:
          return {
            ok: true,
            result: await clearHighlights(Number(message.tabId))
          };

        case MESSAGE.CLEAR_SESSION_LOGS:
          await clearSessionLogs(Number(message.tabId));
          return { ok: true, dashboard: await dashboard() };

        case MESSAGE.GET_NATIVE_STATUS:
          return { ok: true, nativeHost: await checkNativeStatus(sender), dashboard: await dashboard() };

        case MESSAGE.RUN_SHELL:
          return { ok: true, shellRun: await runShell(message, sender), dashboard: await dashboard() };

        case MESSAGE.STOP_SHELL:
          return { ok: true, shellRun: await stopShell(message, sender), dashboard: await dashboard() };

        case MESSAGE.CLEAR_SHELL_OUTPUT:
          return { ok: true, shellRun: await clearShellOutput(message, sender), dashboard: await dashboard() };

        case MESSAGE.CONTENT_RUNTIME_EVENT:
          return { ok: true, runtime: await updateRuntimeFromContent(message, sender) };

        case MESSAGE.CONTENT_PICKER_RESULT:
          return { ok: true, result: await handleElementPickerResult(message, sender) };

        default:
          return undefined;
      }
    } catch (error) {
      return errorResponse(error);
    }
  }

  browser.action.onClicked.addListener((tab) => {
    void browser.sidebarAction.open().catch((error) => {
      console.error("FirefoxChatImprover: cannot open sidebar", error);
    });
    void activateTab(tab, "toolbar").catch(async (error) => {
      if (Number.isInteger(tab?.id)) {
        await applyBadge(tab.id, "!", "#cf222e");
      }
      await broadcast("activation-error", tab?.id || null);
      console.error("FirefoxChatImprover: activation failed", error);
    });
  });

  const requestTypes = new Set([
    MESSAGE.GET_DASHBOARD,
    MESSAGE.ACTIVATE_CURRENT,
    MESSAGE.PAUSE_TAB,
    MESSAGE.RESUME_TAB,
    MESSAGE.STOP_TAB,
    MESSAGE.ASSIGN_PROFILE,
    MESSAGE.SAVE_TAB_CONFIG,
    MESSAGE.RESET_TAB_CONFIG,
    MESSAGE.CREATE_PROFILE,
    MESSAGE.DUPLICATE_PROFILE,
    MESSAGE.SAVE_PROFILE,
    MESSAGE.DELETE_PROFILE,
    MESSAGE.EXPORT_SETTINGS,
    MESSAGE.IMPORT_SETTINGS,
    MESSAGE.TEST_SELECTOR,
    MESSAGE.START_ELEMENT_PICKER,
    MESSAGE.CANCEL_ELEMENT_PICKER,
    MESSAGE.TEST_TARGET_ACTION,
    MESSAGE.CLEAR_HIGHLIGHTS,
    MESSAGE.CLEAR_SESSION_LOGS,
    MESSAGE.GET_NATIVE_STATUS,
    MESSAGE.RUN_SHELL,
    MESSAGE.STOP_SHELL,
    MESSAGE.CLEAR_SHELL_OUTPUT,
    MESSAGE.CONTENT_RUNTIME_EVENT,
    MESSAGE.CONTENT_PICKER_RESULT
  ]);


  const SIDEBAR_REQUEST_TYPES = new Set([
    MESSAGE.GET_DASHBOARD,
    MESSAGE.ACTIVATE_CURRENT,
    MESSAGE.PAUSE_TAB,
    MESSAGE.RESUME_TAB,
    MESSAGE.STOP_TAB,
    MESSAGE.ASSIGN_PROFILE,
    MESSAGE.SAVE_TAB_CONFIG,
    MESSAGE.RESET_TAB_CONFIG,
    MESSAGE.CREATE_PROFILE,
    MESSAGE.DUPLICATE_PROFILE,
    MESSAGE.SAVE_PROFILE,
    MESSAGE.DELETE_PROFILE,
    MESSAGE.EXPORT_SETTINGS,
    MESSAGE.IMPORT_SETTINGS,
    MESSAGE.TEST_SELECTOR,
    MESSAGE.START_ELEMENT_PICKER,
    MESSAGE.CANCEL_ELEMENT_PICKER,
    MESSAGE.TEST_TARGET_ACTION,
    MESSAGE.CLEAR_HIGHLIGHTS,
    MESSAGE.CLEAR_SESSION_LOGS,
    MESSAGE.GET_NATIVE_STATUS,
    MESSAGE.RUN_SHELL,
    MESSAGE.STOP_SHELL,
    MESSAGE.CLEAR_SHELL_OUTPUT
  ]);

  function validateRequestSender(message, sender) {
    if ([MESSAGE.CONTENT_RUNTIME_EVENT, MESSAGE.CONTENT_PICKER_RESULT].includes(message.type)) {
      if (!Number.isInteger(sender?.tab?.id)) {
        throw new Error("Content event chỉ được nhận từ content script trong một tab.");
      }
      return;
    }
    if (SIDEBAR_REQUEST_TYPES.has(message.type)) {
      if (sender?.tab) {
        throw new Error("Yêu cầu quản trị chỉ được gửi từ sidebar, không phải content script.");
      }
      const sidebarPrefix = browser.runtime.getURL("sidebar/");
      if (typeof sender?.url !== "string" || !sender.url.startsWith(sidebarPrefix)) {
        throw new Error("Yêu cầu quản trị không xuất phát từ sidebar hợp lệ.");
      }
    }
  }

  browser.runtime.onMessage.addListener((message, sender) => {
    if (!message || !requestTypes.has(message.type)) {
      return undefined;
    }
    try {
      validateRequestSender(message, sender);
    } catch (error) {
      return Promise.resolve(errorResponse(error));
    }
    return handleRequest(message, sender);
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const session = sessions.get(tabId);
    if (!session) {
      return;
    }
    const navigated =
      changeInfo.status === "loading" ||
      (typeof changeInfo.url === "string" && changeInfo.url !== session.url);
    if (navigated) {
      void stopTab(tabId, tab);
      return;
    }
    if (typeof changeInfo.title === "string" && !session.runtime?.alertActive) {
      session.title = changeInfo.title;
      session.updatedAt = Settings.nowIso();
      void persistSession(session);
      void broadcast("tab-title-updated", tabId);
    }
  });

  browser.tabs.onActivated.addListener((activeInfo) => {
    void broadcast("active-tab-changed", activeInfo.tabId);
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    const shellRun = shellRuns.get(tabId);
    if (shellRun?.runId && ["starting", "running", "terminal", "stopping"].includes(shellRun.status)) {
      try {
        ensureNativePort().postMessage({ action: "stop", runId: shellRun.runId, tabId });
      } catch (_error) {
        // Native host may already be unavailable during browser shutdown.
      }
    }
    shellRuns.delete(tabId);
    pickerStates.delete(tabId);
    const timer = shellBroadcastTimers.get(tabId);
    if (timer) {
      clearTimeout(timer);
      shellBroadcastTimers.delete(tabId);
    }
    if (shellRun?.runId) {
      runToTab.delete(shellRun.runId);
    }
    if (!sessions.has(tabId)) {
      return;
    }
    sessions.delete(tabId);
    void clearNotification(tabId);
    void broadcast("tab-removed", tabId);
  });

  browser.notifications.onClicked.addListener((notificationId) => {
    const match = /^fci-tab-(\d+)$/.exec(notificationId);
    if (!match) {
      return;
    }
    const tabId = Number(match[1]);
    const session = sessions.get(tabId);
    if (!session) {
      return;
    }
    void browser.windows.update(session.windowId, { focused: true }).catch(() => { });
    void browser.tabs.update(tabId, { active: true }).catch(() => { });
    void clearNotification(tabId);
  });
})();
