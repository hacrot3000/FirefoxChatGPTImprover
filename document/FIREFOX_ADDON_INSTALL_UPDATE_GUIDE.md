# FirefoxChatImprover — Hướng dẫn cài đặt và cập nhật add-on

## 1. Các chế độ sử dụng

Dự án hỗ trợ hai workflow khác nhau:

1. **Development mode:** dùng `web-ext run`; Firefox development session được mở riêng và add-on tự reload khi source thay đổi.
2. **Persistent mode:** dùng XPI đã ký self-distributed/unlisted; phù hợp sau khi chức năng ổn định.

Trong các phase đầu, nên dùng development mode.

## 2. Yêu cầu môi trường

Cần có:

- Firefox desktop.
- Python 3 cho Patch Tool và Native Messaging Host sau này.
- Node.js và npm để cài `web-ext`.
- Project root:

```text
/home/duongtc/FirefoxChatImprover
```

Kiểm tra:

```bash
firefox --version
python3 --version
node --version
npm --version
```

Các script của project không dùng `sudo` và không cài `web-ext` toàn hệ thống.

## 3. Áp dụng patch

Chép file patch `.zip` vào:

```text
/home/duongtc/FirefoxChatImprover/patchs/
```

Sau đó chạy:

```bash
cd /home/duongtc/FirefoxChatImprover
./tools/run_python_patches.sh
```

Runner Patch Tool v3 sẽ giải nén trong thư mục tạm, chạy script patch và chỉ chuyển file ZIP gốc vào `patchs/patched/` khi bạn đồng ý.

## 4. Cài `web-ext` cục bộ

Chạy một lần:

```bash
cd /home/duongtc/FirefoxChatImprover
./tools/setup_firefox_addon_dev.sh
```

Script cài package vào:

```text
.firefox-dev-tools/
```

Nó không ghi package vào npm global và không thay đổi Firefox.

Kiểm tra phiên bản:

```bash
.firefox-dev-tools/node_modules/.bin/web-ext --version
```

## 5. Chạy add-on với auto reload

Sau khi Phase 01 tạo `extension/manifest.json`, chạy:

```bash
cd /home/duongtc/FirefoxChatImprover
./tools/run_firefox_addon_dev.sh
```

`web-ext run` sẽ:

- mở một Firefox development session;
- cài add-on tạm thời;
- theo dõi thư mục `extension/`;
- tự reload extension khi source thay đổi.

Giữ terminal này đang chạy trong lúc phát triển. Dừng bằng `Ctrl+C`.

### Mở sẵn URL chat

```bash
FIREFOX_CHAT_URL='https://ai.company.example/chat' \
  ./tools/run_firefox_addon_dev.sh
```

### Chỉ định Firefox binary khác

```bash
FIREFOX_BIN='/usr/bin/firefox-developer-edition' \
  ./tools/run_firefox_addon_dev.sh
```

### Dùng profile development riêng

Mặc định `web-ext` tạo profile tạm mới. Có thể chỉ định một **profile development riêng** làm profile nền:

```bash
WEB_EXT_FIREFOX_PROFILE='/home/duongtc/.mozilla/firefox/firefoxchat-dev' \
  ./tools/run_firefox_addon_dev.sh
```

Theo mặc định, `web-ext` sao chép profile nền sang một profile tạm nên thay đổi trong phiên không được ghi ngược lại. Chỉ khi thật sự cần giữ setting giữa các lần chạy mới bật:

```bash
WEB_EXT_FIREFOX_PROFILE='/home/duongtc/.mozilla/firefox/firefoxchat-dev' \
WEB_EXT_KEEP_PROFILE_CHANGES=1 \
  ./tools/run_firefox_addon_dev.sh
```

`--keep-profile-changes` làm thay đổi các thiết lập bảo mật cần cho `web-ext`; vì vậy profile này phải là profile development riêng, không dùng để duyệt web hằng ngày và tuyệt đối không dùng profile Firefox chính.

## 6. Cài tạm thủ công bằng Firefox

Dùng khi không muốn cài Node/npm:

1. Mở Firefox.
2. Nhập `about:debugging`.
3. Chọn **This Firefox**.
4. Chọn **Load Temporary Add-on**.
5. Chọn `extension/manifest.json`.

Khi source thay đổi:

1. Quay lại `about:debugging`.
2. Tìm FirefoxChatImprover.
3. Nhấn **Reload**.
4. Reload tab chat nếu content script cần được inject lại.

Add-on tạm sẽ bị gỡ khi Firefox khởi động lại. Đây là hành vi bình thường của temporary installation.

## 7. Kiểm tra và build

### Lint

```bash
./tools/lint_firefox_addon.sh
```

### Build source archive

```bash
./tools/build_firefox_addon.sh
```

Artifact được tạo trong:

```text
dist/
```

File do `web-ext build` tạo là artifact để kiểm tra/gửi ký. Không mặc định coi nó là XPI đã ký có thể cài lâu dài trên Firefox Release.

## 8. Cập nhật khi source thay đổi

### Trong development mode

Không cần cài lại thủ công. Giữ lệnh sau đang chạy:

```bash
./tools/run_firefox_addon_dev.sh
```

Khi patch tạo/sửa file trong `extension/`, `web-ext` tự reload add-on. Một số thay đổi content script hoặc trạng thái trang có thể yêu cầu reload tab chat để chạy lại từ đầu.

### Khi add-on được cài tạm qua `about:debugging`

Sau mỗi patch:

- nhấn **Reload** trong `about:debugging`;
- reload tab chat;
- xác nhận lại add-on đang ở trạng thái kích hoạt hay dừng.

### Khi đã có XPI ký self-distributed

Mỗi bản cập nhật phải:

1. tăng `version` trong manifest;
2. lint và build;
3. ký phiên bản mới;
4. cài XPI mới hoặc phát hành qua endpoint update riêng đã cấu hình;
5. cập nhật Native Messaging Host riêng nếu protocol thay đổi.

Không dùng source ZIP chưa ký để thay thế trực tiếp một add-on persistent trên Firefox Release.

## 9. Native Messaging Host

Native host sẽ được bổ sung ở Phase 06. Khi đó có thêm:

- script cài host manifest vào `~/.mozilla/native-messaging-hosts/`;
- chương trình Python chạy command;
- script uninstall;
- kiểm tra kết nối từ add-on.

Native host là thành phần cục bộ riêng. Reload extension không tự cập nhật hoặc restart native host đang chạy. Nếu mã native host thay đổi, cần ngắt kết nối hoặc reload extension để Firefox khởi tạo process mới.

## 10. Xử lý lỗi thường gặp

### `extension/manifest.json not found`

Phase 01 chưa được áp dụng hoặc đang chạy script sai project root.

### `web-ext is not installed`

Chạy:

```bash
./tools/setup_firefox_addon_dev.sh
```

### Firefox không mở vì profile đang được sử dụng

Không dùng profile chính. Bỏ biến `WEB_EXT_FIREFOX_PROFILE` hoặc trỏ đến profile development riêng.

### Add-on reload nhưng hành vi cũ vẫn còn trên trang

Reload tab chat. Sau này add-on cũng phải có cleanup khi reinject để tránh observer cũ tồn tại.

### Setting mất sau khi đóng development session

Profile tạm của `web-ext` không mặc định giữ dữ liệu qua lần chạy mới. Trong cùng một phiên `web-ext run`, việc auto reload extension vẫn giữ được phần lớn dữ liệu `storage.local`. Khi cần giữ setting giữa nhiều phiên, dùng profile development riêng với `WEB_EXT_KEEP_PROFILE_CHANGES=1`, hoặc export/import profile cấu hình sau khi tính năng này được bổ sung.

## 11. Tài liệu chính thức tham khảo

- Temporary installation: https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/
- Getting started with web-ext: https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/
- web-ext command reference: https://extensionworkshop.com/documentation/develop/web-ext-command-reference/
- Signing and distribution: https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/
- Native Messaging: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging

## Phase 06 — cài/cập nhật Native Messaging Host

Native host không nằm bên trong tiến trình WebExtension. Mỗi khi `native-host/native_host.py` thay đổi, chạy trực tiếp:

```bash
./native-host/install_native_host.sh
```

File được cài theo user:

```text
~/.local/share/firefox-chat-ai-assistant/native_host.py
~/.mozilla/native-messaging-hosts/com.duongtc.firefox_chat_assistant.json
```

Sau đó reload add-on hoặc restart phiên `web-ext run`. Dùng nút `Kiểm tra Native Host` trong sidebar để xác nhận kết nối.

Gỡ host hoặc self-test:

```bash
./native-host/uninstall_native_host.sh
python3 ./native-host/native_host.py --self-test
```

Không chạy installer bằng `sudo`; host phải chạy cùng tài khoản người dùng đang chạy Firefox.

## Phase 08 — release, XPI ký và cập nhật

Build Task `Firefox Add-on: Build` nay chạy release workflow đầy đủ: test, lint, build ZIP chưa ký, checksum, metadata và release note trong `dist/releases/<version>/`.

Ký XPI dùng riêng:

```bash
export WEB_EXT_API_KEY='JWT issuer'
export WEB_EXT_API_SECRET='JWT secret'
./tools/sign_firefox_addon_unlisted.sh
```

Cài lâu dài bằng Firefox **Add-ons and themes → bánh răng → Install Add-on From File…**, chọn XPI đã ký trong `dist/signed/<version>/`.

Không thêm `update_url` trước khi có endpoint HTTPS ổn định. Khi cần self-host update, dùng `tools/generate_firefox_update_manifest.py`; rollback phải phát hành lại source ổn định với một version mới cao hơn, không hạ version.

Hướng dẫn đầy đủ: `document/PHASE_08_RELEASE_INSTALL_UPDATE_ROLLBACK.md`.
