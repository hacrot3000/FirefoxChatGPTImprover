# Hướng dẫn thu thập source/evidence cho AI — Python Patch Tool v6.7.9

Tài liệu này mô tả **public workflow** hiện tại. Các lệnh `collect ...` trực tiếp xuất hiện trong tài liệu v5 cũ chỉ là chi tiết dispatcher lịch sử và **không phải hướng dẫn cho người dùng**.

## Entry point duy nhất

Người dùng luôn chạy:

```bash
./tools/run_python_patches.sh
```

Không thêm subcommand COLLECT hoặc đường dẫn request vào command line trong workflow thông thường.

## Khi AI cần thêm source/evidence

AI phải cung cấp **một request ZIP**, không cung cấp JSON rời:

```text
CODE_COLLECTION_REQUEST_<purpose>_<timestamp>.zip
└── CODE_COLLECTION_REQUEST_<purpose>_<timestamp>.json
```

Yêu cầu bắt buộc:

1. ZIP chứa chính xác một file có basename khớp `CODE_COLLECTION_REQUEST*.json`.
2. Request chỉ mô tả thao tác đọc/thu thập evidence; COLLECT không sửa source/Git.
3. Người dùng đặt **request ZIP** trực tiếp vào `<project>/patchs/`.
4. Chạy `./tools/run_python_patches.sh`.
5. Queue tự nhận diện và gắn nhãn `[COLLECT]`; nếu chỉ còn một item thì item đó được chọn sẵn để Enter chạy.
6. Sau khi PASS, gửi **result collection ZIP** được tool đánh dấu `[PRIMARY - UPLOAD THIS FILE]` về AI.

Loose `CODE_COLLECTION_REQUEST*.json` trong `patchs/` bị reject có chủ đích.

## Phân biệt hai ZIP

- **Request ZIP**: AI tạo; chứa request JSON; đưa vào `patchs/`.
- **Result collection ZIP**: tool tạo sau khi COLLECT thành công; chứa source/evidence; đây là file người dùng upload lại cho AI.

Không được nhầm request ZIP với result ZIP và không dùng inner JSON thay cho request ZIP.

## Output PASS chuẩn

Kết quả COLLECT thành công được supervisor chuẩn hóa thành một block duy nhất:

```text
================ COLLECT RESULT ================
[PRIMARY - UPLOAD THIS FILE]
<absolute-path-to-result-collection.zip>
Destination: ChatGPT / AI server
================================================
[INFO] REQUEST ARCHIVED: <request-zip-path>
```

Result ZIP chỉ được hiện một lần; request archive là metadata thông tin.

## Tính chất readonly và tiến trình

- COLLECT là readonly và không dùng transaction worktree.
- TTY progress dùng một dòng, tự tính lại chiều rộng terminal và chặn text vượt width.
- Invalid UTF-8/control characters được xử lý an toàn.
- v6.7.9 đặt collector trong process group riêng và forward SIGINT/SIGTERM để tránh child process bị bỏ lại khi IDE/task runner dừng supervisor.

## Nguồn chuẩn

Khi có mâu thuẫn với tài liệu v5 lịch sử, ưu tiên theo thứ tự:

1. `AI_USAGE_CONTRACT.md`
2. `PORTABLE_USAGE.md`
3. `COLLECT_PROGRESS_V6_7_9.md`
4. `PYTHON_PATCH_TOOL_FEATURE_STATUS.md`
5. `PYTHON_PATCH_STANDARD_PROMPT.md`
