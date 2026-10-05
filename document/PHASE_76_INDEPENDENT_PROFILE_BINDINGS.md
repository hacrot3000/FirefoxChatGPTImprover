# Phase 76 — Independent profile groups and per-tab bindings

## Problem

Automation configuration currently embeds Rule list, Rule monitor, Rule target action, and Alert behavior. Monitor/Target profiles are library items that are copied into the current rule draft; applying them ultimately requires saving the whole Automation profile. This couples unrelated choices and forces users to duplicate profiles for combinations such as one Local action profile with several Target profiles.

Local action profiles already have the desired interaction model: edit the current form, save/new a reusable profile, and explicitly apply one profile to a selected tab without changing other profile groups.

## Target model

The sidebar profile groups become independent:

1. **Automation profiles** — URL/routing/auto-activation settings only from the user's point of view.
2. **Rule list profiles** — rule identity, name, enabled state, and per-rule command-action choice.
3. **Rule monitor profiles** — reusable monitor configuration. Binding is per tab + rule.
4. **Rule target action profiles** — reusable target configuration. Binding is per tab + rule.
5. **Alert behavior profiles** — reusable alert settings.
6. **Local action profiles** — managed-download and shell-command settings only.

A tab may therefore combine, for example:

- Automation = ChatGPT routing
- Rule list = Download result
- Monitor = ChatGPT response-ready monitor
- Target = ChatGPT 1
- Alert = Quiet
- Local action = Save to project + run patch command

without duplicating any of the other profiles.

## Binding scope

Tab-level bindings:

- automationProfileId
- ruleListProfileId
- alertProfileId
- localActionProfileId

Rule-level bindings inside each tab:

- monitorProfileId per rule ID
- targetProfileId per rule ID

This preserves multi-rule behavior: Rule A and Rule B may use different Monitor/Target profiles in the same tab.

## Compatibility strategy

Existing Automation profiles remain readable and retain their historical full config payload for migration/fallback compatibility. After Phase 76:

- Automation profile **New/Save/Apply** changes only activation/routing behavior.
- On activation, the historical rule/monitor/target/alert values form a compatibility component snapshot.
- Independent profile bindings override that snapshot group-by-group.
- Applying a Monitor/Target profile no longer copies data into and auto-saves the Automation profile.
- Existing tabs and stopped-tab recovery keep their effective values.

## UI contract

Every independent profile panel follows the Local action interaction model:

- source summary: **Tab uses** vs **Editing**
- profile search/select
- editable profile name
- **Apply to selected tab** (or **Apply to selected tab/rule** for Monitor/Target)
- **Save as new profile**
- **Save changes**
- **Make default**
- **Delete profile**

Changing the library selection alone never changes a running tab. Apply is explicit.

## Implementation checkpoints

- [x] Settings schema: Rule-list and Alert profile libraries.
- [x] Runtime composition: independent component bindings.
- [x] Protocol/background actions for apply/clear component bindings.
- [x] Rule list profile panel and tab binding.
- [x] Monitor profile per-tab/per-rule binding.
- [x] Target profile per-tab/per-rule binding.
- [x] Alert profile panel and tab binding.
- [x] Automation profile save/apply limited to routing/activation.
- [x] Local action wording/contracts confirm only download + shell ownership.
- [x] Stopped-tab/session recovery preserves component bindings.
- [x] Import/export/backup includes new profile libraries.
- [x] Regression tests and release notes.


## Completed implementation

Released as **v0.41.17**.

Runtime ownership is now explicit:

- Automation save/create/tab override writes only activation/routing fields.
- Rule-list and Alert profiles have their own libraries and tab bindings.
- Monitor and Target profiles bind per tab + rule.
- Local action profiles remain limited to managed-download and shell-command configuration.
- Sidebar keeps **Editing** selection separately from **Tab uses**, including per-tab Rule-list/Alert choices and per-tab/per-rule Monitor/Target choices.
- Component bindings survive active-session persistence, explicit Stop/Start, working-session export/restore, and full configuration backup/recovery.
- Deleting or replacing a bound component profile preserves the tab's effective component snapshot before stale bindings are cleared.
