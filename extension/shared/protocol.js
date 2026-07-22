(() => {
  "use strict";

  if (globalThis.FCI_PROTOCOL?.VERSION >= 2) {
    return;
  }

  const protocol = Object.freeze({
    VERSION: 2,
    MESSAGE: Object.freeze({
      GET_DASHBOARD: "FCI_GET_DASHBOARD",
      ACTIVATE_CURRENT: "FCI_ACTIVATE_CURRENT",
      PAUSE_TAB: "FCI_PAUSE_TAB",
      RESUME_TAB: "FCI_RESUME_TAB",
      STOP_TAB: "FCI_STOP_TAB",
      ASSIGN_PROFILE: "FCI_ASSIGN_PROFILE",
      SAVE_TAB_CONFIG: "FCI_SAVE_TAB_CONFIG",
      RESET_TAB_CONFIG: "FCI_RESET_TAB_CONFIG",
      CREATE_PROFILE: "FCI_CREATE_PROFILE",
      DUPLICATE_PROFILE: "FCI_DUPLICATE_PROFILE",
      SAVE_PROFILE: "FCI_SAVE_PROFILE",
      DELETE_PROFILE: "FCI_DELETE_PROFILE",
      EXPORT_SETTINGS: "FCI_EXPORT_SETTINGS",
      IMPORT_SETTINGS: "FCI_IMPORT_SETTINGS",
      DASHBOARD_CHANGED: "FCI_DASHBOARD_CHANGED",
      CONTENT_ACTIVATE: "FCI_CONTENT_ACTIVATE",
      CONTENT_PAUSE: "FCI_CONTENT_PAUSE",
      CONTENT_RESUME: "FCI_CONTENT_RESUME",
      CONTENT_STOP: "FCI_CONTENT_STOP",
      CONTENT_APPLY_SESSION: "FCI_CONTENT_APPLY_SESSION",
      CONTENT_STATUS: "FCI_CONTENT_STATUS"
    }),
    MODE: Object.freeze({
      INACTIVE: "inactive",
      ACTIVE: "active",
      PAUSED: "paused",
      ERROR: "error"
    }),
    CONFIG_MODE: Object.freeze({
      PROFILE: "profile",
      TAB: "tab"
    }),
    MONITOR_STATE: Object.freeze({
      IDLE: "idle",
      WAITING: "waiting",
      MATCHED: "matched",
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
