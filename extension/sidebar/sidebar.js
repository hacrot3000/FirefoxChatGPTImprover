(() => {
  "use strict";

  const { MESSAGE, MODE, CONFIG_MODE } = globalThis.FCI_PROTOCOL;
  const Settings = globalThis.FCI_SETTINGS;
  const $ = (selector) => document.querySelector(selector);
  const elements = {
    body: document.body,
    statusPill: $("#statusPill"), tabSelect: $("#tabSelect"), tabId: $("#tabId"),
    modeText: $("#modeText"), configModeText: $("#configModeText"), profileText: $("#profileText"), tabUrl: $("#tabUrl"),
    monitorStateText: $("#monitorStateText"), monitorCountText: $("#monitorCountText"), monitorMatchedText: $("#monitorMatchedText"), monitorCycleText: $("#monitorCycleText"), monitorTransitionText: $("#monitorTransitionText"), alertStateText: $("#alertStateText"), targetStateText: $("#targetStateText"), baselineCountText: $("#baselineCountText"), candidateCountText: $("#candidateCountText"), targetActionCountText: $("#targetActionCountText"), lastTargetActionText: $("#lastTargetActionText"),
    activateButton: $("#activateButton"), pauseButton: $("#pauseButton"), resumeButton: $("#resumeButton"), stopButton: $("#stopButton"), refreshButton: $("#refreshButton"),
    profileSelect: $("#profileSelect"), profileName: $("#profileName"), assignProfileButton: $("#assignProfileButton"), newProfileButton: $("#newProfileButton"), duplicateProfileButton: $("#duplicateProfileButton"), deleteProfileButton: $("#deleteProfileButton"),
    requireUrlMatch: $("#requireUrlMatch"), urlPatterns: $("#urlPatterns"),
    monitorTag: $("#monitorTag"), monitorKind: $("#monitorKind"), monitorAttributeName: $("#monitorAttributeName"), monitorValue: $("#monitorValue"), monitorVisibilityTransition: $("#monitorVisibilityTransition"), monitorTestButton: $("#monitorTestButton"), monitorTestResult: $("#monitorTestResult"), conditionJoin: $("#conditionJoin"), addConditionButton: $("#addConditionButton"), conditionsList: $("#conditionsList"), conditionTemplate: $("#conditionTemplate"),
    targetEnabled: $("#targetEnabled"), targetTag: $("#targetTag"), targetKind: $("#targetKind"), targetAttributeName: $("#targetAttributeName"), targetValue: $("#targetValue"), targetTestButton: $("#targetTestButton"), targetTestResult: $("#targetTestResult"), targetDryRunTestButton: $("#targetDryRunTestButton"), targetClickTestButton: $("#targetClickTestButton"), clickStrategy: $("#clickStrategy"), maxClicksPerCycle: $("#maxClicksPerCycle"), visibleOnly: $("#visibleOnly"), enabledOnly: $("#enabledOnly"), dryRun: $("#dryRun"), fingerprintAttributes: $("#fingerprintAttributes"),
    titleBlink: $("#titleBlink"), titlePrefix: $("#titlePrefix"), blinkIntervalMs: $("#blinkIntervalMs"), badgeAlert: $("#badgeAlert"), sidebarAlert: $("#sidebarAlert"), notificationAlert: $("#notificationAlert"),
    logChannel: $("#logChannel"), activityLog: $("#activityLog"), copyLogsButton: $("#copyLogsButton"), clearLogsButton: $("#clearLogsButton"),
    workingDirectory: $("#workingDirectory"), shellCommand: $("#shellCommand"), shellMode: $("#shellMode"), confirmBeforeRun: $("#confirmBeforeRun"),
    saveProfileButton: $("#saveProfileButton"), saveTabButton: $("#saveTabButton"), resetTabButton: $("#resetTabButton"), exportButton: $("#exportButton"), importButton: $("#importButton"), clearHighlightsButton: $("#clearHighlightsButton"), importFile: $("#importFile"), messageBox: $("#messageBox")
  };

  const modeLabels = {
    [MODE.INACTIVE]: "Chưa kích hoạt",
    [MODE.ACTIVE]: "Đang hoạt động",
    [MODE.PAUSED]: "Đang tạm dừng",
    [MODE.ERROR]: "Có lỗi"
  };
  let dashboard = { currentTab: {}, sessions: [], store: Settings.defaultStore() };
  let selectedTabId = null;
  let selectedProfileId = null;
  let busy = false;
  let activeTabRefreshSerial = 0;

  function showMessage(text = "", level = "info") {
    elements.messageBox.textContent = text;
    elements.messageBox.dataset.level = level;
  }

  function sessionById(tabId) {
    return dashboard.sessions.find((session) => session.tabId === Number(tabId)) || null;
  }

  function profileById(profileId) {
    return Settings.profileById(dashboard.store, profileId) || dashboard.store.profiles[0];
  }

  function selectedSession() {
    return sessionById(selectedTabId);
  }

  function addConditionRow(condition = null) {
    const normalized = condition || {
      enabled: true, attribute: "aria-label", operator: "equals", value: "", caseSensitive: true
    };
    const row = elements.conditionTemplate.content.firstElementChild.cloneNode(true);
    row.querySelector('[data-field="enabled"]').checked = normalized.enabled;
    row.querySelector('[data-field="attribute"]').value = normalized.attribute;
    row.querySelector('[data-field="operator"]').value = normalized.operator;
    row.querySelector('[data-field="value"]').value = normalized.value;
    row.querySelector('[data-field="caseSensitive"]').checked = normalized.caseSensitive;
    row.querySelector('[data-action="remove-condition"]').addEventListener("click", () => {
      row.remove();
    });
    elements.conditionsList.append(row);
  }

  function writeConfig(config) {
    const value = Settings.normalizeConfig(config);
    elements.requireUrlMatch.checked = value.activation.requireUrlMatch;
    elements.urlPatterns.value = value.activation.urlPatterns.join("\n");
    elements.monitorTag.value = value.monitor.selector.tag;
    elements.monitorKind.value = value.monitor.selector.kind;
    elements.monitorAttributeName.value = value.monitor.selector.attributeName;
    elements.monitorValue.value = value.monitor.selector.value;
    elements.monitorVisibilityTransition.value = value.monitor.visibilityTransition;
    elements.conditionJoin.value = value.monitor.conditionJoin;
    elements.conditionsList.replaceChildren();
    value.monitor.conditions.forEach(addConditionRow);
    elements.targetEnabled.checked = value.target.enabled;
    elements.targetTag.value = value.target.selector.tag;
    elements.targetKind.value = value.target.selector.kind;
    elements.targetAttributeName.value = value.target.selector.attributeName;
    elements.targetValue.value = value.target.selector.value;
    elements.clickStrategy.value = value.target.clickStrategy;
    elements.maxClicksPerCycle.value = String(value.target.maxClicksPerCycle);
    elements.visibleOnly.checked = value.target.visibleOnly;
    elements.enabledOnly.checked = value.target.enabledOnly;
    elements.dryRun.checked = value.target.dryRun;
    elements.fingerprintAttributes.value = value.target.fingerprintAttributes.join(", ");
    elements.titleBlink.checked = value.alerts.titleBlink;
    elements.titlePrefix.value = value.alerts.titlePrefix;
    elements.blinkIntervalMs.value = String(value.alerts.blinkIntervalMs);
    elements.badgeAlert.checked = value.alerts.badge;
    elements.sidebarAlert.checked = value.alerts.sidebar;
    elements.notificationAlert.checked = value.alerts.notification;
    elements.workingDirectory.value = value.shell.workingDirectory;
    elements.shellCommand.value = value.shell.command;
    elements.shellMode.value = value.shell.mode;
    elements.confirmBeforeRun.checked = value.shell.confirmBeforeRun;
  }

  function readSelector(prefix) {
    return {
      tag: elements[`${prefix}Tag`].value,
      kind: elements[`${prefix}Kind`].value,
      attributeName: elements[`${prefix}AttributeName`].value,
      value: elements[`${prefix}Value`].value
    };
  }

  function readConditions() {
    return [...elements.conditionsList.querySelectorAll(".condition-row")].map((row) => ({
      enabled: row.querySelector('[data-field="enabled"]').checked,
      attribute: row.querySelector('[data-field="attribute"]').value,
      operator: row.querySelector('[data-field="operator"]').value,
      value: row.querySelector('[data-field="value"]').value,
      caseSensitive: row.querySelector('[data-field="caseSensitive"]').checked
    }));
  }

  function readConfig() {
    return Settings.normalizeConfig({
      activation: {
        requireUrlMatch: elements.requireUrlMatch.checked,
        urlPatterns: elements.urlPatterns.value.split(/\r?\n/)
      },
      monitor: {
        selector: readSelector("monitor"),
        visibilityTransition: elements.monitorVisibilityTransition.value,
        conditionJoin: elements.conditionJoin.value,
        conditions: readConditions()
      },
      target: {
        enabled: elements.targetEnabled.checked,
        selector: readSelector("target"),
        clickStrategy: elements.clickStrategy.value,
        maxClicksPerCycle: Number(elements.maxClicksPerCycle.value),
        visibleOnly: elements.visibleOnly.checked,
        enabledOnly: elements.enabledOnly.checked,
        dryRun: elements.dryRun.checked,
        fingerprintAttributes: elements.fingerprintAttributes.value.split(",")
      },
      alerts: {
        titleBlink: elements.titleBlink.checked,
        titlePrefix: elements.titlePrefix.value,
        blinkIntervalMs: Number(elements.blinkIntervalMs.value),
        badge: elements.badgeAlert.checked,
        sidebar: elements.sidebarAlert.checked,
        notification: elements.notificationAlert.checked
      },
      shell: {
        workingDirectory: elements.workingDirectory.value,
        command: elements.shellCommand.value,
        mode: elements.shellMode.value,
        confirmBeforeRun: elements.confirmBeforeRun.checked
      }
    });
  }

  function renderSelectors(preferredTabId = null) {
    const oldTab = selectedTabId;
    elements.tabSelect.replaceChildren();
    const current = dashboard.currentTab;
    const currentSession = sessionById(current.tabId);
    if (Number.isInteger(current.tabId) && !currentSession) {
      const option = new Option(`[Tab hiện tại] ${current.title || current.url || current.tabId}`, String(current.tabId));
      option.dataset.inactive = "true";
      elements.tabSelect.add(option);
    }
    for (const session of dashboard.sessions) {
      const marker = session.tabId === current.tabId ? "★ " : "";
      elements.tabSelect.add(new Option(`${marker}[${session.mode}] ${session.title || session.url || session.tabId}`, String(session.tabId)));
    }
    const validIds = [...elements.tabSelect.options].map((option) => Number(option.value));
    const preferred = preferredTabId === null || preferredTabId === undefined
      ? null
      : Number(preferredTabId);
    selectedTabId = preferred !== null && validIds.includes(preferred)
      ? preferred
      : (validIds.includes(Number(oldTab))
        ? Number(oldTab)
        : (Number.isInteger(current.tabId) ? current.tabId : validIds[0] || null));
    if (selectedTabId !== null) {
      elements.tabSelect.value = String(selectedTabId);
    }

    const oldProfile = selectedProfileId;
    elements.profileSelect.replaceChildren();
    for (const profile of dashboard.store.profiles) {
      const suffix = profile.id === dashboard.store.defaultProfileId ? " (mặc định)" : "";
      elements.profileSelect.add(new Option(`${profile.name}${suffix}`, profile.id));
    }
    const session = selectedSession();
    selectedProfileId = session?.profileId ||
      (dashboard.store.profiles.some((profile) => profile.id === oldProfile) ? oldProfile : dashboard.store.defaultProfileId);
    elements.profileSelect.value = selectedProfileId;
  }

  function selectedLogs() {
    const session = selectedSession();
    const channel = elements.logChannel.value === "debug" ? "debug" : "user";
    return Array.isArray(session?.logs?.[channel]) ? session.logs[channel] : [];
  }

  function formatLogLine(entry) {
    const time = entry?.at ? new Date(entry.at).toLocaleTimeString("vi-VN", { hour12: false }) : "--:--:--";
    const detail = entry?.detail ? ` | ${JSON.stringify(entry.detail)}` : "";
    return `[${time}] ${entry?.event || "event"}: ${entry?.message || ""}${detail}`;
  }

  function renderActivityLog() {
    elements.activityLog.replaceChildren();
    const logs = selectedLogs();
    if (!logs.length) {
      const item = document.createElement("li");
      item.className = "empty-log";
      item.textContent = "Chưa có sự kiện trong kênh này.";
      elements.activityLog.append(item);
      return;
    }
    for (const entry of logs.slice().reverse()) {
      const item = document.createElement("li");
      const time = document.createElement("time");
      time.dateTime = entry.at || "";
      time.textContent = entry.at ? new Date(entry.at).toLocaleTimeString("vi-VN", { hour12: false }) : "--:--:--";
      const text = document.createElement("span");
      text.textContent = `${entry.event || "event"}: ${entry.message || ""}`;
      item.append(time, text);
      if (entry.detail) {
        const detail = document.createElement("code");
        detail.textContent = JSON.stringify(entry.detail);
        item.append(detail);
      }
      elements.activityLog.append(item);
    }
  }

  function renderDetails(loadForm = true) {
    const session = selectedSession();
    const currentIsSelected = Number(dashboard.currentTab.tabId) === Number(selectedTabId);
    const mode = session?.mode || MODE.INACTIVE;
    const runtime = session?.runtime || {};
    elements.body.dataset.mode = mode;
    const sidebarAlertEnabled = Boolean(session?.effectiveConfig?.alerts?.sidebar);
    const alertActive = Boolean(runtime.alertActive || runtime.monitorState === "matched");
    elements.body.dataset.alert = sidebarAlertEnabled && alertActive ? "active" : "inactive";
    elements.statusPill.textContent = sidebarAlertEnabled && alertActive ? "Đã đạt điều kiện" : (modeLabels[mode] || mode);
    elements.tabId.textContent = Number.isInteger(selectedTabId) ? String(selectedTabId) : "—";
    elements.modeText.textContent = modeLabels[mode] || mode;
    elements.configModeText.textContent = session?.configMode === CONFIG_MODE.TAB ? "Riêng cho tab" : (session ? "Theo profile" : "Chưa tạo session");
    elements.profileText.textContent = session?.profileName || profileById(selectedProfileId)?.name || "—";
    elements.monitorStateText.textContent = runtime.monitorState || "—";
    elements.monitorCountText.textContent = session ? `${runtime.monitorCount || 0} (hiện ${runtime.monitorVisibleCount || 0}, ẩn ${runtime.monitorHiddenCount || 0})` : "—";
    elements.monitorMatchedText.textContent = session ? String(runtime.monitorMatchedCount || 0) : "—";
    elements.monitorCycleText.textContent = session ? String(runtime.cycle || 0) : "—";
    elements.alertStateText.textContent = session
      ? (runtime.alertActive ? `ACTIVE${runtime.titleBlinking ? " / title blink" : ""}` : "inactive")
      : "—";
    elements.targetStateText.textContent = session ? (runtime.targetState || "disabled") : "—";
    elements.baselineCountText.textContent = session ? String(runtime.baselineCount || 0) : "—";
    elements.candidateCountText.textContent = session ? `${runtime.candidateCount || 0} / tổng ${runtime.targetTotalCount || 0}` : "—";
    elements.targetActionCountText.textContent = session ? `${runtime.handledCount || 0} (click ${runtime.clickedCount || 0}, dry-run ${runtime.dryRunCount || 0})` : "—";
    elements.lastTargetActionText.textContent = runtime.lastTargetError || runtime.lastTargetAction || "—";
    elements.monitorTransitionText.textContent = runtime.lastVisibilityTransition || runtime.lastTransition || runtime.lastReason || "—";
    elements.tabUrl.textContent = session?.url || (currentIsSelected ? dashboard.currentTab.url : "") || "—";
    elements.activateButton.disabled = busy || !currentIsSelected || Boolean(session);
    elements.pauseButton.disabled = busy || mode !== MODE.ACTIVE;
    elements.resumeButton.disabled = busy || mode !== MODE.PAUSED;
    elements.stopButton.disabled = busy || !session;
    elements.assignProfileButton.disabled = busy || !session;
    elements.saveTabButton.disabled = busy || !session;
    elements.resetTabButton.disabled = busy || !session || session.configMode !== CONFIG_MODE.TAB;
    elements.monitorTestButton.disabled = busy || !currentIsSelected;
    elements.targetTestButton.disabled = busy || !currentIsSelected;
    elements.targetDryRunTestButton.disabled = busy || !currentIsSelected;
    elements.targetClickTestButton.disabled = busy || !currentIsSelected;
    elements.clearHighlightsButton.disabled = busy || !currentIsSelected;
    elements.copyLogsButton.disabled = busy || !session;
    elements.clearLogsButton.disabled = busy || !session;
    renderActivityLog();

    const profile = profileById(selectedProfileId);
    elements.profileName.value = profile?.name || "";
    if (loadForm) {
      writeConfig(session?.effectiveConfig || profile?.config || Settings.defaultConfig());
    }
  }

  function render(nextDashboard, loadForm = true, preferredTabId = null) {
    if (nextDashboard) {
      dashboard = nextDashboard;
    }
    renderSelectors(preferredTabId);
    renderDetails(loadForm);
  }

  function hostPermissionPattern(rawUrl) {
    try {
      const url = new URL(rawUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return null;
      }
      return `${url.protocol}//${url.host}/*`;
    } catch (_error) {
      return null;
    }
  }

  function activateCurrentTab() {
    const current = dashboard.currentTab;
    if (!Number.isInteger(current?.tabId) || Number(current.tabId) !== Number(selectedTabId)) {
      showMessage("Hãy chọn đúng tab hiện tại trước khi kích hoạt.", "error");
      return;
    }

    const activationTabId = current.tabId;
    const activeTabSerialAtStart = activeTabRefreshSerial;
    const origin = hostPermissionPattern(current.url);
    if (!origin) {
      showMessage("Chỉ có thể kích hoạt trên trang HTTP hoặc HTTPS thông thường.", "error");
      return;
    }

    // Call permissions.request() directly inside the click handler so Firefox
    // recognizes this as a user action. Request only the current website.
    const permissionRequest = browser.permissions.request({ origins: [origin] });
    setBusy(true);
    showMessage(`Đang yêu cầu quyền truy cập ${origin}`);

    void permissionRequest.then(async (granted) => {
      if (!granted) {
        throw new Error("Bạn chưa cấp quyền truy cập website này nên tab chưa được kích hoạt.");
      }
      const response = await browser.runtime.sendMessage({
        type: MESSAGE.ACTIVATE_CURRENT,
        tabId: activationTabId,
        profileId: selectedProfileId
      });
      if (!response) {
        throw new Error("Background script không trả về phản hồi.");
      }
      if (!response.ok) {
        throw new Error(response.error || "Không thể kích hoạt tab hiện tại.");
      }
      if (response.dashboard && activeTabSerialAtStart === activeTabRefreshSerial) {
        render(response.dashboard, true, activationTabId);
      }
      showMessage(`Đã cấp quyền website và kích hoạt tab ${activationTabId}.`, "success");
    }).catch((error) => {
      showMessage(error instanceof Error ? error.message : String(error), "error");
    }).finally(() => {
      setBusy(false);
    });
  }

  function selectorTestStat(label, value, kind, empty = false) {
    const item = document.createElement("span");
    item.className = "selector-test-stat";
    item.dataset.kind = kind;
    item.dataset.empty = empty ? "true" : "false";
    const caption = document.createElement("span");
    caption.textContent = label;
    const count = document.createElement("strong");
    count.textContent = String(value);
    item.append(caption, count);
    return item;
  }

  function renderSelectorTestResult(output, result, kind) {
    output.replaceChildren();
    const summary = document.createElement("span");
    summary.className = "selector-test-summary";
    const totalCount = Number(result.totalCount) || 0;
    const matchedCount = kind === "monitor"
      ? Number(result.conditionMatchedCount ?? result.selectedCount) || 0
      : Number(result.selectedCount) || 0;
    summary.append(
      selectorTestStat("Khớp selector", totalCount, "found", totalCount === 0),
      selectorTestStat(
        kind === "monitor" ? "Thỏa điều kiện" : "Được chọn",
        matchedCount,
        "matched",
        matchedCount === 0
      )
    );

    const detail = document.createElement("span");
    detail.className = "selector-test-detail";
    if (kind === "monitor") {
      const conditionText = Number(result.enabledConditionCount) > 0
        ? `${result.enabledConditionCount} điều kiện attribute đang bật`
        : "không có điều kiện attribute; mọi element selector phù hợp kiểm tra tĩnh";
      detail.textContent = `Hiện ${result.visibleCount}; ẩn ${result.hiddenCount}; ${conditionText}. Cam nét đứt = chỉ khớp selector; xanh lá = thỏa điều kiện. Highlight giữ 8 giây.`;
    } else {
      detail.textContent = `Hiện ${result.visibleCount}; ẩn ${result.hiddenCount}. Highlight giữ 8 giây.`;
    }
    output.append(summary, detail);
  }

  function testSelector(kind) {
    const current = dashboard.currentTab;
    if (!Number.isInteger(current?.tabId) || Number(current.tabId) !== Number(selectedTabId)) {
      showMessage("Chỉ kiểm tra selector trên tab đang hiển thị hiện tại.", "error");
      return;
    }

    const tabId = current.tabId;
    const origin = hostPermissionPattern(current.url);
    if (!origin) {
      showMessage("Chỉ có thể kiểm tra selector trên trang HTTP hoặc HTTPS thông thường.", "error");
      return;
    }

    const output = kind === "monitor" ? elements.monitorTestResult : elements.targetTestResult;
    const selector = readSelector(kind);
    const visibility = kind === "monitor"
      ? "any"
      : (elements.visibleOnly.checked ? "visible" : "any");

    output.textContent = "Đang kiểm tra…";
    const permissionRequest = browser.permissions.request({ origins: [origin] });
    setBusy(true);
    void permissionRequest.then(async (granted) => {
      if (!granted) {
        throw new Error("Bạn chưa cấp quyền truy cập website này.");
      }
      const response = await browser.runtime.sendMessage({
        type: MESSAGE.TEST_SELECTOR,
        tabId,
        selector,
        visibility,
        kind,
        config: kind === "monitor" ? readConfig() : null
      });
      if (!response?.ok) {
        throw new Error(response?.error || "Không thể kiểm tra selector.");
      }
      renderSelectorTestResult(output, response.result, kind);
      const matchedCount = kind === "monitor"
        ? Number(response.result.conditionMatchedCount ?? response.result.selectedCount) || 0
        : Number(response.result.selectedCount) || 0;
      showMessage(
        kind === "monitor"
          ? `Tìm thấy ${response.result.totalCount} element; ${matchedCount} element thỏa điều kiện.`
          : `Đã kiểm tra selector target: ${response.result.selectedCount}/${response.result.totalCount} element được chọn.`,
        matchedCount > 0 ? "success" : "error"
      );
    }).catch((error) => {
      output.textContent = "Kiểm tra thất bại.";
      showMessage(error instanceof Error ? error.message : String(error), "error");
    }).finally(() => {
      setBusy(false);
    });
  }

  function testTargetAction(click) {
    const current = dashboard.currentTab;
    if (!Number.isInteger(current?.tabId) || Number(current.tabId) !== Number(selectedTabId)) {
      showMessage("Chỉ thử target trên tab đang hiển thị hiện tại.", "error");
      return;
    }
    if (click && !confirm("Click thử sẽ tác động thật lên target hiện tại. Tiếp tục?")) {
      return;
    }
    void request(MESSAGE.TEST_TARGET_ACTION, {
      tabId: current.tabId,
      config: readConfig(),
      click: Boolean(click)
    }, click ? "Đã click thử target hiện tại." : "Đã dry-run target hiện tại.").then((response) => {
      if (response?.result) {
        elements.targetTestResult.textContent = `Tổng ${response.result.totalCount}; hợp lệ ${response.result.eligibleCount}; xử lý ${response.result.selectedCount}; ${click ? "đã click" : "chỉ highlight"}.`;
      }
    });
  }

  async function copySelectedLogs() {
    const text = selectedLogs().map(formatLogLine).join("\n");
    if (!text) {
      showMessage("Kênh log hiện tại đang trống.", "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      showMessage("Đã copy nhật ký của tab.", "success");
    } catch (_error) {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.append(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
      showMessage("Đã copy nhật ký của tab.", "success");
    }
  }

  async function refreshForActiveTab(preferredTabId) {
    const refreshSerial = ++activeTabRefreshSerial;
    try {
      const response = await browser.runtime.sendMessage({ type: MESSAGE.GET_DASHBOARD });
      if (refreshSerial !== activeTabRefreshSerial) {
        return;
      }
      if (!response) {
        throw new Error("Background script không trả về phản hồi.");
      }
      if (!response.ok) {
        throw new Error(response.error || "Không thể đồng bộ tab hiện tại.");
      }
      const requestedTabId = Number(preferredTabId);
      const tabId = Number.isInteger(requestedTabId)
        ? requestedTabId
        : response.dashboard?.currentTab?.tabId;
      render(response.dashboard, true, tabId);
    } catch (error) {
      if (refreshSerial === activeTabRefreshSerial) {
        showMessage(error instanceof Error ? error.message : String(error), "error");
      }
    }
  }

  function setBusy(value) {
    busy = Boolean(value);
    renderDetails(false);
    elements.refreshButton.disabled = busy;
    elements.saveProfileButton.disabled = busy;
  }

  async function request(type, payload = {}, successText = "") {
    setBusy(true);
    showMessage();
    try {
      const response = await browser.runtime.sendMessage({ type, ...payload });
      if (!response) {
        throw new Error("Background script không trả về phản hồi.");
      }
      if (!response.ok) {
        throw new Error(response.error || "Thao tác không thành công.");
      }
      if (response.profileId) {
        selectedProfileId = response.profileId;
      }
      if (response.dashboard) {
        render(response.dashboard);
      }
      if (successText) {
        showMessage(successText, "success");
      }
      return response;
    } catch (error) {
      showMessage(error instanceof Error ? error.message : String(error), "error");
      return null;
    } finally {
      setBusy(false);
    }
  }

  elements.tabSelect.addEventListener("change", () => {
    selectedTabId = Number(elements.tabSelect.value);
    const session = selectedSession();
    selectedProfileId = session?.profileId || dashboard.store.defaultProfileId;
    elements.profileSelect.value = selectedProfileId;
    renderDetails(true);
  });
  elements.profileSelect.addEventListener("change", () => {
    selectedProfileId = elements.profileSelect.value;
    const profile = profileById(selectedProfileId);
    elements.profileName.value = profile?.name || "";
    writeConfig(profile?.config || Settings.defaultConfig());
  });
  elements.addConditionButton.addEventListener("click", () => addConditionRow());
  elements.monitorTestButton.addEventListener("click", () => testSelector("monitor"));
  elements.targetTestButton.addEventListener("click", () => testSelector("target"));
  elements.targetDryRunTestButton.addEventListener("click", () => testTargetAction(false));
  elements.targetClickTestButton.addEventListener("click", () => testTargetAction(true));
  elements.logChannel.addEventListener("change", renderActivityLog);
  elements.copyLogsButton.addEventListener("click", () => void copySelectedLogs());
  elements.clearLogsButton.addEventListener("click", () => {
    if (selectedSession() && confirm("Xóa toàn bộ user/debug log của tab này?")) {
      void request(MESSAGE.CLEAR_SESSION_LOGS, { tabId: selectedTabId }, "Đã xóa nhật ký tab.");
    }
  });
  elements.clearHighlightsButton.addEventListener("click", () => void request(MESSAGE.CLEAR_HIGHLIGHTS, { tabId: selectedTabId }, "Đã xóa highlight trên tab."));
  elements.refreshButton.addEventListener("click", () => void request(MESSAGE.GET_DASHBOARD));
  elements.activateButton.addEventListener("click", activateCurrentTab);
  elements.pauseButton.addEventListener("click", () => void request(MESSAGE.PAUSE_TAB, { tabId: selectedTabId }, "Đã tạm dừng tab."));
  elements.resumeButton.addEventListener("click", () => void request(MESSAGE.RESUME_TAB, { tabId: selectedTabId }, "Đã tiếp tục tab."));
  elements.stopButton.addEventListener("click", () => void request(MESSAGE.STOP_TAB, { tabId: selectedTabId }, "Đã dừng tab."));
  elements.assignProfileButton.addEventListener("click", () => void request(MESSAGE.ASSIGN_PROFILE, { tabId: selectedTabId, profileId: selectedProfileId }, "Đã áp dụng profile cho tab."));
  elements.saveTabButton.addEventListener("click", () => void request(MESSAGE.SAVE_TAB_CONFIG, { tabId: selectedTabId, config: readConfig() }, "Đã lưu cấu hình độc lập cho tab."));
  elements.resetTabButton.addEventListener("click", () => void request(MESSAGE.RESET_TAB_CONFIG, { tabId: selectedTabId }, "Tab đã dùng lại cấu hình profile."));
  elements.newProfileButton.addEventListener("click", () => {
    const name = prompt("Tên profile mới:", "Profile mới");
    if (name) void request(MESSAGE.CREATE_PROFILE, { name, baseProfileId: selectedProfileId }, "Đã tạo profile.");
  });
  elements.duplicateProfileButton.addEventListener("click", () => {
    const base = profileById(selectedProfileId);
    const name = prompt("Tên bản sao:", `${base?.name || "Profile"} - bản sao`);
    if (name) void request(MESSAGE.DUPLICATE_PROFILE, { profileId: selectedProfileId, name }, "Đã nhân bản profile.");
  });
  elements.deleteProfileButton.addEventListener("click", () => {
    const profile = profileById(selectedProfileId);
    if (profile && confirm(`Xóa profile “${profile.name}”?`)) {
      void request(MESSAGE.DELETE_PROFILE, { profileId: profile.id }, "Đã xóa profile.");
    }
  });
  elements.saveProfileButton.addEventListener("click", () => {
    const profile = profileById(selectedProfileId);
    if (!profile) return;
    void request(MESSAGE.SAVE_PROFILE, {
      profile: { ...profile, name: elements.profileName.value, config: readConfig() }
    }, "Đã lưu profile và cập nhật các tab đang dùng profile này.");
  });
  elements.exportButton.addEventListener("click", async () => {
    const response = await request(MESSAGE.EXPORT_SETTINGS);
    if (!response?.text) return;
    const blob = new Blob([response.text], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `firefox-chat-improver-settings-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });
  elements.importButton.addEventListener("click", () => elements.importFile.click());
  elements.importFile.addEventListener("change", async () => {
    const file = elements.importFile.files?.[0];
    if (!file) return;
    const text = await file.text();
    await request(MESSAGE.IMPORT_SETTINGS, { text }, "Đã import cấu hình.");
    elements.importFile.value = "";
  });

  browser.runtime.onMessage.addListener((message) => {
    if (message?.type !== MESSAGE.DASHBOARD_CHANGED) {
      return undefined;
    }
    if (message.reason === "active-tab-changed") {
      elements.monitorTestResult.textContent = "";
      elements.targetTestResult.textContent = "";
      void refreshForActiveTab(message.changedTabId);
    } else {
      void request(MESSAGE.GET_DASHBOARD);
    }
    return undefined;
  });

  void request(MESSAGE.GET_DASHBOARD);
})();
