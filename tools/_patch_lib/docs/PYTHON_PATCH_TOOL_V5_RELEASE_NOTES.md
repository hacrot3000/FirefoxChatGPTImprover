# Python Patch Tool v5.16.0 release notes

v5.16 completes the **Token reduction and AI handoff** priority group and makes queue hygiene visible inside the patch selector.

## Changes

- AI HANDOFF now has an explicit hard token budget (`handoff_max_tokens`, default 24,000 estimated tokens).
- SUMMARY and CODE compatibility bundles have independent token ceilings.
- Whole source/patch payload blocks are kept whole-or-omitted; Markdown/log evidence uses semantic section/line compaction instead of arbitrary byte cuts.
- Duplicate content inside each AI-facing bundle is removed by SHA-256.
- PASS handoffs use compact proof evidence; FAIL handoffs add focused source/payload evidence for active root causes.
- Every handoff includes `ai_handoff_budget.md/json`, listing included, compacted, omitted and deduplicated evidence. `DETAIL.zip` remains complete redacted evidence and is intentionally unbounded.
- The interactive selector now displays packages automatically skipped before selection. A package already PASSed on the current machine is shown as `[SKIPPED:DUPLICATE - ALREADY PASS]`, with the reason and its quarantine destination, instead of appearing to vanish.
- Other auto-skipped categories such as foreign project, non-patch archive and missing project key are shown in the same read-only section.
- TTY skipped-state labels use yellow highlighting when color is available; line-mode retains textual labels.
- All v5.15 behavior, portable layout and Patch Tool v4 compatibility are retained.

## Portable use

```bash
unzip -o python_patch_tool_v5.16.0_package.zip -d "$PWD"
./tools/run_python_patches.sh
```

Normal AI workflow remains: upload `HANDOFF.zip` first; upload `DETAIL.zip` only when the AI asks for raw/deeper evidence.

## Late v5.16 usability additions

- Long-running steps now show a TTY-only single-line live status such as `POST COMMAND 1/1: ... | 37.2s | process alive | output lines=...`. The line is rewritten in place, does not grow the console, and is deliberately excluded from runner/HANDOFF/DETAIL logs.
- Transaction setup reports overlay progress on the same ephemeral line so a large dirty/config overlay no longer looks frozen.
- Default AI artifacts are reduced to `HANDOFF.zip` and `DETAIL.zip`. The older standalone SUMMARY/CODE ZIPs are compatibility-only and can be restored with `reports.ai_handoff.split_compatibility_bundles=true`.
- JSON evidence is whole-or-omit under token budgets; it is never semantically truncated into invalid JSON.
