# Phase 18 — Sanitized support bundle export

## Goal

Export one local ZIP that is useful for troubleshooting without exposing shell command text, working directories, shell output, session tokens, tab titles, or URL query strings/fragments.

## Bundle contents

- `metadata.json`: add-on, protocol/schema, environment, privacy policy and diagnostic counts.
- `settings.json`: normalized settings with command/cwd fields redacted.
- `sessions.json`: per-tab mode, profile/config mode, sanitized URL, runtime and effective configuration.
- `native-host.json`: connection/run status without command text, cwd or output.
- `logs/tab-<id>-user.json` and `logs/tab-<id>-debug.json`: bounded session logs with sensitive keyed fields redacted.

## Excluded data

The bundle does not include shell output, command history entries, command text, working directories, session tokens, tab titles, page HTML or chat content. URL credentials, query strings and fragments are removed.

## Usage

Open **Tab activity log** and press **Export support bundle**. The ZIP is built locally in the sidebar with no upload and no new Firefox permission.

## Acceptance

- Multiple active tabs are represented independently.
- The archive is a valid uncompressed ZIP with deterministic JSON entries.
- Export requires no `downloads` permission.
- Historical tests and Patch + Test remain the only routine workflow.
