# Phase 03 — Monitor engine, visibility condition và selector test

## Mục tiêu

Phase 03 triển khai engine theo dõi DOM thực tế cho từng tab bằng `MutationObserver`, đồng thời bổ sung công cụ kiểm tra selector trực tiếp từ sidebar.

## Selector resolver dùng chung

UI, validator và content monitor cùng dùng một resolver để chuyển cấu hình thành CSS selector. Các kiểu được hỗ trợ:

- CSS selector.
- ID.
- Class; có thể nhập một hoặc nhiều class, ví dụ `primary send-button` hoặc `.primary.send-button`.
- Attribute; có thể tìm theo tồn tại của attribute hoặc theo giá trị cụ thể.
- Tag có thể kết hợp với ID/class/attribute.

Nút **Kiểm tra và highlight**:

1. Chỉ thao tác trên active tab hiện tại để người dùng nhìn thấy kết quả.
2. Xin quyền đúng website nếu Firefox chưa cấp.
3. Đếm tổng số element, số hiện, số ẩn và số được chọn sau bộ lọc visibility.
4. Highlight element hiện bằng viền đỏ trong 8 giây.
5. Với element ẩn, không cưỡng ép đổi `display`; add-on đánh dấu ancestor hiện gần nhất bằng viền cam đứt để tránh làm thay đổi layout hoặc trạng thái ứng dụng.

## Chuyển trạng thái hiển thị của monitor

`monitor.visibilityTransition` có ba giá trị:

- `none`: không dùng ẩn/hiện làm điều kiện; monitor chỉ xét selector và các condition attribute đang bật.
- `hidden_to_visible`: chỉ MATCHED sau khi element đã được quan sát ở trạng thái ẩn rồi chuyển sang hiện.
- `visible_to_hidden`: chỉ MATCHED sau khi element đã được quan sát ở trạng thái hiện rồi chuyển sang ẩn.

Trạng thái tại lúc kích hoạt, resume hoặc cập nhật cấu hình chỉ được ghi làm baseline. Nếu element đang hiện khi chọn `hidden_to_visible`, monitor vẫn ở `WAITING` cho tới khi element ẩn rồi hiện lại. Quy tắc ngược lại áp dụng cho `visible_to_hidden`.

Có thể xóa hoặc tắt toàn bộ condition attribute. Khi đó selector cùng chuyển trạng thái ẩn/hiện là toàn bộ điều kiện theo dõi. Nếu vẫn dùng condition attribute, transition được ghi nhận trước và monitor chỉ MATCHED khi các condition đó cũng thỏa trong trạng thái đích.

Element được xem là ẩn khi có một trong các dấu hiệu:

- `display: none`.
- `visibility: hidden` hoặc `visibility: collapse`.
- thuộc tính/property `hidden`.
- thuộc tính hoặc property `visible=false`.
- `aria-hidden=true`.
- element đã detached hoặc không có rendered box (`getClientRects().length === 0`), bao gồm trường hợp ancestor bị ẩn.

## State machine và MutationObserver

Mỗi content runtime của từng tab có một monitor instance riêng:

- `IDLE`: chưa chạy hoặc đã dừng.
- `WAITING`: tìm thấy hoặc chưa tìm thấy element nhưng chưa có element nào thỏa điều kiện.
- `MATCHED`: ít nhất một element thỏa điều kiện.
- `PAUSED`: observer đã disconnect theo yêu cầu người dùng.
- `ERROR`: selector hoặc evaluator phát sinh lỗi.

Engine quan sát `attributes`, `childList` và `subtree`, sau đó debounce 80 ms. Không dùng `setInterval` quét trang liên tục. Điều này cho phép tìm lại element khi React/Vue thay node cũ bằng node mới.

Runtime event chỉ được gửi khi state/count quan trọng thay đổi. Background cập nhật đúng session theo `sender.tab.id`; session của tab khác không bị ảnh hưởng.

## Sidebar runtime

Sidebar hiển thị cho active tab:

- monitor state;
- tổng element tìm thấy, số hiện và số ẩn;
- số element đang thỏa điều kiện;
- cycle;
- transition/reason cuối.

Khi đổi active tab, các số liệu trên được nạp từ session của tab mới.

## Giới hạn Phase 03

- Chưa tạo baseline target theo chu kỳ.
- Chưa tự click target mới.
- Chưa triển khai title blink/notification đầy đủ.
- Chưa chạy shell/native host.

Các nội dung trên tiếp tục ở Phase 04–06.

## Kiểm thử thủ công

1. Chọn monitor theo ID và bấm **Kiểm tra và highlight**; xác nhận count và viền đỏ.
2. Chọn kiểu Class, nhập một hoặc nhiều class; xác nhận selector tìm đúng element.
3. Chọn `Ẩn → hiện`, kích hoạt khi element đang ẩn, sau đó bỏ `display:none`; xác nhận monitor chuyển `MATCHED`.
4. Chọn `Hiện → ẩn`, kích hoạt khi element đang hiện, sau đó đặt `visible="false"` hoặc `aria-hidden="true"`; xác nhận monitor chuyển `MATCHED`.
5. Thay node monitor bằng node mới trong DevTools; xác nhận observer tìm lại và sidebar cập nhật.
6. Xóa toàn bộ condition attribute và xác nhận monitor vẫn hoạt động chỉ bằng transition ẩn/hiện.
7. Kích hoạt hai tab với selector/transition khác nhau; xác nhận state/count độc lập.
8. Pause một tab; xác nhận observer của tab đó dừng nhưng tab còn lại tiếp tục cập nhật.
