(() => {
  "use strict";

  const INSTANCE_KEY = "__firefoxChatAssistantElementPickerV1";
  const VERSION = 2;
  const previous = globalThis[INSTANCE_KEY];
  if (previous?.VERSION >= VERSION) {
    return;
  }
  if (typeof previous?.shutdown === "function") {
    previous.shutdown("runtime-upgrade");
  }

  const { MESSAGE } = globalThis.FCI_PROTOCOL;
  const UI_ATTRIBUTE = "data-fci-element-picker-ui";
  const STABLE_ATTRIBUTES = ["data-testid", "data-message-id", "name", "aria-label", "role", "href"];
  let state = {
    active: false,
    kind: null,
    current: null,
    startedAt: null,
    overlay: null,
    label: null
  };

  function cssEscape(value) {
    const text = String(value || "");
    if (globalThis.CSS && typeof globalThis.CSS.escape === "function") {
      return globalThis.CSS.escape(text);
    }
    return text.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character.codePointAt(0).toString(16)} `);
  }

  function attributeEscape(value) {
    return JSON.stringify(String(value || ""));
  }

  function isPickerUi(element) {
    return Boolean(element?.closest?.(`[${UI_ATTRIBUTE}]`));
  }

  function matchCount(doc, css) {
    try {
      return doc.querySelectorAll(css).length;
    } catch (_error) {
      return 0;
    }
  }

  function selectorCss(selector) {
    const tag = selector.tag && selector.tag !== "*" ? cssEscape(selector.tag) : "";
    if (selector.kind === "id") {
      return `${tag}#${cssEscape(selector.value)}`;
    }
    if (selector.kind === "class") {
      return `${tag}${String(selector.value).split(/\\s+/).filter(Boolean).map((item) => `.${cssEscape(item)}`).join("")}`;
    }
    if (selector.kind === "attribute") {
      return `${tag}[${selector.attributeName}=${attributeEscape(selector.value)}]`;
    }
    return selector.value || tag || "*";
  }

  function buildCssPath(element, doc) {
    const parts = [];
    let node = element;
    while (node && node.nodeType === 1 && parts.length < 7) {
      const tag = String(node.tagName || "*").toLowerCase();
      if (node.id) {
        const idCss = `#${cssEscape(node.id)}`;
        if (matchCount(doc, idCss) === 1) {
          parts.unshift(idCss);
          break;
        }
      }
      let part = tag;
      const classes = [...(node.classList || [])]
        .map((item) => String(item).trim())
        .filter(Boolean)
        .slice(0, 2);
      if (classes.length) {
        part += classes.map((item) => `.${cssEscape(item)}`).join("");
      }
      const parent = node.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter((child) => child.tagName === node.tagName);
        if (siblings.length > 1) {
          part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
        }
      }
      parts.unshift(part);
      const css = parts.join(" > ");
      if (matchCount(doc, css) === 1) {
        return css;
      }
      node = parent;
    }
    return parts.join(" > ") || String(element.tagName || "*").toLowerCase();
  }

  function buildSelector(element, doc = document) {
    if (!element || element.nodeType !== 1 || isPickerUi(element)) {
      throw new Error("The selected element is invalid.");
    }
    const tag = String(element.tagName || "*").toLowerCase();
    const id = String(element.id || "").trim();
    if (id) {
      const candidate = { tag, kind: "id", value: id, attributeName: "" };
      const css = selectorCss(candidate);
      if (matchCount(doc, css) === 1) {
        return { selector: candidate, css, matchCount: 1, strategy: "unique-id" };
      }
    }

    for (const attributeName of STABLE_ATTRIBUTES) {
      const value = String(element.getAttribute?.(attributeName) || "").trim();
      if (!value) {
        continue;
      }
      const candidate = { tag, kind: "attribute", value, attributeName };
      const css = selectorCss(candidate);
      const count = matchCount(doc, css);
      if (count === 1) {
        return { selector: candidate, css, matchCount: count, strategy: `unique-${attributeName}` };
      }
    }

    const classes = [...(element.classList || [])]
      .map((item) => String(item).trim())
      .filter(Boolean)
      .slice(0, 4);
    for (let count = Math.min(classes.length, 3); count >= 1; count -= 1) {
      const selectedClasses = classes.slice(0, count);
      const candidate = { tag, kind: "class", value: selectedClasses.join(" "), attributeName: "" };
      const css = selectorCss(candidate);
      const matches = matchCount(doc, css);
      if (matches === 1) {
        return { selector: candidate, css, matchCount: matches, strategy: "unique-class" };
      }
    }

    const css = buildCssPath(element, doc);
    return {
      selector: { tag, kind: "css", value: css, attributeName: "" },
      css,
      matchCount: matchCount(doc, css),
      strategy: "css-path"
    };
  }

  function elementSummary(element) {
    if (!element) {
      return "No element selected";
    }
    const tag = String(element.tagName || "element").toLowerCase();
    const id = element.id ? `#${element.id}` : "";
    const classes = [...(element.classList || [])].slice(0, 3).map((item) => `.${item}`).join("");
    return `${tag}${id}${classes}`;
  }

  function ensureUi() {
    if (state.overlay?.isConnected && state.label?.isConnected) {
      return;
    }
    const overlay = document.createElement("div");
    overlay.setAttribute(UI_ATTRIBUTE, "overlay");
    Object.assign(overlay.style, {
      position: "fixed",
      zIndex: "2147483646",
      pointerEvents: "none",
      border: "2px solid #a855f7",
      borderRadius: "4px",
      background: "rgba(168, 85, 247, 0.10)",
      boxShadow: "0 0 0 1px rgba(255,255,255,.85) inset",
      display: "none"
    });
    const label = document.createElement("div");
    label.setAttribute(UI_ATTRIBUTE, "label");
    Object.assign(label.style, {
      position: "fixed",
      zIndex: "2147483647",
      pointerEvents: "none",
      maxWidth: "min(520px, calc(100vw - 16px))",
      padding: "5px 8px",
      borderRadius: "5px",
      background: "#6b21a8",
      color: "white",
      font: "12px/1.3 system-ui, sans-serif",
      boxShadow: "0 2px 10px rgba(0,0,0,.35)",
      display: "none"
    });
    (document.documentElement || document.body).append(overlay, label);
    state.overlay = overlay;
    state.label = label;
  }

  function hideUi() {
    if (state.overlay) state.overlay.style.display = "none";
    if (state.label) state.label.style.display = "none";
    state.current = null;
  }

  function updateUi(element) {
    if (!state.active || !element || element.nodeType !== 1 || isPickerUi(element)) {
      return;
    }
    ensureUi();
    const rect = element.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) {
      hideUi();
      return;
    }
    state.current = element;
    Object.assign(state.overlay.style, {
      display: "block",
      left: `${Math.max(0, rect.left)}px`,
      top: `${Math.max(0, rect.top)}px`,
      width: `${Math.max(1, rect.width)}px`,
      height: `${Math.max(1, rect.height)}px`
    });
    state.label.textContent = `${elementSummary(element)} — click to select, Esc to cancel`;
    const labelTop = rect.top >= 34 ? rect.top - 30 : Math.min(window.innerHeight - 28, rect.bottom + 4);
    Object.assign(state.label.style, {
      display: "block",
      left: `${Math.max(4, Math.min(rect.left, window.innerWidth - 300))}px`,
      top: `${Math.max(4, labelTop)}px`
    });
  }

  function removeListeners() {
    document.removeEventListener("pointermove", onPointerMove, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("scroll", onViewportChange, true);
    window.removeEventListener("resize", onViewportChange, true);
  }

  function cleanupUi() {
    state.overlay?.remove();
    state.label?.remove();
    state.overlay = null;
    state.label = null;
    state.current = null;
  }

  function emit(payload) {
    void browser.runtime.sendMessage({
      type: MESSAGE.CONTENT_PICKER_RESULT,
      payload
    }).catch(() => {
      // Extension reload or tab close may invalidate the message channel.
    });
  }

  function finish(payload, notify = true) {
    const kind = state.kind;
    removeListeners();
    cleanupUi();
    state = { active: false, kind: null, current: null, startedAt: null, overlay: null, label: null };
    if (notify) {
      emit({ kind, ...payload });
    }
  }

  function cancel(reason = "cancelled", notify = true) {
    if (!state.active) {
      return { cancelled: false };
    }
    finish({ cancelled: true, reason }, notify);
    return { cancelled: true, reason };
  }

  function onPointerMove(event) {
    updateUi(event.target);
  }

  function onPointerDown(event) {
    if (!state.active || isPickerUi(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function onClick(event) {
    if (!state.active || isPickerUi(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const element = state.current || event.target;
    try {
      const result = buildSelector(element, document);
      finish({ cancelled: false, ...result, elementSummary: elementSummary(element) });
    } catch (error) {
      finish({ cancelled: true, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  function onKeyDown(event) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    cancel("escape");
  }

  function onViewportChange() {
    if (state.current?.isConnected) updateUi(state.current);
    else hideUi();
  }

  function start(kind) {
    if (!["monitor", "target", "verify"].includes(kind)) {
      throw new Error("The element picker type is invalid.");
    }
    if (state.active) cancel("replaced", false);
    state.active = true;
    state.kind = kind;
    state.startedAt = new Date().toISOString();
    ensureUi();
    const kindLabel = kind === "monitor" ? "monitor element" : (kind === "verify" ? "verification element" : "target");
    state.label.textContent = `Picking ${kindLabel}: hover and click, or press Esc to cancel`;
    Object.assign(state.label.style, { display: "block", left: "8px", top: "8px" });
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange, true);
    return snapshot();
  }

  function snapshot() {
    return { active: state.active, kind: state.kind, startedAt: state.startedAt, current: elementSummary(state.current) };
  }

  function onRuntimeMessage(message) {
    if (message?.type === MESSAGE.CONTENT_START_ELEMENT_PICKER) {
      try {
        return Promise.resolve({ ok: true, picker: start(message.payload?.kind) });
      } catch (error) {
        return Promise.resolve({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (message?.type === MESSAGE.CONTENT_CANCEL_ELEMENT_PICKER) {
      return Promise.resolve({ ok: true, picker: cancel(message.payload?.reason || "sidebar-cancel") });
    }
    return undefined;
  }

  function shutdown(reason = "shutdown") {
    cancel(reason, false);
    try { browser.runtime.onMessage.removeListener(onRuntimeMessage); } catch (_error) {}
  }

  browser.runtime.onMessage.addListener(onRuntimeMessage);
  window.addEventListener("pagehide", () => shutdown("pagehide"), { once: true });
  Object.defineProperty(globalThis, INSTANCE_KEY, {
    configurable: true,
    enumerable: false,
    writable: false,
    value: Object.freeze({ VERSION, buildSelector, selectorCss, start, cancel, snapshot, shutdown })
  });
  Object.defineProperty(globalThis, "FCI_ELEMENT_PICKER", {
    configurable: true,
    enumerable: false,
    writable: false,
    value: globalThis[INSTANCE_KEY]
  });
})();
