# Phase 15 — Multi-rule monitor/action automation

## Mục tiêu

Cho phép một tab theo dõi đồng thời nhiều automation rule độc lập thay vì chỉ một cặp monitor/target.

## Cấu trúc cấu hình

- Settings schema nâng lên `11`.
- Mỗi profile/tab config có `rules[]` và `activeRuleId`.
- Mỗi rule gồm:
  - `id`, `name`, `enabled`;
  - monitor selector, visibility transition, attribute conditions và stability windows;
  - target selector, baseline/fingerprint, click strategy và delay/click/verify pipeline.
- Profile cũ không có `rules[]` được migration thành một rule mặc định, giữ nguyên monitor/target cũ.
- `monitor` và `target` top-level vẫn là projection của rule đang chọn để giữ tương thích với công cụ cũ.

## Runtime

- Mỗi rule tạo monitor engine và target automation riêng.
- Baseline, cycle, candidate, handled count, pipeline và verify result không dùng chung giữa các rule.
- Runtime tab có `ruleRuntimes` theo `ruleId`, `matchedRuleIds`, `matchedRuleCount` và cycle cảnh báo tổng hợp.
- Khi bất kỳ rule nào chuyển sang `MATCHED`, cảnh báo tab được kích hoạt; target action chỉ chạy trong rule tương ứng.
- Một rule re-arm không dừng rule khác đang `MATCHED`.
- Pause/resume/stop tab tác động đồng thời lên toàn bộ rule của chính tab đó, không ảnh hưởng tab khác.

## Sidebar

- Group **Automation rules** cho phép chọn, tạo mới, nhân bản, bật/tắt và xóa rule.
- Các group **Element theo dõi** và **Target element mới** luôn chỉnh rule đang chọn.
- Thay đổi rule chỉ nằm trong bản nháp cho tới khi bấm **Lưu vào profile** hoặc **Lưu riêng cho tab**.
- Sidebar hiển thị runtime tóm tắt của rule đang chọn và tổng số rule bật/MATCHED trong session.

## Giới hạn có chủ đích

- Mỗi rule hiện dùng một `MutationObserver` monitor và một observer target; nên chỉ bật các rule thật sự cần thiết.
- Cảnh báo title/badge/notification vẫn là cảnh báo chung của tab, không tạo nhiều notification song song cho cùng một thời điểm.
- Shell command vẫn thuộc profile/tab config chung, chưa gắn riêng theo từng rule.
