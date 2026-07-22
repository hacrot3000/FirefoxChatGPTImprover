# FirefoxChatImprover — Kế hoạch triển khai

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

### Phase 09 — Nâng cấp tùy chọn sau baseline

Chỉ thực hiện sau khi Phase 00–08 ổn định:

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
- Phase baseline 00–08 đã hoàn tất; Phase 09 chỉ gồm các nâng cấp tùy chọn sau baseline.
