# Phase 02 — Multi-tab session, profile và cấu hình

## Mục tiêu

Phase 02 xây dựng lớp dữ liệu trước khi triển khai DOM observer. Add-on có thể duy trì nhiều tab đã kích hoạt đồng thời; mỗi tab có trạng thái và cấu hình độc lập.

## Mô hình dữ liệu

### Profile lưu lâu dài

Profile là cấu hình mẫu lưu trong `browser.storage.local`:

- URL allowlist.
- Selector element theo dõi.
- Danh sách điều kiện attribute và AND/OR.
- Selector target mới và chiến lược click.
- Cấu hình cảnh báo.
- Working directory và shell command dành cho Phase 06.

### Session theo tab

Mỗi tab đã kích hoạt có session riêng, nhận diện bằng `tabId`:

- `mode`: active, paused hoặc error.
- `profileId`.
- `configMode`: dùng profile hoặc cấu hình riêng của tab.
- `tabConfig`: snapshot độc lập nếu người dùng chọn “Lưu riêng cho tab”.
- `runtime`: monitor state, cycle, baseline count, candidate count và last event.

Session được gắn vào tab bằng `browser.sessions.setTabValue()`. Background vẫn giữ `Map<tabId, session>` để truy cập nhanh. Khi background được nạp lại, session chỉ được khôi phục nếu content runtime của tab vẫn còn; add-on không tự inject lại toàn bộ tab sau khi Firefox khởi động.

## Luồng sử dụng nhiều tab

1. Mở tab AI thứ nhất, bấm toolbar và chọn profile A.
2. Mở tab AI thứ hai, bấm toolbar và chọn profile B.
3. Cả hai content runtime tiếp tục tồn tại độc lập.
4. Sidebar có selectbox liệt kê tất cả session đang theo dõi.
5. Pause/resume/stop, profile và lưu cấu hình đều gửi kèm `tabId`.
6. “Lưu vào profile” cập nhật các tab đang dùng profile đó ở chế độ profile.
7. “Lưu riêng cho tab” chuyển tab sang `configMode=tab`; thay đổi profile sau đó không ghi đè tab này.
8. “Tab dùng lại profile” bỏ cấu hình riêng và quay về profile hiện tại.

## Quyền Firefox bổ sung

- `storage`: lưu profile.
- `tabs`: đọc tiêu đề/URL để hiển thị danh sách tab.
- `sessions`: gắn session data vào từng tab.

Add-on vẫn chỉ inject source trang sau thao tác trực tiếp bằng toolbar/active tab; không khai báo host permission toàn cục.

## Giới hạn Phase 02

- Chưa theo dõi `MutationObserver`.
- Chưa tạo baseline element.
- Chưa tự click.
- Chưa chạy shell.
- Các trường liên quan đã được lưu đúng schema để các phase sau sử dụng.

## Kiểm thử thủ công

1. Kích hoạt hai tab HTTP/HTTPS khác nhau.
2. Xác nhận sidebar hiển thị cả hai session.
3. Pause tab thứ nhất và kiểm tra tab thứ hai vẫn active.
4. Gán hai profile khác nhau.
5. Lưu cấu hình riêng cho một tab, sửa profile và xác nhận tab riêng không bị ghi đè.
6. Reload sidebar và xác nhận danh sách/profile vẫn còn.
7. Dừng một tab và xác nhận session còn lại không thay đổi.


## Hotfix v0.2.1 — quyền kích hoạt từ sidebar

Nút “Kích hoạt tab hiện tại” nằm trong sidebar không tự nhận quyền tạm thời `activeTab` giống thao tác bấm biểu tượng toolbar. Bản v0.2.1 khai báo `optional_host_permissions` và gọi `browser.permissions.request()` trực tiếp từ click handler của sidebar.

- Chỉ xin quyền cho hostname của tab đang kích hoạt, không tự động đọc mọi website.
- Firefox hỏi quyền một lần cho mỗi website; quyền đã cấp được dùng cho các tab khác cùng website.
- Session runtime vẫn độc lập theo `tabId`; việc dùng chung host permission không làm dùng chung profile, trạng thái, baseline, badge hay log.
- Toolbar vẫn có thể dùng `activeTab` mà không cần quyền host lâu dài.
- Nếu người dùng từ chối, add-on giữ tab ở trạng thái chưa kích hoạt và hiển thị lỗi rõ ràng.


## Hotfix v0.2.2 — sidebar đồng bộ theo active tab

Sidebar trước đây giữ `selectedTabId` cũ miễn tab đó vẫn có trong danh sách session. Vì vậy khi người dùng chuyển từ tab 1 sang tab 2, giao diện vẫn hiển thị session của tab 1 và nút “Kích hoạt tab hiện tại” bị vô hiệu hóa sai.

Bản v0.2.2 áp dụng các nguyên tắc sau:

- Background gửi chính xác `activeInfo.tabId` cùng sự kiện `active-tab-changed`.
- Sidebar ép chọn tab vừa trở thành active và nạp lại profile, cấu hình, mode cùng các nút thao tác của riêng tab đó.
- Các thay đổi khác như cập nhật title/profile vẫn giữ lựa chọn thủ công trong selectbox, không giật sidebar về tab active một cách không cần thiết.
- Dùng sequence number để bỏ qua phản hồi cũ nếu người dùng chuyển tab liên tiếp quá nhanh.
- Yêu cầu kích hoạt mang theo `tabId` tại thời điểm bấm nút, nên không thể vô tình kích hoạt nhầm tab nếu active tab đổi trong lúc Firefox đang hỏi quyền.
- Session runtime vẫn nằm độc lập trong `Map<tabId, session>`; hotfix chỉ sửa lớp đồng bộ giao diện, không gộp trạng thái giữa các tab.
