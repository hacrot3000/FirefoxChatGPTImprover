# Phase 21 — Local-action profiles and managed downloads

## Scope

Phase 21 separates machine-local actions from automation profiles. Automation profiles continue to own monitor rules, target selectors, alerts, and DOM pipelines. Local-action profiles own:

- managed-download destination and conflict behavior;
- shell working directory, command, mode, presets, allowlist, and history policy;
- URL routing used only for local actions.

A tab can use the routed/shared local-action profile or a tab-specific override. Working-session export/import preserves both assignments.

## Managed-download flow

1. Enable **Capture the next target-triggered download** in the selected local-action profile.
2. Set an absolute destination directory.
3. Save the local-action profile or save a tab-specific override.
4. Immediately before the add-on clicks a configured target, the content runtime arms a short capture window.
5. For HTTP responses that look like downloads, the background cancels the original response and restarts it through Firefox Downloads with `saveAs: false` in the extension staging directory.
6. After Firefox reports completion, the Native Host validates that the source is inside the user's Downloads directory and moves it to the configured absolute destination.
7. The sidebar displays completion and can run the configured shell command. Optional automatic execution works only when command confirmation is disabled and all allowlist checks pass.

Downloads that cannot be intercepted as an HTTP response use the Firefox download-manager event as a fallback. Browser- or site-specific download prompts may still be outside the add-on's control in that fallback path.

## Native Host update

After applying Phase 21, reinstall/update the Native Host:

```bash
cd /home/duongtc/FirefoxChatImprover
./native-host/install_host.sh
```

Then reload the add-on and any monitored tabs.

## Optional standalone watcher

The integrated Native Host is the normal relocation mechanism. A manual fallback watcher is included:

```bash
cd /home/duongtc/FirefoxChatImprover
./native-host/download_relocator_watch.py \
  --destination /absolute/destination/path
```

By default it watches:

```text
~/Downloads/FirefoxChatImprover
```

Useful options:

```text
--source /absolute/staging/path
--conflict uniquify|overwrite|fail
--poll-seconds 1
--once
```

The watcher moves only stable completed files and ignores `.part`, `.tmp`, and `.download` files.

## Safety boundaries

- Download destinations and shell settings are not embedded in automation profiles.
- The Native Host accepts only absolute paths.
- The source file must be under the user's Firefox download directory.
- Shell execution runs as the user who launched Firefox and never uses `sudo`.
- Automatic shell execution after relocation is skipped when confirmation is enabled.
- Rule-command preset text is resolved and validated by the background; page content cannot provide shell text.
