# Phase 60 v0.41.1 — Configuration import preview and confirmation

Configuration import is now a two-step operation. Selecting a file first performs a read-only parse/validation and returns the scope plus profile/preset/template counts. No storage is modified during preview. The sidebar then asks for explicit confirmation before issuing the mutating import request.

Full bundles identify Automation, Monitor, Target, Local action, command preset, custom prompt-template and sidebar-preset contents. Legacy files are identified as Automation-only. Both paths retain the existing automatic recovery snapshot immediately before mutation.
