# FirefoxChatImprover

## ⚡ Cài đặt nhanh (không cần build)

> Tải bản đã build sẵn từ GitHub Releases — **không cần Node.js, Python hay bất kỳ công cụ nào**.

### Bước 1 — Tải file `.zip`

Vào trang **[Releases](../../releases)** của repository này, chọn phiên bản mới nhất rồi tải file:

```
firefox-chat-ai-assistant-<version>-unsigned.zip
```

> **Kiểm tra toàn vẹn (tùy chọn):** Mỗi release kèm file `SHA256SUMS`, bạn có thể xác minh bằng:
> ```bash
> sha256sum -c SHA256SUMS
> ```

### Bước 2 — Cài vào Firefox

1. Mở Firefox, vào địa chỉ: **`about:addons`**
2. Nhấn biểu tượng bánh răng ⚙️ → chọn **"Install Add-on From File..."**
3. Chọn file `.zip` vừa tải về → nhấn **Add**

> **Lưu ý:** Đây là bản chưa qua Mozilla ký (unsigned). Firefox sẽ cho phép cài trên **Firefox Developer Edition** hoặc **Firefox ESR** với `xpinstall.signatures.required = false` trong `about:config`.  
> Để cài lâu dài trên Firefox Release thông thường, cần bản XPI đã được Mozilla ký qua AMO.

### Bước 3 — Cài Native Host (nếu dùng tính năng Shell command)

```bash
git clone <repository-url>
cd FirefoxChatImprover
./native-host/install_native_host.sh
```

Sau đó reload add-on trong `about:addons`.

---

## Safe profile lifecycle

Deleting an Automation or Local action profile uses **safe detach**. Open active/stopped tabs keep their effective automation, download and shell values as tab-specific overrides instead of silently reverting to Default or URL routing. Importing Local action profile bundles also preserves unsaved per-tab working drafts.

## Profile editor continuity

Automation and Local action profile editors remember the selected profile per tab across sidebar reloads. The source summary distinguishes **Editing** from the profile the tab currently **uses**, and saved state is rejected when the tab URL changes.

<!-- FIREFOX_CHAT_IMPROVER_PHASE00_BEGIN -->

## Kế hoạch và workflow phát triển add-on

Tài liệu chính:

- `document/PROJECT_IMPLEMENTATION_PLAN.md` — danh sách phase, công việc và tiêu chí nghiệm thu.
- `document/FIREFOX_ADDON_INSTALL_UPDATE_GUIDE.md` — cài tạm, auto reload, build và hướng cập nhật lâu dài.

Công cụ development:

```bash
./tools/setup_firefox_addon_dev.sh
./tools/run_firefox_addon_dev.sh
./tools/lint_firefox_addon.sh
./tools/build_firefox_addon.sh
```

`run_firefox_addon_dev.sh` sẽ dùng `web-ext run` để mở Firefox development session và tự reload add-on mỗi khi source trong `extension/` thay đổi. Công cụ này bắt đầu sử dụng được sau khi Phase 01 tạo `extension/manifest.json`.

Phase hiện tại: **Phase 00 — kế hoạch, tài liệu và workflow phát triển**.

Phase tiếp theo: **Phase 01 — khung WebExtension và kích hoạt thủ công**.
<!-- FIREFOX_CHAT_IMPROVER_PHASE00_END -->

<!-- FIREFOX_CHAT_IMPROVER_PHASE01_BEGIN -->
## Phase 01 — WebExtension skeleton và kích hoạt thủ công

Source add-on tối thiểu đã được tạo trong `extension/`.

Chạy từ VS Code bằng `Terminal → Run Build Task...`:

- `Firefox Add-on: Setup Dev Environment` — cài/cập nhật `web-ext` cục bộ.
- `Firefox Add-on: Lint` — kiểm tra manifest và source.
- `Firefox Add-on: Build` — tạo artifact trong `dist/`.
- `Firefox Add-on: Run Dev (Auto Reload)` — mở Firefox development session và tự reload khi source thay đổi.

Tài liệu chi tiết: `document/PHASE_01_WEBEXTENSION_SKELETON.md`.

Phase hiện tại: **Phase 01 — WebExtension skeleton và kích hoạt thủ công**.

Phase tiếp theo: **Phase 02 — schema cấu hình, URL/profile và selector setting**.
<!-- FIREFOX_CHAT_IMPROVER_PHASE01_END -->
<!-- FIREFOX_CHAT_IMPROVER_PHASE02_BEGIN -->
## Phase 02 — Multi-tab profile và cấu hình

Add-on hỗ trợ nhiều tab hoạt động đồng thời. Sidebar liệt kê session theo `tabId`; mỗi tab có thể dùng profile khác hoặc lưu một cấu hình độc lập.

Các cấu hình đã có UI và lưu trữ:

- URL allowlist.
- Monitor selector và nhiều condition AND/OR.
- Target selector, chiến lược click và fingerprint.
- Cảnh báo.
- Working directory và shell command chuẩn bị cho Native Messaging.
- Import/export JSON.

Tài liệu chi tiết: `document/PHASE_02_MULTI_TAB_PROFILE_CONFIG.md`.

Phase hiện tại: **Phase 02 — multi-tab session, profile và cấu hình**.

Phase tiếp theo: **Phase 03 — engine theo dõi trạng thái element bằng MutationObserver**.
<!-- FIREFOX_CHAT_IMPROVER_PHASE02_END -->

<!-- FIREFOX_CHAT_IMPROVER_PHASE02_V021_BEGIN -->
### Phase 02 v0.2.1 — sidebar host-permission hotfix

Nút kích hoạt trong sidebar nay xin quyền đúng website hiện tại bằng optional host permission trước khi inject content script. Quyền website và session tab là hai lớp độc lập: quyền có thể dùng lại cho cùng hostname, còn profile/trạng thái runtime vẫn riêng theo `tabId`.
<!-- FIREFOX_CHAT_IMPROVER_PHASE02_V021_END -->

<!-- FIREFOX_CHAT_IMPROVER_PHASE02_V022_BEGIN -->
### Phase 02 v0.2.2 — active-tab sidebar synchronization

Sidebar tự động chuyển sang đúng session khi active tab của Firefox thay đổi. Mỗi tab tiếp tục giữ profile, cấu hình, mode và runtime riêng theo `tabId`; phản hồi đồng bộ cũ bị loại bỏ khi chuyển tab nhanh.
<!-- FIREFOX_CHAT_IMPROVER_PHASE02_V022_END -->

<!-- FIREFOX_CHAT_IMPROVER_PHASE03_BEGIN -->
## Phase 03 — Monitor engine và kiểm tra selector

Add-on đã theo dõi element thực tế bằng `MutationObserver` cho từng tab độc lập. Monitor hỗ trợ điều kiện hiện/ẩn, các điều kiện attribute AND/OR và tự tìm lại element khi SPA thay node.

Sidebar có nút **Kiểm tra và highlight** cho monitor/target selector, hỗ trợ ID, class, CSS selector và attribute; kết quả hiển thị tổng số element, số hiện và số ẩn.

Tài liệu chi tiết: `document/PHASE_03_MONITOR_ENGINE_SELECTOR_TEST.md`.

Phase hiện tại: **Phase 03 — monitor engine, visibility condition và selector test**.

Phase tiếp theo: **Phase 04 — baseline target mới và tự click theo chu kỳ**.
<!-- FIREFOX_CHAT_IMPROVER_PHASE03_END -->
<!-- FIREFOX_CHAT_IMPROVER_PHASE03_V031_BEGIN -->
### Phase 03 v0.3.1 — visibility-transition semantics

Monitor visibility is now a transition condition rather than a static filter. A tab can wait for `hidden → visible` or `visible → hidden`; activation only records the current baseline and never triggers immediately. Attribute conditions are optional, so deleting or disabling every condition makes visibility transition the only trigger.
<!-- FIREFOX_CHAT_IMPROVER_PHASE03_V031_END -->
<!-- FIREFOX_CHAT_IMPROVER_PHASE04_BEGIN -->
## Phase 04 — Baseline target mới và tự click theo chu kỳ

Mỗi tab có target engine riêng. Khi kích hoạt hoặc khi monitor rời `MATCHED`, target hiện có được lưu làm baseline. Trong lúc `MATCHED`, add-on chỉ xử lý target vượt baseline, hỗ trợ dry-run, visible/enabled filter, fingerprint chống click lặp và giới hạn hành động mỗi chu kỳ.

Tài liệu chi tiết: `document/PHASE_04_NEW_TARGET_BASELINE_AUTO_CLICK.md`.

Phase hiện tại: **Phase 04 — nhận diện target mới và tự click theo chu kỳ**.

Phase tiếp theo: **Phase 05 — cảnh báo title/badge và quan sát hoạt động**.
<!-- FIREFOX_CHAT_IMPROVER_PHASE04_END -->

<!-- FIREFOX_CHAT_IMPROVER_PHASE05_BEGIN -->
## Phase 05 — Cảnh báo đa tab và nhật ký hoạt động

Mỗi tab hiện có cảnh báo độc lập bằng title, badge, sidebar và notification tùy chọn. Sidebar bổ sung log user/debug riêng cho từng session, copy/clear log, dry-run/click thử target hiện tại và nút dọn highlight.

Tài liệu chi tiết: `document/PHASE_05_ALERTS_ACTIVITY_OBSERVABILITY.md`.

Phase hiện tại: **Phase 05 — cảnh báo và quan sát hoạt động**.

Phase tiếp theo: **Phase 06 — Native Messaging Host và chạy shell local**.
<!-- FIREFOX_CHAT_IMPROVER_PHASE05_END -->

<!-- FIREFOX_CHAT_IMPROVER_PHASE05_V051_BEGIN -->
### Phase 05 v0.5.1 — selector preview và help tooltip

- Các ghi chú dài trong sidebar được thu gọn thành nút `?` ở góc card; hover, focus hoặc bấm mới hiển thị.
- Nút kiểm tra monitor nằm sau danh sách điều kiện.
- Kết quả tách riêng số element khớp selector và số element thỏa điều kiện attribute.
- Viền cam nét đứt biểu thị element chỉ khớp selector; viền xanh biểu thị element thỏa điều kiện.

Tài liệu chi tiết: `document/PHASE_05_V0_5_1_SELECTOR_PREVIEW_HELP_TOOLTIPS.md`.
<!-- FIREFOX_CHAT_IMPROVER_PHASE05_V051_END -->


<!-- FIREFOX_CHAT_IMPROVER_PHASE05_V052_BEGIN -->
### Phase 05 v0.5.2 — compact header/status

Header sidebar được thu gọn thành một hàng thấp, giữ nguyên tên add-on do local tùy chỉnh. Status được hiển thị bằng chip nhỏ có chấm màu theo trạng thái, giảm padding và không chiếm thêm chiều cao nội dung.

Tài liệu chi tiết: `document/PHASE_05_V0_5_2_COMPACT_HEADER_STATUS.md`.
<!-- FIREFOX_CHAT_IMPROVER_PHASE05_V052_END -->

<!-- FIREFOX_CHAT_IMPROVER_PHASE06_BEGIN -->
## Phase 06 — Native Messaging và shell local

Đã bổ sung Python Native Messaging Host, command session riêng theo `tabId`, stream stdout/stderr, mở terminal tương tác và stop process group đúng run ID.

Để tránh làm rối VS Code Build Tasks, các thao tác ít dùng của Native Host không có menu riêng. Khi cần, chạy trực tiếp:

```bash
./native-host/install_native_host.sh
./native-host/uninstall_native_host.sh
python3 ./native-host/native_host.py --self-test
```

Sau khi cài/cập nhật Native Host, reload development add-on.

Tài liệu: `document/PHASE_06_NATIVE_MESSAGING_SHELL.md`.

Phase tiếp theo: **Phase 07 — kiểm thử integration và hardening**.
<!-- FIREFOX_CHAT_IMPROVER_PHASE06_END -->

## Phase 07 — Test và hardening

Workflow VS Code được giữ gọn và dùng chung cho mọi phase:

- `Patchs: Run Python Patch` — chỉ áp dụng patch;
- `Patchs: Run Python Patch + Test` — áp dụng patch thành công rồi chạy toàn bộ test hiện hành.

Mỗi phase mới chỉ bổ sung test vào `tools/test_firefox_addon.sh`; không tạo thêm task theo phase. Có thể chạy test riêng bằng:

```bash
./tools/test_firefox_addon.sh
```

DOM fixture và các công cụ kiểm tra chuyên biệt vẫn tồn tại nhưng chạy trực tiếp khi thật sự cần:

```bash
./tools/run_phase07_fixture.sh
```

Gói patch từ Phase 07 v0.7.1 trở đi chỉ chứa script `patch_*.py` và resource thật sự cần thiết; không đính kèm lại file source không thay đổi.

Chi tiết: `document/PHASE_07_TEST_HARDENING.md`.

<!-- FIREFOX_CHAT_IMPROVER_PHASE08_BEGIN -->
## Phase 08 — Release, cài lâu dài và cập nhật/rollback

Build Task `Firefox Add-on: Build` nay tạo release có thể truy vết trong `dist/releases/<version>/`, gồm ZIP chưa ký, SHA-256, metadata và release note. Workflow vẫn không thêm task theo phase.

Công cụ chuyên biệt:

```bash
./tools/bump_firefox_addon_version.py --patch
./tools/sign_firefox_addon_unlisted.sh
./tools/generate_firefox_update_manifest.py --help
```

XPI cài lâu dài trên Firefox Release phải là bản đã được Mozilla ký. Native Messaging Host tiếp tục cài/cập nhật riêng.

Tài liệu: `document/PHASE_08_RELEASE_INSTALL_UPDATE_ROLLBACK.md`.

Phase baseline 00–08 đã hoàn tất. Phase tiếp theo là **Phase 09 — các nâng cấp tùy chọn**.
<!-- FIREFOX_CHAT_IMPROVER_PHASE08_END -->

<!-- FIREFOX_CHAT_IMPROVER_PHASE09_BEGIN -->
## Phase 09 — Group thu gọn và cảnh báo theo chu kỳ liên tục

Mỗi group trong sidebar có thể ẩn/hiện độc lập; trạng thái UI được lưu riêng và không ảnh hưởng profile/tab config.

Cảnh báo nay được giữ chốt theo `alertCycle` cho đến khi người dùng thao tác thật trong tab hoặc tab active liên tục đủ timeout cấu hình. Xác nhận cảnh báo không dừng monitor: add-on tiếp tục chờ condition trở về không đạt, re-arm baseline, rồi xử lý cycle tiếp theo khi condition đạt lại.

Tài liệu: `document/PHASE_09_COLLAPSIBLE_GROUPS_LATCHED_ALERT_CYCLES.md`.
<!-- FIREFOX_CHAT_IMPROVER_PHASE09_END -->

<!-- FIREFOX_CHAT_IMPROVER_PHASE10_BEGIN -->
## Phase 10 — Element Picker trực quan

Sidebar có nút **Chọn trên trang** riêng cho monitor và target. Rê chuột để xem element, click để tự điền selector hoặc nhấn `Esc` để hủy. Picker ưu tiên ID/attribute/class duy nhất và giữ trạng thái độc lập theo tab.

Tài liệu: `document/PHASE_10_VISUAL_ELEMENT_PICKER.md`.
<!-- FIREFOX_CHAT_IMPROVER_PHASE10_END -->

<!-- FIREFOX_CHAT_IMPROVER_PHASE11_BEGIN -->
## Phase 11 — Chọn profile theo URL

Khi kích hoạt tab chưa active, add-on có thể tự chọn profile khớp URL theo độ ưu tiên và độ cụ thể của pattern. Sidebar có preview, nút kiểm tra và manual override; session đã active không tự đổi profile.

Tài liệu: `document/PHASE_11_URL_PROFILE_ROUTING.md`.
<!-- FIREFOX_CHAT_IMPROVER_PHASE11_END -->

<!-- FIREFOX_CHAT_IMPROVER_PHASE13_BEGIN -->
## Phase 13 — Monitor stability windows

Monitor có thể yêu cầu condition giữ liên tục trước khi MATCHED và giữ trạng thái không đạt liên tục trước khi re-arm. Trạng thái chớp nhanh do React re-render bị hủy, không tăng cycle và không chạy target pipeline.

Tài liệu: `document/PHASE_13_MONITOR_STABILITY_WINDOWS.md`.

Phase hiện tại: **Phase 13 — ổn định match/reset và chống trigger giả**.
<!-- FIREFOX_CHAT_IMPROVER_PHASE13_END -->


<!-- FIREFOX_CHAT_IMPROVER_PHASE14_BEGIN -->
## Phase 14 — Khôi phục session sau reload/navigation

Session active/paused được giữ theo từng `tabId`, tự re-inject content runtime sau background reload hoặc navigation, rồi lập baseline mới để không lặp target action cũ. Nếu thiếu quyền website hoặc URL không còn phù hợp, session không bị xóa mà chuyển sang trạng thái cần khôi phục thủ công.

Tài liệu: `document/PHASE_14_SESSION_RECOVERY.md`.

Phase hiện tại: **Phase 14 — restart-safe multi-tab session recovery**.
<!-- FIREFOX_CHAT_IMPROVER_PHASE14_END -->

<!-- FIREFOX_CHAT_IMPROVER_PHASE14_V0141_BEGIN -->
### Phase 14 v0.14.1 — compact controls và monitor title spinner

Khi group **Tab và session** thu gọn, các nút play/pause, stop và refresh vẫn nằm trên title. Group **Target element mới** có nút click thử target ngay trên title khi thu gọn. Tab đang active nhưng monitor còn `WAITING` hiển thị spinner động ở đầu title; alert blink vẫn có ưu tiên cao hơn.

Tài liệu: `document/PHASE_14_V0_14_1_COMPACT_CONTROLS_MONITOR_SPINNER.md`.
<!-- FIREFOX_CHAT_IMPROVER_PHASE14_V0141_END -->

<!-- FIREFOX_CHAT_IMPROVER_PHASE15_BEGIN -->
## Phase 15 — Nhiều monitor/action rule trong cùng tab

Mỗi profile hoặc tab config có thể chứa nhiều automation rule. Mỗi rule giữ monitor, target, baseline, cycle và action pipeline riêng; nhiều rule chạy đồng thời nhưng vẫn nằm trong session độc lập của từng `tabId`.

Sidebar bổ sung group **Automation rules** để tạo, nhân bản, bật/tắt, xóa và chọn rule đang chỉnh. Profile cũ tự migration thành một rule duy nhất, không mất selector hoặc condition hiện có.

Tài liệu: `document/PHASE_15_MULTI_RULE_AUTOMATION.md`.

Phase hiện tại: **Phase 15 — multi-rule monitor/action automation**.
<!-- FIREFOX_CHAT_IMPROVER_PHASE15_END -->


<!-- FIREFOX_CHAT_IMPROVER_PHASE15_V0151_BEGIN -->
### Phase 15 v0.15.1 — timer/session isolation hotfix

Sửa timer binding của cảnh báo, rollback activation dở dang và thêm `sessionToken` để runtime event cũ hoặc sai tab không thể cập nhật session khác. Test stability được chống flaky bằng polling có timeout.

Tài liệu: `document/PHASE_15_V0_15_1_TIMER_SESSION_ISOLATION_HOTFIX.md`.
<!-- FIREFOX_CHAT_IMPROVER_PHASE15_V0151_END -->


<!-- FIREFOX_CHAT_IMPROVER_PHASE15_V0152_BEGIN -->
### Phase 15 v0.15.2 — English UI and title/help hotfix

- The complete add-on UI now uses English.
- Repeated READY/RUNNING/alert/spinner title decorations are normalized after reload.
- Rule runtime status is collapsed by default, and `?` help popovers work consistently.
- Historical generated Vietnamese default names are migrated to English without renaming custom names.

Details: `document/PHASE_15_V0_15_2_ENGLISH_UI_TITLE_DEDUP_HELP.md`.
<!-- FIREFOX_CHAT_IMPROVER_PHASE15_V0152_END -->


## Phase 15 v0.15.3 stability timer hotfix

Stability windows now recover from callbacks that execute slightly before their recorded deadline. The Phase 13 regression test uses a deterministic fake clock, so repeated Patch + Test and Build runs no longer depend on host timing.


## Phase 15 v0.15.4 version-contract hotfix

Historical feature tests now validate the minimum version that introduced their contract instead of pinning the manifest to that exact release. Later hotfix and feature versions therefore remain compatible with the Phase 15 v0.15.2 English UI/title/help test.


## Phase 16 — Command presets and per-tab command history

Shell commands can now be saved as profile/tab presets. Optional allowlist mode is enforced in the background before Native Messaging is used. Each activated tab keeps its own bounded command history, which can be loaded or cleared from the sidebar.

## Phase 17 — Rule-triggered command presets

An automation rule can optionally run an enabled command preset when its monitor matches, after a target click, or after verification passes. The page never supplies shell text: the background resolves and validates the saved preset, rule, session token, and cycle before contacting the Native Host.


## Phase 18 — Sanitized support bundle export

Use **Export support bundle** in the Tab activity log section to create a local ZIP with sanitized settings, per-tab runtime summaries, bounded user/debug logs, native-host status and diagnostics. Shell command text, working directories, output, session tokens, tab titles and URL query strings/fragments are excluded.

Details: `document/PHASE_18_SUPPORT_BUNDLE_EXPORT.md`.


## Phase 19 — Settings snapshots and rollback

The **Save configuration** section now provides a bounded local recovery history. The add-on automatically snapshots settings before profile save/delete and JSON import, and creates a safety snapshot before every restore.

Details: `document/PHASE_19_SETTINGS_SNAPSHOT_ROLLBACK.md`.


## Phase 20 — Verified save and working sessions

Configuration saves are verified after storage persistence. Working sessions can be exported/imported with selected tabs, URLs, profiles and complete per-tab configuration. See `document/PHASE_20_WORKING_SESSION_SAVE_RESTORE.md`.

## Phase 21 — Local-action profiles and managed downloads

Download relocation and shell settings now use a separate local-action profile store. Profiles may be shared, selected by URL, or overridden per tab without changing automation profiles. Target-triggered downloads can be captured into Firefox's staging directory and moved by the Native Host to an absolute destination. Working-session files preserve local-action assignments and overrides.

After applying this phase, update the Native Host with `./native-host/install_host.sh`. See `document/PHASE_21_LOCAL_ACTION_PROFILES_MANAGED_DOWNLOADS.md`.


<!-- FIREFOX_CHAT_IMPROVER_PHASE22_BEGIN -->
## Phase 22 — File-backed full command logs

Background shell runs now keep a complete Native Host transcript on disk. The sidebar shows a bounded live tail and a paged full-log dialog with copy-selection, copy-page, copy-all, reopen, refresh, and delete controls. Compact Run/Stop/Open-log controls remain available in the collapsed Shell command heading.

After applying this phase, reinstall/update the Native Host and reload the add-on.

Details: `document/PHASE_22_FILE_BACKED_SHELL_LOG_VIEWER.md`.
<!-- FIREFOX_CHAT_IMPROVER_PHASE22_END -->


<!-- FIREFOX_CHAT_IMPROVER_PHASE23_BEGIN -->
## Phase 23 — Immutable managed-download jobs and recovery

Each target-triggered download now freezes its destination and shell settings at click time. In-flight files cannot be redirected by later local-action profile, URL, or tab changes. Persisted jobs recover after background restart, ambiguous multi-tab fallback attribution is rejected, and interrupted relocation exposes an explicit retry.

Details: `document/PHASE_23_IMMUTABLE_DOWNLOAD_JOBS_RECOVERY.md`.
<!-- FIREFOX_CHAT_IMPROVER_PHASE23_END -->


<!-- FIREFOX_CHAT_IMPROVER_PHASE23_V0231_BEGIN -->
## Phase 23 v0.23.1 — Dedicated Managed download group

Managed-download destination, capture, conflict, completion, auto-shell, status, and retry controls now live in a separate collapsible group directly below **New target element**. Local-action profile, per-tab, URL routing, immutable job, and recovery semantics are unchanged.

Details: `document/PHASE_23_V0_23_1_DOWNLOAD_GROUP_LAYOUT.md`.
<!-- FIREFOX_CHAT_IMPROVER_PHASE23_V0231_END -->


<!-- FIREFOX_CHAT_IMPROVER_PHASE24_BEGIN -->
## Phase 24 — Verified local-action saves and protected drafts

The Local action profile header now shows Saved/Unsaved state and the effective configuration source. Switching tabs/profiles or applying/resetting local-action settings protects unsaved download and shell edits. Profile and tab-override saves are read back and verified before success is reported.

Details: `document/PHASE_24_LOCAL_ACTION_SAVE_GUARD.md`.
<!-- FIREFOX_CHAT_IMPROVER_PHASE24_END -->


<!-- FIREFOX_CHAT_IMPROVER_PHASE24_V0241_BEGIN -->
## Phase 24 v0.24.1 — No-dialog managed-download fallback

Page-created downloads detected through `downloads.onCreated` are canceled and restarted by the extension with `saveAs: false`, then relocated by the Native Host. This prevents the fallback path from inheriting Firefox's normal Save As dialog behavior.
<!-- FIREFOX_CHAT_IMPROVER_PHASE24_V0241_END -->


<!-- FIREFOX_CHAT_IMPROVER_PHASE24_V0242_BEGIN -->
## Phase 24 v0.24.2 — Capture-aware target click hotfix

An armed managed-download capture now converts that one target action from dry-run to a real click, allowing the page JavaScript download to start. Firefox content timers also use lexical Window binding to prevent recovery from remaining stuck with an illegal timer receiver.
<!-- FIREFOX_CHAT_IMPROVER_PHASE24_V0242_END -->


<!-- FIREFOX_CHAT_IMPROVER_PHASE24_V0243_BEGIN -->
## Phase 24 v0.24.4 — Correlated managed-download relocation

Managed-download move requests now have an end-to-end correlation ID and a bounded timeout. Native Host validation/unsupported-action errors are shown in the download group instead of leaving the job stuck in `moving`. Reinstall Native Host 0.9.1 after applying this patch.
<!-- FIREFOX_CHAT_IMPROVER_PHASE24_V0243_END -->


<!-- FIREFOX_CHAT_IMPROVER_PHASE25_BEGIN -->
## Phase 25 — Download shell execution and complete console integration

Managed downloads can now run their frozen shell command manually from the completion dialog or automatically after verified relocation. Download-triggered commands always use background mode, receive the verified file through `FCI_DOWNLOAD_PATH` and related `FCI_DOWNLOAD_*` variables, and use the Phase 22 file-backed full-console viewer. Automatic/manual execution is isolated per tab and cannot switch to later profile edits.

Details: `document/PHASE_25_DOWNLOAD_SHELL_EXECUTION.md`.
<!-- FIREFOX_CHAT_IMPROVER_PHASE25_END -->


<!-- FIREFOX_CHAT_IMPROVER_PHASE25_V0251_BEGIN -->
## Phase 25 v0.25.1 — Embedded installation guide

The sidebar now includes a collapsible **Installation guide** group after **Shell command**. It links directly to the Patch Tool v3 package and the repository Native Host directory, and documents runner bootstrap, patch execution, Native Host self-test, per-user install/update, Firefox reload, connection check, installed paths and uninstall.

Details: `document/PHASE_25_V0_25_1_INSTALLATION_GUIDE.md`.
<!-- FIREFOX_CHAT_IMPROVER_PHASE25_V0251_END -->


<!-- FIREFOX_CHAT_IMPROVER_PHASE25_V0252_BEGIN -->
## Phase 25 v0.25.2 — Critical sidebar bootstrap recovery

Fixes a fatal `ReferenceError` in the local-action default configuration that prevented the sidebar script from loading after a real reload. Tabs/dashboard/event handlers now initialize normally, the Save group defaults to collapsed, and the sticky Save card remains in normal document flow until sidebar initialization completes. A runtime VM smoke test now executes `defaultConfig()` and `defaultStore()` so this class of error cannot pass static-only validation again.

Details: `document/PHASE_25_V0_25_2_SIDEBAR_BOOTSTRAP_RECOVERY.md`.
<!-- FIREFOX_CHAT_IMPROVER_PHASE25_V0252_END -->

<!-- FIREFOX_CHAT_IMPROVER_PHASE26_BEGIN -->
## Phase 26 — Sidebar preload runtime guard

A small guard now loads before all other sidebar scripts. Fatal dependency/runtime errors are shown in a recovery panel with diagnostics, dashboard retry, sidebar reload and copy actions instead of leaving the sidebar blank or frozen. Dashboard startup remains independent from collapsible-layout initialization.

Details: `document/PHASE_26_SIDEBAR_RUNTIME_GUARD.md`.
<!-- FIREFOX_CHAT_IMPROVER_PHASE26_END -->

<!-- FIREFOX_CHAT_IMPROVER_PHASE26_V0261_BEGIN -->
## Phase 26 v0.26.1 — Per-tab download shell persistence hotfix

Manual shell execution now first persists and verifies the displayed Managed download + Shell command settings as the selected tab's override. The next download therefore freezes the same working directory and command that were tested manually. The completion-dialog Execute shell command button is enabled only when the immutable completed-download snapshot contains a valid manual background command and has not already started.

Details: `document/PHASE_26_V0_26_1_PER_TAB_DOWNLOAD_SHELL_PERSISTENCE.md`.
<!-- FIREFOX_CHAT_IMPROVER_PHASE26_V0261_END -->

<!-- FIREFOX_CHAT_IMPROVER_PHASE27_BEGIN -->
## Phase 27 — Post-download shell outcome audit

Managed download shell status now distinguishes a command that could not be launched from a command that was launched successfully but exited non-zero. The status and tooltip expose the frozen working directory, command, relocated file, run ID, execution mode and return code without changing immutable snapshot or exactly-once semantics.

Details: `document/PHASE_27_DOWNLOAD_SHELL_OUTCOME_AUDIT.md`.
<!-- FIREFOX_CHAT_IMPROVER_PHASE27_END -->

<!-- FIREFOX_CHAT_IMPROVER_PHASE28_BEGIN -->
## Phase 28 — Global command presets and simple per-tab commands

Command presets now use an independent global store. Create, edit and save a preset once, then select it and apply it to any tab. Tabs can instead use a direct Working directory and Command, which are auto-saved for that tab without saving a local-action profile.

Details: `document/PHASE_28_GLOBAL_COMMAND_PRESETS.md`.
<!-- FIREFOX_CHAT_IMPROVER_PHASE28_END -->

<!-- FIREFOX_CHAT_IMPROVER_PHASE28_V0281_BEGIN -->
### Phase 28 v0.28.1 — Simplified preset creation

**New preset** now prompts for a name and immediately adds the selected name to the global Command preset list. The editor saves into the selected preset; **Apply to this tab** copies it to the tab. Preset-name, preset-enabled, and preset-matching controls are removed from the user workflow. Direct tab commands remain available through a separate button.
<!-- FIREFOX_CHAT_IMPROVER_PHASE28_V0281_END -->

<!-- FIREFOX_CHAT_IMPROVER_PHASE28_V0283_BEGIN -->
### Phase 28 v0.28.3 — Volatile editor priority

Valid unsaved local-action edits are effective immediately for the selected tab and are intentionally lost after Firefox or the add-on reloads. The Local action profile card is placed after Configuration profiles, redundant saved/effective-source labels are hidden, and only one yellow volatile-edit note is shown. Repeated development builds overwrite the existing same-version artifact. The patch is tolerant of braced or colon-only background message cases.
<!-- FIREFOX_CHAT_IMPROVER_PHASE28_V0283_END -->

<!-- FIREFOX_CHAT_IMPROVER_PHASE28_V0284_BEGIN -->
### Phase 28 v0.28.4 — Historical command-preset test compatibility

The Phase 16 regression now validates the current global command-preset selector, prompt-based preset creation and per-tab history while explicitly confirming that the removed `shellPresetName` and mandatory `requireShellPresetMatch` controls do not return.
<!-- FIREFOX_CHAT_IMPROVER_PHASE28_V0284_END -->

<!-- FIREFOX_CHAT_IMPROVER_PHASE28_V0285_BEGIN -->
### Phase 28 v0.28.5 — Status dot only

The Local action profile heading now shows only one compact yellow dot when volatile tab-only edits exist. It no longer displays the full explanatory sentence in the heading.
<!-- FIREFOX_CHAT_IMPROVER_PHASE28_V0285_END -->

<!-- FIREFOX_CHAT_IMPROVER_PHASE28_V0286_BEGIN -->
### Phase 28 v0.28.6 — Download execute and console recovery

The completed-download Execute shell command action now accepts valid frozen commands regardless of their editor terminal/background choice and provides a manual fallback when automatic launch failed before creating a run ID. Full command log falls back to all stdout/stderr/system chunks received by the add-on when a file-backed Native Host log is unavailable.
<!-- FIREFOX_CHAT_IMPROVER_PHASE28_V0286_END -->

<!-- FIREFOX_CHAT_IMPROVER_PHASE28_V0287_BEGIN -->
### Phase 28 v0.28.7 — Native move completion and automatic shell launch

Correlated Native Host move replies are now consumed before their pending requests resolve, completed download responses are idempotent, and automatic post-download execution no longer marks itself `starting` before calling the start routine. Manual Execute shell readiness and automatic execution therefore share the same verified completed-download state, while compound shell commands remain unchanged and run in background mode for full stdout/stderr capture.
<!-- FIREFOX_CHAT_IMPROVER_PHASE28_V0287_END -->

<!-- FIREFOX_CHAT_IMPROVER_PHASE28_V0288_BEGIN -->
### Phase 28 v0.28.8 — Same-tab session rebind and popup Execute readiness

Managed download jobs now remain valid across same-tab navigation and content-runtime session-token rollover. Completion state is published before automatic startup, failed automatic launches without a run ID expose a manual fallback, and the page-centered popup uses the shared frozen-job readiness contract instead of disabling Execute merely because the configured mode is automatic. Content runtime version 20 replaces stale popup logic in already-open tabs after reload/reinjection.
<!-- FIREFOX_CHAT_IMPROVER_PHASE28_V0288_END -->

<!-- FIREFOX_CHAT_IMPROVER_PHASE28_V0289_BEGIN -->
### Phase 28 v0.28.9 — JavaScript source-integrity guard

Standalone Docker BuildKit progress records such as `#10 51.98` are removed from extension JavaScript without touching valid code. The test suite now scans every JavaScript file for leaked terminal progress and runs `node --check` on each file before release.
<!-- FIREFOX_CHAT_IMPROVER_PHASE28_V0289_END -->

<!-- FIREFOX_CHAT_IMPROVER_PHASE28_V02810_BEGIN -->
### Phase 28 v0.28.10 — Extended BuildKit source sanitizer

The JavaScript source-integrity repair now removes complete standalone BuildKit progress records such as `#10 51.98 Configuring extension`, plus `DONE`, `CACHED`, `ERROR`, and stage records. The patch itself runs `node --check` against every extension JavaScript file before reporting success.
<!-- FIREFOX_CHAT_IMPROVER_PHASE28_V02810_END -->

<!-- FIREFOX_CHAT_IMPROVER_PHASE28_V02812_BEGIN -->
### Phase 28 v0.28.12 — Full source syntax audit and repair

A complete 127-line terminal/build transcript accidentally inserted into `extension/background/background.js` is removed as one anchored block. The repository now includes a full syntax audit for JavaScript, Python, shell, JSON, and SVG sources, and the patch refuses to report success while any checked source still has a syntax error.
<!-- FIREFOX_CHAT_IMPROVER_PHASE28_V02812_END -->

<!-- FIREFOX_CHAT_IMPROVER_PHASE28_V02813_BEGIN -->
### Phase 28 v0.28.13 — Full regression and restart dashboard repair

Updates stale Phase 23/25 contracts, restores repeatable `--overwrite` builds, verifies a fresh background dashboard after restart, retains full source-syntax validation, and reports incomplete `web-ext` installations clearly.
<!-- FIREFOX_CHAT_IMPROVER_PHASE28_V02813_END -->

<!-- FIREFOX_CHAT_IMPROVER_PHASE28_V02814_BEGIN -->
## Phase 28 v0.28.14 — tab-bound command log and command status

- The full command-log dialog is rebound whenever the selected tab changes; stale asynchronous pages from the previous tab are ignored.
- A command-running indicator and a finished-but-unread indicator are persisted per tab, shown in the tab selector, sidebar status pill, browser-action badge and managed page title.
- The unread indicator is cleared only after the matching log is successfully displayed (stored page or inline fallback).
- Stored-log read failures are non-fatal and no longer become unhandled sidebar rejections.
<!-- FIREFOX_CHAT_IMPROVER_PHASE28_V02814_END -->

<!-- FIREFOX_CHAT_IMPROVER_PHASE28_V02815_BEGIN -->
## Phase 28 v0.28.15 — preset editing and icon-only command status

- Removes the redundant **Direct command for this tab** button.
- Keeps the selected preset while editing, exposes **Save changes**, and protects unsaved preset values before switching.
- Makes **Save configuration** a normal non-sticky group.
- Uses icon-only command indicators (`⌘` running, `✓` finished/unread) without replacing the AI monitor status.
- Clears the unread indicator to idle only after the matching console is displayed for the active tab; legacy `viewed` notices are migrated to idle while the stored log remains reopenable.
<!-- FIREFOX_CHAT_IMPROVER_PHASE28_V02815_END -->

<!-- FIREFOX_CHAT_IMPROVER_PHASE28_V02818_BEGIN -->
## Phase 28 v0.28.18 — cumulative runtime-22 rescue

- Repairs directly from v0.28.15/runtime 22 or verifies a partial v0.28.16/v0.28.17 tree.
- README differences are not a prerequisite for functional code repair.
- Forces activation runtime 25 and alert engine 9 so stale title controllers are replaced.
- Moves failed v0.28.16/v0.28.17 packages out of the active patch queue after validation.
<!-- FIREFOX_CHAT_IMPROVER_PHASE28_V02818_END -->

<!-- FIREFOX_CHAT_IMPROVER_PHASE28_V02819_BEGIN -->
## Phase 28 v0.28.19 — matched remains AI READY

- Active-tab timeout stops alert blinking but keeps `matched` as a static AI READY title.
- The running spinner is reserved strictly for `waiting`.
- Alert engine 10 and content runtime 26 replace v0.28.18 title controllers.
<!-- FIREFOX_CHAT_IMPROVER_PHASE28_V02819_END -->

<!-- FIREFOX_CHAT_IMPROVER_PHASE28_V02820_BEGIN -->
## Phase 28 v0.28.20 — completed in-progress recovery and deployment work

- Restores still-valid managed-download captures after background restart.
- Replays interrupted relocations safely through Native Host 0.11.0 idempotent move receipts.
- Recovers historical file-backed logs from their `runId` when `logId` was not persisted.
- Adds guarded self-hosted update-channel preparation, verification, enable and disable tooling.
- Raises Firefox minimum version to 142 for Android-compatible data-collection manifest metadata.
- Uses `document/CURRENT_PROJECT_STATUS.md` as the canonical implementation-status document.
<!-- FIREFOX_CHAT_IMPROVER_PHASE28_V02820_END -->

<!-- FIREFOX_CHAT_IMPROVER_PHASE28_V02821_BEGIN -->
## Phase 28 v0.28.21 — visible Native Host version

- The Shell command header displays the complete Native Host version instead of truncating it to `Native 0.`.
- Hover text and the accessible label include version, connection state, error information and last-check time.
- Native Host files are unchanged.
<!-- FIREFOX_CHAT_IMPROVER_PHASE28_V02821_END -->

<!-- FIREFOX_CHAT_IMPROVER_PHASE28_V02822_BEGIN -->
## Phase 28 v0.28.22 — bounded Native command logs

- Automatically limits Native Host command logs by age, total MiB and file count.
- Protects running and completed-unread logs from cleanup.
- Supports startup cleanup, post-command cleanup and an explicit Clean now action.
- Requires Native Host 0.12.0.
<!-- FIREFOX_CHAT_IMPROVER_PHASE28_V02822_END -->

<!-- FIREFOX_CHAT_IMPROVER_PHASE28_V02823_BEGIN -->
## Phase 28 v0.28.23 — tab-bound download configuration

- Persists unsaved local-action working snapshots per tab across background restart and navigation recovery.
- Binds delayed sidebar autosync to the originating tab, session token, URL and local-action revision.
- Rejects stale cross-tab autosync instead of allowing another tab's destination to overwrite the current tab.
- Freezes and logs the exact destination source and fingerprint when managed-download capture is armed.
<!-- FIREFOX_CHAT_IMPROVER_PHASE28_V02823_END -->

<!-- FIREFOX_CHAT_IMPROVER_PHASE28_V02824_BEGIN -->
## Phase 28 v0.28.24 — real Firefox E2E validation

- Adds a real-Firefox E2E runner for multi-tab activation, AI title/badge state, target clicks, SPA/full navigation recovery and tab-bound download configuration.
- When Native Host is available, the same E2E run verifies real managed-download relocation and shell execution.
- Adds a multi-binary Firefox compatibility matrix with JSON and Markdown reports.
- Test-only hooks are injected only into a temporary extension copy and are never included in release builds.
<!-- FIREFOX_CHAT_IMPROVER_PHASE28_V02824_END -->

<!-- FCI_PHASE_28_V0_28_25_WINDOWS_NATIVE_HOST -->
## Phase 28 v0.28.25 — Windows Native Host

Windows Native Host support is available through `native-host/install_native_host.ps1` and `native-host/uninstall_native_host.ps1`. Linux installations continue to use `native-host/install_native_host.sh`. See `document/PHASE_28_V0_28_25_WINDOWS_NATIVE_HOST.md` for validation and usage.

<!-- FIREFOX_CHAT_IMPROVER_PHASE29_V0290_BEGIN -->
## Phase 29 v0.29.0 — component profiles and custom tab titles

- Adds reusable Monitor element and New target element profile libraries.
- Renames Save configuration to Import/export configuration and adds type-safe JSON import/export for configuration, monitor, target and local-action profiles.
- Adds per-tab custom titles that survive reload/navigation and remain the base title for AI READY/Running indicators.
- Native Host remains 0.13.0 and does not need reinstalling.
<!-- FIREFOX_CHAT_IMPROVER_PHASE29_V0290_END -->

<!-- FIREFOX_CHAT_IMPROVER_PHASE30_V0300_BEGIN -->
## Phase 30 v0.30.0 — sidebar search/filter

Adds non-destructive search/filter controls for tabs, configuration/monitor/target/local-action profiles, global command presets and per-tab command history. Current selections remain available outside the active query, and filter text is stored only as sidebar UI state. Native Host remains 0.13.0.
<!-- FIREFOX_CHAT_IMPROVER_PHASE30_V0300_END -->

<!-- FCI_RELEASE_DOCUMENTATION_START -->
## Project status and release history

- [Project feature status](PROJECT_STATUS.md) — completed, in-progress, planned and deferred features with progress.
- [Changelog](CHANGELOG.md) — version-specific user-visible changes.

Release tasks validate both files and use them to generate GitHub Release notes and documentation assets.
<!-- FCI_RELEASE_DOCUMENTATION_END -->

<!-- FIREFOX_CHAT_IMPROVER_PHASE31_V0310_BEGIN -->
## Phase 31 v0.31.0 — named saved working-session catalog

- Store multiple named working sessions inside the extension instead of relying only on downloaded JSON files.
- Search, update, rename, duplicate, delete, export/import and restore a selected subset of tabs.
- Existing working-session file export/import remains compatible.
- Release-facing progress is tracked in `PROJECT_STATUS.md` and version changes in `CHANGELOG.md`.
<!-- FIREFOX_CHAT_IMPROVER_PHASE31_V0310_END -->

<!-- FIREFOX_CHAT_IMPROVER_PHASE32_V0320_BEGIN -->
## Phase 32 v0.32.0 — optional sound alerts

- Adds an opt-in sound channel to the Alerts group; it remains disabled by default.
- Supports Soft chime, Double beep and Urgent tones with bounded volume, repeat count and repeat interval.
- Plays at most once per alert cycle, stops pending repeats when dismissed and does not replay an already-restored cycle.
- Includes a Test sound preview and keeps Native Host unchanged at 0.13.0.
<!-- FIREFOX_CHAT_IMPROVER_PHASE32_V0320_END -->

<!-- FIREFOX_CHAT_IMPROVER_PHASE33_V0330_BEGIN -->
## Phase 33 v0.33.0 — opt-in trusted URL auto-activation

- Adds profile-level automatic activation for explicit HTTP/HTTPS allowlists; it remains disabled by default.
- Firefox site access is requested only from the **Grant auto-activation access** user action.
- Startup and navigation scans never change an already-active or paused tab and revalidate the URL/profile immediately before activation.
- Native Host remains unchanged at 0.13.0.
<!-- FIREFOX_CHAT_IMPROVER_PHASE33_V0330_END -->

<!-- FCI_PHASE34_KEYBOARD_SHORTCUTS_BEGIN -->
## Keyboard shortcuts (v0.34.0)

Firefox-managed shortcuts are available for opening the sidebar, toggling the active tab, acknowledging alerts and running the configured target action. Open **Keyboard shortcuts** in the sidebar to inspect effective assignments, resolve conflicts in Firefox and reset defaults. Optional log/stop commands are intentionally unassigned by default.

## Per-rule statistics dashboard (v0.35.0)

The **Rule statistics** sidebar group keeps independent counters for every rule in the selected activated tab session: MATCHED transitions, clicked/dry-run target elements, verification results, automatic-command success/failure and return-code frequencies. It also reports average MATCHED-to-target and pipeline durations. Statistics survive background recovery, can be exported as JSON, and can be reset without changing configuration or stopping automation.
<!-- FCI_PHASE34_KEYBOARD_SHORTCUTS_END -->

<!-- FCI_PHASE36_COMPRESSED_RUN_LOG_EXPORT_BEGIN -->
## Compressed command-run log export (v0.36.0)

Open a current or history entry with **Open full log**, then choose **Export run ZIP**. The archive contains:

- `command.log` — the complete paged Native Host transcript for exactly that run;
- `metadata.json` — tab/run identity, command source, preset/rule correlation, working directory, result, timestamps and completeness status;
- `README.txt` — archive interpretation and sharing-safety notes.

The export is bound to the tab ID, run ID and log ID captured when it starts. ZIP entries use DEFLATE when useful. If the original file-backed log is unavailable, the extension exports the persisted fallback and marks `completeTranscript: false` instead of presenting it as a complete transcript. Logs above 64 MiB require confirmation, and export is capped at 512 MiB to protect sidebar memory.

Native Host remains **0.13.0** and does not need to be reinstalled.
<!-- FCI_PHASE36_COMPRESSED_RUN_LOG_EXPORT_END -->


<!-- FCI_PHASE37_PROMPT_TEMPLATES_BEGIN -->
## Prompt templates (v0.37.0)

The **Prompt templates** sidebar group provides two bundled workflow prompts and a local custom-template library. Select a template and use **Copy prompt**, or choose **Fill last page input** to replace the last visible writable textarea/text input in the currently displayed page. Compatible contenteditable textboxes are supported as a fallback for modern chat composers.

Bundled defaults are intentionally separated into `extension/shared/prompt_templates.js`; edit `BUILTIN_TEMPLATES` there to change code-shipped templates. User-created templates are stored independently in Firefox local storage and can be created, updated or deleted without changing source code.

Prompt filling never follows a stale sidebar selection: the background verifies that the requested tab is still the active displayed tab before injecting the page helper. Native Host remains **0.13.0** and does not need to be reinstalled.
<!-- FCI_PHASE37_PROMPT_TEMPLATES_END -->

<!-- FCI_PHASE38_CHROMIUM_PORT_BEGIN -->
## Chromium, Chrome and Edge build (v0.38.0)

Phase 38 keeps the Firefox package intact and adds a dedicated Chromium Manifest V3 build using the same automation engine and sidebar UI. Build an unpacked directory and deterministic ZIP with:

```bash
./tools/build_chromium_addon.sh --browser chromium --overwrite
./tools/build_chromium_addon.sh --browser chrome --overwrite
./tools/build_chromium_addon.sh --browser edge --overwrite
```

Artifacts are written to `releases/chromium/<browser>/<current-version>/`. The generated manifest uses a service worker and Chromium Side Panel, removes Firefox-only keys, maps the open-sidebar shortcut to `fci-open-side-panel`, and generates PNG icons. `extension/shared/browser_compat.js` provides the Promise-message, tab-session, shortcut-settings and side-panel adapters required by the shared source.

For a local unpacked build, the stable extension ID is `aganahagmocgjhcglbjdeidlpecdhgfj`. Register Native Host 0.13.0 on Linux with:

```bash
./native-host/install_chromium_native_host.sh --browser chromium
# or: --browser chrome / --browser edge / --browser all
```

A store listing can assign another ID; pass it with `--extension-id <id>`. For an isolated development browser profile, run `FCI_CHROMIUM_BROWSER=chromium ./tools/run_chromium_addon_dev.sh` and optionally set `FCI_CHROMIUM_BIN`.

Details: `document/PHASE_38_V0_38_0_CHROMIUM_PORT.md`.
<!-- FCI_PHASE38_CHROMIUM_PORT_END -->



<!-- FCI_PHASE39_ACCESSIBILITY_BEGIN -->
## Accessibility audit (v0.39.0)

The sidebar now exposes a keyboard-visible **Skip to main controls** link, consistent focus rings, labelled dialogs, live status/error announcements and busy-state semantics. CSS respects reduced-motion, increased-contrast and operating-system forced-colour preferences. Repeated profile import/export controls have unique accessible names.

The page element picker can be completed without a pointer: start the picker, use **Tab** or **Shift+Tab** to move through focusable page elements, press **Enter** or **Space** to select the focused element, or press **Escape** to cancel. Pointer hover/click remains supported.

These changes apply to both Firefox and Chromium builds. Protocol remains **25** and Native Host remains **0.13.0**.
<!-- FCI_PHASE39_ACCESSIBILITY_END -->


<!-- FCI_PHASE40_STOPPED_TAB_LOCAL_ACTION_BINDING_BEGIN -->
## Stopped-tab Local action profile binding (v0.39.1)

`Apply to tab` is available for the currently displayed tab even when automation is stopped. The selected Local action profile is stored as an explicit tab-scoped binding, shown again after sidebar refresh, and used on the next activation instead of silently reverting to the default profile. Active-tab assignments use the same binding, so an explicit profile remains selected across later Stop/Start cycles.

The binding stores only the profile ID in browser tab-session storage. Editing the profile continues to update the configuration used by the bound tab. Deleting a bound profile safely replaces the stale binding with the current URL-routed or default Local action profile. Protocol remains **25** and Native Host remains **0.13.0**.
<!-- FCI_PHASE40_STOPPED_TAB_LOCAL_ACTION_BINDING_END -->


### Local action binding source and reset

Version 0.39.2 shows whether a tab uses an explicit Local action binding, a URL-routed profile or the default profile. Use **Use URL/default** to remove an explicit binding on either a stopped or active tab. The routed/default profile is applied immediately and remains effective on the next Start.
<!-- FCI_PHASE42_RELEASE_STATUS_CONSISTENCY_BEGIN -->
## Release-candidate status consistency (v0.39.3)

The required and recommended feature backlogs are now closed consistently across `PROJECT_STATUS.md`, `CURRENT_PROJECT_STATUS.md`, the implementation plan, changelog and release tests. The build fails its focused Phase 42 regression if the manifest version, release documents or final regression summary become stale relative to one another.

No additional implementation item is scheduled. Native Host for macOS remains explicitly deferred; future work starts from a focused bug report or an explicit new feature request. Protocol remains **26** and Native Host remains **0.13.0**.
<!-- FCI_PHASE42_RELEASE_STATUS_CONSISTENCY_END -->
<!-- FCI_PHASE43_SEPARATE_CONFIGURATION_SESSION_IO_BEGIN -->
## Configuration and working-session data separation (v0.39.4)

`Import/export configuration` handles configuration data only. It no longer contains the legacy working-session save/import buttons, and its full-store actions are labelled **Export all configuration** and **Import all configuration**.

All working-session operations remain in `Saved working sessions`: save or update current tabs, restore a selected session, import/export one session, and import/export the complete saved-session catalog. The configuration store and saved-session catalog continue to use separate storage keys and separate JSON formats.
<!-- FCI_PHASE43_SEPARATE_CONFIGURATION_SESSION_IO_END -->

<!-- FCI_PHASE44_STOP_START_TAB_CONFIG_BEGIN -->
## Stop/Start preserves each tab configuration (v0.39.5)

Pressing **Stop** ends the tab's automation runtime but no longer discards its configuration. While the tab remains open, the add-on keeps a tab-scoped snapshot containing the selected configuration profile, tab-specific override, current monitor/target editor draft, Local action profile/override and Local action working draft. Pressing **Start** restores that snapshot instead of loading the default profile.

Runtime-only data intentionally starts clean: monitor baselines, alert state, activity logs and per-rule statistics are not treated as configuration. Selecting a different configuration profile while the tab is stopped intentionally replaces the preserved snapshot on the next Start.
<!-- FCI_PHASE44_STOP_START_TAB_CONFIG_END -->

## Explicit stopped-tab state (v0.39.6)

After **Stop**, the tab remains explicitly inactive even if Firefox reloads the page or restarts the background script. Trusted URL auto-activation skips that tab until the user presses **Start**. The preserved configuration is consumed only after Start succeeds. Applying/clearing a Local action profile or deliberately selecting another configuration/URL route while stopped updates or bypasses the snapshot instead of restoring stale/default values.

<!-- FCI_PHASE46_SIMPLIFIED_SIDEBAR_BEGIN -->
## Simplified sidebar and visible features (v0.39.7)

The two profile systems now use purpose-specific names:

- **Automation profiles** store rules, monitors, targets, alerts and automation URL routing.
- **Local action profiles** store machine-local download destinations, shell commands and their URL routing.

Use the gear button in **Tabs and runtime** to choose a **Simple**, **Standard**, **All features** or **Custom** layout. Tabs and runtime always remains visible, so hidden features can always be restored. Hiding a feature affects only the sidebar controls; it does not delete settings, disable an active automation, alter saved working sessions or change Stop/Start persistence.

Automation save and tab-override controls now live in Automation profiles. **Backup and transfer** contains only configuration import/export, typed profile transfer and recovery snapshots. Working-session files remain isolated in **Working session library**.
<!-- FCI_PHASE46_SIMPLIFIED_SIDEBAR_END -->


## Profile save continuity (v0.39.8)

`Save current as new` captures the complete current Automation or Local action editor. The created or saved profile remains selected without applying Default or silently changing the profile bound to the tab.
