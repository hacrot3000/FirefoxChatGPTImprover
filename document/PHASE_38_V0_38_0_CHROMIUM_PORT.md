# Phase 38 v0.38.0 — Chromium port for Chrome and Edge

## Scope

Phase 38 reuses the Firefox automation engine on Chromium browsers while keeping
the Firefox package unchanged. A dedicated build converts the source manifest,
loads the background engine through one Manifest V3 service worker and exposes
the existing sidebar UI through the Chromium Side Panel API.

## Build

```bash
./tools/build_chromium_addon.sh --browser chromium --overwrite
./tools/build_chromium_addon.sh --browser chrome --overwrite
./tools/build_chromium_addon.sh --browser edge --overwrite
```

Each build creates an unpacked directory, a deterministic ZIP, `release.json`
and `SHA256SUMS` under `releases/chromium/<browser>/0.38.0/`.

The public manifest key in `extension/chromium/manifest_key.txt` keeps local
unpacked builds on the stable extension ID:

```text
aganahagmocgjhcglbjdeidlpecdhgfj
```

The file is not a private signing key. A Chrome Web Store or Edge Add-ons build
may receive another ID; the Native Host installer accepts an explicit override.

## Compatibility layer

`extension/shared/browser_compat.js` is loaded before all shared code. Firefox
keeps its native `browser` API. Chrome and Edge receive adapters for:

- Promise-returning `runtime.onMessage` handlers on Chromium versions where the
  listener still requires `sendResponse` plus `return true`;
- Firefox-style `sessions.getTabValue`, `setTabValue` and `removeTabValue`
  backed by `chrome.storage.session`;
- `sidebarAction.open()` backed by `chrome.sidePanel.open()`;
- shortcut settings and Firefox/Chromium open-panel command name mapping;
- `runtime.getBrowserInfo()` support-bundle metadata.

The compatibility script is also injected before content automation and prompt
filling scripts.

## Manifest conversion

The generated Chromium manifest:

- uses `background/chromium_service_worker.js`;
- defines `side_panel.default_path = sidebar/sidebar.html`;
- adds `sidePanel` permission;
- removes Firefox-only `browser_specific_settings` and `sidebar_action`;
- removes `webRequestBlocking`, which normal Chromium MV3 packages cannot use;
- replaces `_execute_sidebar_action` with `fci-open-side-panel`;
- generates PNG icons because Chromium manifest icons do not accept SVG;
- requires Chromium 116 or newer for programmatic Side Panel opening.

Managed downloads retain the `downloads.onCreated` interception fallback. The
Firefox blocking response-header interception remains Firefox-only.

## Native Host registration on Linux

```bash
./native-host/install_chromium_native_host.sh --browser chromium
./native-host/install_chromium_native_host.sh --browser chrome
./native-host/install_chromium_native_host.sh --browser edge
```

Use `--browser all` to register all three user-profile locations. Use
`--extension-id <store-id>` for a store-installed extension whose ID differs
from the local development ID. The generated manifest uses Chromium's required
`allowed_origins` field and keeps Native Host **0.13.0** unchanged.

## Development launch

```bash
FCI_CHROMIUM_BROWSER=chromium ./tools/run_chromium_addon_dev.sh
FCI_CHROMIUM_BROWSER=chrome ./tools/run_chromium_addon_dev.sh
FCI_CHROMIUM_BROWSER=edge ./tools/run_chromium_addon_dev.sh
```

`FCI_CHROMIUM_BIN` can override the browser executable.

## Validation

- Shared-source JavaScript and Python syntax.
- Compatibility VM for Firefox no-op and Chromium adapters.
- Promise message response bridge.
- Side Panel and shortcut-command mapping.
- Tab-value session adapter.
- Deterministic Chrome/Edge package generation and ZIP extraction.
- Stable local extension ID and separate Native Host origin.
- Chromium PNG icon generation.
- Existing Phase 09, 34, 35, 36 and 37 focused regressions.
