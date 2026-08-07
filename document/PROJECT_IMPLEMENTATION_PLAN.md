# FirefoxChatImprover — Kế hoạch triển khai

> **Current implementation baseline:** Phase 46 v0.39.7.


## 1. Mục tiêu dự án

FirefoxChatImprover là add-on Firefox dùng riêng để hỗ trợ thao tác trên một trang chat AI nội bộ và thực thi công cụ local theo yêu cầu của người dùng.

Mục tiêu chính:

1. Chỉ hoạt động trên tab được người dùng kích hoạt thủ công hoặc URL nằm trong danh sách cho phép.
2. Hiển thị sidebar để cấu hình, theo dõi trạng thái và thao tác.
3. Theo dõi một element điều khiển bằng selector và các điều kiện thuộc tính.
4. Chỉ nhận diện/click các target element mới xuất hiện trong chu kỳ theo dõi hiện tại.
5. Cảnh báo khi điều kiện đạt bằng title, badge và trạng thái sidebar.
6. Chạy lệnh shell tại thư mục được chỉ định thông qua Native Messaging Host cục bộ.
7. Không public bắt buộc; ưu tiên workflow phát triển và sử dụng riêng ổn định.

## 2. Nguyên tắc kiến trúc

- Add-on không inject content script vào mọi trang theo mặc định.
- Chế độ mặc định là kích hoạt thủ công bằng biểu tượng toolbar trên tab hiện tại.
- URL allowlist là lớp bảo vệ bổ sung, không phải cơ chế kích hoạt duy nhất.
- Content script chỉ đọc/sửa DOM của tab đã kích hoạt.
- Sidebar không được truyền trực tiếp lệnh từ nội dung trang sang shell.
- Background script là trung gian giữa sidebar, content script và Native Messaging Host.
- Native host chỉ chạy dưới quyền người dùng hiện tại, không dùng `sudo` hoặc quyền root.
- Mọi thay đổi được phát hành dưới dạng gói Patch Tool v3 duy nhất.

### Yêu cầu xuyên suốt — nhiều tab độc lập

- Add-on phải theo dõi đồng thời nhiều tab đã được người dùng kích hoạt.
- Mỗi tab có session riêng nhận diện bằng `tabId`; không dùng một biến trạng thái toàn cục đại diện cho mọi tab.
- Mỗi session giữ profile, cấu hình riêng tùy chọn, monitor state, cycle, baseline, candidate, badge/cảnh báo và log riêng.
- Sidebar phải cho phép chọn session để pause/resume/stop hoặc chỉnh cấu hình mà không làm thay đổi session khác.
- Profile là template dùng chung; “tab config” là snapshot riêng và không bị profile update ghi đè.
- Các event DOM ở phase sau luôn phải mang `tabId` và chỉ cập nhật session tương ứng.
## 3. Cấu trúc thư mục dự kiến

```text
FirefoxChatImprover/
├── extension/
│   ├── manifest.json
│   ├── background/
│   │   └── background.js
│   ├── content/
│   │   ├── monitor.js
│   │   ├── selector.js
│   │   └── alert.js
│   ├── sidebar/
│   │   ├── sidebar.html
│   │   ├── sidebar.css
│   │   └── sidebar.js
│   ├── options/
│   │   ├── options.html
│   │   ├── options.css
│   │   └── options.js
│   ├── shared/
│   │   ├── messages.js
│   │   ├── settings.js
│   │   └── validation.js
│   └── icons/
├── native-host/
│   ├── native_host.py
│   ├── install_native_host.sh
│   ├── uninstall_native_host.sh
│   └── manifest-template.json
├── document/
├── tests/
├── tools/
├── patchs/
├── dist/
├── LICENSE
└── README.md
```

Tên file có thể được tinh chỉnh trong từng phase, nhưng ranh giới trách nhiệm phải giữ nguyên.

## 4. Các giai đoạn triển khai

### Phase 00 — Kế hoạch, tài liệu và workflow phát triển

**Mục tiêu:** Chuẩn hóa kế hoạch, cách cài thử và cách tự reload add-on trước khi viết mã chức năng.

Công việc:

- Tạo tài liệu kế hoạch toàn dự án.
- Tạo hướng dẫn cài add-on tạm thời bằng `about:debugging`.
- Tạo hướng dẫn sử dụng `web-ext run` để tự reload add-on khi source thay đổi.
- Tạo script cài `web-ext` cục bộ trong project.
- Tạo script chạy Firefox development session.
- Tạo script lint và build add-on.
- Cập nhật README để liên kết các tài liệu và công cụ mới.

Tiêu chí hoàn tất:

- Các tài liệu tồn tại và không phụ thuộc vào source add-on chưa được tạo.
- Script báo lỗi rõ ràng nếu `extension/manifest.json` chưa có.
- Script không cài package toàn hệ thống và không dùng `sudo`.

### Phase 01 — Khung WebExtension tối thiểu và kích hoạt thủ công

**Mục tiêu:** Có add-on tải được trong Firefox và chỉ kích hoạt trên tab hiện tại khi người dùng bấm toolbar.

Công việc:

- Tạo `extension/manifest.json` với ID Firefox cố định.
- Khai báo quyền tối thiểu: `activeTab`, `storage`, `scripting`, `nativeMessaging` chỉ khi thực sự cần.
- Tạo background script quản lý tab đã kích hoạt.
- Khi bấm toolbar:
  - lấy tab hiện tại;
  - kiểm tra URL và scheme hợp lệ;
  - inject content script vào tab;
  - mở sidebar;
  - ghi trạng thái tab đang được theo dõi.
- Hỗ trợ nút `Kích hoạt`, `Tạm dừng`, `Dừng`.
- Không tự inject khi Firefox khởi động.
- Xử lý reload/navigation: trạng thái tab cũ phải được dọn hoặc tái kích hoạt có kiểm soát.

Tiêu chí hoàn tất:

- Add-on không chạy trên tab khác.
- Bấm toolbar lần hai không tạo nhiều observer trùng nhau.
- Sidebar hiển thị đúng tab/URL đang được điều khiển.

### Phase 02 — Mô hình cấu hình và profile

**Mục tiêu:** Người dùng cấu hình URL, selector, điều kiện và command từ sidebar/options.

Công việc:

- Xây dựng schema cấu hình có version.
- Hỗ trợ nhiều profile theo từng website hoặc mục đích.
- Cấu hình activation:
  - thủ công;
  - allowlist URL;
  - tùy chọn tự kích hoạt trong tương lai, mặc định tắt.
- Cấu hình monitor selector:
  - tag/type;
  - ID;
  - class;
  - CSS selector;
  - attribute selector.
- Cấu hình điều kiện thuộc tính:
  - tồn tại/không tồn tại;
  - bằng/khác;
  - chứa/không chứa;
  - regex có kiểm tra lỗi;
  - AND/OR nhiều điều kiện.
- Cấu hình target selector và chiến lược click.
- Cấu hình shell: working directory, command, chế độ chạy nền/mở terminal.
- Import/export profile JSON.
- Migration cấu hình khi schema thay đổi.

Tiêu chí hoàn tất:

- Setting được lưu bằng `browser.storage.local`.
- Selector và regex sai không làm crash add-on.
- Không mất cấu hình khi reload add-on trong cùng dev profile.

### Phase 03 — Engine theo dõi trạng thái element

**Mục tiêu:** Theo dõi chính xác điều kiện của element điều khiển mà không polling nặng.

Công việc:

- Tạo selector resolver dùng chung cho CSS, ID, class và attribute.
- Hỗ trợ điều kiện visibility: any/visible/hidden; hidden gồm display none, visibility hidden/collapse, hidden, visible=false, aria-hidden=true hoặc không có rendered box.
- Có nút test selector, đếm kết quả và highlight trực tiếp trên active tab.
- Tìm lại element khi SPA/React thay node cũ bằng node mới.
- Dùng `MutationObserver` cho:
  - attribute thay đổi trên element;
  - child list khi element bị thay thế;
  - vùng DOM cần thiết thay vì quét vô hạn nếu có thể.
- Debounce các đợt mutation dày.
- Xây dựng state machine tối thiểu:
  - `INACTIVE`;
  - `WAITING`;
  - `MATCHED`;
  - `PAUSED`;
  - `ERROR`.
- Chỉ phát event khi có cạnh chuyển trạng thái, không phát lặp khi điều kiện vẫn giữ nguyên.
- Log thời điểm và lý do chuyển trạng thái.

Tiêu chí hoàn tất:

- Không dùng vòng `setInterval` quét toàn trang liên tục.
- Một lần chuyển `WAITING -> MATCHED` chỉ tạo một event.
- Element bị thay thế vẫn được theo dõi lại.

### Phase 04 — Nhận diện target mới và tự click theo chu kỳ

**Mục tiêu:** Chỉ click target element mới xuất hiện kể từ baseline của chu kỳ gần nhất.

Công việc:

- Khi kích hoạt: quét target hiện có và tạo baseline, không click target cũ.
- Khi monitor rời trạng thái `MATCHED`: tái tạo baseline.
- Khi monitor chuyển sang `MATCHED`:
  - quét target hiện tại;
  - so sánh với baseline;
  - lấy target mới;
  - lọc node đã mất khỏi DOM;
  - lọc target đã click;
  - click theo chiến lược cấu hình.
- Hỗ trợ chiến lược:
  - mới đầu tiên;
  - mới cuối cùng;
  - tất cả target mới;
  - chỉ target đang visible/enabled.
- Kết hợp Node identity và fingerprint logic.
- Ưu tiên các thuộc tính ổn định như `data-message-id`, `data-testid`, `id`, `href`.
- Có dry-run để chỉ highlight mà chưa click.
- Có giới hạn số click trên mỗi chu kỳ.

Tiêu chí hoàn tất:

- Target tồn tại trước khi kích hoạt không bị click.
- Target của chu kỳ cũ không bị click lại ở chu kỳ mới.
- React re-render không gây click lặp vô hạn.

### Phase 05 — Sidebar, cảnh báo và quan sát hoạt động

**Mục tiêu:** Người dùng nhìn thấy rõ trạng thái và có thể kiểm soát mọi automation.

Công việc:

- Hoàn thiện sidebar UI.
- Hiển thị trạng thái observer, monitor element, điều kiện và target count.
- Hoàn thiện trải nghiệm selector test/highlight đã có từ Phase 03, gồm log và cleanup thống nhất.
- Nút dry-run/click thử có xác nhận.
- Cảnh báo:
  - title nhấp nháy;
  - badge trên toolbar;
  - màu/trạng thái trong sidebar;
  - notification tùy chọn.
- Khôi phục title gốc khi dừng hoặc khi điều kiện hết đúng.
- Log vòng đời có timestamp, giới hạn số dòng và nút copy/clear.
- Tách log người dùng với log debug.

Tiêu chí hoàn tất:

- Dừng add-on phải khôi phục title và xóa highlight.
- Cảnh báo không tiếp tục chạy sau khi tab đóng.
- UI không khóa khi trang phát sinh nhiều mutation.

### Phase 06 — Native Messaging Host và chạy shell

**Mục tiêu:** Chạy command local theo thao tác trực tiếp từ sidebar.

Công việc:

- Tạo Python Native Messaging Host dùng JSON length-prefixed qua stdin/stdout.
- Tạo native host manifest có `allowed_extensions` đúng ID add-on.
- Tạo script install/uninstall manifest cho Linux.
- Background quản lý kết nối native host.
- Hỗ trợ hai chế độ:
  - chạy nền và stream stdout/stderr;
  - mở terminal tương tác.
- Hỗ trợ stop process bằng SIGTERM và escalation có kiểm soát nếu cần.
- Kiểm tra working directory:
  - là đường dẫn tuyệt đối;
  - tồn tại;
  - là directory;
  - không tự tạo directory ngoài ý muốn.
- Command chỉ được gửi từ sidebar extension, không lấy trực tiếp từ content trang.
- Hiển thị chính xác cwd và command trước khi chạy.
- Có tùy chọn confirm cho command nguy hiểm hoặc mọi command.
- Không chạy bằng root và không chèn `sudo` tự động.

Tiêu chí hoàn tất:

- Content script không gọi native host trực tiếp.
- Log stdout/stderr được stream mà không làm treo sidebar.
- Command tương tác có thể chạy trong terminal thật.
- Stop process không giết nhầm process ngoài phiên do add-on tạo.

### Phase 07 — Kiểm thử và hardening

**Mục tiêu:** Bảo đảm engine hoạt động đúng trước các biến thể DOM và lỗi runtime.

Công việc:

- Unit test selector, condition evaluator, fingerprint và state machine.
- DOM fixture cho các trường hợp:
  - element có sẵn;
  - element mới;
  - element bị replace;
  - nhiều target giống nhau;
  - target hidden/disabled;
  - mutation liên tục;
  - selector/regex lỗi.
- Integration test message flow giữa sidebar/background/content.
- Test native host protocol và command lifecycle.
- Lint bằng `web-ext lint`.
- Kiểm tra CSP và không dùng `eval`.
- Kiểm tra permission tối thiểu.
- Kiểm tra cleanup khi disable/reload/uninstall.
- Tạo checklist test thủ công trên trang AI nội bộ.

Tiêu chí hoàn tất:

- Không còn lỗi console trong luồng chuẩn.
- Không phát sinh click lặp qua nhiều chu kỳ.
- Native host từ chối message/action không hợp lệ.

### Phase 08 — Đóng gói, cài lâu dài và cập nhật

**Mục tiêu:** Có quy trình sử dụng hàng ngày mà không cần load lại thủ công sau mỗi lần Firefox khởi động.

Công việc:

- Build artifact bằng `web-ext build`.
- Bump version có kiểm soát.
- Tạo checksum và release note.
- Chọn một trong hai hướng:
  - dùng `web-ext run` cho môi trường phát triển cá nhân;
  - ký add-on dạng self-distributed/unlisted để cài lâu dài trên Firefox thường.
- Viết hướng dẫn cài XPI đã ký từ file hoặc URL riêng.
- Nghiên cứu và chỉ triển khai auto-update XPI riêng khi:
  - gói XPI đã ký hợp lệ;
  - endpoint update metadata và XPI được kiểm soát;
  - rollback được xác định.
- Không tự động cập nhật native host âm thầm; native host dùng installer/version riêng.

Tiêu chí hoàn tất:

- Có artifact cài được và truy vết version.
- Có quy trình update/rollback rõ ràng.
- Không nhầm source ZIP chưa ký với XPI cài lâu dài.

### Phase 09 — Sidebar thu gọn và vòng đời cảnh báo liên tục

**Mục tiêu:** Giảm chiều cao sidebar và cho phép automation chạy nhiều chu kỳ mà không cần kích hoạt lại tab.

Công việc:

- Cho phép ẩn/hiện độc lập từng group sidebar và lưu trạng thái UI riêng.
- Tách cảnh báo khỏi trạng thái MATCHED tức thời bằng `alertCycle`.
- Xác nhận cảnh báo bằng thao tác trusted trong tab.
- Có timeout dự phòng khi tab visible liên tục đủ số giây cấu hình.
- Không coi click synthetic của target automation là thao tác người dùng.
- Sau khi condition rời MATCHED, target engine rebaseline và chờ cycle kế tiếp.
- Giữ session/monitor ACTIVE sau khi action và cảnh báo đã hoàn tất.

Tiêu chí hoàn tất:

- Thu gọn group không thay đổi profile hoặc tab config.
- Cảnh báo không mất chỉ vì condition vừa trở về không đạt.
- Cảnh báo đã xác nhận không bật lại trong cùng cycle.
- Condition không đạt rồi đạt lại tạo cycle mới và action/cảnh báo mới.

Các nâng cấp tùy chọn còn lại sau Phase 09:

- Profile picker theo URL.
- Element picker trực quan bằng chuột.
- Nhiều monitor rule và nhiều action.
- Chuỗi action: wait, click, delay, verify.
- Âm báo desktop.
- Lịch sử command và preset command được allowlist.
- Xuất log/support bundle.
- Hỗ trợ Chromium nếu còn cần.

## 5. Thứ tự phụ thuộc

```text
Phase 00
  └─ Phase 01
      ├─ Phase 02
      │   ├─ Phase 03
      │   │   └─ Phase 04
      │   └─ Phase 05
      └─ Phase 06
          └─ Phase 07
              └─ Phase 08
                  └─ Phase 09
```

Phase 06 có thể bắt đầu sau Phase 01 nhưng chỉ tích hợp hoàn chỉnh khi message schema của Phase 02 ổn định.

## 6. Quy tắc phát hành patch

- Mỗi lần thay đổi code/tài liệu phải phát hành một file `.zip` duy nhất theo Patch Tool v3.
- Tên file duy nhất, có phase, nội dung ngắn và timestamp.
- Gói chỉ chứa script `patch_*.py` và resource thật sự cần thiết.
- Không copy/đính kèm lại file source, test hoặc tài liệu không thay đổi vào gói patch.
- Nếu một phase cần test mới, bổ sung vào `tools/test_firefox_addon.sh`; không tạo thêm VS Code task theo phase.
- Workflow dùng thường xuyên chỉ gồm `Patchs: Run Python Patch` và `Patchs: Run Python Patch + Test`.
- Patch chạy từ project root bằng:

```bash
./tools/run_python_patches.sh
```

- Patch không tự build, không tự mở Firefox, không tự chạy command hệ thống sau khi sửa file.
- Script build/test/dev được tạo ra nhưng chỉ chạy khi người dùng chủ động gọi.
- Mỗi phase phải cập nhật tài liệu tiến độ và tiêu chí nghiệm thu.

## 7. Trạng thái hiện tại

- Phase hiện tại: **Phase 00**.
- Kết quả của patch Phase 00:
  - kế hoạch triển khai;
  - hướng dẫn cài/cập nhật;
  - công cụ setup và chạy `web-ext`;
  - công cụ lint/build;
  - cập nhật README.
- Phase tiếp theo dự kiến: **Phase 01 — Khung WebExtension và kích hoạt thủ công**.

## Trạng thái triển khai đến Phase 06

- Phase 00–04 đã hoàn tất theo các tài liệu phase tương ứng.
- Phase 05 đã triển khai cảnh báo title/badge/sidebar/notification, activity log riêng theo `tabId`, test target thủ công và cleanup highlight/title.
- Phase 06 đã hoàn tất: Native Messaging Host, shell session riêng theo tab, stream output và scoped stop.
- Phase 07 đã hoàn tất: test state machine/selector/target/sender/native protocol, security scan, observer attribute filtering, output chunking và DOM fixture nhiều tab.
- Phase 07 v0.7.1 đã chuẩn hóa workflow: task patch/test tổng hợp, bỏ task theo phase và dùng gói patch tối giản không kèm file không đổi.
- Phase 08 đã hoàn tất: controlled version bump, release build có checksum/metadata, ký unlisted, cài XPI lâu dài, optional HTTPS update manifest và rollback bằng version mới cao hơn.
- Phase baseline 00–08 đã hoàn tất.
- Phase 09 đã hoàn tất: group sidebar thu gọn độc lập, cảnh báo giữ chốt theo cycle, user-activity acknowledgement và active-tab timeout.

## Trạng thái triển khai đến Phase 10

- Phase 00–08: baseline chức năng, test/hardening và release workflow.
- Phase 09: group sidebar thu gọn và cảnh báo giữ chốt theo chu kỳ liên tục.
- Phase 10: visual element picker cho monitor/target, selector tự sinh và routing độc lập theo `tabId`.
- Phase 11: URL profile routing theo priority/specificity, preview trong sidebar và manual override cho tab chưa active.
- Nâng cấp tùy chọn tiếp theo có thể triển khai: nhiều monitor/action rule, chuỗi wait/click/delay/verify, preset command allowlist hoặc support bundle.


### Phase 11 — Profile picker theo URL

**Mục tiêu:** Tự chọn profile phù hợp nhất khi kích hoạt tab mới mà vẫn giữ activation thủ công và session multi-tab độc lập.

Công việc:

- Profile tham gia URL routing theo tùy chọn riêng.
- Xếp hạng theo priority rồi specificity của wildcard pattern.
- Preview candidate/profile thắng trong sidebar.
- Toolbar dùng URL routing; sidebar hỗ trợ auto mode và manual override.
- Không đổi profile của tab đã active.

Tiêu chí hoàn tất:

- Hai tab URL khác nhau có thể tự chọn hai profile khác nhau.
- Profile priority/specificity được chọn ổn định.
- Không có match thì fallback profile mặc định.
- Không tự inject vào tab chỉ vì URL khớp.


### Phase 12 — Target action pipeline delay/click/verify

**Mục tiêu:** Cho phép action target chạy có delay và xác minh trạng thái DOM sau click mà vẫn giữ cycle/multi-tab độc lập.

Công việc:

- Bump settings schema lên 9 và migration profile cũ với pipeline mặc định tắt.
- Thêm delay trước/sau action.
- Thêm selector verify và bốn expectation: exists/not-exists/visible/hidden.
- Poll verify có timeout và interval giới hạn.
- Hủy pipeline pending khi re-arm, pause, stop, config update hoặc runtime restart.
- Hiển thị pipeline runtime/verify result trong sidebar và activity log.
- Mở rộng Element Picker cho verify selector.
- Gom test Phase 12 vào task test chung.

Tiêu chí hoàn tất:

- Không thay đổi hành vi profile cũ nếu pipeline chưa bật.
- Không action trùng trong lúc đang delay/verify.
- Pipeline không chạy sang monitor cycle hoặc tab khác.
- Verify failure được báo rõ và cycle kế tiếp có thể re-arm bình thường.


### Phase 13 — Monitor stability windows

**Mục tiêu:** Chống trigger/re-arm giả do DOM hoặc attribute chớp nhanh.

Công việc:

- Cấu hình thời gian condition phải đạt liên tục trước MATCHED.
- Cấu hình thời gian condition phải không đạt liên tục trước WAITING/re-arm.
- Hủy pending khi condition đảo lại, pause, stop hoặc config đổi.
- Công bố pending state trong runtime/sidebar theo từng tab.
- Giữ mặc định 0 ms để tương thích profile cũ.

Tiêu chí hoàn tất:

- Flicker ngắn hơn ngưỡng không tăng cycle và không chạy action.
- Chỉ cạnh ổn định mới tạo MATCHED/re-arm.
- Timer không rò sang tab hoặc chu kỳ khác.

### Phase 14 — Restart-safe session recovery

Đã hoàn tất khôi phục session theo `tabId`, re-inject content runtime sau reload/navigation, lập baseline mới và giữ trạng thái cần cấp quyền thay vì xóa session.

### Phase 15 — Nhiều monitor/action rule

**Mục tiêu:** Một tab có thể theo dõi nhiều luồng DOM độc lập trong cùng profile hoặc tab config.

Công việc:

- Nâng schema và migration cấu hình một rule cũ sang `rules[]`.
- Rule editor trong sidebar: chọn, tạo, nhân bản, bật/tắt và xóa.
- Monitor/target engine instance riêng cho từng rule.
- Runtime tổng hợp theo tab và runtime chi tiết theo `ruleId`.
- Cycle cảnh báo tổng hợp tăng khi bất kỳ rule nào có cạnh mới sang `MATCHED`.
- Giữ pause/resume/stop và session recovery độc lập theo tab.

Tiêu chí hoàn tất:

- Hai rule trong cùng tab có thể `WAITING/MATCHED` độc lập.
- Baseline hoặc pipeline của rule này không bị reset bởi rule khác.
- Profile cũ không mất monitor selector, condition hoặc target config.
- Sidebar chỉ lưu thay đổi rule sau thao tác lưu rõ ràng.

## Phase 17 — Rule-triggered command presets

- Add an optional command action to each automation rule.
- Support monitor-match, target-action, and verification-pass triggers.
- Enforce exactly one request per rule cycle and trigger.
- Resolve command details only in the background from an enabled saved preset.
- Preserve per-tab command isolation, history, recovery, and Native Host safety checks.


## Phase 18 — Sanitized support bundle export

- Export a local ZIP from the sidebar without a new Firefox permission.
- Include sanitized settings, independent per-tab session/runtime summaries, bounded user/debug logs, Native Host status and diagnostic metadata.
- Exclude shell command text, working directories, shell output/history, session tokens, tab titles and URL query/fragment data.
- Keep the archive generation local and add the regression test to the existing combined test workflow.


## Phase 19 — Settings snapshots and rollback

- Keep up to 20 unique local settings snapshots.
- Automatically snapshot before destructive or overwrite operations.
- Restore snapshots while re-applying the restored store to active sessions.
- Expose compact create/restore/delete controls without adding VS Code tasks.

## Phase 28 v0.28.24 — real Firefox E2E and compatibility matrix

Completed: opt-in real-Firefox runtime validation and multi-binary compatibility reports.

<!-- FIREFOX_CHAT_IMPROVER_PHASE31_PLAN_BEGIN -->
## Phase 31 — Named saved working-session catalog

Completed in v0.31.0: persistent named catalog, search, create/update/rename/duplicate/delete, individual and full-catalog JSON backup, and controlled subset restore with permission checks.
<!-- FIREFOX_CHAT_IMPROVER_PHASE31_PLAN_END -->

### Phase 32 — Optional sound alert

**Status:** Complete in v0.32.0.

- Sound is disabled by default and configured per effective profile/tab configuration.
- Available tones: Soft chime, Double beep and Urgent.
- Volume is clamped to 0–100%; repeat count is limited to 1–5; repeat interval is bounded to 250–10000 ms.
- Playback is scheduled once per alert cycle, pending repeats stop on dismissal, and recovery does not replay an already-sounded cycle.
- The sidebar provides a Test sound preview without requiring Native Host.

**Next approved task:** opt-in automatic activation for explicitly trusted URL patterns.

### Phase 33 — Opt-in automatic activation for trusted URLs

**Status:** Complete in v0.33.0.

- Automatic activation is disabled by default and configured per configuration profile.
- URL routing, `Require the URL to match the allowlist`, explicit HTTP/HTTPS hosts and Firefox permission are mandatory.
- The permission request is initiated only by the user from the sidebar.
- Startup, completed navigation, profile saves and manual scans share one guarded activation path.
- Active or paused tabs are never switched automatically.
- Concurrent duplicate activation is prevented by a tab/URL/profile signature, and routing is rechecked immediately before content-script injection.

**Next approved task:** keyboard shortcuts for common tab and shell-log actions.

## Phase 34 — Firefox-managed keyboard shortcuts (v0.34.0)

**Status:** Complete.

- Added manifest commands for sidebar, active-tab lifecycle, alert acknowledgement, target action, command-log access and stop.
- Uses `browser.commands` as the source of truth for assignments and conflicts.
- Sidebar displays current assignments and links to Firefox shortcut management.
- Shortcut actions resolve the current active tab and keep pending sidebar actions correlated by tab/action ID.
- Native Host for macOS remains deferred.

**Next:** Per-rule statistics dashboard.

## Phase 35 — Per-rule statistics dashboard (v0.35.0)

**Status:** Complete.

- Statistics are isolated by activated tab session and rule ID.
- MATCHED transitions, clicked/dry-run target elements, verification PASS/FAIL/skipped outcomes and automatic-command results are counted without duplicate recovery events.
- Return-code frequencies, last-event timestamps, average MATCHED-to-target latency and average pipeline duration are shown in the sidebar.
- The dashboard can export typed JSON or reset only the current tab statistics without changing configuration or stopping automation.
- Private observer checkpoints persist with the tab session but are removed from public dashboard payloads.

**Next:** Compressed/exportable command logs by individual run.


## Phase 36 — Compressed per-run command-log export (v0.36.0)

**Status:** Complete.

- Added **Export run ZIP** to the Full command log dialog.
- The export freezes the selected tab/run/log identity and reads the complete file-backed transcript through ownership-checked pages.
- The ZIP contains `command.log`, `metadata.json` and `README.txt`; entries use DEFLATE whenever it reduces size.
- Metadata records sidebar/history origin, command source, preset/rule correlation, working directory, status, return code, timestamps, byte count and completeness.
- Missing Native Host files fall back to persisted per-run output and explicitly set `completeTranscript: false` with the failure reason.
- Export warns above 64 MiB and rejects a complete transcript above 512 MiB to bound sidebar memory.
- Native Host remains v0.13.0 because the existing paged read API is sufficient.

## Phase 37 — Suggested and custom prompt templates (v0.37.0)

**Status:** Complete.

- Added a **Prompt templates** group to the sidebar.
- Bundled defaults live in `extension/shared/prompt_templates.js`, separate from UI/background logic.
- Ships the requested context-estimate/early-handoff and complete-ZIP-handoff prompts.
- The selected prompt can be copied or inserted into the last visible writable prompt input in the currently displayed tab.
- Native input setters plus bubbling/composed `input` and `change` events support framework-controlled fields.
- User-created templates are stored locally and can be created, updated or deleted.
- Filling is active-tab-bound and rejects unsupported/internal pages or stale sidebar tab selection.
- Native Host remains v0.13.0.

## Phase 38 — Chromium port for Chrome and Edge (v0.38.0)

**Status:** Complete.

- Added a deterministic Chromium/Chrome/Edge MV3 build without changing the Firefox release package.
- Added a single service-worker loader, Chromium Side Panel manifest conversion and generated PNG icons.
- Added a compatibility layer for Promise message listeners, tab-scoped session values, side-panel opening, shortcut settings and support-bundle browser metadata.
- Added a stable public manifest key for local unpacked ID consistency plus an explicit extension-ID override for store builds.
- Added separate Linux Native Host registration manifests using `allowed_origins` for Chromium, Chrome and Edge.
- Removed unsupported Chromium MV3 `webRequestBlocking` while preserving the download-event fallback.
- Native Host remains v0.13.0.

**Next:** Full accessibility audit.


## Phase 39 — Full accessibility audit (v0.39.0)

**Status:** Complete.

- Added a keyboard-visible skip link and deterministic main-content focus target.
- Added visible focus indicators across native controls, links, disclosures and generated group toggles.
- Added status/alert live-region semantics, busy-state announcements and labelled/described dialogs.
- Added reduced-motion, increased-contrast and forced-colour CSS adaptations.
- Added keyboard-only element picking with Tab/Shift+Tab navigation, Enter/Space selection and Escape cancellation/focus restoration.
- Added regression coverage for accessible names, focus, live regions, display preferences and keyboard picker behavior.
- Protocol remains 25; Native Host remains 0.13.0.

**Next:** Recommended-feature backlog complete; Native Host for macOS remains deferred.


## Phase 40 — Stopped-tab Local action binding hotfix (v0.39.1)

Status: **Complete**

- Enable `Apply to tab` for the currently displayed stopped tab.
- Persist explicit Local action profile bindings in browser tab-session storage.
- Prefer the explicit binding during activation before URL routing/default fallback.
- Keep the selected binding visible after sidebar refresh and across Stop/Start cycles.
- Rebind stale tab assignments when a Local action profile is deleted.
- Add focused regression coverage for the inactive-tab apply and activation path.


## Phase 41 — Local action binding source and clear control (v0.39.2)

Status: **Complete**

- Restore the effective Local action source summary for stopped and active tabs.
- Distinguish explicit tab binding, URL-routed profile and default fallback.
- Add `Use URL/default` to remove an explicit binding without requiring activation.
- Re-resolve and persist the active tab profile immediately when clearing a binding.
- Add focused regression coverage for stopped-tab and active-session clear behavior.

## Phase 42 — Release-candidate status consistency (v0.39.3)

**Status:** Complete.

- Marked both required and recommended feature backlogs complete in the release-facing inventory.
- Removed stale “next task” wording after the Chromium port and accessibility audit were completed.
- Added a focused release-status consistency regression covering manifest, changelog, current status, implementation plan and test-runner version.
- Kept Native Host for macOS explicitly deferred rather than silently treating it as planned work.
- Protocol remains 26; Native Host remains 0.13.0.

**Next:** No scheduled implementation item; accept focused bug reports or an explicit new feature request.

## Phase 43 — Separate configuration and working-session I/O (v0.39.4)

**Status:** Complete.

- Removed the duplicate legacy working-session controls from the configuration import/export card.
- Clarified full-store actions as configuration-only import/export.
- Kept all named-session and session/catalog JSON operations in `Saved working sessions`.
- Added a regression proving the configuration JSON schema excludes the saved-session catalog and the two UI groups do not cross-own controls.
- Protocol remains 26; Native Host remains 0.13.0.

## Phase 44 — Preserve tab configuration across Stop/Start (v0.39.5)

### Mục tiêu

- `Stop` chỉ kết thúc runtime automation, không làm tab quay về default configuration.
- Lưu snapshot theo `tabId` bằng `browser.sessions` để tồn tại qua sidebar/background reload trong khi tab còn mở.
- Giữ profile binding, tab override, monitor/target editor draft, Local action profile/override và working draft.
- Không khôi phục monitor baseline, alert, logs, statistics hoặc trạng thái command đang chạy như một runtime session mới.

### Tiêu chí nghiệm thu

- Stop rồi Start trên cùng tab khôi phục đúng fingerprint cấu hình trước Stop.
- Sidebar của tab đang stopped vẫn hiển thị cấu hình đã giữ, không hiển thị default.
- Profile bị chỉnh trong lúc tab stopped không âm thầm đổi cấu hình đã đóng băng; snapshot chuyển thành tab override khi cần.
- Người dùng chọn profile khác khi tab stopped thì lựa chọn mới được ưu tiên.
- Regression Phase 04–44 PASS.

## Phase 45 — Explicit stopped-tab state reconciliation (v0.39.6)

**Mục tiêu:** bảo đảm `Stop` là trạng thái chủ động, không bị auto-activation đảo ngược và mọi lựa chọn profile khi tab dừng được phản ánh nhất quán.

- Chặn URL auto-activation khi còn stopped snapshot.
- Cập nhật snapshot khi Apply/Clear Local action profile ở tab đã Stop.
- Cho phép lựa chọn profile/routing mới bỏ qua snapshot một cách tường minh.
- Chỉ xóa snapshot sau khi Start và persist session thành công.
- Giữ nguyên snapshot nếu permission/content activation thất bại.

## Phase 46 — Simplified sidebar and feature visibility (v0.39.7)

**Status:** Complete.

- Rename confusing profile and editor groups without changing storage schemas.
- Reorder groups into a predictable task flow and colocate controls with the data they modify.
- Provide persistent Simple, Standard, All and Custom visibility presets from an always-visible control.
- Treat visibility as UI-only: no configuration deletion, runtime disablement or session mutation.
- Enforce dependencies so routing requires Automation profiles and download/shell editors require Local action profiles.
