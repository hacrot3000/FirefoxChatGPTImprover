(() => {
  "use strict";

  if (globalThis.FCI_PROMPT_TEMPLATES?.VERSION >= 1) {
    return;
  }

  const VERSION = 1;
  const STORAGE_KEY = "firefoxChatImprover.promptTemplates.v1";
  const MAX_CUSTOM_TEMPLATES = 100;
  const MAX_NAME_LENGTH = 120;
  const MAX_PROMPT_LENGTH = 30000;

  // Edit this list to change the prompt templates bundled with the extension.
  // Built-in templates are read-only in the sidebar; users can add independent custom templates.
  const BUILTIN_TEMPLATES = Object.freeze([
    Object.freeze({
      id: "builtin-context-estimate-and-handoff",
      name: "Context estimate and early handoff",
      prompt: `Đồng thời ước lượng độ dài context còn lại dựa trên độ dài topic và lượng log/patch hiện tại, ước lượng còn khoảng bao nhiêu % thì phải mở topic mới.
Từ các kết quả tiếp theo hãy ghi lên đầu ví dụ:
CONTEXT ESTIMATE: 20–30% remaining
Khi ước lượng xuống dưới 10%, hãy cảnh báo và ưu tiên tạo ZIP handoff trước khi topic bị khóa. ZIP handoff mới cần đầy đủ thông tin, context, các quy định, mã nguồn mới nhất, mục tiêu quan trọng chính của topic, ... Có thể loại bỏ bớt các log debug, log lỗi, thông tin sửa lỗi của các phiên sửa lỗi và các thông tin đã hết hạn và không cần thiết.`
    }),
    Object.freeze({
      id: "builtin-create-complete-handoff",
      name: "Create complete ZIP handoff",
      prompt: `Hãy tạo ZIP handoff cần đầy đủ thông tin, context, các quy định, mã nguồn mới nhất, mục tiêu quan trọng chính của topic, ...
Có thể loại bỏ bớt các log debug, log lỗi, thông tin sửa lỗi của các phiên sửa lỗi và các thông tin đã hết hạn và không cần thiết.`
    })
  ]);

  function nowIso() {
    return new Date().toISOString();
  }

  function makeId() {
    if (globalThis.crypto?.randomUUID) {
      return `custom-${globalThis.crypto.randomUUID()}`;
    }
    return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function normalizeName(value) {
    return String(value || "").trim().slice(0, MAX_NAME_LENGTH);
  }

  function normalizePrompt(value) {
    return String(value || "").replace(/\r\n?/g, "\n").trim().slice(0, MAX_PROMPT_LENGTH);
  }

  function normalizeCustomTemplate(raw, fallbackId = null) {
    const source = raw && typeof raw === "object" ? raw : {};
    const rawId = String(source.id || fallbackId || makeId()).trim();
    const id = rawId.startsWith("custom-") ? rawId.slice(0, 180) : makeId();
    const createdAt = typeof source.createdAt === "string" && source.createdAt ? source.createdAt : nowIso();
    return {
      id,
      name: normalizeName(source.name),
      prompt: normalizePrompt(source.prompt),
      source: "custom",
      editable: true,
      createdAt,
      updatedAt: typeof source.updatedAt === "string" && source.updatedAt ? source.updatedAt : createdAt
    };
  }

  function defaultStore() {
    return { schema: VERSION, customTemplates: [] };
  }

  function normalizeStore(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const seen = new Set();
    const customTemplates = [];
    for (const entry of Array.isArray(source.customTemplates) ? source.customTemplates : []) {
      const template = normalizeCustomTemplate(entry);
      if (!template.name || !template.prompt || seen.has(template.id)) continue;
      seen.add(template.id);
      customTemplates.push(template);
      if (customTemplates.length >= MAX_CUSTOM_TEMPLATES) break;
    }
    return { schema: VERSION, customTemplates };
  }

  function builtins() {
    return BUILTIN_TEMPLATES.map((template) => ({
      ...template,
      source: "built-in",
      editable: false,
      createdAt: null,
      updatedAt: null
    }));
  }

  function library(rawStore = null) {
    const store = normalizeStore(rawStore || defaultStore());
    const templates = [...builtins(), ...store.customTemplates.map((entry) => ({ ...entry }))];
    return {
      schema: VERSION,
      builtInCount: BUILTIN_TEMPLATES.length,
      customCount: store.customTemplates.length,
      maxCustomTemplates: MAX_CUSTOM_TEMPLATES,
      templates
    };
  }

  function templateById(rawStore, templateId) {
    const id = String(templateId || "");
    return library(rawStore).templates.find((template) => template.id === id) || null;
  }

  async function loadStore(browserApi = globalThis.browser) {
    if (!browserApi?.storage?.local) throw new Error("Firefox local storage is unavailable.");
    const result = await browserApi.storage.local.get(STORAGE_KEY);
    return normalizeStore(result?.[STORAGE_KEY]);
  }

  async function saveStore(browserApi, rawStore) {
    if (!browserApi?.storage?.local) throw new Error("Firefox local storage is unavailable.");
    const store = normalizeStore(rawStore);
    await browserApi.storage.local.set({ [STORAGE_KEY]: store });
    return store;
  }

  async function upsertCustom(browserApi, rawTemplate) {
    const store = await loadStore(browserApi);
    const requestedId = String(rawTemplate?.id || "").trim();
    const existingIndex = requestedId
      ? store.customTemplates.findIndex((entry) => entry.id === requestedId)
      : -1;
    const existing = existingIndex >= 0 ? store.customTemplates[existingIndex] : null;
    const template = normalizeCustomTemplate({
      ...rawTemplate,
      id: existing?.id || undefined,
      createdAt: existing?.createdAt || undefined,
      updatedAt: nowIso()
    });
    if (!template.name) throw new Error("Template name is required.");
    if (!template.prompt) throw new Error("Prompt text is required.");
    if (existingIndex < 0 && store.customTemplates.length >= MAX_CUSTOM_TEMPLATES) {
      throw new Error(`At most ${MAX_CUSTOM_TEMPLATES} custom prompt templates can be stored.`);
    }
    if (existingIndex >= 0) store.customTemplates[existingIndex] = template;
    else store.customTemplates.push(template);
    await saveStore(browserApi, store);
    return { template, store: normalizeStore(store), library: library(store) };
  }

  async function deleteCustom(browserApi, templateId) {
    const id = String(templateId || "");
    if (!id.startsWith("custom-")) throw new Error("Built-in prompt templates cannot be deleted.");
    const store = await loadStore(browserApi);
    const before = store.customTemplates.length;
    store.customTemplates = store.customTemplates.filter((entry) => entry.id !== id);
    if (store.customTemplates.length === before) throw new Error("The custom prompt template no longer exists.");
    await saveStore(browserApi, store);
    return { deletedId: id, store: normalizeStore(store), library: library(store) };
  }

  Object.defineProperty(globalThis, "FCI_PROMPT_TEMPLATES", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({
      VERSION,
      STORAGE_KEY,
      MAX_CUSTOM_TEMPLATES,
      MAX_NAME_LENGTH,
      MAX_PROMPT_LENGTH,
      BUILTIN_TEMPLATES,
      defaultStore,
      normalizeStore,
      normalizeCustomTemplate,
      library,
      templateById,
      loadStore,
      saveStore,
      upsertCustom,
      deleteCustom
    })
  });
})();
