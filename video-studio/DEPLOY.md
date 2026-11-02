# Mở Luma Studio bằng link trên điện thoại

Bộ triển khai này tạo một website có HTTPS, dùng được trên máy tính và điện thoại. Chưa có website công khai được tạo tự động: bạn cần tài khoản hosting và đưa mã nguồn lên repository GitHub của mình. **Publish môi trường Codex không tạo website trên Render.**

## Cách dễ nhất: Render

Bạn cần tài khoản [Render](https://render.com), repository GitHub chứa thư mục `video-studio`, và khóa AI nếu muốn tạo video AI thật. Hosting và API có thể tính phí riêng; xem giá hiện tại trong tài khoản trước khi tạo dịch vụ. Blueprint mặc định chọn **Free** để chạy thử. Gói này có thể ngủ khi không sử dụng, giới hạn tài nguyên và không lưu job qua lần khởi động lại. API tạo video vẫn có phí riêng; xem điều kiện hiện tại trong Render trước khi triển khai.

### 1. Đưa mã nguồn lên GitHub

Trong repository `huannd0611/quanlychitieu`, thư mục `video-studio` cần chứa các tệp của bản này, gồm `Dockerfile` và `server.py`. Nếu tải gói ZIP, giải nén trước rồi đưa **cả thư mục `video-studio`** lên GitHub để giữ đúng đường dẫn. Không tải tệp `.env` hoặc khóa API lên repository.

Các tệp trong workspace chưa tự xuất hiện trên GitHub cho tới khi được commit và push hoặc tải lên bằng giao diện GitHub. Nếu bạn nhờ người khác triển khai, chỉ cấp quyền repository cần thiết và nhập khóa qua bảng Environment của hosting.

### 2. Tạo Web Service

Trong Render chọn **New → Web Service**, kết nối GitHub và chọn repository:

| Mục | Giá trị |
| --- | --- |
| Branch | Nhánh đã chứa mã mới, thường là `main` |
| Root Directory | `video-studio` |
| Runtime / Language | `Docker` |
| Dockerfile Path | `./Dockerfile` |
| Docker Build Context | `.` |
| Health Check Path | `/healthz` |

Chọn vùng Singapore nếu phù hợp vị trí sử dụng. Chọn gói đủ tài nguyên cho xử lý MP4; bản Blueprint mặc định dùng Free để thử; bạn có thể nâng cấp sau khi xem giá. Nếu Render hiển thị trường Docker Command, để trống để dùng lệnh trong Dockerfile.

### 3. Nhập biến môi trường

Trong mục **Environment** của dịch vụ nhập:

| Tên | Giá trị bạn cần nhập |
| --- | --- |
| `LUMA_APP_PASSWORD` | Mật khẩu riêng ít nhất 12 ký tự, khó đoán, để đăng nhập website |
| `LUMA_VIDEO_KEY` | Khóa fal.ai có quyền và số dư để tạo video |
| `LUMA_AI_KEY` | Khóa OpenAI để phân tích ảnh/video mẫu và lập bản dựng |
| `LUMA_AI_MODEL` | `gpt-4.1-mini` hoặc model phù hợp tài khoản |

`PORT` mặc định là `10000`. Render tự cấp `RENDER_EXTERNAL_URL`; máy chủ dùng URL HTTPS này để kiểm tra đúng tên miền. Chưa cần mua domain. Nếu dùng domain riêng sau này, đặt `LUMA_PUBLIC_ORIGIN` bằng URL HTTPS chính xác của domain đó, ví dụ `https://studio.example.com`.

Nhập khóa ở bảng Environment, không đưa vào mã nguồn hoặc chat. Nếu chỉ muốn thử trình biên tập trước, có thể để các khóa AI trống; khi đó chưa tạo được chuyển động AI từ ảnh.

### 4. Deploy và mở trên điện thoại

Chọn **Create Web Service / Deploy** và đợi trạng thái **Live**. Render sẽ hiển thị URL dạng HTTPS do chính dịch vụ cấp. Đó là link để bạn mở trên điện thoại hoặc máy tính.

Khi trình duyệt hỏi đăng nhập:

- Tên người dùng: **`luma`**.
- Mật khẩu: giá trị **`LUMA_APP_PASSWORD`** bạn đã đặt.

Sau đó chọn **Ảnh → Video AI**, tải ảnh, thêm video mẫu nếu muốn, nhập ý tưởng và chọn chế độ tạo hoặc dựng. Khóa AI được giữ ở máy chủ, không nhập vào trang biên tập.

Khuyến nghị dùng Chrome/Edge bản mới trên Windows hoặc Chrome trên Android. Trình duyệt điện thoại có thể hạn chế codec, ghi canvas và hoạt động nền; nếu xuất video trên Safari không khả dụng, mở cùng dịch vụ bằng Chrome/Edge trên máy tính. Giữ tab hiển thị khi xuất. Dự án được lưu trong trình duyệt của từng thiết bị, **chưa tự đồng bộ giữa máy tính và điện thoại**.

## Dùng Blueprint thay cho nhập từng mục

Tệp `render.yaml` ở gốc repository được nút triển khai sử dụng. `video-studio/render.yaml` là bản sao cho trường hợp chọn Blueprint Path riêng. Trong Render chọn **New → Blueprint**, repository của bạn và đặt **Blueprint Path** là `video-studio/render.yaml` nếu giao diện cung cấp trường này. Nếu không thấy trường đường dẫn, dùng cách Web Service ở trên.

Blueprint tự tạo `LUMA_APP_PASSWORD`; xem giá trị trong Environment của dịch vụ và giữ riêng để đăng nhập với username `luma`. Các khóa AI vẫn cần bạn nhập. Đường dẫn Blueprint được viết cho cấu trúc repository có thư mục `video-studio`; nếu chuyển toàn bộ nội dung ứng dụng ra gốc repository khác, bỏ `rootDir: video-studio` trong bản Blueprint của repository đó.

## Chạy bằng Docker trên VPS

Cần VPS đã cài Docker và reverse proxy HTTPS (ví dụ Caddy/Nginx). Build trong thư mục `video-studio`:

```sh
docker build -t luma-studio .
```

Cấu hình các biến `LUMA_APP_PASSWORD`, `LUMA_VIDEO_KEY`, `LUMA_AI_KEY`, `LUMA_PUBLIC_ORIGIN` bằng trình quản lý secrets/biến môi trường của VPS. Sau đó chạy container, chỉ chuyển tiếp cổng qua reverse proxy trên cùng máy:

```sh
docker run -d --name luma-studio --restart unless-stopped \
  -p 127.0.0.1:10000:10000 \
  -e LUMA_APP_PASSWORD -e LUMA_VIDEO_KEY -e LUMA_AI_KEY \
  -e LUMA_PUBLIC_ORIGIN luma-studio
```

Reverse proxy cần chuyển Host và HTTPS scheme đúng theo URL đã cấu hình, cho phép request khoảng 110 MB và timeout đủ dài cho xuất MP4. Không mở cổng container trực tiếp ra Internet bằng HTTP: đăng nhập Basic cần HTTPS do hosting/reverse proxy cung cấp.

Container chạy bằng user không có quyền root, có FFmpeg/FFprobe để xuất MP4. Khóa không được đóng vào image. Dịch vụ giữ các tác vụ AI đang chờ trong bộ nhớ: tránh redeploy/restart khi đang tạo cảnh; bản này chưa có cơ sở dữ liệu tác vụ bền vững hoặc nhiều tài khoản riêng.

## Nếu gặp lỗi

- **Deploy không khởi động:** kiểm tra Root Directory, Dockerfile và `LUMA_APP_PASSWORD`; chế độ public cần mật khẩu và đúng public origin.
- **Trang báo sai Host/Origin:** dùng đúng link Render; nếu có custom domain, sửa `LUMA_PUBLIC_ORIGIN` theo URL HTTPS đang dùng rồi redeploy.
- **Không đăng nhập được:** username luôn là `luma`; kiểm tra mật khẩu trong Environment và thử cửa sổ riêng tư nếu trình duyệt đang giữ thông tin cũ.
- **AI chưa sẵn sàng:** kiểm tra các biến khóa, quyền model, số dư và log trạng thái đã được ứng dụng lọc. Không đăng khóa/log chứa thông tin riêng lên chat.
- **Xuất MP4 quá thời gian:** giảm độ phân giải hoặc thời lượng, chọn WebM hoặc tăng tài nguyên hosting. MP4 giới hạn 180 giây/100 MB đầu vào.

Không có bước nào trong tài liệu chứng minh dịch vụ đã Live hoặc một lượt AI trả phí đã thành công. Hãy kiểm tra link, đăng nhập và thử chức năng sau khi chính tài khoản hosting báo deploy hoàn tất.
