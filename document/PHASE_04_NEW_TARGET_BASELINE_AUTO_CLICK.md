# Phase 04 — Baseline target mới và tự click theo chu kỳ

## Mục tiêu

Phase 04 chỉ xử lý target element mới xuất hiện sau baseline của chu kỳ hiện tại. Mỗi tab có một target engine riêng, nên baseline, candidate, số lần click và dry-run của tab này không ảnh hưởng tab khác.

## Cấu hình target

- **Bật xử lý target mới khi monitor MATCHED**: mặc định tắt để tránh click ngoài ý muốn sau khi nâng cấp.
- Selector hỗ trợ CSS, ID, class và attribute giống monitor.
- Chiến lược:
  - `Mới đầu tiên`;
  - `Mới cuối cùng`;
  - `Tất cả element mới`.
- Có thể chỉ nhận target đang visible và enabled.
- `maxClicksPerCycle` giới hạn tổng hành động trong một chu kỳ; dry-run cũng tính là một hành động để không highlight lặp vô hạn.
- `fingerprintAttributes` ưu tiên các khóa ổn định như `data-message-id`, `data-testid`, `id`, `href`, `aria-label`.

## Baseline và candidate

1. Khi tab được kích hoạt/resume hoặc cấu hình thay đổi, add-on quét target hiện có và lập baseline; không click.
2. Khi monitor chuyển sang `MATCHED`, target engine quét ngay và tiếp tục theo dõi DOM bằng `MutationObserver`.
3. Candidate chỉ được tạo khi số target có cùng fingerprint vượt số lượng đã có trong baseline.
4. Node identity được kết hợp với fingerprint count để:
   - không click node cũ;
   - không click lại khi React thay toàn bộ node nhưng số lượng logic không đổi;
   - vẫn nhận ra một target mới được thêm bên cạnh các target giống nhau.
5. Khi monitor rời `MATCHED`, add-on quét lại target hiện tại và lập baseline mới cho chu kỳ sau.

## Click và dry-run

- Dry-run chỉ highlight target bằng viền xanh và không gọi `element.click()`.
- Click thật gọi `element.click()` sau khi kiểm tra node vẫn kết nối, visible/enabled theo cấu hình.
- Target đã xử lý được đánh dấu trong chu kỳ. Nếu React render lại cùng fingerprint trong lúc monitor vẫn MATCHED, add-on không click lặp.
- Target xuất hiện sau thời điểm monitor đã MATCHED vẫn được xử lý nhờ observer riêng của target engine.

## Runtime hiển thị trên sidebar

Sidebar hiển thị riêng cho tab đang active:

- target state;
- baseline count;
- tổng target và candidate mới;
- tổng hành động, số click thật và số dry-run;
- action hoặc lỗi gần nhất.

## Kiểm thử thủ công

1. Bật target automation và giữ `Dry-run` được chọn.
2. Kích hoạt tab khi đã có một số target; xác nhận baseline bằng số target hiện có và không có highlight.
3. Làm monitor chuyển `MATCHED`, thêm một target mới; xác nhận chỉ target mới có viền xanh.
4. Giữ monitor `MATCHED`, thêm target khác; xác nhận target mới tiếp tục được xử lý cho tới giới hạn chu kỳ.
5. Render lại toàn bộ danh sách với cùng số target/fingerprint; xác nhận không highlight/click lặp.
6. Làm monitor trở lại `WAITING`; xác nhận baseline được tạo lại.
7. Chuyển sang tab khác với selector/cấu hình khác; xác nhận số liệu hoàn toàn độc lập.
8. Tắt dry-run trên trang thử nghiệm an toàn và xác nhận target mới được click đúng chiến lược.
