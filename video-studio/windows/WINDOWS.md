# Dùng Luma Studio trên Windows

Đây là bộ mã nguồn có chương trình khởi động bằng cách nhấp đúp, không phải tệp EXE kèm sẵn Python. Không cần Node.js, npm hoặc thao tác build.

## Lần đầu

1. Tải và cài **Python 3.10 trở lên** từ https://www.python.org/downloads/windows/. Khi cài, chọn **Add python.exe to PATH** nếu tùy chọn xuất hiện.
2. Tải gói Luma Studio, bấm phải tệp ZIP → **Extract All / Giải nén tất cả**. Giữ nguyên các thư mục và tệp bên trong; không chạy trực tiếp trong ZIP.
3. Mở thư mục đã giải nén và nhấp đúp **START-WINDOWS.cmd**.
4. Cửa sổ khởi động sẽ hỏi khóa fal.ai và OpenAI nếu chưa có trong biến môi trường. Nội dung bạn gõ được ẩn. Nhấn Enter để bỏ qua từng khóa nếu chỉ muốn thử biên tập cục bộ.
5. Trình duyệt tự mở khi máy chủ sẵn sàng. Nếu trình duyệt chưa mở, nhập `127.0.0.1:8081` vào thanh địa chỉ Chrome/Edge.

Chương trình khởi động chỉ chuyển khóa vào tiến trình máy chủ của lần chạy này, không lưu khóa vào tệp. Không dán khóa trong chat hoặc mã nguồn. Nếu đã đặt `LUMA_VIDEO_KEY` / `LUMA_AI_KEY` trong biến môi trường, chương trình dùng cấu hình có sẵn.

## Tạo video

1. Chọn **Ảnh → Video AI** ở đầu trang.
2. Chọn **Ảnh thành video AI** để tạo chuyển động mới từ ảnh, hoặc **Dựng tư liệu theo mẫu** để chỉnh các ảnh/video sẵn có.
3. Tải ảnh nguồn, thêm video mẫu nếu muốn và nhập ý tưởng.
4. Với tạo chuyển động AI, cần tài khoản fal.ai có số dư và `LUMA_VIDEO_KEY`. `LUMA_AI_KEY` bổ sung AI hiểu nội dung của ảnh/video mẫu. Việc tạo cảnh có thể phát sinh phí nhà cung cấp.
5. Xem bản dựng, chỉnh thêm nếu cần và xuất video. Giữ tab và cửa sổ khởi động mở trong lúc làm việc.

Không có khóa vẫn dựng theo nhịp đo từ video mẫu và chỉnh sửa cục bộ. Chế độ đó không tạo chuyển động chủ thể mới bằng mô hình AI.

## Xuất MP4

Trình duyệt mới có codec MP4 sẽ ghi MP4 trực tiếp, không cần cài thêm. Nếu trình duyệt chưa có codec MP4, máy chủ cần **FFmpeg và FFprobe** trong biến `PATH` để chuyển từ WebM. Xem https://ffmpeg.org/download.html để chọn bản Windows từ nguồn được dự án hướng dẫn; sau cài đặt, mở cửa sổ khởi động mới. Chương trình không tự tải hoặc chạy bộ cài từ nguồn khác.

Nếu FFmpeg chưa có, có thể xuất WebM trước; giao diện ghi rõ định dạng thực. Dùng bản website đã triển khai có FFmpeg sẽ không cần cài trên Windows.

## Dừng và chạy lại

- Chờ tác vụ AI và xuất video hoàn tất, sau đó nhấn **Ctrl+C** trong cửa sổ khởi động. Nhấp đúp `START-WINDOWS.cmd` để chạy lại.
- Dự án được lưu trong trình duyệt này; xóa dữ liệu trình duyệt sẽ xóa dự án. Không tự đồng bộ với bản website trên điện thoại.
- Nếu đúng Luma đang chạy ở cổng đã chọn, chương trình mở lại ứng dụng hiện có và không khởi động thêm máy chủ.
- Nếu cổng 8081 đang do ứng dụng khác dùng, chương trình không tắt ứng dụng đó. Mở Terminal ở thư mục Luma và chạy `START-WINDOWS.cmd --port 8082` rồi dùng địa chỉ `127.0.0.1:8082`.

Các tùy chọn khi đã có cấu hình sẵn:

```bat
START-WINDOWS.cmd --no-prompt --port 8081
START-WINDOWS.cmd --no-prompt --no-browser --port 8082
```

Chương trình nhận cả `-NoPrompt`, `-NoBrowser` và `-Port` nếu dùng quen cách viết PowerShell. Không có lệnh thay đổi Execution Policy hoặc cài phần mềm tự động.

## Điện thoại

Địa chỉ `127.0.0.1` chỉ thuộc chính máy đang mở trình duyệt. Bản Windows hiện chỉ lắng nghe trên máy Windows đó; nhập địa chỉ này vào điện thoại không kết nối được máy tính. Để mở trên điện thoại, dùng **đường dẫn HTTPS công khai của bản triển khai**. Đó là một bản chạy riêng, cần cấu hình khóa ở máy chủ hosting; các khóa nhập trong cửa sổ Windows không được tự chuyển lên hosting.

Máy chủ của chương trình khởi động này chỉ dành cho sử dụng cục bộ. Không tự mở cổng router hoặc đổi địa chỉ lắng nghe để công khai máy tính.
