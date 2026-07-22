# FirefoxChatGPTImprover
A tool for me to work with my ChatGPT and system

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
