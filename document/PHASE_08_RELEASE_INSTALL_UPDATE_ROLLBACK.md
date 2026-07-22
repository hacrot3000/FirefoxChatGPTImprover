# Phase 08 — Đóng gói, cài lâu dài, cập nhật và rollback

## 1. Phạm vi

Phase 08 chuẩn hóa release nhưng không tự gửi source hoặc credential ra ngoài. Workflow tách ba artifact:

1. **Unsigned source archive** do `web-ext build` tạo để kiểm tra hoặc gửi Mozilla ký.
2. **Mozilla-signed XPI** dùng để cài lâu dài trên Firefox Release.
3. **Native Messaging Host** cài riêng trên máy, không nằm trong XPI và không tự cập nhật cùng add-on.

Add-on giữ ID cố định:

```text
firefox-chat-assistant@duongtc.local
```

Manifest Phase 08 có `data_collection_permissions.required = ["none"]` và chưa thêm `update_url`. Chỉ thêm `update_url` sau khi endpoint HTTPS cho cả `updates.json` và XPI đã hoạt động.

## 2. Bump version

```bash
./tools/bump_firefox_addon_version.py --patch
./tools/bump_firefox_addon_version.py --minor
./tools/bump_firefox_addon_version.py --major
./tools/bump_firefox_addon_version.py --set 0.8.1
```

Tool chỉ sửa `extension/manifest.json` và từ chối version mới không lớn hơn version hiện tại.

## 3. Build release chưa ký

Dùng Build Task hiện có:

```text
Firefox Add-on: Build
```

Hoặc:

```bash
./tools/build_firefox_addon.sh
```

Workflow thực hiện:

1. kiểm tra manifest, add-on ID và khai báo không thu thập dữ liệu;
2. chạy toàn bộ `tools/test_firefox_addon.sh`;
3. chạy `web-ext lint`;
4. build ZIP chưa ký;
5. tạo `SHA256SUMS`, `release.json` và `RELEASE_NOTES.md`.

Kết quả:

```text
dist/releases/<version>/
├── firefox-chat-ai-assistant-<version>-unsigned.zip
├── RELEASE_NOTES.md
├── release.json
└── SHA256SUMS
```

Không ghi đè release cùng version theo mặc định. Cần bump version; `--overwrite` chỉ dành cho build thử chưa phát hành.

## 4. Ký self-distributed/unlisted

Tạo AMO API credentials trong tài khoản Mozilla Add-ons, sau đó export vào terminal hiện tại:

```bash
export WEB_EXT_API_KEY='JWT issuer'
export WEB_EXT_API_SECRET='JWT secret'
./tools/sign_firefox_addon_unlisted.sh
```

Script dùng `web-ext sign --channel unlisted`, không ghi credential vào source, task hoặc command argument. XPI tải về nằm tại:

```text
dist/signed/<version>/
```

Giữ `SHA256SUMS` cùng XPI. Không commit API key/secret.

## 5. Cài XPI lâu dài

Trong Firefox desktop:

1. Mở **Add-ons and themes**.
2. Bấm biểu tượng bánh răng.
3. Chọn **Install Add-on From File…**.
4. Chọn XPI đã được Mozilla ký trong `dist/signed/<version>/`.
5. Xác nhận **Add**.

ZIP chưa ký trong `dist/releases/` không thay thế cho XPI đã ký.

Sau khi cài add-on, cài/cập nhật Native Host riêng:

```bash
./native-host/install_native_host.sh
```

Reload add-on hoặc restart Firefox để process native host mới được khởi tạo.

## 6. Cập nhật thủ công

Với cách dùng cá nhân đơn giản nhất:

1. bump version;
2. chạy test/build;
3. ký unlisted;
4. cài XPI mới bằng **Install Add-on From File…**;
5. cài lại Native Host nếu file host thay đổi.

Firefox giữ cùng add-on do ID không đổi và áp dụng version mới.

## 7. Tự host update manifest — tùy chọn

Chỉ dùng sau khi có nơi host HTTPS ổn định. Tạo update manifest từ **đúng XPI đã ký**:

```bash
./tools/generate_firefox_update_manifest.py \
  --xpi dist/signed/0.8.0/firefox_chat_ai_assistant-0.8.0.xpi \
  --xpi-url 'https://updates.example.com/firefox/firefox-chat-ai-assistant-0.8.0.xpi' \
  --update-url 'https://updates.example.com/firefox/updates.json'
```

Tool tạo:

```text
dist/update/updates.json
dist/update/manifest-update-url-fragment.json
```

Thứ tự triển khai bắt buộc:

1. upload XPI và xác nhận URL tải được qua HTTPS;
2. upload `updates.json` và xác nhận JSON tải được qua HTTPS;
3. xem lại SHA-256 trong manifest;
4. mới thêm `update_url` vào `browser_specific_settings.gecko`;
5. bump version, build và ký lại add-on chứa `update_url`;
6. cài bản đó một lần; các bản sau mới có thể tự cập nhật.

Không tự động chèn `update_url`, vì cấu hình URL sai có thể làm hỏng luồng cập nhật của bản cài lâu dài.

## 8. Rollback

Không hạ `version` trong manifest. Rollback đúng là:

1. checkout source của bản ổn định trước;
2. đặt **version mới lớn hơn tất cả version đã phát hành**, ví dụ lỗi ở `0.8.2` thì bản rollback có thể là `0.8.3`;
3. test, build và ký lại;
4. cài XPI mới hoặc cập nhật `updates.json` tới XPI rollback;
5. cập nhật Native Host riêng nếu protocol cũng cần rollback.

Lưu lại mỗi thư mục `dist/signed/<version>/`, checksum, release note và commit tương ứng để truy vết.

## 9. Kiểm thử Phase 08

```bash
./tools/test_firefox_addon.sh
```

Test Phase 08 kiểm tra:

- ID và version manifest;
- khai báo data collection;
- không bật `update_url` sớm;
- chống version downgrade;
- format update manifest và SHA-256;
- signing channel `unlisted`;
- credential không nằm trong command argument;
- Build Task hiện có đi qua release workflow.

## 10. Tài liệu Mozilla

- https://extensionworkshop.com/documentation/develop/web-ext-command-reference/
- https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/
- https://extensionworkshop.com/documentation/publish/install-self-distributed/
- https://extensionworkshop.com/documentation/manage/updating-your-extension/
- https://extensionworkshop.com/documentation/publish/version-rollback/
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings
