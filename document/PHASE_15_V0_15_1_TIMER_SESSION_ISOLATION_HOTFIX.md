# Phase 15 v0.15.1 — Timer binding và session isolation hotfix

- Bọc timer API để luôn gọi với đúng owner (`Window` hoặc clock test), loại bỏ lỗi `setTimeout called on an object that does not implement interface Window`.
- Activation thất bại được rollback hoàn toàn: dừng content runtime dở dang, xóa session persistence, notification và badge.
- Mỗi activation có `sessionToken`; background chỉ nhận runtime event khi `sender.tab.id`, payload `tabId` và token đều khớp session hiện hành.
- Resume giữ trạng thái monitor do content runtime trả về, không ép về `IDLE`.
- Test monitor stability dùng polling có timeout thay vì ngủ cố định 110 ms để tránh fail giả khi máy bận.
