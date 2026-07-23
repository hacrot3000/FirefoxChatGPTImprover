# Phase 20 — Reliable configuration save and working-session restore

## Configuration save

Profile and per-tab saves now validate the complete current form, commit the selected rule and command preset draft, write through the background storage transaction, and compare the persisted normalized configuration before reporting success.

## Save working session

The Save configuration group can list every open HTTP/HTTPS tab. Active add-on tabs are checked by default; inactive tabs are unchecked. The exported JSON contains only selected tabs, their original title, URL, current profile snapshot, configuration mode and complete effective add-on configuration.

## Import working session

Import is a two-step user action. The file is parsed first, then the user presses **Open and restore tabs** so Firefox can request the required site permissions directly from a user gesture. Tabs are opened, profiles are merged without overwriting a different existing profile, and active/paused add-on sessions are restored with a fresh runtime baseline.
