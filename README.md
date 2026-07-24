# FirefoxChatImprover

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
