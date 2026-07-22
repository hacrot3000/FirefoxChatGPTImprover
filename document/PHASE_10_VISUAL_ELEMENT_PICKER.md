# Phase 10 — Visual Element Picker

## Mục tiêu

Cho phép chọn trực tiếp element trên tab hiện tại thay vì tự dò ID, class hoặc CSS selector. Picker hoạt động độc lập theo `tabId` và không tự lưu đè profile/tab config.

## Luồng sử dụng

1. Mở group **Element theo dõi** hoặc **Target element mới**.
2. Bấm **Chọn trên trang**. Firefox chỉ xin quyền website hiện tại khi cần.
3. Rê chuột trên trang; element đang trỏ được viền tím và hiện mô tả ngắn.
4. Click để chọn hoặc nhấn `Esc` để hủy.
5. Sidebar tự điền selector. Người dùng kiểm tra/highlight rồi chủ động lưu vào tab hoặc profile.

## Chiến lược tạo selector

Picker ưu tiên theo thứ tự:

1. ID duy nhất.
2. Attribute ổn định duy nhất: `data-testid`, `data-message-id`, `name`, `aria-label`, `role`, `href`.
3. Tổ hợp class duy nhất.
4. CSS path có `nth-of-type` làm fallback.

Kết quả luôn kèm số element đang khớp selector để người dùng biết selector có duy nhất hay không.

## Multi-tab và an toàn

- Mỗi tab có picker state riêng trong background.
- Chỉ tab đang active mới được bắt đầu picker.
- Kết quả luôn mang `tabId` và loại `monitor`/`target`; không điền nhầm form của tab khác.
- Click dùng để chọn element bị chặn, không kích hoạt hành động thật trên trang.
- Selector chỉ điền vào form; không tự lưu profile hoặc tự bật automation.
- Stop/đóng/navigation tab dọn picker state và overlay.

## Kiểm thử

`tools/test_firefox_addon.sh` chạy thêm `tests/test_phase10_element_picker.js`, kiểm tra chiến lược ID/attribute/class, protocol, UI và background routing.
