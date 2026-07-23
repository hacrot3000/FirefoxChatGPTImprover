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


<!-- FIREFOX_CHAT_IMPROVER_PHASE12_BEGIN -->
## Phase 12 — Target action pipeline delay/click/verify

Target automation có thể chạy pipeline `delay trước → click/dry-run → delay sau → verify DOM`. Pipeline và trạng thái verify độc lập theo `tabId`/monitor cycle; pending action bị hủy khi re-arm, pause, stop hoặc config đổi.

Profile cũ giữ hành vi click tức thời vì pipeline mặc định tắt. Tài liệu: `document/PHASE_12_TARGET_ACTION_PIPELINE.md`.
<!-- FIREFOX_CHAT_IMPROVER_PHASE12_END -->
