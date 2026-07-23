# Phase 11 — URL profile routing

## Mục tiêu

Chọn đúng profile khi kích hoạt một tab mới dựa trên URL, nhưng không tự inject vào mọi website và không thay đổi profile của session đã active.

## Quy tắc chọn

1. Chỉ profile bật **Profile tham gia chọn theo URL** và có ít nhất một pattern khớp mới là candidate.
2. `routingPriority` lớn hơn thắng.
3. Nếu bằng ưu tiên, pattern cụ thể hơn (ít wildcard, nhiều ký tự literal hơn) thắng.
4. Nếu không có candidate, add-on fallback về profile mặc định.
5. Chọn profile thủ công trong sidebar là override cho tab chưa active; có thể bấm **Chọn profile phù hợp** để quay lại kết quả routing.
6. Tab đã active giữ nguyên profile/config/session độc lập; thay đổi active tab hoặc routing không tự đổi session đó.

## Toolbar và sidebar

- Toolbar activation không truyền profile cụ thể nên background tự route theo URL.
- Sidebar mặc định bật **Tự chọn profile khớp URL khi kích hoạt tab chưa active**.
- Nút **Kiểm tra URL hiện tại** hiển thị số candidate, profile thắng, priority và pattern.

## Migration

Schema setting tăng lên 8. Profile cũ tự nhận `routingEnabled=true` và `routingPriority=0`; URL pattern/allowlist hiện có được giữ nguyên.
