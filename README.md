# FamilyMoney V2.0 – Web + PWA, kết nối gia đình

## Đã có trong bản này

- Giao diện tiếng Việt, hoạt động trên laptop/điện thoại.
- Chế độ **Mẫu** để thử ngay, lưu vào localStorage của trình duyệt.
- **Supabase Auth**: đăng ký và đăng nhập bằng email + mật khẩu, xác nhận email.
- **Cơ sở dữ liệu thật**: nhóm gia đình, thành viên, lời mời qua email, ví riêng/chung, thu chi, chuyển tiền, ngân sách chung, mục tiêu chung.
- Phân quyền **Row-Level Security (RLS)**: thành viên thấy ví chung và ví riêng của chính mình, không thấy ví riêng của người khác.
- Đồng bộ qua Supabase: tải lại khi mở trang, nút **Làm mới** và làm mới tự động mỗi 30 giây khi tab đang mở.
- Xuất CSV/JSON, tổng quan và phân tích theo quy tắc.
- PWA có manifest và service-worker: có thể thêm biểu tượng ra màn hình chính khi chạy trên HTTPS. Native Android/iOS vẫn là bước phát triển tiếp theo.

## A. Dùng thử ngay – không cần tạo tài khoản

1. Giải nén file ZIP.
2. Mở `index.html` bằng Chrome/Edge/Safari. Nếu trình duyệt giới hạn nội dung với file `file://`, chạy ở thư mục này: `python -m http.server 8080`, sau đó truy cập `http://localhost:8080`.
3. Thêm giao dịch, thêm ví, đặt ngân sách, xem số liệu. Chế độ mẫu không đồng bộ với người khác.

## B. Bật đăng nhập & đồng bộ thật

1. Tạo **project Supabase** tại https://supabase.com/dashboard (project này thuộc quyền quản lý của bạn).
2. Vào **SQL Editor** → tạo query → dán toàn bộ nội dung `supabase/schema.sql` → Run. Chạy trên *project mới* vì migration tạo bảng và trigger.
3. Vào **Authentication → Providers → Email**, bật email/password và **Confirm email**. Thiết lập **URL Configuration**/redirects ứng với domain sẽ host ứng dụng. Đối với thử nghiệm hãy dùng server local hoặc một HTTPS origin do bạn kiểm soát.
4. Vào **Project Settings / Connect / API Keys** (tên mục có thể thay đổi trong Supabase), sao chép **Project URL** và **publishable key** (hoặc legacy **anon key**).
5. Mở `config.js` và cập nhật:

   ```js
   window.FM_CONFIG = {
     supabaseUrl: 'https://YOUR-PROJECT.supabase.co',
     supabaseKey: 'YOUR_PUBLISHABLE_OR_ANON_KEY'
   };
   ```

   `publishable/anon` key được dùng cho trình duyệt và **không phải** khóa bí mật. **TUYỆT ĐỐI KHÔNG** đặt `service_role`, secret key hoặc `OPENAI_API_KEY` ở đây.

6. Đăng ứng dụng tĩnh trên **Netlify, Vercel, Cloudflare Pages hoặc HTTPS web hosting** (chỉ cần toàn bộ file nằm cùng thư mục). Để thử local, chạy `python -m http.server 8080`.
7. Mở link ứng dụng, đăng ký tài khoản A, xác minh email, tạo gia đình → tạo ví **chung**, nhập chi tiêu.
8. Ở mục **Gia đình**, tạo lời mời bằng email của B. **Lưu ý:** chưa có gửi email tự động; bạn cần nhắn cho B link ứng dụng.
9. B mở cùng URL, đăng ký bằng **chính email được mời**, xác minh email, đăng nhập, chấp nhận lời mời → sẽ xem được ví/giao dịch **chung**.
10. Kiểm tra B **không** nhìn thấy ví riêng hoặc giao dịch thuộc ví riêng của A. A và B có thể thêm giao dịch chung.

**Quan trọng:** Nếu không tạo được tài khoản, kiểm tra cấu hình Authentication/Email trong Supabase, email xác nhận, giới hạn gửi email và domain redirect. Nếu SQL lỗi, xem thông báo từ SQL Editor. Không nhập dữ liệu thật trước khi kiểm tra RLS bằng hai tài khoản khác nhau.

## C. Trình tự kiểm thử quyền truy cập

- Tài khoản A: tạo gia đình, ví chung `Quỹ chung` và ví riêng `Ví A`, thêm mỗi ví một giao dịch.
- Tài khoản A: mời email tài khoản B.
- Tài khoản B: xác minh email, chấp nhận lời mời, kiểm tra có `Quỹ chung`, không có `Ví A`; tạo `Ví B` riêng.
- Tài khoản A: làm mới, phải thấy giao dịch chung do B thêm, nhưng không thấy `Ví B`.
- B không thể sửa ngân sách/mục tiêu chung (chỉ admin quản lý).
- B không thể chuyển tiền từ ví chung sang ví riêng, hoặc truy cập ví của người khác.
- Không được đăng nhập bằng account chưa xác minh email để chấp nhận lời mời.

## D. Những gì bản V2 chưa có

- **Chưa phải ứng dụng native Android/iOS**; V2 là responsive Web App/PWA. Native sẽ dùng API/dữ liệu đã tạo.
- **Chưa gọi AI thật**: mục Phân tích hiện chỉ là quy tắc trên dữ liệu. AI thực yêu cầu Edge Function/backend và OpenAI API key lưu trong secret máy chủ.
- Chưa có gửi email lời mời tự động, reset mật khẩu trong giao diện, cập nhật/xóa ví, sửa giao dịch, chức năng hạch toán công nợ.
- Chưa cung cấp hệ thống sao lưu server chuyên biệt, quản lý quyền đầy đủ, báo cáo dài hạn, kiểm thử production, hoặc kiểm toán bảo mật độc lập.
- Ứng dụng chỉ lấy tối đa **1.000 giao dịch mới nhất** cho mỗi gia đình mỗi lượt tải, chưa phân trang. Báo cáo tháng có thể thiếu nếu quá ngưỡng này.
- Khi mở file ZIP mà không cấu hình Supabase, dữ liệu **không đồng bộ giữa các máy**.

## E. Bảo mật

- RLS nằm trong `supabase/schema.sql`; các truy vấn dữ liệu từ client được lọc theo user đăng nhập.
- Admin **không** có quyền đọc ví cá nhân của người khác.
- Lời mời được đối chiếu với **email đã xác minh trong auth.users**, không tin dữ liệu email người dùng tự nhập trên frontend.
- App escape nội dung người dùng trước khi hiển thị HTML.
- Để vận hành thực tế: bật MFA khi thích hợp, giám sát truy cập, backup DB, xem lại và kiểm thử SQL policy, triển khai domain HTTPS; chỉ gửi cho AI dữ liệu khi có sự đồng ý rõ ràng.

## F. Các thư mục

- `index.html`, `style.css`, `app.js`: giao diện và logic.
- `config.js`: URL + Supabase publishable/anon key.
- `supabase/schema.sql`: cơ sở dữ liệu, trigger, RLS.
- `manifest.webmanifest`, `service-worker.js`, `icon.svg`: khả năng PWA.

Bản chạy thử độc lập, không ghi đè FamilyMoney V1. Dữ liệu V1 **không tự động chuyển** sang V2; hãy lưu bản sao lưu V1 trước khi di chuyển dữ liệu.
