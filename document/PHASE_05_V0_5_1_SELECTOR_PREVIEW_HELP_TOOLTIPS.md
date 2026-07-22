# Phase 05 v0.5.1 — Selector preview và help tooltip

## Mục tiêu

Hotfix này sửa giao diện kiểm tra element theo dõi và giảm không gian dành cho hướng dẫn.

## Help tooltip

Các hướng dẫn dài không còn nằm thường trực trong luồng layout. Mỗi card liên quan có nút `?` đặt tuyệt đối ở góc. Nội dung hiện khi hover, focus bàn phím hoặc mở bằng click.

## Kiểm tra monitor

Nút kiểm tra được đặt sau danh sách điều kiện để người dùng nhập selector và điều kiện trước rồi mới kiểm tra. Kết quả gồm hai số độc lập:

1. **Khớp selector**: toàn bộ node DOM được tìm bởi selector.
2. **Thỏa điều kiện**: số node trong tập trên vượt qua các điều kiện attribute đang bật theo AND/OR.

Màu highlight:

- Cam nét đứt: khớp selector nhưng không thỏa điều kiện.
- Xanh lá: khớp selector và thỏa điều kiện.
- Với element ẩn, add-on đánh dấu ancestor hiển thị gần nhất bằng màu tương ứng mà không ép element hiện ra.

Điều kiện chuyển trạng thái ẩn/hiện vẫn là điều kiện runtime cần baseline, nên preview tĩnh chỉ đánh giá selector và điều kiện attribute hiện tại.
