# Phase 27 v0.27.0 — Post-download shell outcome audit

## Runtime evidence

The managed download pipeline correctly captured the per-tab local-action profile, relocated the downloaded patch, and launched the frozen shell command. The command then returned a non-zero process code because a downstream build step rejected an already-existing release directory. The previous sidebar summary exposed only a run ID and raw return code, which could be mistaken for failure to recognize or launch the command.

## Changes

- Classify completed-download shell state as ready, running, succeeded, failed, blocked, or unavailable.
- Explicitly distinguish transport/validation failure before launch from a child process that was launched and later exited non-zero.
- Show the frozen working directory, command, relocated file, run ID, execution mode, and return code through the Managed download shell status tooltip.
- Mark non-zero child exits as an error state while retaining proof that the add-on successfully launched the command.
- Keep immutable snapshot and exactly-once execution semantics unchanged.
- Add VM regression coverage for ready, running, successful, non-zero, blocked, and unavailable outcomes.

No Native Host reinstall is required because the wire protocol and host implementation are unchanged.
