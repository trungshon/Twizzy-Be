# Twizzy Backend (API Server)

Đây là mã nguồn Backend của dự án mạng xã hội Twizzy, được xây dựng bằng **Node.js**, **Express**, **TypeScript**, và hệ cơ sở dữ liệu **MongoDB**. Hệ thống cũng tích hợp công nghệ AI (Gemini API) cho việc tìm kiếm nâng cao, kiểm duyệt nội dung và đề xuất bài đăng.

---

## 🚀 Tính năng nổi bật của Backend
- **Xác thực người dùng**: JWT Access/Refresh token, Google OAuth 2.0, Xác thực OTP qua Email.
- **Mạng xã hội**: Tạo bài viết (Twizz), like, bookmark, comment, quote, follow.
- **Realtime Chat & Notification**: Tích hợp Socket.io cho phòng chat thời gian thực và Firebase Cloud Messaging (FCM) để gửi thông báo đa nền tảng.
- **Content Moderation (Kiểm duyệt)**: Sử dụng Sightengine & Gemini AI kiểm duyệt tin nhắn/hình ảnh/video độc hại.
- **Hệ thống tìm kiếm**: Kết hợp MongoDB Text Search/Regex và Gemini AI để tìm kiếm ngữ nghĩa.
- **Hệ thống gợi ý bài viết (Recommendation System)**: Thuật toán AI phân tích tương tác người dùng để hiển thị News Feed cá nhân hóa.

---

## 🛠️ Yêu cầu hệ thống
- **Node.js**: Phiên bản >= 18.x
- **MongoDB**: Đã cài đặt cục bộ (Local) hoặc MongoDB Atlas Cloud.
- **Python**: Phiên bản >= 3.10 (dùng để chạy các script AI/Recommendation phụ trợ).

---

## 📁 Cấu trúc thư mục chính
```text
Twizzy-BE/
├── src/
│   ├── config/             # Cấu hình Database, Cloudinary, Firebase, GCP...
│   ├── controllers/        # Xử lý Logic của các API Endpoints
│   ├── middlewares/        # Bộ lọc validation, xác thực JWT, phân quyền...
│   ├── models/             # Định nghĩa cấu trúc dữ liệu MongoDB (Schemas)
│   ├── routes/             # Định nghĩa các tuyến đường API (API Routes)
│   ├── services/           # Xử lý nghiệp vụ chính (Email, AI, Moderation, Search...)
│   ├── utils/              # Các hàm tiện ích, helpers, seeder dữ liệu
│   └── index.ts            # Điểm khởi chạy ứng dụng (Express App Entry)
├── firebase-service-account.json # File cấu hình Firebase Cloud Messaging (Cần tự cấu hình)
├── .env.example            # Bản mẫu cấu hình môi trường
└── package.json            # Quản lý thư viện và lệnh chạy dự án
```

---

## ⚙️ Hướng dẫn Cài đặt & Cấu hình

### Bước 1: Cài đặt các thư viện Node.js
Di chuyển vào thư mục `Twizzy-BE` và chạy lệnh sau để tải các package cần thiết:
```bash
npm install
```

### Bước 2: Cấu hình biến môi trường (`.env`)
1. Tạo một file `.env` từ file mẫu `.env.example`:
   ```bash
   cp .env.example .env
   ```
2. Mở file `.env` và điền đầy đủ các thông số cấu hình:
   - **MongoDB**: Điền `DB_USERNAME`, `DB_PASSWORD`, và `DB_NAME` để kết nối cơ sở dữ liệu.
   - **Email Setup**: Xem hướng dẫn chi tiết tại [EMAIL_SETUP.md](./EMAIL_SETUP.md) để lấy App Password của Gmail.
   - **Gemini AI**: Đăng ký lấy API Key tại Google AI Studio và điền vào `GEMINI_API_KEY`.
   - **Cloudinary**: Đăng ký Cloudinary để lấy các API key lưu trữ đa phương tiện.
   - **Sightengine**: Lấy key từ Sightengine để kích hoạt kiểm duyệt hình ảnh/video.
   - **Python Path**: Đường dẫn đến executable Python của máy bạn (để chạy model gợi ý).

### Bước 3: Cấu hình Firebase (Cho thông báo đẩy)
1. Truy cập [Firebase Console](https://console.firebase.google.com/), tạo một dự án mới.
2. Tải về file Service Account key dạng `.json` (nằm trong mục *Project Settings > Service accounts*).
3. Đổi tên file này thành `firebase-service-account.json` và lưu vào thư mục gốc của dự án `Twizzy-BE/`.

---

## 🚀 Chạy ứng dụng

### Chế độ Development (Hỗ trợ hot-reload khi sửa code)
```bash
npm run dev
```
Server sẽ mặc định chạy tại địa chỉ: `http://localhost:3000`

### Seed dữ liệu giả lập hệ thống đề xuất bài đăng (Khuyên dùng khi chạy thử nghiệm)
Để có sẵn dữ liệu test cho hệ thống gợi ý tin tức (News Feed):
```bash
npm run seed:reco
```

### Build và Chạy Production
Để đóng gói code TypeScript sang JavaScript thuần:
```bash
# Biên dịch code sang thư mục /dist
npm run build

# Khởi chạy dự án từ thư mục /dist ở môi trường production
npm run start
```

---

## 🔍 Tài liệu API
Các Endpoint chính hỗ trợ cho Mobile Client và Admin Web:
- `/users`: Đăng ký, đăng nhập, xác thực OTP, đổi mật khẩu, thông tin cá nhân.
- `/twizzs`: Viết bài, like, bookmark, retwizz, feed gợi ý/mới nhất.
- `/conversations`: Nhắn tin realtime, lấy danh sách cuộc trò chuyện.
- `/notifications`: Nhận danh sách thông báo hoạt động.
- `/admin`: Quản lý người dùng, bài viết, xử lý báo cáo vi phạm nội dung (Dành cho Dashboard).
