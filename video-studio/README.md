# Luma Studio — ảnh thành video AI, dựng theo video mẫu

Ứng dụng web tiếng Việt cho TikTok/Reels. Tải tư liệu, chọn video mẫu và nêu ý tưởng; luồng tự động phân tích mẫu, lập kế hoạch, tạo cảnh AI khi được chọn, rồi hoàn thiện timeline và xuất video. Ứng dụng FamilyMoney ở thư mục cha được giữ nguyên.

## Hai cách sử dụng

- **Windows:** giải nén gói tải về, cài Python 3.10+, nhấp đúp `START-WINDOWS.cmd`. Xem [hướng dẫn Windows](windows/WINDOWS.md).
- **Mở bằng link trên điện thoại:** triển khai Docker lên Render, đặt mật khẩu và khóa AI trong Environment của hosting. Xem [hướng dẫn Render](DEPLOY.md). Chưa có link công khai cho tới khi tài khoản hosting triển khai thành công.
- Bộ đóng gói không chứa khóa API. `python3 tools/package.py --output <thư-mục>` tạo ZIP Windows và ZIP hosting từ danh sách tệp nguồn được cho phép.

## Chạy ứng dụng

Yêu cầu Python 3.10+; không cần npm install hoặc build. MP4 cần `ffmpeg` và `ffprobe` có trong PATH (môi trường này đã có).

```sh
cd /workspace/quanlychitieu/video-studio
python3 -B server.py --port 8081
```

Máy chủ phát triển lắng nghe tại `127.0.0.1:8081`, trang ở đường dẫn `/`. Máy chủ tĩnh thông thường chỉ hỗ trợ trình biên tập cục bộ, không có API tự động, AI hoặc chuyển MP4.

## Luồng “Ảnh → Video AI”

Mở nút **Ảnh → Video AI** trên thanh đầu trang. Có hai chế độ:

### 1. Ảnh thành video AI — tạo chuyển động mới

1. Chọn ảnh nguồn từ thiết bị hoặc thư viện. Ảnh là khung bắt đầu để mô hình tạo chuyển động chủ thể/môi trường.
2. Thêm video mẫu nếu muốn tham khảo nhịp dựng, màu và bố cục. Không có mẫu vẫn tạo được video từ ảnh và ý tưởng.
3. Mô tả chủ thể, chuyển động, góc máy, cảm xúc, nội dung chữ; chọn tối đa 1–4 cảnh mỗi lượt (mặc định 1). Mỗi lượt tạo cảnh là API có phí, không hiển thị giá cố định do giá tùy nhà cung cấp.
4. Đồng ý gửi ảnh và mô tả cho dịch vụ rồi chọn **Tạo video AI từ ảnh**.
5. Ứng dụng lập kế hoạch, tạo từng cảnh bằng fal.ai/Kling, nhận clip chuyển động thực rồi áp dụng vào timeline. Có thể tự xuất sau khi dựng xong.

Dịch vụ dùng model `fal-ai/kling-video/v2.1/standard/image-to-video`, tạo clip 5 hoặc 10 giây. Ảnh được chuẩn bị theo tỉ lệ của bản dựng; khung hình có thể bị cắt để vừa tỉ lệ. Đây là tích hợp tạo video AI thực, khác với chuyển động phóng ảnh trong trình biên tập. Kết quả phụ thuộc mô hình, quyền truy cập tài khoản và tư liệu; không bảo đảm sao chép chính xác mọi chuyển động/hiệu ứng trong mẫu.

### 2. Dựng tư liệu theo mẫu — ghép ảnh/video hiện có

1. Chọn ảnh/video nguồn; video mẫu được thêm riêng và không tự biến thành cảnh nguồn.
2. Thêm mẫu tham chiếu dài 0,5–120 giây, tối đa 250 MB.
3. Nêu ý tưởng và chọn **Dựng tự động theo mẫu**.

Phân tích mẫu lấy tối đa 120 khung theo thời gian ngay trong trình duyệt, phát hiện điểm đổi cảnh, đo thời lượng đoạn, nhịp, tỉ lệ, độ sáng và độ bão hòa. Dựng cục bộ dùng các số đo này để khớp nhịp cắt, lặp/sắp tư liệu và chọn bộ lọc; nó không phải AI hiểu nội dung và không tạo chuyển động chủ thể mới từ ảnh.

Nếu OpenAI được cấu hình và bạn đồng ý, AI xem tối đa 8 khung tham chiếu có timestamp và 2 khung cho mỗi tư liệu để lập thứ tự cảnh, điểm cắt, tốc độ, vị trí/màu chữ, chuyển cảnh và prompt tạo chuyển động. Kết quả được kiểm tra nguồn, thời lượng và điểm trim trước khi thay timeline. Tối đa 12 tư liệu và 30 cảnh cho chế độ dựng theo mẫu. Với mẫu dài/cắt dày hoặc nguồn quá ngắn, bản dựng bị giới hạn bởi các mức này, không cam kết giữ nguyên thời lượng mẫu.

## Kết nối dịch vụ AI

Cấu hình biến/secrets **trên máy chủ**, không nhập khóa vào giao diện, mã nguồn, Git hoặc chat:

| Biến | Mục đích | Kết nối |
| --- | --- | --- |
| `LUMA_VIDEO_KEY` | Khóa fal.ai, bắt buộc để ảnh thành video chuyển động AI | `queue.fal.run` |
| `LUMA_AI_KEY` | Khóa OpenAI, để hiểu nội dung ảnh/mẫu và lập bản dựng bằng AI | `api.openai.com` |
| `LUMA_AI_MODEL` | Tùy chọn, mặc định `gpt-4.1-mini` | Responses API, ảnh + structured outputs |

Cho phép HTTPS đến `api.openai.com`, `queue.fal.run`, `fal.media` và `*.fal.media` trong môi trường giới hạn mạng; giữ proxy và CA có sẵn, không tắt xác minh TLS. Khởi động lại máy chủ sau khi thêm biến.

Có thể chỉ dùng `LUMA_VIDEO_KEY`: ứng dụng dùng kế hoạch theo quy tắc và gọi Kling để tạo chuyển động thật. Để AI hiểu ngữ nghĩa của video mẫu và ảnh, cần cả `LUMA_AI_KEY`. Không có hai khóa vẫn dùng dựng theo số đo mẫu cục bộ.

- Không gửi gì đến API khi chỉ mở trang, xem trước hoặc dùng dựng nhanh cục bộ.
- Chỉ gọi dịch vụ khi người dùng chọn dựng, có cấu hình và đã đồng ý gửi dữ liệu.
- AI phân tích nhận ý tưởng, metadata, ảnh thu nhỏ JPEG/PNG; không gửi toàn bộ video mẫu hoặc nhạc nền. Chế độ tạo video gửi ảnh đầu vào được chuẩn bị và mô tả chuyển động tới fal.ai.
- Khóa luôn ở máy chủ. Trạng thái “đã cấu hình” chỉ cho biết có biến, không chứng minh khóa/hạn mức/quyền model hợp lệ.
- Ảnh nguồn tối đa 5 MB sau chuẩn bị; request tối đa 8 MB. API chỉ gọi endpoint cố định, chỉ tải kết quả từ HTTPS `fal.media` và các tên miền con, không chuyển khóa vào CDN.
- Trạng thái từng cảnh lấy từ hàng đợi thực, không giả tiến độ. Chờ tối đa 15 phút/lần; có thể thử lại để theo dõi cùng tác vụ. Mã yêu cầu chống tạo trùng trong vòng đời máy chủ. Nếu lần gửi bị mất phản hồi, ứng dụng dừng gửi lại để tránh phát sinh lượt phí trùng.
- Hủy gửi yêu cầu dừng tới nhà cung cấp, không bảo đảm hoàn phí hoặc ngừng ngay. Tác vụ và cache chống trùng hiện ở bộ nhớ phiên/máy chủ, không phục hồi qua khởi động lại. Không xóa/refresh phiên trong khi có tác vụ đang chờ nếu muốn tiếp tục theo dõi.
- Timeline cũ chỉ bị thay khi mọi cảnh hoàn tất và kế hoạch hợp lệ. Có thể hoàn tác; các clip tạo thành công vẫn nằm trong thư viện để tái sử dụng.

**Tình trạng xác minh:** chưa có khóa API trong môi trường này nên chưa chạy một lượt tạo video AI trả phí thật. Phân tích mẫu, biên tập, MP4 và luồng hàng đợi/nhận clip đã được kiểm thử; nhà cung cấp AI được giả lập trong kiểm thử.

## Trình biên tập và xuất

- 9:16, 16:9, 1:1; các mẫu Reels/điện ảnh/sản phẩm/nhật ký; 5 ảnh minh họa vector gốc.
- JPEG/PNG/WebP/AVIF, MP4/WebM, MOV tùy codec; nguồn tối đa 250 MB/tệp, 100 tư liệu/thư viện. Luồng tự động nhận tối đa 12 tư liệu mỗi bản dựng.
- Kéo sắp xếp, tách, xóa, nhân đôi; thời lượng 0,5–30 giây/cảnh; tối đa 60 cảnh thủ công; trim và tốc độ theo kế hoạch AI.
- Bộ lọc, chữ/vị trí/màu, hòa tan/cắt thẳng, phóng/thu ảnh. Chuyển động ảnh cục bộ không phải AI tạo video.
- Nhạc nền riêng, tối đa 50 MB, lặp nhạc và âm lượng. Âm thanh gốc của clip không được dùng; không tự sao chép nhạc từ mẫu.
- Tự lưu một dự án và tư liệu bằng IndexedDB trong trình duyệt, không đồng bộ tài khoản/thiết bị. Xóa dữ liệu trình duyệt sẽ xóa dự án.
- Xuất 720p/1080p, 30 fps: WebM trong trình duyệt; MP4 ghi trực tiếp khi trình duyệt có codec, hoặc chuyển qua máy chủ FFmpeg (H.264/AAC), tối đa 180 giây cho bản chuyển. Giữ tab hiển thị trong lúc ghi hình; chuyển tab sẽ hủy để tránh thiếu khung hình. Tự xuất tạo tệp sẵn tải về; trình duyệt vẫn yêu cầu chọn tải file.
- Nếu không có máy chủ chuyển MP4, bản WebM hoàn tất vẫn có thể tải, định dạng thực được ghi rõ.

Mặc định máy chủ chỉ chạy cục bộ. Chế độ `--public --host 0.0.0.0` dành cho hosting sau HTTPS, cần URL chính xác trong `LUMA_PUBLIC_ORIGIN` hoặc `RENDER_EXTERNAL_URL` và `LUMA_APP_PASSWORD` tối thiểu 12 ký tự. Đăng nhập bằng username `luma`; trang và API đều được bảo vệ, riêng `/healthz` chỉ trả trạng thái đơn giản. Bản hosting dành cho chủ tài khoản sử dụng riêng, chưa có hệ thống nhiều người dùng hoặc lưu job bền vững.

## Kiểm thử

```sh
python3 -B -m unittest discover -s tests -p 'test_*.py' -v
node --check studio.js
node --check auto.js
node --check reference.js
node tests/browser-smoke.cjs
node tests/reference-browser.cjs
node tests/auto-browser.cjs
node tests/mobile-codec.cjs
```

Các bài trình duyệt cần Node.js, Playwright và Chromium; mặc định máy chủ ở cổng 8081. Dùng `STUDIO_URL` và `CHROMIUM_PATH` để thay địa chỉ hoặc executable.

Kiểm thử dùng ảnh/video/nhạc thật được tạo trong browser: phát hiện điểm đổi cảnh, các khung thời gian, trim/lưu/khôi phục, đồng ý gửi ảnh, tạo tác vụ, tiếp tục tác vụ cũ sau lỗi, hủy, nhận video chuyển động và xuất tệp phát lại được. API AI dùng phản hồi giả lập, không gọi dịch vụ trả phí.
