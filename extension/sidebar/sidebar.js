(() => {
  "use strict";

  const { MESSAGE, MODE } = globalThis.FCI_PROTOCOL;
  const elements = {
    body: document.body,
    statusPill: document.querySelector("#statusPill"),
    tabId: document.querySelector("#tabId"),
    modeText: document.querySelector("#modeText"),
    tabUrl: document.querySelector("#tabUrl"),
    activateButton: document.querySelector("#activateButton"),
    pauseButton: document.querySelector("#pauseButton"),
    stopButton: document.querySelector("#stopButton"),
    refreshButton: document.querySelector("#refreshButton"),
    messageBox: document.querySelector("#messageBox")
  };

  const modeLabels = {
    [MODE.INACTIVE]: "Chưa kích hoạt",
    [MODE.ACTIVE]: "Đang hoạt động",
    [MODE.PAUSED]: "Đang tạm dừng",
    [MODE.ERROR]: "Có lỗi"
  };

  let state = {
    tabId: null,
    url: "",
    mode: MODE.INACTIVE,
    error: null
  };
  let busy = false;

  function showMessage(text = "", level = "info") {
    elements.messageBox.textContent = text;
    elements.messageBox.dataset.level = level;
  }

  function render(nextState) {
    state = {
      ...state,
      ...(nextState || {})
    };

    const mode = modeLabels[state.mode] ? state.mode : MODE.INACTIVE;
    const label = modeLabels[mode];
    elements.body.dataset.mode = mode;
    elements.statusPill.textContent = label;
    elements.modeText.textContent = label;
    elements.tabId.textContent = Number.isInteger(state.tabId) ? String(state.tabId) : "—";
    elements.tabUrl.textContent = state.url || "—";

    elements.activateButton.disabled = busy || mode === MODE.ACTIVE;
    elements.pauseButton.disabled = busy || mode !== MODE.ACTIVE;
    elements.stopButton.disabled = busy || (mode !== MODE.ACTIVE && mode !== MODE.PAUSED);
    elements.refreshButton.disabled = busy;

    if (state.error) {
      showMessage(state.error, "error");
    }
  }

  function setBusy(value) {
    busy = Boolean(value);
    render(state);
  }

  async function request(type, successText) {
    setBusy(true);
    showMessage();

    try {
      const response = await browser.runtime.sendMessage({ type });
      if (!response) {
        throw new Error("Background script không trả về phản hồi.");
      }
      render(response.state);
      if (!response.ok) {
        throw new Error(response.error || "Thao tác không thành công.");
      }
      if (successText) {
        showMessage(successText, "success");
      }
    } catch (error) {
      showMessage(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(false);
    }
  }

  elements.activateButton.addEventListener("click", () => {
    void request(
      MESSAGE.ACTIVATE_CURRENT,
      "Đã kích hoạt tab hiện tại."
    );
  });

  elements.pauseButton.addEventListener("click", () => {
    void request(
      MESSAGE.PAUSE_CURRENT,
      "Đã tạm dừng tab hiện tại."
    );
  });

  elements.stopButton.addEventListener("click", () => {
    void request(
      MESSAGE.STOP_CURRENT,
      "Đã dừng và xóa trạng thái tab hiện tại."
    );
  });

  elements.refreshButton.addEventListener("click", () => {
    void request(MESSAGE.GET_STATUS, "Đã làm mới trạng thái.");
  });

  browser.runtime.onMessage.addListener((message) => {
    if (message?.type === MESSAGE.STATE_CHANGED && message.state) {
      render(message.state);
    }
    return undefined;
  });

  void request(MESSAGE.GET_STATUS);
})();
