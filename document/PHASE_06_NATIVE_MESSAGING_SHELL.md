# Phase 06 — Native Messaging Host và chạy shell local

## 1. Phạm vi

Phase 06 nối sidebar Firefox với một Python Native Messaging Host cục bộ. Add-on không trực tiếp gọi shell và content script không có quyền yêu cầu chạy command.

Luồng:

```text
Sidebar extension
  -> background/background.js
  -> browser.runtime.connectNative()
  -> com.duongtc.firefox_chat_assistant
  -> native-host/native_host.py
```

## 2. Cài hoặc cập nhật Native Host

Trong VS Code chọn `Terminal -> Run Build Task...` rồi chạy:

```text
Firefox Add-on: Install/Update Native Host
```

Task thực hiện:

1. copy `native-host/native_host.py` vào `~/.local/share/firefox-chat-ai-assistant/native_host.py`;
2. đặt quyền executable chỉ cho người dùng;
3. tạo manifest tại `~/.mozilla/native-messaging-hosts/com.duongtc.firefox_chat_assistant.json`;
4. điền đường dẫn tuyệt đối tới host đã cài;
5. chạy self-test protocol, stdout và stderr.

Sau khi cập nhật host, reload add-on hoặc khởi động lại task `Firefox Add-on: Run Dev (Auto Reload)` để Firefox mở process host mới.

Gỡ host bằng task:

```text
Firefox Add-on: Uninstall Native Host
```

## 3. Chạy command từ sidebar

1. Kích hoạt tab cần gắn command session.
2. Nhập đường dẫn tuyệt đối trong `Working directory`.
3. Nhập command shell.
4. Chọn một trong hai mode:
   - `Mở terminal tương tác`: mở terminal thật, phù hợp script có prompt/menu;
   - `Chạy nền và lấy log`: stream stdout và stderr vào sidebar.
5. Bấm `Chạy lệnh`.
6. Xác nhận cwd, mode và command nếu `Xác nhận trước khi chạy` được bật.

Nút `Kiểm tra Native Host` dùng để kiểm tra host đã được Firefox tìm thấy hay chưa.

## 4. Độc lập theo tab

- Mỗi `tabId` có một shell run state riêng.
- Một tab chỉ có tối đa một command chưa kết thúc.
- Hai tab khác nhau có thể chạy hai command nền đồng thời.
- Output, PID, run ID, return code và lỗi được hiển thị theo tab đang chọn.
- `Dừng lệnh` chỉ gửi SIGTERM tới process group của run ID thuộc tab hiện tại.
- Nếu process chưa dừng sau thời gian grace, host mới escalation sang SIGKILL cho đúng process group đó.
- Khi tab bị đóng, background yêu cầu dừng command đang gắn với tab đó.

## 5. Ranh giới an toàn

- Content script bị từ chối khi gửi action Native Messaging.
- Chỉ URL của `sidebar/sidebar.html` được background chấp nhận cho `RUN_SHELL`, `STOP_SHELL` và kiểm tra host.
- Working directory phải là đường dẫn tuyệt đối, tồn tại và là directory.
- Command rỗng, command chứa NUL hoặc message/action lạ bị từ chối.
- Host từ chối chạy command khi Firefox đang chạy dưới tài khoản root.
- Không tự thêm `sudo`.
- Dữ liệu DOM/chat không được ghép tự động vào shell command.
- Output được giới hạn số dòng và tổng số ký tự trong bộ nhớ background.

## 6. Terminal được hỗ trợ

Host thử theo thứ tự terminal có sẵn:

- `gnome-terminal`;
- `kgx`;
- `xfce4-terminal`;
- `konsole`;
- `x-terminal-emulator`.

Command tương tác được ghi vào một script tạm có quyền `0700`; script tự xóa sau khi terminal bắt đầu chạy command. Sau khi command kết thúc, terminal giữ lại interactive shell để xem kết quả.

## 7. Kiểm thử

Task `Firefox Add-on: Test` chạy thêm:

- parse/encode length-prefixed JSON;
- validation working directory;
- background command với stdout và stderr;
- stop đúng process group;
- contract giữa manifest, protocol, background và sidebar.

Có task riêng:

```text
Firefox Add-on: Test Native Host
```

## 8. Giới hạn hiện tại

- Shell output chỉ giữ trong bộ nhớ background của phiên Firefox hiện tại; không ghi tự động xuống file.
- Terminal mode chỉ theo dõi process terminal launcher; nội dung tương tác nằm trong cửa sổ terminal.
- Native host là thành phần cài riêng, không được cập nhật chỉ bằng reload source extension.
