# Phase 25 v0.25.1 — Installation guide trong sidebar

## Phạm vi

Bổ sung group độc lập **Installation guide** ngay sau **Shell command** và trước **Save configuration**. Group vẫn dùng cơ chế thu gọn/mở rộng chung của sidebar.

UI add-on tiếp tục hoàn toàn bằng tiếng Anh.

## Patch Tool v3

Link tải trực tiếp:

```text
https://github.com/hacrot3000/FirefoxChatGPTImprover/raw/refs/heads/main/tools/python_patch_tool_v3_package.zip
```

Hướng dẫn trong sidebar phân biệt:

- repository hiện tại đã có runner: đặt patch vào `patchs/` rồi chạy `./tools/run_python_patches.sh`;
- project mới: tạo `tools/`, `patchs/`, copy `python_patch_utils.py` và `run_python_patches.sh`, sau đó cấp quyền executable;
- runner cũ: chép patch upgrade v3 vào `patchs/` và chạy runner hiện tại một lần.

## Native Messaging Host

Link source/installer:

```text
https://github.com/hacrot3000/FirefoxChatGPTImprover/tree/main/native-host
```

Group hướng dẫn đầy đủ:

1. Giữ nguyên thư mục `native-host/` trong project root.
2. Dùng Python 3 và chạy cùng tài khoản đang chạy Firefox; không dùng `sudo`.
3. Chạy `python3 ./native-host/native_host.py --self-test`.
4. Chạy `./native-host/install_native_host.sh` để cài hoặc cập nhật.
5. Reload add-on/restart `web-ext`, reload các tab liên quan.
6. Bấm **Check Native Host** trong group **Shell command**.
7. Chạy installer lại mỗi khi host hoặc manifest thay đổi.
8. Có lệnh uninstall và hiển thị hai đường dẫn cài đặt per-user.

Các link dùng `target="_blank"` và `rel="noopener noreferrer"` để mở tab mới mà không điều hướng sidebar.
