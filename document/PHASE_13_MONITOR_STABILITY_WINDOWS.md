# Phase 13 — Monitor stability windows

## Mục tiêu

Loại bỏ chu kỳ giả khi element hoặc attribute chớp nhanh trong lúc SPA/React re-render.

## Cấu hình mới

- `matchStableMs`: condition phải giữ liên tục đủ thời gian trước khi `WAITING -> MATCHED`.
- `resetStableMs`: condition phải không đạt liên tục đủ thời gian trước khi `MATCHED -> WAITING` và re-arm chu kỳ.
- Giá trị `0` giữ hành vi tức thời tương thích các profile cũ.

## Vòng đời

- Khi bắt đầu khoảng ổn định, runtime giữ nguyên state hiện tại và công bố `pendingMonitorState`.
- Nếu condition đảo lại trước deadline, pending bị hủy và không tăng cycle.
- Target pipeline/cảnh báo chỉ chạy sau cạnh `MATCHED` đã được xác nhận ổn định.
- Pause, stop, config update và runtime upgrade đều hủy timer pending.
- Mỗi tab có timer ổn định riêng trong content runtime của chính tab đó.

## Kiểm thử

`tests/test_phase13_monitor_stability.js` kiểm tra match flicker, reset flicker, cycle counter và hai cạnh ổn định liên tiếp.
