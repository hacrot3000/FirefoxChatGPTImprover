# Phase 05 v0.5.2 — Compact header/status

## Mục tiêu

Giảm chiều cao cố định ở đầu sidebar mà không loại bỏ tên add-on hay trạng thái của tab/session hiện tại.

## Thay đổi giao diện

- Header dùng một hàng, căn giữa theo chiều dọc.
- Padding dọc giảm từ 14 px xuống 6 px.
- Tên add-on được phép co và hiện dấu ba chấm khi sidebar quá hẹp.
- Status dùng chip cao khoảng 18 px với chấm màu trạng thái.
- Trạng thái active, paused, error và alert vẫn giữ màu riêng.
- Không sửa nội dung text status và không thay đổi logic multi-tab.

## Tương thích thay đổi local

Patch không ghi đè `extension/sidebar/sidebar.html`, tên add-on, Gecko ID hay tiêu đề notification. Vì vậy các thay đổi branding local trong staged changes được giữ nguyên.
