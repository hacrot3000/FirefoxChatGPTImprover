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
