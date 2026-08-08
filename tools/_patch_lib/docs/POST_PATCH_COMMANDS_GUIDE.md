# Safe post-patch commands — Python Patch Tool v5.16

> **HISTORICAL v5 DOCUMENT — NOT THE CURRENT PUBLIC WORKFLOW.** Python Patch Tool v6.7.9 supersedes any user-facing command, COLLECT-delivery, transaction or SANDBOX guidance below. Current normal operation is `./tools/run_python_patches.sh`; AI COLLECT requests are ZIP-only; public PATCH execution is in-place and SANDBOX/worktree execution is removed. See `AI_USAGE_CONTRACT.md`, `PORTABLE_USAGE.md` and `PYTHON_PATCH_STANDARD_PROMPT.md`.

## Mục tiêu

Patch có thể yêu cầu chạy một hoặc nhiều command sau khi payload đã chạy. Runner không dùng shell string; mỗi command là một mảng `argv`, chạy trong transaction sandbox, được giới hạn timeout, lọc log, redaction và chỉ áp dụng delta về project thật sau khi validation PASS.

## Quy tắc mặc định

1. Patch có payload và thực sự sửa/tạo file: command được chạy.
2. Patch có payload nhưng không tạo thay đổi: command bị bỏ qua.
3. Package không có payload, chỉ có `post_patch.commands`: được coi là **command-only package** và được chạy.
4. `run_when_no_changes=true` là ngoại lệ hạn chế, không nên dùng. Phải có `no_change_reason` rõ ràng; mặc định tối đa một command.
5. Command FAIL làm package FAIL, sandbox bị loại bỏ và source thật không nhận delta.
6. Idempotency của payload được kiểm tra trước command. Command không bị tự chạy lại lần hai.

## Manifest thông thường

```json
{
  "post_patch": {
    "commands": [
      {
        "name": "Run focused project check",
        "argv": ["python3", "tools/check_feature.py"],
        "cwd": ".",
        "timeout_seconds": 300
      }
    ],
    "run_when_no_changes": false
  }
}
```

## Ngoại lệ khi payload không đổi source

```json
{
  "post_patch": {
    "run_when_no_changes": true,
    "no_change_reason": "The existing code is already correct, but this one focused diagnostic must be refreshed.",
    "commands": [
      {
        "name": "Refresh focused diagnostic",
        "argv": ["python3", "tools/refresh_diagnostic.py"],
        "cwd": ".",
        "timeout_seconds": 120
      }
    ]
  }
}
```

Chỉ dùng khi command thật sự cần thiết dù payload không thay đổi gì. Không dùng để chạy lại build/test theo thói quen.

## Command-only package

Package có thể chỉ gồm:

```text
PATCH_TOOL_MANIFEST.json
```

Manifest vẫn phải có `project.key`, metadata patch chuẩn và `post_patch.commands`. Loại package này dành cho thao tác project-local có chủ đích mà không cần apply source patch.

## Allowlist

### Lệnh đọc cơ bản

Chỉ chấp nhận:

```text
ls
tree
pwd
find
```

`find -exec`, `-execdir`, `-ok`, `-delete`, các output action; `tree -o`; đường dẫn tuyệt đối và `..` đều bị chặn.

### Script trong project

Chấp nhận:

```json
["python3", "tools/check.py"]
["bash", "scripts/check.sh"]
["node", "tools/check.mjs"]
["./tools/check.sh"]
```

Script phải:

- Là đường dẫn tương đối.
- Resolve bên trong project/sandbox.
- Tồn tại tại thời điểm command chạy.
- Có extension được project policy cho phép; direct script phải executable.

Cấm inline/module execution như `python -c`, `python -m`, `bash -c`, `node -e`, PowerShell encoded command. Không chấp nhận `git`, `cmake`, `make`, `docker`, `idf.py`, `gradle` hoặc binary ngoài allowlist ở `post_patch`; các build/test đó phải nằm trong validation profile tin cậy của project.

## Báo cáo

Summary có dòng:

```text
POST_COMMANDS: decision=... status=... requested=N executed=N pass=N fail=N forced=TRUE|FALSE
```

Các trạng thái chính:

- `CHANGED_PATHS`
- `SKIPPED_NO_PATCH_CHANGES`
- `NO_CHANGE_OVERRIDE`
- `COMMAND_ONLY_PACKAGE`
- `NOT_REQUESTED`

Raw/important logs và process-tree metadata nằm trong report ZIP/AI handoff.
