# Phase 14 — Restart-safe multi-tab session recovery

## Mục tiêu

Giữ session riêng của từng tab qua background/add-on reload và nối lại monitor sau navigation mà không lặp action của chu kỳ cũ.

## Hành vi

- Khôi phục các session `active` và `paused` từ `browser.sessions`.
- Re-inject toàn bộ content runtime và áp dụng đúng profile/tab config.
- Lập baseline monitor/target mới; xóa pending stability, pipeline và alert tạm thời.
- Giữ các bộ đếm lịch sử như cycle/click count để quan sát, nhưng không tiếp tục pipeline đang dở.
- Sau navigation, chờ `status=complete` rồi mới nối lại.
- Nếu thiếu host permission, giữ session và hiển thị trạng thái `permission-required`; người dùng bấm **Khôi phục tab hiện tại** để cấp quyền lại.
- Nếu URL mới không khớp config, giữ session ở `paused/url-blocked` thay vì xóa.
- Mỗi tab có recovery state, attempt count và log độc lập.

## Trạng thái recovery

`none`, `recovering`, `attached`, `navigation-pending`, `permission-required`, `url-blocked`, `failed`.

## An toàn

Recovery luôn reset baseline, candidate, pending stability, alert và action pipeline. Vì vậy reload/navigation không được phép click lại target cũ hoặc tiếp tục một pipeline đã mất ngữ cảnh.
