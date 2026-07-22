# Phase 07 — Kiểm thử và hardening

## Phạm vi

Phase 07 không bổ sung automation mới. Mục tiêu là cố định hành vi Phase 01–06 trước khi đóng gói cài lâu dài:

- test selector, condition, visibility transition và state machine;
- test baseline/fingerprint/target observer;
- kiểm tra message sender scope giữa sidebar, background và content script;
- hardening Native Messaging trước output lớn, action lạ và stop sai tab;
- kiểm tra CSP, permission và cấm mã động/remote script;
- cung cấp DOM fixture để kiểm tra thủ công nhiều tab.

## Thay đổi runtime

### Observer giới hạn theo cấu hình

Monitor và target không còn mặc định nhận mọi attribute mutation. Add-on xây dựng `attributeFilter` từ:

- selector ID/class/attribute/CSS attribute;
- condition attribute;
- fingerprint attribute;
- các attribute visibility/enabled chuẩn như `style`, `hidden`, `aria-hidden`, `disabled`.

Condition dùng `textContent` sẽ bật `characterData`; các cấu hình khác không theo dõi text mutation không cần thiết.

### Native output chunking

Một dòng stdout/stderr dài được chia thành chunk tối đa 65.536 ký tự trước khi gửi qua Native Messaging. Việc ghép log ở sidebar vẫn giữ nguyên thứ tự nội dung.

### Sender scope

- `CONTENT_RUNTIME_EVENT` chỉ được nhận từ content script có `sender.tab.id`.
- Yêu cầu quản trị/profile/test/shell chỉ được nhận từ sidebar extension.
- Content script không được gọi shell hoặc thay đổi profile.

### Cleanup

Content runtime có `shutdown()` và dọn monitor, target, title alert, highlight và listener khi `pagehide`. Engine global được để `configurable` cho các nâng cấp sau này.

## Chạy test tự động

Từ VS Code Build Tasks chọn:

```text
Firefox Add-on: Test
```

Hoặc:

```bash
./tools/test_firefox_addon.sh
```

Nếu `web-ext` đã được cài, script chạy luôn `web-ext lint`. Nếu chưa cài, phần unit/security test vẫn chạy và lint báo `SKIP` rõ ràng.

## DOM fixture

Chọn Build Task:

```text
Firefox Add-on: Phase 07 DOM Fixture
```

Sau đó mở:

```text
http://127.0.0.1:8765/phase07_dom_fixture.html
```

Fixture hỗ trợ:

- ẩn/hiện monitor;
- đổi `aria-label` và `data-testid`;
- thay node như React re-render;
- thêm target thường, ẩn hoặc disabled;
- tạo 100 attribute mutation liên tiếp;
- ghi nhận target thật sự bị click.

## Checklist thủ công nhiều tab

1. Mở fixture ở hai tab.
2. Kích hoạt cả hai tab và chọn profile khác nhau.
3. Tab A theo dõi `ẩn → hiện`; tab B theo dõi `aria-label chứa Stop`.
4. Thao tác tab A và xác nhận trạng thái tab B không đổi.
5. Thêm target ở từng tab và xác nhận baseline/click/log độc lập.
6. Chạy command nền ở tab A; xác nhận tab B có shell state riêng.
7. Dừng command tab A và xác nhận không tác động tab B.
8. Tạo mutation storm; sidebar không treo và không tăng cycle nếu điều kiện không đổi.
9. Replace monitor; node mới chỉ làm baseline, không tạo MATCHED giả.
10. Pause/stop tab; title và highlight phải được dọn.

## Tiêu chí nghiệm thu

- Toàn bộ test Phase 04–07 PASS.
- Không có `eval`, `new Function`, remote script hoặc quyền ngoài danh sách đã duyệt.
- Output native lớn không làm đứt protocol.
- Sender sai nguồn bị từ chối trước khi chạy thao tác.
- Mutation storm không phát event trạng thái lặp.
