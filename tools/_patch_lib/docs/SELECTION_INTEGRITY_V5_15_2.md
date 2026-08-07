# Selection integrity — Python Patch Tool v5.15.2

Contract: only packages actually executed may gain new PASS/success evidence.

v5.15.2 retains the v5.15.1 recovery for an unexecuted package wrongly moved to `patchs/ignored/duplicate_success/`, and adds cleanup of newly appended success-history records for queue packages that were not executed even when the file itself stayed in `patchs/`.

Unselected packages remain runnable. Existing pre-run duplicate history is preserved; only evidence newly created during the current invocation is eligible for correction.
