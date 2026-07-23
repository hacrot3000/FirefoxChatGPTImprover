# Phase 17 — Per-rule command preset actions

Phase 17 connects automation rules to the Native Messaging command preset system without allowing page content to provide shell text.

## Rule action

Each rule may optionally run one enabled command preset at one of these points:

- when the monitor enters `MATCHED`;
- after a real target click, with an optional explicit dry-run allowance;
- after the target pipeline verification passes.

One request is emitted per `ruleId + monitor cycle + trigger`.

## Security and isolation

The content runtime sends only a preset ID and rule/cycle metadata. The background resolves the actual working directory, command, and mode from the saved effective configuration. Before Native Messaging starts, it verifies:

- sender tab ID and session token;
- rule existence and enabled state;
- saved trigger and preset ID;
- current rule monitor cycle;
- enabled preset state;
- confirmation is disabled for automatic presets;
- no command is already running for that tab.

Processed request IDs are persisted with the tab session to prevent duplicate execution after repeated runtime events or recovery. Command history records whether a run was started manually or by a rule.

## Compatibility

Existing rules migrate with command actions disabled. Manual shell commands, presets, allowlist mode, and per-tab history retain their Phase 16 behavior.
