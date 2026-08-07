# Patch selection — Python Patch Tool v5.15.2

The normal zero-argument selector remains provided by the installed v5.15 core.

Selection-integrity invariant added by v5.15.2:

- selected + executed + PASS: may enter local success history and `patchs/patched/`;
- selected + executed + FAIL: remains rerunnable according to core policy;
- not executed: must not gain new PASS history because of the current invocation;
- not executed: must not disappear into `duplicate_success` unless it was already positively classified by pre-run local history.

The runtime guard reconciles the queue after the core returns and removes only newly-created false success evidence.
