"use strict";
(() => {
  const host = document.querySelector("#monitor-host");
  const targetHost = document.querySelector("#target-host");
  const log = document.querySelector("#fixture-log");
  let targetSequence = 0;
  function monitor() { return host.querySelector("#composer-submit-button"); }
  function note(message) { log.textContent = `${new Date().toLocaleTimeString()} ${message}\n${log.textContent}`.slice(0, 8000); }
  function makeMonitor(source = monitor()) {
    const button = document.createElement("button");
    button.id = "composer-submit-button";
    button.className = "composer-submit-btn";
    button.setAttribute("aria-label", source?.getAttribute("aria-label") || "Send prompt");
    button.dataset.testid = source?.dataset.testid || "send-button";
    button.textContent = button.getAttribute("aria-label");
    if (source?.hidden) button.hidden = true;
    return button;
  }
  document.querySelector("#toggle-visibility").addEventListener("click", () => {
    monitor().hidden = !monitor().hidden;
    note(`monitor hidden=${monitor().hidden}`);
  });
  document.querySelector("#toggle-label").addEventListener("click", () => {
    const button = monitor();
    const stop = button.getAttribute("aria-label") !== "Stop answering";
    button.setAttribute("aria-label", stop ? "Stop answering" : "Send prompt");
    button.dataset.testid = stop ? "stop-button" : "send-button";
    button.textContent = button.getAttribute("aria-label");
    note(`aria-label=${button.getAttribute("aria-label")}`);
  });
  document.querySelector("#replace-monitor").addEventListener("click", () => {
    const current = monitor();
    current.replaceWith(makeMonitor(current));
    note("monitor node replaced");
  });
  function addTarget({ hidden = false, disabled = false } = {}) {
    targetSequence += 1;
    const button = document.createElement("button");
    button.className = "phase07-target";
    button.dataset.messageId = `message-${targetSequence}`;
    button.setAttribute("aria-label", "Continue");
    button.textContent = `Target ${targetSequence}`;
    button.hidden = hidden;
    button.disabled = disabled;
    button.addEventListener("click", () => note(`clicked ${button.dataset.messageId}`));
    targetHost.append(button);
    note(`added ${button.dataset.messageId} hidden=${hidden} disabled=${disabled}`);
  }
  document.querySelector("#add-target").addEventListener("click", () => addTarget());
  document.querySelector("#add-hidden-target").addEventListener("click", () => addTarget({ hidden: true }));
  document.querySelector("#add-disabled-target").addEventListener("click", () => addTarget({ disabled: true }));
  document.querySelector("#mutation-storm").addEventListener("click", () => {
    for (let index = 0; index < 100; index += 1) monitor().dataset.storm = String(index);
    note("mutation storm completed");
  });
  document.querySelector("#clear-targets").addEventListener("click", () => {
    targetHost.replaceChildren();
    note("targets cleared");
  });
  note("fixture ready");
})();
