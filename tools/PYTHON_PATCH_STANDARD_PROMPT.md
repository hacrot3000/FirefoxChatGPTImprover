# Tiêu chuẩn Python patch mini-AI v3 cho project

Tài liệu này dùng khi yêu cầu ChatGPT tạo patch sửa code ở local. Mục tiêu là giảm token patch, tăng khả năng thích ứng khi code local lệch nhẹ, vẫn an toàn vì có backup, thống kê lỗi, và có thể zip các file lỗi để gửi lại ChatGPT.

## Cách chạy

```bash
mkdir -p patchs
cp patch_<ten_thay_doi>.py patchs/
# Hoặc chép gói patch .zip / .tar.gz vào patchs/
./tools/run_python_patches.sh
```

Quy ước:

- `tools/python_patch_utils.py` là helper dùng chung, không đặt trong `patchs/`.
- Runner nhận patch độc lập `.py` và gói `.zip`, `.tar.gz`, `.tgz`.
- Với gói nén, runner giải nén an toàn vào thư mục tạm và chạy đệ quy các file `patch_*.py` theo thứ tự tên; nếu không có file theo mẫu đó thì chạy toàn bộ `.py`.
- Sau khi chạy, runner xóa nội dung giải nén tạm. Chỉ file `.py` độc lập hoặc file nén gốc được chuyển vào `patchs/patched/`.
- Nếu tên đích đã tồn tại, runner tạo tên có timestamp thay vì ghi đè.
- Patch không tự build/flash/monitor/đọc log/phần cứng.
- Patch chỉ sửa đúng file nằm trong yêu cầu.


## Gói patch nén

Gói nén hữu ích khi một thay đổi cần nhiều patch Python hoặc kèm dữ liệu phụ. Cấu trúc có thể có nhiều cấp thư mục:

```text
patch_feature_bundle.zip
├── phase_01/patch_feature_phase_01.py
├── phase_02/patch_feature_phase_02.py
└── resources/config.json
```

Quy tắc runner v3:

1. Không giải nén trực tiếp vào `patchs/` hay project root.
2. Chặn đường dẫn thoát thư mục (`../`), symlink, hardlink và special file.
3. Chạy các patch Python theo thứ tự đường dẫn đã sắp xếp.
4. Xóa toàn bộ nội dung giải nén sau khi hoàn tất hoặc lỗi.
5. Khi người dùng đồng ý dọn dẹp, chỉ chuyển file nén gốc vào `patchs/patched/`; các `.py` đã giải nén không được giữ riêng.

## Skeleton patch ngắn nên dùng

```python
#!/usr/bin/env python3
from pathlib import Path
import sys

PATCH_NAME = "ten_patch_ngan_gon"
PROJECT_ROOT = Path.cwd().resolve()
sys.path.insert(0, str(PROJECT_ROOT / "tools"))

from python_patch_utils import run_patch

OPS = [
    {
        "id": "mo-ta-ngan",
        "kind": "replace",
        "file": "relative/path/to/file.c",
        "anchor": "ten_ham_hoac_comment_gan_do",
        "old": """old block""",
        "new": """new block""",
        "mode": "auto",
        "on_error": "stop",
    },
]

if __name__ == "__main__":
    raise SystemExit(run_patch(PATCH_NAME, OPS))
```

## Operation kinds

### 1. `replace`

Thay một block. Mặc định `mode="auto"` sẽ thử theo thứ tự:

1. exact match;
2. old variants nếu có;
3. whitespace-normalized match;
4. fuzzy line-window match.

Ví dụ ngắn:

```python
{
    "id": "bump-hook-marker",
    "kind": "replace",
    "file": "battle/hook.nim",
    "anchor": "hook status",
    "old": "[MWF] hook status V7 where=",
    "new": "[MWF] hook status V8 where=",
}
```

Các field hữu ích:

- `old_variants`: list các block cũ có thể gặp.
- `already`: chuỗi hoặc list chuỗi dùng để nhận biết đã patch rồi.
- `mode`: `auto`, `exact`, `normalized_ws`, `fuzzy`, `regex`.
- `fuzzy_min`: mặc định `0.88`, tăng lên nếu muốn chặt hơn.
- `anchor_radius`: chỉ tìm quanh anchor để giảm mơ hồ.
- `on_error`: `stop`, `skip`, `ignore`.

### 2. `replace_any`

Dùng khi local có thể đang ở nhiều dạng A/B/C và mỗi dạng cần new khác nhau.

```python
{
    "id": "support-two-local-shapes",
    "kind": "replace_any",
    "file": "src/main.c",
    "anchor": "target_function",
    "replacements": [
        {"old": "old shape A", "new": "new shape A"},
        {"old": "old shape B", "new": "new shape B"},
    ],
}
```

### 3. `insert_after` / `insert_before`

Chèn quanh anchor duy nhất. Có idempotent check bằng nội dung `insert` hoặc field `already`.

```python
{
    "id": "add-helper-call",
    "kind": "insert_after",
    "file": "src/main.c",
    "anchor": "init_system();\n",
    "insert": "    init_new_feature();\n",
}
```

### 4. `regex_replace`

Dùng regex khi exact block quá dài hoặc có giá trị biến đổi nhẹ.

```python
{
    "id": "bump-version",
    "kind": "regex_replace",
    "file": "src/version.h",
    "pattern": r'#define APP_VERSION "[^"]+"',
    "repl": '#define APP_VERSION "0.1.26"',
    "count": 1,
}
```

`count` mặc định là `1`. Nếu regex match 0 hoặc nhiều hơn count thì patch báo lỗi, không tự đoán. Có thể dùng `count="any"` khi thật sự muốn thay toàn bộ.

### 5. `if`

Dùng cho logic nếu-thì-không-thì.

```python
{
    "id": "shape-dependent-patch",
    "kind": "if",
    "condition": {
        "file": "src/main.c",
        "contains": "old local shape A",
    },
    "then": [
        {"kind": "replace", "file": "src/main.c", "old": "A", "new": "A'"},
    ],
    "else": [
        {"kind": "replace", "file": "src/main.c", "old": "B", "new": "B'", "on_error": "skip"},
    ],
}
```

Condition hỗ trợ:

- `contains`
- `not_contains`
- `regex`
- `not_regex`
- `exists`
- `path_exists`

### 6. `first_success`

Thử nhiều alternative, chọn cái đầu tiên match thành công. Chỉ nên dùng cho các alternative nhỏ và độc lập.

```python
{
    "id": "try-known-layouts",
    "kind": "first_success",
    "alternatives": [
        [{"kind": "replace", "file": "src/a.c", "old": "layout A", "new": "new A"}],
        [{"kind": "replace", "file": "src/a.c", "old": "layout B", "new": "new B"}],
    ],
}
```

### 7. `write`, `append`, `prepend`

- `write`: tạo mới hoặc ghi đè file nếu khác nội dung, có backup nếu file đã tồn tại.
- `append` / `prepend`: thêm nội dung vào cuối/đầu file, có check idempotent.

## Chính sách lỗi

Mỗi operation có thể đặt:

```python
"on_error": "stop"   # mặc định, dừng toàn patch
"on_error": "skip"   # ghi nhận lỗi, bỏ qua operation đó, chạy tiếp operation khác
"on_error": "ignore" # bỏ qua thật sự, không tính failed; chỉ dùng cho optional cleanup nhỏ
```

Khuyến nghị:

- Các patch phụ thuộc nhau: để `stop`.
- Các patch độc lập theo file/tính năng phụ: dùng `skip`.
- Không dùng `ignore` cho thay đổi code chính.

Khi có lỗi, helper sẽ in:

- `ERROR`
- `File`
- `Op`
- `Mode`
- `Anchor`
- preview block cần tìm
- nearby context/candidate context nếu có
- summary cuối cùng và danh sách failed files

Nếu chạy trong terminal tương tác, khi có lỗi helper sẽ hỏi có zip các file lỗi không. Zip được lưu tại:

```text
patchs/failed_patch_files/<patch_name>_failed_<timestamp>.zip
```

Zip giữ nguyên đường dẫn tương đối để gửi lại ChatGPT.

## Prompt chuẩn đưa cho ChatGPT

```text
Hãy cung cấp file Python patch, không cung cấp prompt sửa code.

Dùng helper tools/python_patch_utils.py phiên bản mini-AI v3 nếu có. Patch nên dùng dạng khai báo run_patch(PATCH_NAME, OPS) để giảm token.

Yêu cầu bắt buộc:
1. File patch đặt tên duy nhất dạng patch_<ten_ngan_gon>.py; nếu đóng gói nhiều file thì dùng tên duy nhất dạng patch_<ten_ngan_gon>.zip hoặc .tar.gz.
2. Patch chạy từ project root bằng ./tools/run_python_patches.sh.
3. Không thay đổi runner, không build/flash/monitor/đọc log/phần cứng trong patch.
4. Chỉ sửa file liên quan trực tiếp yêu cầu.
5. Ưu tiên operation kind: replace, replace_any, regex_replace, insert_after, insert_before, if, first_success, write.
6. Mỗi operation phải có id ngắn, file, anchor nếu có thể.
7. Với block dễ lệch nhẹ ở local, dùng mode="auto" hoặc old_variants; chỉ dùng fuzzy khi block đủ dài và anchor đủ rõ.
8. Nếu operation phụ thuộc operation trước, để on_error="stop". Nếu độc lập, có thể đặt on_error="skip".
9. Nếu cần nếu-thì, dùng kind="if" hoặc replace_any thay vì viết logic Python dài.
10. Nếu lỗi, helper phải tự báo file lỗi và cuối cùng hỏi zip failed files.
11. Không dùng replace mơ hồ trên chuỗi ngắn xuất hiện nhiều nơi; dùng anchor_radius, regex count=1, hoặc exact block lớn hơn.
```

## Ghi chú an toàn

- `mode="auto"` không có nghĩa là đoán bừa. Nếu tìm thấy nhiều candidate, helper báo ambiguous.
- Fuzzy matching chỉ nên dùng khi `anchor` đủ đặc trưng hoặc block đủ dài.
- Backup được tạo trước lần ghi đầu tiên vào mỗi file.
- Nếu một patch chạy nhiều lần, backup cũ không bị ghi đè; helper tự thêm hậu tố `.2`, `.3`, ... khi cần.
