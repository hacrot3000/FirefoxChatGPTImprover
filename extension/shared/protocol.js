(() => {
  "use strict";

  if (globalThis.FCI_PROTOCOL) {
    return;
  }

  const protocol = Object.freeze({
    VERSION: 1,
    MESSAGE: Object.freeze({
      GET_STATUS: "FCI_GET_STATUS",
      ACTIVATE_CURRENT: "FCI_ACTIVATE_CURRENT",
      PAUSE_CURRENT: "FCI_PAUSE_CURRENT",
      STOP_CURRENT: "FCI_STOP_CURRENT",
      STATE_CHANGED: "FCI_STATE_CHANGED",
      CONTENT_ACTIVATE: "FCI_CONTENT_ACTIVATE",
      CONTENT_PAUSE: "FCI_CONTENT_PAUSE",
      CONTENT_STOP: "FCI_CONTENT_STOP",
      CONTENT_STATUS: "FCI_CONTENT_STATUS"
    }),
    MODE: Object.freeze({
      INACTIVE: "inactive",
      ACTIVE: "active",
      PAUSED: "paused",
      ERROR: "error"
    })
  });

  Object.defineProperty(globalThis, "FCI_PROTOCOL", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: protocol
  });
})();
