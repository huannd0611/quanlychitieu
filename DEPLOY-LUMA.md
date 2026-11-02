# Đưa Luma Studio lên mạng

Mã đã được chuẩn bị trên nhánh **`codex/luma-studio`** của repository này. Không cần tải từng tệp, cài Python hoặc cấu hình Docker trên máy của bạn.

1. Mở [Render Dashboard](https://dashboard.render.com), đăng nhập bằng GitHub.
2. Chọn **New → Blueprint**, kết nối repository **`huannd0611/quanlychitieu`**.
3. Chọn **Branch: `codex/luma-studio`**, **Blueprint Path: `render.yaml`**. Đặt tên nhóm, ví dụ `Luma Studio`.
4. Nhập các khóa được biểu mẫu yêu cầu: `LUMA_VIDEO_KEY` là khóa fal.ai để tạo video từ ảnh; `LUMA_AI_KEY` là khóa OpenAI để hiểu nội dung mẫu. Nếu biểu mẫu cho phép để trống, bạn có thể thử phần biên tập trước, nhưng chưa tạo được video AI thật.
5. Xem lại dịch vụ và chọn **Apply / Deploy**. Chỉ xác nhận sau khi đã xem điều kiện và chi phí hiển thị trong tài khoản của bạn.
6. Đợi **Live**, mở URL HTTPS mà Render cấp. Đó là link dùng chung trên Windows và điện thoại.

Đăng nhập website bằng username **`luma`**. Mật khẩu ứng dụng được Render tự tạo trong biến **`LUMA_APP_PASSWORD`**; xem nó trong mục Environment của dịch vụ và giữ riêng.

Blueprint mặc định dùng **Free để thử**, có thể ngủ khi không hoạt động và giới hạn tài nguyên. Tạo video AI tính phí riêng ở nhà cung cấp. Không có hosting hoặc khóa API nào được cung cấp kèm mã nguồn.

Nếu bạn không thấy lựa chọn Branch hoặc Blueprint Path, xem [cách tạo Web Service thủ công](video-studio/DEPLOY.md).

**Trạng thái:** mã và cấu hình triển khai đã chuẩn bị. Tệp này không chứng minh dịch vụ đã được tạo trên tài khoản Render hay đang Live. Không đưa khóa API vào GitHub hoặc chat.
