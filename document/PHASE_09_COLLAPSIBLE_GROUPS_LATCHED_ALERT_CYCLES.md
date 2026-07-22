# Phase 09 — Collapsible groups và cảnh báo giữ chốt theo chu kỳ

## 1. Mục tiêu

Phase 09 cải thiện trải nghiệm dùng sidebar dài và sửa vòng đời cảnh báo để automation hoạt động liên tục theo nhiều chu kỳ mà không yêu cầu kích hoạt lại tab.

## 2. Group sidebar có thể ẩn/hiện

Các group sau có nút mũi tên riêng ở cạnh tiêu đề:

- Tab và session;
- Profile cấu hình;
- URL activation;
- Element theo dõi;
- Target element mới;
- Cảnh báo;
- Nhật ký hoạt động;
- Shell command;
- Lưu cấu hình.

Trạng thái thu gọn được lưu trong `browser.storage.local` dưới key riêng `firefoxChatImprover.sidebarUi.v1`. Đây chỉ là tùy chọn giao diện, không nằm trong profile và không thay đổi cấu hình/session của bất kỳ tab nào.

## 3. Vòng đời monitor liên tục

Monitor không dừng khi đạt điều kiện:

```text
WAITING
  └─ điều kiện đạt → MATCHED, cycle tăng, chạy target action và bật cảnh báo
MATCHED
  └─ điều kiện không còn đạt → WAITING, target baseline được tạo lại
WAITING
  └─ điều kiện đạt lần sau → MATCHED của cycle mới
```

Việc xác nhận/tắt cảnh báo không thay đổi `monitorState`, không pause và không stop session.

## 4. Cảnh báo giữ chốt

Cảnh báo được gắn với `alertCycle` và không tự tắt chỉ vì monitor rời `MATCHED`.

Cảnh báo tắt khi một trong các điều kiện sau xảy ra:

1. Người dùng có thao tác thật trong tab đang hiển thị: `pointerdown`, `keydown`, `wheel` hoặc `touchstart`.
2. Tab hiển thị liên tục đủ `activeTabTimeoutSeconds` giây.
3. Người dùng pause/stop tab hoặc tắt toàn bộ kênh cảnh báo.

Event giả do `element.click()` của add-on có `isTrusted=false` và không được tính là thao tác xác nhận.

Sau khi cảnh báo của cycle N đã được xác nhận, condition vẫn đang MATCHED sẽ không bật lại cảnh báo cycle N. Chỉ sau khi condition trở về không đạt rồi đạt lại, monitor tăng sang cycle N+1 và cảnh báo mới được bật.

## 5. Cấu hình mới

Trong group **Cảnh báo**:

- `Tắt cảnh báo khi có thao tác thật trong tab`;
- `Timeout dự phòng khi tab active liên tục`, từ 0 đến 3600 giây; giá trị 0 tắt timeout.

Giá trị mặc định:

```text
dismissOnUserActivity = true
activeTabTimeoutSeconds = 10
```

## 6. Trạng thái runtime mới

Mỗi tab giữ riêng:

- `alertCycle`;
- `alertAcknowledgedAt`;
- `alertDismissReason`;
- `lastUserActivityAt`;
- `activeVisibleSince`.

Badge, title, sidebar và notification dựa trên `alertActive`, không còn dựa trực tiếp vào việc monitor đang MATCHED.

## 7. Kiểm thử

`tools/test_firefox_addon.sh` kiểm tra:

- cảnh báo vẫn active khi monitor rời MATCHED;
- thao tác synthetic không xác nhận cảnh báo;
- thao tác trusted xác nhận cảnh báo;
- cùng cycle không bật lại sau khi đã xác nhận;
- cycle kế tiếp bật cảnh báo mới;
- timeout chỉ chạy khi tab visible liên tục;
- đủ chín group sidebar có trạng thái thu gọn được lưu.
