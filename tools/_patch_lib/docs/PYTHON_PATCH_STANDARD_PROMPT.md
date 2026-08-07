# Tiêu chuẩn Python Patch Tool mini-AI v5.16

Tài liệu này là chuẩn chung để AI tạo, chạy và sửa patch mã nguồn local với ít token, ít sai khác giữa các AI và có đủ bằng chứng khi lỗi. Không tự phát minh cấu trúc ZIP, summary, Git policy hoặc format log riêng nếu tiêu chuẩn này đã đáp ứng được yêu cầu.

## Primary execution contract: zero arguments

The patch package must be designed for the user's normal command:

```bash
./tools/run_python_patches.sh
```

Zero-argument mode must present the cleaned runnable queue and ask the user to choose one patch, multiple patches, all patches, or cancel. It must not silently run the whole queue. In a TTY, use the checkbox selector; without TTY, accept selections such as `1,3-5`, `a`, `n`, or `q`. Enter with no selected patch must ask again rather than default to all.

For non-interactive automation, the caller must explicitly use `--all`, repeat `--patch`, or configure `automation.zero_argument.selection=all`. Patch manifests still contain validation, Git, report, and execution policy; the user only chooses which package(s) from the current queue are intended for this run.

A successful selected package is moved automatically to `patchs/patched/`. A failed selected package remains available for replacement or rerun. Unselected packages remain unchanged in `patchs/` and are recorded as `user_not_selected`. `AI_HANDOFF.zip`, `DETAIL.zip`, `LAST_RUN.md`, and machine-readable summaries are generated automatically.

## Mandatory backward-compatibility contract

The v5 runner must execute recognized Patch Tool v4 inputs: standalone `patch_*.py`, v4 ZIP/TAR packages with nested patch scripts, and the v4 fallback form where helper-based Python scripts use other names. Compatibility is an input feature only: AI must still return all new or corrected patches in v5 ZIP format.

A v4 package has no manifest or `project.key`. It is accepted only after positive structural/helper-marker recognition and explicit user selection. It must be labeled `legacy_v4`, must not create project identity, and must not be used as evidence of patch sequence/history. Git and current source remain authoritative. On a new machine, identity is adopted from the first selected keyed v5 package, even when selected v4 packages appear earlier. See `LEGACY_V4_COMPATIBILITY.md`.


## 1. Mục tiêu v5.16

1. AI tạo patch ngắn hơn bằng payload dữ liệu `PATCH_TOOL_OPS.json` khi không cần logic Python đặc biệt.
2. Console chỉ hiện phần quan trọng; log nguyên bản vẫn được giữ trong ZIP chi tiết.
3. Lỗi cú pháp có vị trí, dấu `^`, vùng code và gợi ý sửa.
4. Lỗi build/test được trích file, dòng, cột và nguyên nhân chính từ GCC/Clang, CMake/Ninja/Make, ESP-IDF, Docker, Gradle, Node/TypeScript, Rust và Python.
5. Lỗi do code đã thay đổi hoặc anchor cũ được kèm file hiện tại, block gần giống và Git diff để AI cập nhật patch.
6. Phát hiện source drift trước khi chạy patch, ưu tiên symbol hash để phân biệt thay đổi không liên quan.
7. Gom hàng trăm lỗi dây chuyền thành một số ít root-cause có mã lỗi ổn định.
8. Thu thập function/class/symbol chứa lỗi thay vì gửi nguyên file khi không cần.
9. Tạo một `AI_HANDOFF.zip` mặc định để người dùng chỉ cần gửi một file cho AI; các bundle cũ vẫn được giữ để tương thích.
10. Chạy patch và validation trong Git worktree tách biệt; chỉ áp dụng delta đã xác minh vào project thật.
11. Rollback các path đã áp dụng nếu việc chép delta lỗi giữa chừng; không dùng `git reset --hard` trên worktree thật.
12. Kiểm tra idempotency trong sandbox mà không lặp lại validation/Git action.
13. Theo dõi và dọn toàn bộ process group khi timeout hoặc process cha kết thúc nhưng process con còn giữ stdout.
14. Tự chọn validation profile từ các path thực sự thay đổi trong sandbox, theo rule chỉ do project cấu hình.
15. Khi validation FAIL, có thể chạy đúng một diagnostic rerun đã được đánh dấu an toàn để lấy log rõ hơn nhưng không thay đổi kết quả FAIL.
16. So sánh với lần FAIL trước theo patch ID, chỉ ra lỗi mới, lỗi đã hết và lỗi còn giữ nguyên để giảm log/token lặp lại.
17. Hỗ trợ cùng một project được patch trên nhiều máy: Git/source là nguồn sự thật duy nhất; lịch sử patch cục bộ không phải chuỗi ràng buộc.
18. Mỗi patch mang `project.key`; máy chưa có identity chỉ nhận key từ patch đầu tiên trong tập người dùng thực sự chọn chạy.
19. Bỏ qua và đưa ra khỏi queue các ZIP không phải patch, ví dụ AI handoff/report ZIP tải nhầm vào `patchs/`.
19a. Các package bị tự động bỏ qua trước selector (đặc biệt `duplicate_success`) phải vẫn được hiển thị ngay trong màn hình chọn với tên file, lý do và nơi đã chuyển tới; không được để người dùng hiểu rằng patch tự biến mất.
20. Bỏ qua patch của project khác chỉ với cảnh báo, không mutation và không làm queue FAIL.
21. Dùng fingerprint payload chuẩn để bỏ qua package đã PASS trùng trên chính máy hiện tại, kể cả file bị đổi tên hoặc đóng gói lại.
22. Ưu tiên đường dẫn tương đối trong manifest, console, report và AI handoff để dùng được trên các máy có project root khác nhau.
23. Cung cấp bộ nghiên cứu code tổng quát cho AI: overview/ls/tree/find/file/range/head/tail/search/references/callgraph/dependencies/pack/Git/decompile.
24. Dùng một entry point công khai duy nhất; module, ví dụ và tài liệu phải nằm trong `tools/_patch_lib/` để không lẫn với tool nghiệp vụ.
25. Gói phát hành phải portable-first: giải nén trực tiếp vào project tạo đúng `tools/run_python_patches.sh`; không bắt buộc chạy installer.
26. Zero-argument runner phải hỗ trợ chọn một/nhiều/tất cả, bỏ chọn, hủy, và giữ nguyên mọi patch không được chọn.
27. Runner v5 phải chạy được patch v4 đã tồn tại nhưng không yêu cầu AI tạo patch mới theo format v4; mọi run v4 phải ghi rõ project scope chưa xác minh.

## 2. Cài đặt hoặc nâng cấp portable

Luồng chính không dùng installer. Đứng tại project root và giải nén trực tiếp:

```bash
unzip -o python_patch_tool_v5.16.0_package.zip -d "$PWD"
./tools/run_python_patches.sh
```

ZIP phải chứa sẵn đường dẫn cuối cùng:

```text
tools/
├── run_python_patches.sh          # entry point công khai duy nhất
└── _patch_lib/
    ├── python_patch_runner.py
    ├── python_patch_utils.py
    ├── python_patch_diagnostics.py
    ├── python_patch_transaction.py
    ├── python_patch_intelligence.py
    ├── python_patch_identity.py
    ├── python_patch_commands.py
    ├── python_patch_source_baseline.py
    ├── python_patch_code_collector.py
    ├── install_python_patch_tool_v5.py   # tùy chọn
    ├── docs/
    ├── examples/
    └── templates/
```

`run_python_patches.sh` không được nằm trong `_patch_lib/`. Direct extraction không chứa và không ghi đè `.python_patch_tool.json`; runtime dùng default deep-merge cho trường còn thiếu.

Chỉ dùng installer tùy chọn khi cần backup từng file, dọn layout cũ hoặc tạo explicit config:

```bash
python3 tools/_patch_lib/install_python_patch_tool_v5.py --project-root "$PWD"
```

Installer không còn là điều kiện để chạy tool.

## 3. Đầu ra bắt buộc của AI

AI phải trả về **một file ZIP patch duy nhất**. Không trả riêng từng file `.py`, không yêu cầu người dùng chép nhiều đoạn code.

Tên khuyến nghị:

```text
patch_<project>_<phase>_<short_description>_v5_<timestamp>.zip
```

Một ZIP chỉ nên có một mục tiêu logic. Cấu trúc ưu tiên:

```text
patch_feature_checkpoint_v5_20260806_2100.zip
├── PATCH_TOOL_MANIFEST.json
└── PATCH_TOOL_OPS.json
```

Chỉ dùng Python khi operation DSL không đủ:

```text
patch_complex_migration_v5_20260806_2100.zip
├── PATCH_TOOL_MANIFEST.json
├── patch_complex_migration.py
└── resources/                    # chỉ khi thật sự cần
```

Không đặt đồng thời `PATCH_TOOL_OPS.json` và `patch_*.py` trong cùng package. Runner từ chối package có hai entrypoint để tránh thứ tự không rõ ràng.

## 3A. Tương thích đầu vào Patch Tool v4

Các patch v4 hiện có vẫn được phép dùng:

```text
patch_example.py
legacy_bundle.zip/phase_01/patch_example.py
legacy_bundle.tar.gz
```

Runner nhận diện bằng tên `patch_*.py` hoặc dấu hiệu helper v4. Không được coi mọi file `.py` là patch. V4 không có manifest/project key nên user selection là xác nhận chạy; report phải ghi `PROJECT_SCOPE_VERIFIED: FALSE`. Project có thể tắt bằng `package_policy.allow_legacy_v4=false`.

AI không được tạo patch v4 mới. Khi sửa hoặc thay thế patch v4, hãy trả một ZIP v5 chuẩn.

## 4. Dạng data-only để giảm token

Ưu tiên `PATCH_TOOL_OPS.json` cho replace, insert, append, prepend, write, điều kiện và các phương án fallback. Dạng này:

- bỏ toàn bộ import/boilerplate Python;
- không thể lỗi cú pháp Python;
- dễ preflight và thu thập chính xác file/anchor;
- giúp AI tạo patch ngắn hơn và runner tạo CODE_CONTEXT tốt hơn.

Ví dụ:

```json
{
  "schema_version": 1,
  "patch_name": "feature_checkpoint",
  "default_on_error": "stop",
  "ops": [
    {
      "id": "update-feature-block",
      "kind": "replace",
      "file": "src/feature.c",
      "anchor": "static void feature_entry(void)",
      "old": "old block",
      "new": "new block",
      "mode": "auto"
    }
  ]
}
```

Operation chuẩn:

```text
replace
replace_any
regex_replace
insert_after
insert_before
append
prepend
write
if
first_success
```

Quy tắc:

- `file` luôn là đường dẫn tương đối trong project; không dùng absolute path hoặc `..`.
- `stop` là mặc định cho thay đổi chính.
- `skip` chỉ dùng cho operation độc lập nhưng vẫn cần báo failure.
- `ignore` chỉ dùng cho cleanup tùy chọn; không dùng để che lỗi chính.
- Ưu tiên exact → variant → whitespace-normalized; chỉ fuzzy khi block đủ dài và anchor rõ.
- Anchor phải đủ đặc trưng để xác định đúng một vùng.
- Không bỏ uniqueness check chỉ để patch chạy qua.
- Nếu code có nhiều shape hợp lệ, dùng `first_success` hoặc `if` thay vì regex quá rộng.

## 5. Khi nào vẫn dùng Python patch

Dùng `patch_*.py` khi cần một trong các trường hợp:

- đọc và chuyển đổi cấu trúc phức tạp mà operation DSL không biểu diễn được;
- cập nhật nhiều file dựa trên dữ liệu tính toán;
- migration cần parser riêng;
- kiểm tra invariant phức tạp trước khi ghi file.

Dùng `tools/_patch_lib/templates/PYTHON_PATCH_TEMPLATE.py` và `run_patch(PATCH_NAME, OPS)` nếu phần lớn thay đổi vẫn là operation chuẩn. Không nhúng bản sao helper/runner/diagnostics vào package nghiệp vụ.

Python patch phải:

- idempotent;
- chạy từ project root;
- không tự build, flash, monitor hoặc push ngoài manifest/workflow;
- không `git reset --hard`, `clean`, `checkout`, `stash`, `rebase`, `amend` hoặc force push;
- không nuốt exception làm package PASS giả.

## 6. Manifest chuẩn

```json
{
  "schema_version": 1,
  "project": {
    "key": "stable-project-key"
  },
  "patch": {
    "id": "feature_checkpoint",
    "version": "v5.16.0",
    "phase": "Phase 3 / ~5",
    "phase_under_test": "Phase 3",
    "summary": "Complete the feature checkpoint.",
    "regression_scope": "Focused feature checks plus core regression."
  },
  "source_baseline": {
    "generated_from": "git:<commit-sha>",
    "files": [
      {
        "file": "src/feature.c",
        "sha256": "<raw-file-sha256>",
        "symbol": "feature_entry",
        "symbol_sha256": "<normalized-symbol-sha256>",
        "line_hint": 120
      }
    ]
  },
  "execution": {
    "timeout_seconds": 0
  },
  "validation": {
    "profiles": ["quick"]
  },
  "git": {
    "add": "changed",
    "commit": "auto",
    "commit_message": "Complete feature checkpoint",
    "push": "off",
    "fail_on_error": true
  }
}
```

Bắt buộc khi strict mode:

```text
patch.id
patch.version
patch.phase
patch.phase_under_test
patch.summary
patch.regression_scope
project.key
```

`project.key` phải ổn định, viết thường và chỉ gồm chữ số, chữ cái, `.`, `_`, `-`. AI phải sao chép chính xác key từ `.python_patch_tool_project.json`, manifest patch trước hoặc thông tin handoff; không tự đổi key giữa các phase.

Manifest chỉ được:

- chọn validation profile tin cậy đã có trong project;
- đặt timeout của package;
- khai báo Git policy và metadata.

Manifest **không được** tùy biến command filter, report bundle, source-context limit hoặc lệnh validation trực tiếp. Những phần đó thuộc project config tin cậy để tránh mỗi AI tạo một kiểu và tránh package chưa tin cậy làm mất log.

### Tạo `source_baseline` đúng chuẩn

Không tự gõ hash bằng tay. Dùng helper đã cài đặt:

```bash
./tools/run_python_patches.sh baseline \
  --ops /path/to/PATCH_TOOL_OPS.json \
  --output /tmp/source_baseline.json
```

Hoặc chỉ định file/symbol:

```bash
./tools/run_python_patches.sh baseline \
  --file src/feature.c \
  --symbol src/feature.c=feature_entry \
  --line src/feature.c=120
```

Helper dùng đúng thuật toán hash/symbol của runner. Khi file hash thay đổi nhưng symbol hash vẫn khớp, runner có thể cho phép patch tiếp tục theo project policy. Khi symbol hoặc file mục tiêu đã thay đổi, runner dừng trước mutation và tạo `PTV-SOURCE-DRIFT-001`.


## 7. Quy tắc nhiều máy, project identity và lịch sử cục bộ

### Git/source là nguồn sự thật duy nhất

Cùng một project có thể được patch luân phiên trên nhiều máy. Chỉ source được đồng bộ qua Git; các thư mục `patchs/`, report và lịch sử chạy có thể hoàn toàn khác nhau. Vì vậy AI và runner phải tuân thủ:

- không yêu cầu history phải chứa patch/phase trước;
- không báo lỗi chỉ vì thiếu số patch, thiếu phase hoặc lịch sử không liên tục;
- không dùng history để kết luận source đang cũ hoặc mới;
- không thiết kế patch phụ thuộc vào file report/history của máy trước;
- luôn kiểm tra source hiện tại, Git HEAD, source baseline, precondition và postcondition;
- patch phải idempotent hoặc có nhận dạng trạng thái `already applied`;
- khi đổi máy, chấp nhận rằng duplicate suppression có thể không nhận ra package đã chạy ở máy khác.

Lịch sử cục bộ chỉ là tối ưu hóa tránh chạy lại **cùng canonical payload đã PASS trên máy hiện tại**. Nó không phải ledger phân tán, migration database hay dependency graph.

### Project identity

Mỗi package v5.16 phải có:

```json
"project": {
  "key": "stable-project-key"
}
```

Identity cục bộ nằm tại:

```text
.python_patch_tool_project.json
```

Nếu file chưa tồn tại, runner chỉ nhận key từ patch đầu tiên trong danh sách người dùng đã xác nhận chạy, rồi ghi identity cục bộ. Patch chỉ nằm trong queue nhưng không được chọn không được phép quyết định identity. Sau khi nhận key, package khác key được chuyển vào `patchs/ignored/foreign_project/`, chỉ cảnh báo và không chạy. Identity là machine-local; runner/installer cố thêm nó vào `.git/info/exclude` thay vì sửa `.gitignore` tracked.

### Duplicate suppression cục bộ

PASS history mặc định nằm tại:

```text
patchs/reports/.patch_tool_local_history/successful.jsonl
```

Fingerprint được tính từ canonical manifest và hash payload, nên đổi tên ZIP hoặc đóng gói lại cùng nội dung vẫn được nhận ra. Chỉ PASS được ghi vào duplicate history; patch FAIL đã sửa có payload mới vẫn chạy bình thường. Có thể chẩn đoán đặc biệt bằng `--force-repeat`, nhưng đây không phải workflow chính.

### Queue hygiene

Trong zero-argument mode, runner kiểm tra cấu trúc trước khi thực thi:

```text
patchs/ignored/non_patch/           ZIP handoff/report/archive không phải patch
patchs/ignored/missing_project_key/ patch không có project.key bắt buộc
patchs/ignored/foreign_project/     patch dành cho project khác
patchs/ignored/duplicate_success/   payload đã PASS trên máy hiện tại
```

Các trường hợp này là `SKIPPED`, không phải package FAIL. Không xóa vĩnh viễn file; chỉ đưa ra khỏi queue để lần chạy sau không lặp cảnh báo. `LAST_RUN.md/json` ghi lý do và đường dẫn tương đối sau khi di chuyển.

### Chọn patch tương tác

Mặc định project config phải dùng:

```json
{
  "automation": {
    "zero_argument": {
      "selection": "prompt",
      "non_interactive_confirmed": false,
      "initial_selection": "none",
      "selector_ui": "auto"
    }
  }
}
```

TTY controls: `Space` chọn/bỏ, mũi tên di chuyển, `a` chọn tất cả, `n` bỏ tất cả, `Enter` xác nhận, `q/Esc` hủy. Fallback dòng nhận `1`, `1,3`, `2-5`, `1,3-5`, `a`, `n`, `q`. `--patch` có thể lặp để chọn nhiều package không tương tác.

Config `selection=all/first/newest` phải kèm `non_interactive_confirmed=true`; nếu thiếu, runner chuyển về prompt và cảnh báo để cấu hình tự sinh từ phiên bản cũ không âm thầm chạy toàn bộ queue.

Patch không được chọn không bị di chuyển hay coi là FAIL; `last_run.json` ghi category `user_not_selected`. Xem `tools/_patch_lib/docs/PATCH_SELECTION_GUIDE.md`.

### Đường dẫn tương đối

Mọi đường dẫn do AI ghi trong manifest, operation, validation mapping và tài liệu phải tương đối với project root. Không ghi `/home/user/...`, ký tự ổ đĩa Windows hoặc đường dẫn chứa `..`. Report/handoff phải ưu tiên `src/file.c`, `patchs/reports/...` và `tools/...`; absolute path chỉ được dùng nội bộ khi hệ điều hành bắt buộc và không được coi là dữ liệu portable.

## 8. Transaction sandbox và idempotency

Project config tin cậy nên bật:

```json
{
  "transaction": {
    "mode": "auto",
    "keep_failed_sandbox": false,
    "overlay_paths": [],
    "exclude_paths": ["patchs/**", ".git/**"],
    "max_apply_paths": 4000,
    "idempotency": "data_only"
  }
}
```

`auto` tạo detached Git worktree từ `HEAD`, overlay dirty tracked files, non-ignored untracked files, config active và các `overlay_paths`. Patch và validation chạy trong sandbox với Git index riêng. Project thật chỉ nhận delta sau khi:

1. patch payload PASS;
2. validation PASS;
3. idempotency theo policy PASS;
4. các path thật không bị người dùng/process khác thay đổi trong lúc sandbox chạy.

Nếu patch/validation/idempotency FAIL, sandbox delta bị bỏ; source thật và staged index ban đầu không bị patch chạm vào. Khi apply delta lỗi giữa chừng, rollback journal khôi phục các path đã chép trước đó theo thứ tự ngược. Không được thay cơ chế này bằng `git reset --hard`, `git clean` hoặc stash tự động.

Mode:

```text
off       chạy in-place tương thích v5.3
auto      ưu tiên sandbox; fallback có cảnh báo nếu project không phải Git worktree
required  không tạo được sandbox thì FAIL trước mutation
```

Idempotency:

```text
off        không chạy lần hai
data_only  chạy lại PATCH_TOOL_OPS.json; mặc định
all        chạy lại cả Python patch
```

Lần hai chỉ chạy patch payload, không lặp validation, commit hoặc push. Kết quả phải exit 0 và không tạo thêm thay đổi. Nếu không, `PTV-IDEMPOTENCY-001` và delta không được áp dụng.

CLI:

```bash
./tools/run_python_patches.sh patch.zip --transaction required
./tools/run_python_patches.sh patch.zip --idempotency all
./tools/run_python_patches.sh patch.zip --keep-failed-sandbox
```

Ignored local dependencies cần cho build nhưng không có trong detached worktree phải được khai báo trong `transaction.overlay_paths`. Không dùng absolute path trong patch để ghi ra ngoài project/sandbox.

## 9. Validation profile

Project định nghĩa command trong `.python_patch_tool.json`, ví dụ:

```json
{
  "validation": {
    "fail_on_error": true,
    "profiles": {
      "firmware_debug": [
        {
          "name": "Build ESP-IDF debug firmware",
          "command": ["idf.py", "build"],
          "cwd": "main-esp32c3",
          "timeout_seconds": 1800
        }
      ],
      "docker_image": [
        {
          "name": "Build service image",
          "command": ["docker", "build", "-t", "service:test", "."],
          "cwd": ".",
          "timeout_seconds": 1800
        }
      ]
    }
  }
}
```

Command bắt buộc là argv list; không dùng shell string. Validation chạy sau patch và trước Git. Validation FAIL:

- package FAIL theo mặc định;
- không git add;
- không commit;
- không push;
- vẫn tạo `AI_HANDOFF.zip` cùng các bundle AI SUMMARY, CODE CONTEXT và DETAIL tương thích.

Ngay cả `validation.fail_on_error=false` cũng không cho phép Git action khi validation chưa PASS.

### Chọn validation theo file thực sự thay đổi

Rule nằm trong `.python_patch_tool.json`, không nằm trong manifest của patch:

```json
{
  "validation": {
    "selection": {
      "mode": "append",
      "fallback_profiles": [],
      "rules": [
        {
          "name": "ESP-IDF source",
          "include": ["main-esp32c3/*.c", "main-esp32c3/**/*.c", "main-esp32c3/**/*.h"],
          "exclude": ["main-esp32c3/build/**"],
          "profiles": ["firmware_debug"]
        }
      ]
    }
  }
}
```

`append` giữ profile do manifest/default chọn rồi bổ sung profile phù hợp. `replace` chỉ dùng profile tự chọn. `off` tắt tính năng. Runner tính rule trên delta sau patch trong sandbox, không tin danh sách file do AI tự khai báo. `--no-validation` tắt cả profile thủ công và auto-selection.

Report tạo `validation_selection.md/json`, ghi path đã xét, rule khớp, profile yêu cầu, profile tự thêm và profile cuối cùng. Preflight không có delta sau patch nên chỉ báo selection `DEFERRED_UNTIL_PATCH_DELTA`.

### Diagnostic rerun an toàn

Mỗi validation command có thể khai báo một rerun trong config tin cậy:

```json
{
  "name": "Build Gradle",
  "command": ["./gradlew", "assembleDebug"],
  "cwd": "android",
  "timeout_seconds": 1800,
  "diagnostic_rerun": {
    "enabled": true,
    "safe": true,
    "name": "Gradle stacktrace",
    "append_args": ["--stacktrace"],
    "timeout_seconds": 600
  }
}
```

Rerun chỉ chạy sau primary FAIL, tối đa `validation.diagnostic_rerun.max_commands`, không chạy lại khi timeout trừ khi `on_timeout=true`, và không làm primary FAIL trở thành PASS. Command chứa dấu hiệu flash, OTA, deploy, push, publish, release, provisioning hoặc erase bị từ chối kể cả khi cấu hình nhầm là safe. Raw/important log của rerun được giữ trong DETAIL và AI handoff.

## 10. Git policy chuẩn

### Git add — gần như luôn luôn

Dùng:

```json
"add": "changed"
```

Runner chỉ stage những path thực sự thay đổi bởi package, loại backup, report, cache và chính file patch. Không dùng `all` theo thói quen vì có thể cuốn thay đổi không liên quan.

Không stage khi patch hoặc validation FAIL, khi chỉ điều tra, hoặc khi thay đổi chỉ là log/artifact tạm.

### Git commit — tại checkpoint có ý nghĩa

Commit khi:

- hoàn tất một tính năng độc lập;
- hoàn tất phase/phase con quan trọng;
- sửa xong lỗi và regression liên quan đã PASS;
- đạt checkpoint ổn định trước thay đổi lớn tiếp theo;
- hoàn tất tài liệu có thể review độc lập.

Không commit sau từng chỉnh sửa nhỏ. Không dùng message chung như `update`, `fix`, `new code`.

### Git push — khi task lớn hoàn tất

Push khi task/tính năng lớn đã hoàn thiện, validation bắt buộc PASS, branch/upstream đúng và staged content không chứa secret/log/binary tạm.

Runner không force push, không tự giải quyết conflict và không tự tạo upstream.

## 11. Smart console và log đầy đủ

Mặc định:

```json
"console_mode": "smart"
```

Ba chế độ CLI/config:

```text
smart  chỉ in error, warning, milestone và vùng context cần thiết
full   in toàn bộ console như tool cũ
quiet  chỉ in trạng thái runner; log command vẫn được lưu
```

CLI:

```bash
./tools/run_python_patches.sh patch.zip --console-mode smart
./tools/run_python_patches.sh patch.zip --console-mode full
```

Smart filter tự nhận dạng command:

- C/C++: CMake, Ninja, Make, Meson;
- ESP-IDF: `idf.py`, Ninja và compiler output;
- Docker/Podman build;
- Gradle/Android;
- Node/npm/yarn/pnpm/TypeScript;
- Rust/Cargo;
- Python/pytest/compileall;
- generic command.

Runner lọc progress lặp lại, download/cache/build line không có giá trị, nhưng luôn giữ:

- first/primary error;
- warning có vị trí;
- file:line:column;
- traceback;
- linker errors;
- Docker `failed to solve` và Dockerfile location;
- CMake/Ninja/ESP-IDF failure;
- timeout, signal, OOM, permission, disk-full;
- một ít context trước/sau và tail đã lọc khi command FAIL.

Raw output không bị mất: nằm trong DETAIL ZIP dưới `logs/*.raw.log`. File `logs/*.important.log` chứa bản rút gọn có line number.


Mỗi command chạy trong process session riêng. Khi timeout hoặc process cha thoát nhưng process con còn giữ pipe, runner gửi `SIGTERM` cho toàn process group, chờ grace period rồi `SIGKILL` nếu cần. Summary command lưu duration, process group, signal events và survivor status. Zombie đã kết thúc không được tính là process sống còn sót.

## 12. Chẩn đoán lỗi và code context

Runner cố trích diagnostic có cấu trúc:

```text
severity
kind
message
file
line
column
source command
suggested next check
evidence
```

### Lỗi cú pháp Python

Runner compile trước khi chạy và in:

- file, line, column;
- dòng lỗi và dấu `^`;
- 5 dòng trước/sau;
- gợi ý theo loại lỗi: thiếu `:`, quote chưa đóng, bracket chưa đóng, indentation, f-string.

### Lỗi build/test

Runner nhận dạng location từ GCC/Clang, MSVC, CMake, Rust, Java/Kotlin/TypeScript, Python traceback và Dockerfile. Final wrapper error như `ninja: build stopped` được đánh dấu là lỗi phụ; AI phải đọc primary error trước đó.

### Root-cause clustering

Runner gom lỗi trùng và lỗi wrapper/dây chuyền thành `root_causes.md/json`. AI phải ưu tiên `ROOT-01` và mã lỗi như `PTV-SOURCE-DRIFT-001`, `PTV-ANCHOR-001`, `PTV-SYNTAX-001`, `PTV-BUILD-C-001`; các dòng như `ninja: build stopped` thường chỉ là hậu quả.

### Symbol-aware code context

Khi diagnostic có file/dòng hoặc baseline có tên symbol, runner cố trích toàn bộ function/class chứa lỗi, ghi dưới `code_context/symbols/`. Nếu không tìm được symbol, runner bắt buộc tạo compact snippet có line number; không được bỏ mất code chỉ vì parser heuristic thất bại.

### Patch anchor/code shape đã thay đổi

Khi helper báo `expected block not found`, `anchor not found`, `found 0` hoặc lỗi tương tự, CODE CONTEXT ZIP cố chứa:

- file hiện tại;
- expected/anchor/context từ helper;
- số lần anchor/expected xuất hiện;
- whitespace-normalized match;
- tối đa ba block hiện tại gần giống nhất với phần trăm similarity;
- Git diff liên quan;
- patch source hoặc `PATCH_TOOL_OPS.json` gốc.

AI phải cập nhật `old`/`anchor` theo code hiện tại. Không sửa bằng cách bỏ kiểm tra hoặc chọn một match mơ hồ.

## 13. Một AI handoff chính và ba bundle tương thích

Cuối mỗi package, runner in:

```text
SEND TO AI FIRST: PTV_<time>_<id>_<STATUS>_HANDOFF.zip
SUMMARY ZIP: PTV_<time>_<id>_<STATUS>_SUMMARY.zip
CODE ZIP: PTV_<time>_<id>_<STATUS>_CODE.zip
DETAIL ZIP: PTV_<time>_<id>_<STATUS>_DETAIL.zip
SEND ORDER: AI_HANDOFF only -> DETAIL only if the AI requests raw evidence
```

### AI HANDOFF ZIP — mặc định gửi duy nhất file này

Chứa `START_HERE.md`, `NEXT_AI_ACTION.md`, failure delta, validation selection, root causes, source drift, transaction/idempotency status, important log, symbol/snippet liên quan và patch payload. Không chứa raw log lớn. Đây là lựa chọn mặc định cho hầu hết lỗi.

### AI SUMMARY/CODE CONTEXT ZIP

Giữ để tương thích với workflow v5.2 hoặc khi cần tách metadata và source. CODE CONTEXT đầy đủ có thể chứa file nhỏ, diff, stale-anchor analysis và symbol/snippet.

### DETAIL ZIP

Chỉ gửi khi AI yêu cầu raw evidence. Chứa raw logs, runner logs, machine result, Git evidence và metadata đầy đủ. Không paste toàn bộ console vào chat.

## 14. Giới hạn source context và bảo mật

Project config kiểm soát:

```json
{
  "reports": {
    "ai_handoff": {
      "enabled": true,
      "max_code_files": 24,
      "max_code_total_bytes": 4194304,
      "full_file_max_bytes": 262144,
      "context_lines": 20,
      "max_diff_bytes": 1048576,
      "include_touched_files": true,
      "max_root_causes": 8,
      "max_symbols": 12,
      "max_symbol_lines": 800,
      "max_symbol_bytes": 524288
    }
  },
  "source_drift": {
    "enabled": true,
    "fail_on_drift": true,
    "allow_file_hash_drift_when_symbol_matches": true,
    "max_file_bytes": 67108864
  },
  "transaction": {
    "mode": "auto",
    "keep_failed_sandbox": false,
    "overlay_paths": [],
    "exclude_paths": ["patchs/**", ".git/**"],
    "max_apply_paths": 4000,
    "idempotency": "data_only"
  }
}
```

Runner bỏ qua common secret files như `.env`, SSH key, credential path và binary. Đây là lớp giảm rủi ro, không thay thế review của người dùng. Luôn xem inventory trước khi gửi source code nhạy cảm ra ngoài.

Không đưa token, password, private key, signing key, endpoint bí mật hoặc dữ liệu cá nhân vào manifest, commit message, patch log hay test fixture.

## 15. Preflight-only

```bash
./tools/run_python_patches.sh patch_feature.zip \
  --preflight-only \
  --require-zip \
  --require-manifest \
  --require-standard-metadata
```

Preflight kiểm tra archive, traversal/symlink/size, manifest, validation profile reference, Python syntax hoặc ops schema. Nó không chạy patch, validation command, Git hay move input. Preflight vẫn tạo `AI_HANDOFF.zip` và các bundle tương thích để gửi lỗi syntax/schema cho AI.

## 16. CLI thường dùng

```bash
# Apply package, smart console, giữ patch tại chỗ
./tools/run_python_patches.sh patch_feature.zip --keep

# Chạy toàn bộ và move package PASS
./tools/run_python_patches.sh --all --move --require-zip --require-manifest --require-standard-metadata

# Override validation profile
./tools/run_python_patches.sh patch_feature.zip --validation-profile quick

# Chẩn đoán với full console nhưng vẫn tạo bundle
./tools/run_python_patches.sh patch_feature.zip --console-mode full

# Tắt bundle AI và chỉ tạo report legacy khi cần tương thích
./tools/run_python_patches.sh patch_feature.zip --no-ai-handoff


# Bắt buộc transaction sandbox và kiểm tra idempotency cả Python patch
./tools/run_python_patches.sh patch_feature.zip --transaction required --idempotency all
```

## 17. Quy tắc AI khi nhận handoff lỗi

1. Đọc `START_HERE.md` trước.
2. Đọc `failure_delta.md`: nếu `SAME_FAILURE`, không yêu cầu gửi lại raw log cũ; nếu `FAILURE_CHANGED`, ưu tiên nguyên nhân mới.
3. Đọc `root_causes.md`; ưu tiên `ROOT-01` và mã lỗi chính.
4. Đọc `validation_selection.md` để biết vì sao build/test nào đã chạy.
5. Đọc `important_log.txt`; không suy luận từ final wrapper error nếu còn primary error phía trước.
6. Khi là stale anchor, mở `STALE_ANCHOR_ANALYSIS.md` và file hiện tại trong CODE CONTEXT.
7. Chỉ yêu cầu DETAIL ZIP nếu cần raw output chưa có trong bản compact.
8. Trả về đúng một ZIP patch mới theo chuẩn; không yêu cầu người dùng paste lại log đã có trong bundle.
9. Không lặp lại toàn bộ source/log trong câu trả lời; chỉ tóm tắt nguyên nhân và cung cấp file ZIP.

## 18. Prompt chuẩn gửi AI

```text
Hãy trả về đúng một file ZIP patch theo Python Patch Tool v5.16, không trả riêng file code.
Ưu tiên PATCH_TOOL_OPS.json data-only để giảm token và lỗi cú pháp; chỉ dùng patch_*.py khi operation DSL không đủ.
ZIP phải có PATCH_TOOL_MANIFEST.json ở root và chỉ một loại entrypoint: PATCH_TOOL_OPS.json hoặc patch_*.py.
Patch phải idempotent, đường dẫn tương đối, không nhúng runner/helper/diagnostics, không build/flash/monitor trong patch.
Manifest phải có project.key ổn định, patch id, version, phase, PHASE UNDER TEST, summary, regression scope, validation profile và Git policy.
Không kiểm tra hoặc áp đặt chuỗi patch history giữa các máy; history cục bộ chỉ dùng bỏ qua duplicate đã PASS trên chính máy đó. Git/source hiện tại là nguồn sự thật.
Manifest chỉ được chọn validation profile đã cấu hình; không nhúng command hoặc tùy biến report/log filter.
Mặc định git.add="changed". Chỉ commit tại checkpoint có ý nghĩa; chỉ push khi task lớn hoàn tất 100%.
Không force push, không commit rỗng, không thay format PATCH TOOL V5 SUMMARY.
Khi sửa từ handoff, đọc failure_delta.md, root_causes.md, validation_selection.md và important_log.txt trước; dùng symbol/snippet trong CODE_CONTEXT cho đúng file liên quan và không yêu cầu paste full console nếu DETAIL ZIP đã giữ raw log.
```

## 19. Self-test

```bash
python3 self_test_python_patch_tool_v5.py
```

Self-test phải kiểm tra ít nhất:

- fresh install, upgrade và installer idempotency;
- Python patch PASS;
- data-only patch PASS;
- syntax diagnostic có line/caret/suggestion;
- stale anchor có current file và nearest block;
- noisy C build được giảm mạnh nhưng raw log vẫn đủ;
- validation failure chặn Git;
- hard exit/timeout vẫn tạo AI_HANDOFF và các ZIP tương thích;
- source drift, symbol context, root-cause clustering, report ZIP integrity và secret-file exclusion;
- patch ghi dở rồi crash không thay đổi worktree thật;
- validation/idempotency FAIL làm sandbox bị discard;
- apply journal rollback path đã chép trước khi path sau lỗi;
- child process/orphan được dọn theo process group;
- auto validation selection dựa trên delta thật, không dựa trên manifest;
- diagnostic rerun an toàn có log riêng và primary FAIL vẫn giữ nguyên;
- failure history phân biệt FIRST/SAME/CHANGED/RESOLVED;
- PASS retention không xóa FAIL bundle;
- máy mới nhận project key từ patch hợp lệ đầu tiên;
- duplicate canonical payload bị bỏ qua cục bộ nhưng không tạo dependency lịch sử;
- handoff ZIP tải nhầm và patch sai project được đưa ra khỏi queue chỉ với cảnh báo;
- `last_run.json` không chứa project-root absolute path trong metadata portable.

## Quy tắc bắt buộc khi AI phân tích handoff nhiều máy

AI phải coi các trường `history_scope: LOCAL_MACHINE_ONLY` và `history_is_not_sequence_constraint: true` là chỉ dẫn bắt buộc. Không yêu cầu người dùng tìm patch history từ máy khác, không bắt chạy lại patch bị “thiếu” chỉ vì số phase không liên tục, và không sửa source dựa trên giả định rằng package trước chưa chạy. Hãy đọc source/Git hiện tại và bằng chứng trong `AI_HANDOFF.zip`, rồi tạo một ZIP patch mới có cùng `project.key` và đường dẫn tương đối.


## v5.16 mandatory feature-status, layout and code-collection rules

Every release ZIP must also be directly extractable at a project root. Its root must contain `tools/`; `tools/` must contain exactly the public `run_python_patches.sh` plus `_patch_lib/` for Patch Tool-managed files. Do not package the public runner inside `_patch_lib/`, and do not require an installer before the zero-argument command works.

Every released Patch Tool package must include an up-to-date standalone file named `PYTHON_PATCH_TOOL_FEATURE_STATUS.md`. It must list feature name, short description, completion state/percentage and priority. The fixed development order is:

1. Diagnostics and AI log collection;
2. Code search and collection tool;
3. Token reduction and AI handoff;
4. Multi-machine/project support;
5. Intelligent validation;
6. Other work.

Do not make a lower group the main target until the preceding group is 100%, except for genuinely shared implementation. Never report an incomplete item as complete.

For requests that need source evidence instead of a code-changing patch, use the single installed entry point rather than asking the user to paste source:

```bash
./tools/run_python_patches.sh collect overview
./tools/run_python_patches.sh collect research <query> --path <relative-path>
```

The AI may provide one `CODE_COLLECTION_REQUEST.json` containing any normal research action: `overview`, `research`, `ls`, `tree`, `find`, `file`, `range`, `head`, `tail`, `symbol`, `search`, `references`, `callgraph`, `dependencies`, `directory`, `pack`, `git`, or large-file `decompile`. All paths must be project-relative. The collector must produce one bounded, redacted ZIP under `artifacts/patch_tool_code_collections/`. It must not accept arbitrary shell commands from a request. For large IDA/Ghidra/GM52-style dumps, use `decompile` by address/name/regex with optional neighbors and references.

Patch packages must never embed absolute paths from the AI's machine. Logs and code collection outputs must redact credential-like values before they are placed in AI bundles.


## v5.16 safe post-patch command rules

Patch có thể khai báo `post_patch.commands` trong manifest. Đây là argv data, không phải shell string.

Mặc định:

- Payload tạo thay đổi/file mới: command được chạy.
- Payload không tạo delta: command bị bỏ qua.
- Package không có payload nhưng có command: được chấp nhận như command-only package.
- `run_when_no_changes=true` chỉ là ngoại lệ hạn chế; phải có `no_change_reason` 20-500 ký tự và mặc định tối đa một command.

Command chỉ được là:

1. `ls`, `tree`, `pwd`, `find` ở chế độ đọc; hoặc
2. script tương đối nằm trong project, chạy trực tiếp hoặc qua interpreter allowlist.

Cấm shell string, `git`, build/deploy binary trực tiếp, `find -exec/-delete`, `tree -o`, absolute path, `..`, `python -c/-m`, `bash -c`, `node -e`, PowerShell encoded command và command argument chứa credential. Build/test thông thường phải ở validation profile tin cậy.

Ví dụ:

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

Command chạy trong transaction sandbox, có timeout, process-tree cleanup, smart log filtering, redaction và diagnostic ZIP. Payload idempotency được kiểm tra trước command; command không bị tự replay lần hai. Command tạo file mới sẽ được tính vào delta, validation và Git policy.

## v5.16 output-file display rules

At the end of a run, the tool must classify files by purpose rather than printing unexplained paths:

- `[PRIMARY - UPLOAD] AI_HANDOFF.zip`: the normal and usually only file sent to AI.
- `[OPTIONAL] AI_SUMMARY.zip`: text-only compatibility bundle.
- `[OPTIONAL] CODE_CONTEXT.zip`: separate code evidence only when requested.
- `[DEBUG ONLY] DETAIL.zip`: full redacted raw evidence only when requested.
- `[ALIAS] REPORT ZIP`: normally the same physical file as DETAIL, not an extra ZIP.
- `[LOCAL INFO] LAST_RUN.md`: local status, not uploaded by default.

The console must print the absolute project root and absolute paths for these critical local files. Portable JSON/manifest fields remain project-relative. ANSI color is additive only; textual labels are mandatory so output remains understandable in captured logs and terminals without color.


## v5.16 queue/output rules

- Final console states must be visually distinct: PASS green, FAIL red, SKIPPED yellow, CANCELLED cyan and IDLE blue, with textual labels when ANSI color is unavailable.
- Final summary must list the exact filename of every patch actually executed.
- AI report ZIP names are intentionally short and must not repeat the full patch input filename. Mapping to the original input remains in summary/LAST_RUN metadata.
- Interactive selector may delete a queued patch only after explicit confirmation. TTY uses `d` then `y`; line fallback uses `d <number/range>` then `y`. Deleted inputs are recorded as `user_deleted`.


## v5.16 token-bounded handoff, visible skip and live-status rules

- Default AI artifacts are only `HANDOFF.zip` and `DETAIL.zip`. Separate `SUMMARY.zip` / `CODE.zip` are compatibility-only and must not be generated unless `reports.ai_handoff.split_compatibility_bundles=true`.
- HANDOFF has a hard token budget and deterministic evidence priority. Source/patch payload and machine-readable JSON are whole-or-omit; JSON must never be truncated into invalid syntax.
- `ai_handoff_budget.md/json` must record included, compacted, omitted and deduplicated evidence. DETAIL remains complete redacted fallback evidence.
- A patch automatically skipped by local duplicate detection must remain visible in the selector under `TỰ ĐỘNG BỎ QUA TRƯỚC KHI CHỌN`, including `[SKIPPED:DUPLICATE - ALREADY PASS]`, reason and quarantine destination. Local duplicate history remains machine-local only.
- Long-running work must expose a TTY-only single-line live status, rewritten in place rather than appended. It should cover sandbox creation/overlay, patch payload, idempotency, post-patch command, validation, verified-delta apply, Git and report creation. The ephemeral line is UI state only and must not be persisted into runner/HANDOFF/DETAIL logs.
