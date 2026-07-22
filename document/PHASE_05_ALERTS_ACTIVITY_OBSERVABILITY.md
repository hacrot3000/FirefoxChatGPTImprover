# Phase 05 — Cảnh báo đa tab và quan sát hoạt động

## Mục tiêu

Phase 05 hoàn thiện khả năng quan sát và kiểm soát automation. Mỗi tab có cảnh báo, badge, notification và nhật ký riêng; sự kiện của tab này không thay đổi UI/runtime của tab khác.

## Cảnh báo theo từng tab

Khi monitor của một tab chuyển sang `MATCHED`:

- title của chính tab đó có thể nhấp nháy với tiền tố cấu hình;
- badge của toolbar cho tab đó chuyển thành `!`;
- sidebar chuyển sang trạng thái cảnh báo nếu đang hiển thị session đó;
- Firefox notification có thể được phát một lần trên cạnh chuyển `WAITING -> MATCHED`.

Khi monitor rời `MATCHED`, tab được pause hoặc stop:

- title gốc được khôi phục;
- badge trở về `ON`, `II` hoặc rỗng theo mode;
- notification của tab được dọn;
- sidebar không tiếp tục nhấp nháy.

Notification chỉ được phát khi option `Notification` được bật. Nhấn notification sẽ focus cửa sổ và active đúng tab đã tạo cảnh báo.

## Bảo toàn title

`content/alert.js` lưu title trang trước khi cảnh báo. Trong lúc cảnh báo, một `MutationObserver` theo dõi thẻ title để tiếp nhận thay đổi title hợp lệ do SPA tạo ra. Add-on không dùng title của tab khác làm baseline.

## Nhật ký session

Mỗi session theo `tabId` có hai kênh:

- `user`: activate, pause/resume, monitor transition, target click/dry-run và lỗi cần chú ý;
- `debug`: runtime update, reason và dữ liệu chẩn đoán chi tiết.

Giới hạn lưu:

- tối đa 80 dòng user;
- tối đa 120 dòng debug.

Sidebar cho phép chọn kênh, copy và xóa log của riêng tab đang chọn. Log được lưu cùng session bằng Firefox Sessions API, không trộn giữa các tab.

## Thử target hiện tại

Phase 05 thêm hai thao tác thủ công:

- `Dry-run target hiện tại`: chọn target theo selector/visible/enabled/strategy đang nhập rồi chỉ highlight;
- `Click thử có xác nhận`: hiển thị hộp xác nhận trước khi click thật.

Đây là công cụ test selector/action hiện tại, không thay đổi baseline của target automation theo chu kỳ.

## Cleanup

Nút `Xóa highlight` dọn highlight selector và target trên active tab. `Dừng` session cũng dọn highlight và khôi phục title ngay cả khi target dry-run vẫn còn thời gian hiển thị.

## Kiểm thử thủ công

1. Kích hoạt hai tab với hai profile khác nhau.
2. Làm tab 1 chuyển `MATCHED`; xác nhận chỉ title/badge/log tab 1 thay đổi.
3. Chuyển sang tab 2; xác nhận sidebar hiển thị trạng thái/log riêng của tab 2.
4. Làm tab 2 `MATCHED`; xác nhận cả hai tab có badge độc lập.
5. Cho tab 1 trở về `WAITING`; xác nhận title tab 1 được phục hồi trong khi tab 2 vẫn cảnh báo.
6. Bật notification, tạo một cạnh `WAITING -> MATCHED`, nhấn notification và xác nhận Firefox focus đúng tab.
7. Thử dry-run target hiện tại; xác nhận chỉ highlight.
8. Thử click thật trên trang an toàn; xác nhận có hộp xác nhận và log riêng.
9. Pause/stop tab; xác nhận title và highlight được dọn.
