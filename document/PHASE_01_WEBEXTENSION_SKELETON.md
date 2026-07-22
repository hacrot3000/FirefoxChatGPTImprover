# FirefoxChatImprover — Phase 01: WebExtension skeleton và kích hoạt thủ công

## 1. Mục tiêu

Phase 01 tạo bộ source WebExtension tối thiểu để các task `Lint`, `Build` và `Run Dev (Auto Reload)` có đầu vào hợp lệ, đồng thời hoàn thành luồng kích hoạt thủ công trên tab hiện tại.

Add-on chưa theo dõi DOM, chưa tự click và chưa chạy shell trong phase này.

## 2. Thành phần được tạo

```text
extension/
├── manifest.json
├── background/
│   └── background.js
├── content/
│   └── activation.js
├── shared/
│   └── protocol.js
└── sidebar/
    ├── sidebar.html
    ├── sidebar.css
    └── sidebar.js
```

## 3. Quyền và phạm vi hoạt động

Manifest V3 chỉ yêu cầu các quyền Phase 01 đang dùng:

- `activeTab`: quyền tạm thời trên tab sau thao tác trực tiếp của người dùng.
- `scripting`: inject bootstrap vào tab được kích hoạt.
    Không có `content_scripts` tự động và không có host permission toàn cục. Add-on không chạy trên tất cả website khi Firefox khởi động.

Manifest khai báo `data_collection_permissions.required = ["none"]`: add-on không thu thập hoặc truyền dữ liệu ra ngoài trình duyệt.

## 4. Luồng sử dụng

1. Mở một trang HTTP/HTTPS cần thử nghiệm.
2. Bấm biểu tượng FirefoxChatImprover trên toolbar.
3. Firefox mở sidebar và inject bootstrap vào đúng tab đó.
4. Badge toolbar hiển thị `ON`.
5. Sidebar hiển thị Tab ID, URL và trạng thái.
6. Có thể bấm `Tạm dừng`, `Dừng` hoặc `Làm mới trạng thái`.

Bấm toolbar nhiều lần trên cùng tab không tạo nhiều runtime listener: bootstrap content script có instance guard và chỉ tái sử dụng instance hiện có.

Khi tab điều hướng sang URL khác hoặc bị đóng, background dọn trạng thái tab và xóa badge.

## 5. Build và chạy development

Cài công cụ một lần:

```bash
./tools/setup_firefox_addon_dev.sh
```

Kiểm tra:

```bash
./tools/lint_firefox_addon.sh
```

Tạo artifact trong `dist/`:

```bash
./tools/build_firefox_addon.sh
```

Chạy Firefox development session có auto reload:

```bash
./tools/run_firefox_addon_dev.sh
```

Các lệnh trên cũng có trong `Terminal → Run Build Task...` của VS Code.

## 6. Giới hạn chủ ý của Phase 01

- Nút `Kích hoạt` trong sidebar có thể cần quyền `activeTab` đã được cấp từ lần bấm toolbar gần nhất. Khi Firefox từ chối inject, hãy bấm biểu tượng add-on trên toolbar.
- Không hỗ trợ các trang đặc quyền như `about:*`, trang Firefox Add-ons hoặc URL không phải HTTP/HTTPS.
- Chưa có URL allowlist/profile setting; nội dung này thuộc Phase 02.
- Chưa có `MutationObserver`; nội dung này thuộc Phase 03.
- Chưa có baseline/target mới/tự click; nội dung này thuộc Phase 04.
- Chưa có Native Messaging và shell; nội dung này thuộc Phase 06.

## 7. Tiêu chí nghiệm thu

- `extension/manifest.json` tồn tại và parse được.
- `web-ext lint` pass.
- `web-ext build` tạo ZIP trong `dist/`.
- Bấm toolbar mở sidebar và kích hoạt đúng tab hiện tại.
- Badge chuyển `ON`, `II` và rỗng tương ứng Active, Paused và Stopped.
- Reload/navigation không để trạng thái active cũ trong background.
