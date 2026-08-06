(() => {
  "use strict";

  if (globalThis.FCI_PROMPT_FILL?.VERSION >= 1) {
    return;
  }

  const VERSION = 1;
  const MESSAGE = globalThis.FCI_PROTOCOL?.MESSAGE || {};

  function isTextInput(element) {
    if (!(element instanceof HTMLInputElement)) return false;
    const type = String(element.type || "text").toLowerCase();
    return type === "text" || type === "search";
  }

  function isEditableCandidate(element) {
    if (element instanceof HTMLTextAreaElement || isTextInput(element)) {
      return !element.disabled && !element.readOnly && element.getAttribute("aria-disabled") !== "true";
    }
    return element instanceof HTMLElement &&
      element.getAttribute("contenteditable") !== null &&
      element.getAttribute("contenteditable") !== "false" &&
      (element.getAttribute("role") === "textbox" || element.isContentEditable) &&
      element.getAttribute("aria-disabled") !== "true";
  }

  function isVisible(element) {
    if (!element?.isConnected) return false;
    const style = globalThis.getComputedStyle ? getComputedStyle(element) : null;
    if (style && (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse")) return false;
    if (element.hidden) return false;
    if (typeof element.getClientRects === "function" && element.getClientRects().length === 0) return false;
    return true;
  }

  function collectCandidates(root = document.documentElement, output = []) {
    if (!root) return output;
    const children = root.children ? Array.from(root.children) : [];
    for (const child of children) {
      if (isEditableCandidate(child) && isVisible(child)) output.push(child);
      if (child.shadowRoot) collectCandidates(child.shadowRoot, output);
      collectCandidates(child, output);
    }
    return output;
  }

  function nativeValueSetter(element) {
    if (element instanceof HTMLTextAreaElement) {
      return Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set || null;
    }
    if (element instanceof HTMLInputElement) {
      return Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set || null;
    }
    return null;
  }

  function dispatchInputEvents(element, text) {
    try {
      element.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        composed: true,
        inputType: "insertText",
        data: text
      }));
    } catch (_error) {
      element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    }
    element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }

  function fillElement(element, text) {
    const value = String(text || "");
    element.focus({ preventScroll: false });
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      const setter = nativeValueSetter(element);
      if (setter) setter.call(element, value);
      else element.value = value;
      if (typeof element.setSelectionRange === "function") {
        try { element.setSelectionRange(value.length, value.length); } catch (_error) {}
      }
    } else {
      element.textContent = value;
      const selection = globalThis.getSelection?.();
      if (selection && document.createRange) {
        try {
          const range = document.createRange();
          range.selectNodeContents(element);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        } catch (_error) {}
      }
    }
    dispatchInputEvents(element, value);
    try { element.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (_error) {}
  }

  function describeElement(element, candidateCount) {
    return {
      candidateCount,
      tagName: String(element.tagName || "").toLowerCase(),
      inputType: element instanceof HTMLInputElement ? String(element.type || "text").toLowerCase() : null,
      id: String(element.id || ""),
      name: String(element.getAttribute?.("name") || ""),
      placeholder: String(element.getAttribute?.("placeholder") || "").slice(0, 240),
      contentEditable: !(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)
    };
  }

  function fillLastPromptInput(text) {
    const value = String(text || "");
    if (!value.trim()) throw new Error("Prompt text is empty.");
    const candidates = collectCandidates();
    const target = candidates.at(-1) || null;
    if (!target) {
      throw new Error("No visible writable textarea or text input was found in the page.");
    }
    fillElement(target, value);
    return describeElement(target, candidates.length);
  }

  const api = Object.freeze({ VERSION, collectCandidates, fillElement, fillLastPromptInput });
  Object.defineProperty(globalThis, "FCI_PROMPT_FILL", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: api
  });

  browser.runtime.onMessage.addListener((message) => {
    if (message?.type !== MESSAGE.CONTENT_FILL_PROMPT) return undefined;
    try {
      return Promise.resolve({ ok: true, result: fillLastPromptInput(message.payload?.text) });
    } catch (error) {
      return Promise.resolve({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
})();
