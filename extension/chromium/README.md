# Chromium build input

`manifest_key.txt` contains only the public manifest key used to keep the ID of
local unpacked Chrome/Edge builds stable. It is not a private signing key.

Run `./tools/build_chromium_addon.sh --overwrite`. The generated unpacked source
and ZIP are written under `releases/chromium/<browser>/<version>/`.

The default local extension ID derived from this key is:

`aganahagmocgjhcglbjdeidlpecdhgfj`

A Chrome Web Store or Edge Add-ons listing can assign a different ID. Pass that
ID to `native-host/install_chromium_native_host.sh --extension-id <id>` when
registering the Native Host for a store-installed build.
