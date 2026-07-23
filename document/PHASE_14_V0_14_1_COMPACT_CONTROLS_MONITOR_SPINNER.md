# Phase 14 v0.14.1 — Compact collapsed controls and monitor title spinner

## Phạm vi

Hotfix này giữ nguyên engine multi-tab/session recovery của Phase 14 và chỉ bổ sung các thao tác nhanh cùng chỉ báo hoạt động.

## Group Tab và session

Khi group được thu gọn, tiêu đề vẫn hiển thị:

- `▶` để kích hoạt, khôi phục hoặc tiếp tục tab tùy mode hiện tại;
- `⏸` để tạm dừng tab đang active;
- `■` để dừng session của tab;
- `↻` để làm mới dashboard.

Nút chính tự đổi hành động theo đúng session của `selectedTabId`; không dùng trạng thái toàn cục của tab khác.

## Group Target element mới

Khi thu gọn, tiêu đề hiển thị nút `☝` để chạy cùng luồng **Click thử target hiện tại**. Luồng vẫn yêu cầu xác nhận trước khi click thật và chỉ tác động tab đang hiển thị.

## Chỉ báo monitor trên title tab

Khi session ở mode `ACTIVE` và monitor ở trạng thái `WAITING`, add-on thêm spinner Braille thay đổi theo thời gian ở đầu `document.title`. Spinner dừng khi:

- monitor chuyển sang `MATCHED`;
- session bị pause hoặc stop;
- alert title blink đang chiếm quyền hiển thị title.

Alert blink có ưu tiên cao hơn spinner. Khi alert được xác nhận và monitor đang chờ, spinner tự xuất hiện lại. Title gốc của trang được khôi phục khi không còn signal nào.

## Tương thích

- Không thay đổi schema profile.
- Không thêm VS Code task.
- Không thay đổi baseline, cycle, target pipeline hoặc session recovery.
- Add-on version: `0.14.1`.
