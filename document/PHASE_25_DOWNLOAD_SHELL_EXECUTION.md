# Phase 25 — Download shell execution and complete console integration

Phase 25 completes the managed-download command path. A local-action profile selects disabled, manual, or automatic execution after relocation. The command, working directory and allowlist state are frozen at target-click time.

Download-triggered commands always run through Native Messaging in background mode so stdout and stderr are captured completely. The Native Host supplies only validated `FCI_*` variables; `FCI_DOWNLOAD_PATH` contains the verified absolute destination returned by relocation. No page-provided shell text is accepted.

The sidebar keeps a bounded live tail while the full transcript remains in the Phase 22 file-backed log store. When enabled, the complete paged/copyable console opens automatically after exit and can be reopened after closure. Manual and automatic paths share the same execution routine, duplicate starts are rejected, and a non-zero exit code is surfaced as a download-shell error without changing the already-relocated file.
