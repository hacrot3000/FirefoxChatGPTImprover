# Phase 37 v0.37.0 — Suggested and custom prompt templates

## Goal

Keep frequently reused prompts beside the active Firefox tab and insert one without manually selecting or pasting text.

## Built-in configuration

`extension/shared/prompt_templates.js` owns `BUILTIN_TEMPLATES`. Phase 37 ships:

1. context remaining estimate plus early ZIP-handoff policy;
2. immediate complete ZIP-handoff request.

Built-ins are read-only in the sidebar so source updates remain deterministic. Editing the array changes the templates delivered by the extension.

## Custom template storage

Custom entries use `browser.storage.local` key `firefoxChatImprover.promptTemplates.v1`. Each entry has a stable `custom-*` ID, name, prompt, creation time and update time. Limits are 100 custom templates, 120 characters per name and 30,000 characters per prompt.

## Fill behavior

1. The sidebar sends the selected tab ID and prompt text.
2. The background confirms that the tab is still the currently displayed HTTP/HTTPS tab.
3. `content/prompt_fill.js` collects visible writable textareas, `input[type=text]`, `input[type=search]` and compatible contenteditable textboxes, including open shadow roots.
4. The last candidate in page traversal order is focused and replaced.
5. Native value setters plus bubbling/composed `input` and `change` events notify React and similar frameworks.

No automation activation is required. Firefox still must permit script injection into the page.

## Versions

- Extension: 0.37.0
- Protocol: 25
- Native Host: 0.13.0 (unchanged)
