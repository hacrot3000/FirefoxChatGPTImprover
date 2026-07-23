# Phase 12 — Target action pipeline delay/click/verify

## Mục tiêu

Mở rộng target automation từ một click tức thời thành pipeline có kiểm soát cho từng tab và từng monitor cycle:

```text
new target → delay trước action → click hoặc dry-run → delay sau action → verify DOM
```

Profile cũ được migration với `pipeline.enabled=false`, vì vậy hành vi click tức thời hiện tại không thay đổi cho đến khi người dùng chủ động bật pipeline.

## Cấu hình

Trong group **Target element mới**:

- `Bật pipeline delay/click/verify`.
- Delay trước action: 0–60.000 ms.
- Delay sau action: 0–60.000 ms.
- Bật/tắt verify.
- Selector verify độc lập; hỗ trợ CSS, ID, class, attribute và Element Picker.
- Kỳ vọng verify:
  - element tồn tại;
  - element biến mất;
  - có element đang hiển thị;
  - element tồn tại nhưng tất cả đều ẩn.
- Timeout verify: 100–120.000 ms.
- Chu kỳ polling verify: 50–5.000 ms.

## Vòng đời

- Target mới được reserve ngay khi pipeline bắt đầu để mutation khác không tạo action trùng.
- Pipeline pending được hủy khi:
  - monitor rời `MATCHED` và re-arm;
  - tab pause/stop;
  - cấu hình được áp dụng lại;
  - session/content runtime được restart.
- Pipeline của tab A không ảnh hưởng pipeline của tab B.
- Dry-run chỉ highlight, không click và không chạy verify để tránh false failure.
- Verify failure đặt target runtime thành `ERROR` trong cycle hiện tại; monitor vẫn active. Khi monitor re-arm, baseline/pipeline được reset cho cycle kế tiếp.

## Runtime và log

Sidebar hiển thị `pipelineState`, trạng thái busy và kết quả verify gần nhất. Background ghi các transition pipeline quan trọng vào log riêng của session theo `tabId`.

## Kiểm thử

`tools/test_firefox_addon.sh` chạy thêm `tests/test_phase12_action_pipeline.js`, bao gồm:

- migration schema 8 → 9;
- normalize/validate pipeline;
- bốn kỳ vọng verify;
- verify polling đến khi đạt;
- contract UI, picker, background log và cancellation marker;
- version add-on `0.12.0`.
