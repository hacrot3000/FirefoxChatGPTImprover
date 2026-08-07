# Hướng dẫn nghiên cứu và thu thập code cho AI — Patch Tool v5.16

## Entry point duy nhất

Sau khi cài đặt, mọi chức năng dùng chung một file:

```bash
./tools/run_python_patches.sh
```

Chạy patch như cũ, không tham số:

```bash
./tools/run_python_patches.sh
```

Nhóm lệnh nghiên cứu/thu thập code:

```bash
./tools/run_python_patches.sh collect <command> [options]
```

Các module, tài liệu và ví dụ nằm trong `tools/_patch_lib/`; không chạy trực tiếp trừ khi đang sửa chính Patch Tool.

## Thu thập tổng quan trước khi AI quyết định

```bash
./tools/run_python_patches.sh collect overview
```

ZIP kết quả chứa:

- Danh sách thư mục gốc tương đương `ls`.
- Cây thư mục có giới hạn tương đương `tree`.
- Thống kê loại file.
- Các file build/cấu hình quan trọng.
- Git branch, status, recent log và diff stat khi project dùng Git.

Nghiên cứu theo từ khóa, vừa lấy tổng quan vừa tìm code:

```bash
./tools/run_python_patches.sh collect research MFRC522 --path gate-rp2040
```

## Danh sách và cây thư mục

```bash
./tools/run_python_patches.sh collect ls .
./tools/run_python_patches.sh collect ls main-esp32c3 --max-entries 500
./tools/run_python_patches.sh collect tree . --max-depth 4
./tools/run_python_patches.sh collect tree gate-rp2040 --max-depth 6
```

Collector không cần hệ thống cài lệnh `tree`; cây thư mục được tạo bằng Python và áp dụng chung exclude/security policy.

## Tìm file theo tên hoặc glob

Chỉ lập danh sách:

```bash
./tools/run_python_patches.sh collect find '*.c' '*.h' --path gate-rp2040
```

Tìm và đưa luôn file khớp vào ZIP:

```bash
./tools/run_python_patches.sh collect find 'CMakeLists.txt' '*.cmake' --path . --collect
```

## Thu thập file, một phần file, đầu hoặc cuối file

```bash
./tools/run_python_patches.sh collect file src/main.c
./tools/run_python_patches.sh collect file src/main.c --start-line 120 --end-line 260
./tools/run_python_patches.sh collect head build.log --lines 150
./tools/run_python_patches.sh collect tail build.log --lines 250
```

## Thu thập symbol

```bash
./tools/run_python_patches.sh collect symbol src/runtime.c runtime_start
```

Tool cố lấy nguyên function/class/struct chứa symbol, tránh cắt giữa khối logic.

## Tìm kiếm và references

```bash
./tools/run_python_patches.sh collect search runtime_start --path src --path include
./tools/run_python_patches.sh collect search 'runtime_(start|stop)' --regex --path src
./tools/run_python_patches.sh collect references runtime_start --path src --path include
```

Kết quả chỉ giữ các đoạn context quanh match thay vì gửi cả project.

## Gom nhiều file hoặc thư mục thành một ZIP

```bash
./tools/run_python_patches.sh collect pack \
  src/main.c \
  include \
  CMakeLists.txt
```

`pack` chấp nhận nhiều file/thư mục, giữ đường dẫn tương đối, áp dụng include/exclude, giới hạn dung lượng và redaction trước khi đóng một ZIP duy nhất.

Thu thập một thư mục theo loại file:

```bash
./tools/run_python_patches.sh collect directory gate-rp2040 \
  --include '**/*.c' \
  --include '**/*.h' \
  --exclude 'build/**'
```

## Git context an toàn

```bash
./tools/run_python_patches.sh collect git
./tools/run_python_patches.sh collect git \
  --section status \
  --section log \
  --section diff_stat \
  --section diff
```

Chỉ các section cố định được phép; request không thể truyền shell command tùy ý.

## File decompile lớn kiểu GM52/IDA/Ghidra

Theo tên:

```bash
./tools/run_python_patches.sh collect decompile docs/GM_52_76.c \
  --name sub_140123456 \
  --match exact \
  --neighbors-before 2 \
  --neighbors-after 2 \
  --references
```

Theo địa chỉ:

```bash
./tools/run_python_patches.sh collect decompile docs/GM_52_76.c \
  --address 0x21E551A \
  --references
```

Adapter này giữ cơ chế index SQLite của GM52 toolkit nhưng không giới hạn tên project hoặc tên file.

## Request nhiều hành động, chạy không tham số

Tạo `CODE_COLLECTION_REQUEST.json` ở project root:

```json
{
  "id": "nfc-reader-research",
  "title": "NFC reader evidence for AI",
  "actions": [
    {"type": "overview", "path": "gate-rp2040", "tree_depth": 4},
    {"type": "find", "paths": ["gate-rp2040"], "patterns": ["*.c", "*.h"]},
    {"type": "search", "query": "MFRC522", "paths": ["gate-rp2040"], "context_lines": 8},
    {"type": "references", "symbol": "nfc_reader_poll", "paths": ["gate-rp2040"]},
    {"type": "pack", "paths": ["gate-rp2040/CMakeLists.txt", "gate-rp2040/include"]}
  ]
}
```

Sau đó:

```bash
./tools/run_python_patches.sh collect
```

Kết quả mặc định:

```text
artifacts/patch_tool_code_collections/<request-id>.zip
```

## Các action hỗ trợ trong JSON

| Action | Mục đích |
|---|---|
| `overview` | Tổng quan project: ls, tree, thống kê, key files, Git |
| `research` | Tổng quan cộng tìm kiếm theo câu hỏi/từ khóa |
| `ls` | Danh sách trực tiếp của thư mục |
| `tree` | Cây thư mục có giới hạn depth/entries |
| `find` | Tìm path theo glob; tùy chọn thu luôn file |
| `file` / `range` | File hoàn chỉnh hoặc đoạn dòng |
| `head` / `tail` | N dòng đầu/cuối |
| `symbol` | Function/class/struct-like block |
| `search` | Text hoặc regex với context |
| `references` | Tìm references của symbol |
| `directory` | Thu source trong một thư mục theo include/exclude |
| `pack` / `zip` | Gom nhiều file/thư mục vào một AI ZIP |
| `git` | Git status/log/diff theo section cố định |
| `decompile` / `ida` / `ghidra` | Trích function từ file decompile lớn |

## An toàn và giới hạn

- Chỉ dùng đường dẫn tương đối trong project.
- Chặn absolute path và `..` traversal.
- Không thực thi shell command do request cung cấp.
- Không tự lấy `.env`, private key, credential hoặc file nhạy cảm.
- Secret trong source/log được redaction trước khi ghi ZIP.
- Mặc định loại `.git`, `patchs`, build output, dependencies, `_patch_lib` và artifact collector cũ.
- Request chỉ được giảm giới hạn, không được tăng vượt project policy.
- ZIP ghi manifest, hash, file đã lấy, file bỏ qua và lỗi từng action.
