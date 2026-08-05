(() => {
  "use strict";
  const query = new URLSearchParams(location.search);
  const tabName = query.get("tab") || "unknown";
  document.title = `FirefoxChatImprover E2E ${tabName}`;
  document.documentElement.dataset.e2eTab = tabName;
  document.documentElement.dataset.e2eClicks = "0";

  function monitor() {
    return document.getElementById("monitor");
  }

  function setMonitor(state) {
    const value = state === "ready" ? "ready" : "waiting";
    monitor().dataset.state = value;
    monitor().textContent = value;
    return value;
  }

  function addTarget(id = `target-${Date.now()}`) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "download-target";
    button.dataset.e2eTargetId = id;
    button.textContent = `Target ${id}`;
    button.addEventListener("click", () => {
      const next = Number(document.documentElement.dataset.e2eClicks || 0) + 1;
      document.documentElement.dataset.e2eClicks = String(next);
      document.getElementById("result").textContent = `clicked:${id}:${next}`;
    });
    document.getElementById("targets").append(button);
    return id;
  }

  function clearTargets() {
    document.getElementById("targets").replaceChildren();
  }

  function spaNavigate(suffix = "next") {
    history.pushState({ suffix }, "", `/fixture.html?tab=${encodeURIComponent(tabName)}&spa=${encodeURIComponent(suffix)}`);
    document.title = `FirefoxChatImprover E2E ${tabName} ${suffix}`;
    return location.href;
  }

  function setDownload(name = "e2e.bin") {
    const link = document.getElementById("download-link");
    link.href = `/download/${encodeURIComponent(name)}`;
    link.download = name;
    return link.href;
  }

  Object.defineProperty(window, "FCI_E2E_FIXTURE", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({ setMonitor, addTarget, clearTargets, spaNavigate, setDownload })
  });
})();
