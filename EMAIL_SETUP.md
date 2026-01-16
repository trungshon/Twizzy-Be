# Hướng dẫn cấu hình Email với Nodemailer

## 1. Cấu hình Gmail App Password

### Bước 1: Bật xác thực 2 bước
1. Truy cập: https://myaccount.google.com/security
2. Tìm mục "2-Step Verification" (Xác thực 2 bước)
3. Bật tính năng này

### Bước 2: Tạo App Password
1. Truy cập: https://myaccount.google.com/apppasswords
2. Chọn "Select app" → "Other (Custom name)"
3. Đặt tên: "Twizzy Backend"
4. Click "Generate"
5. Copy mã 16 ký tự (ví dụ: `abcd efgh ijkl mnop`)

### Bước 3: Cấu hình .env
Thêm vào file `.env`:

```env
# Email Configuration
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=your_email@gmail.com
EMAIL_PASSWORD=abcdefghijklmnop
EMAIL_FROM_NAME=Twizzy
```

**Lưu ý:** 
- `EMAIL_PASSWORD` là App Password (16 ký tự, không có khoảng trắng)
- KHÔNG dùng mật khẩu Gmail thường

## 2. Các nhà cung cấp email khác

### Outlook/Hotmail
```env
EMAIL_HOST=smtp-mail.outlook.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=your_email@outlook.com
EMAIL_PASSWORD=your_password
```

### Yahoo
```env
EMAIL_HOST=smtp.mail.yahoo.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=your_email@yahoo.com
EMAIL_PASSWORD=your_app_password
```

### SendGrid (Professional)
```env
EMAIL_HOST=smtp.sendgrid.net
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=apikey
EMAIL_PASSWORD=your_sendgrid_api_key
```

### Mailtrap (Testing)
```env
EMAIL_HOST=smtp.mailtrap.io
EMAIL_PORT=2525
EMAIL_SECURE=false
EMAIL_USER=your_mailtrap_username
EMAIL_PASSWORD=your_mailtrap_password
```

## 3. Test Email Service

Sau khi cấu hình, test bằng cách:

1. Khởi động server:
```bash
npm run dev
```

2. Đăng ký tài khoản mới:
```bash
POST /users/register
{
  "name": "Test User",
  "email": "test@example.com",
  "password": "Test123!@#",
  "confirm_password": "Test123!@#",
  "date_of_birth": "2000-01-01"
}
```

3. Kiểm tra email → bạn sẽ nhận được OTP

## 4. Troubleshooting

### Lỗi "Invalid login"
- Kiểm tra App Password đã đúng chưa
- Kiểm tra 2-Step Verification đã bật chưa

### Lỗi "Connection timeout"
- Kiểm tra firewall/antivirus
- Thử đổi PORT từ 587 sang 465 và set `EMAIL_SECURE=true`

### Lỗi "Self signed certificate"
- Thêm vào .env: `NODE_TLS_REJECT_UNAUTHORIZED=0` (chỉ dùng trong development)

### Email không gửi được
- Kiểm tra log console
- Email sẽ fallback log OTP ra console nếu gửi thất bại

## 5. Email Templates

Hiện tại có 2 template:
1. **Verification OTP** - Màu tím gradient
2. **Forgot Password OTP** - Màu hồng gradient

Có thể customize trong `src/services/email.services.ts`

## 6. Security Best Practices

- ✅ Không commit file `.env` vào Git
- ✅ Sử dụng App Password thay vì password thật
- ✅ Giới hạn rate limit cho API gửi email
- ✅ Validate email address trước khi gửi
- ✅ Log các lỗi nhưng không expose sensitive info

## 7. Production Recommendations

Với production, nên dùng:
- **SendGrid** (free tier: 100 emails/day)
- **AWS SES** (giá rẻ, reliable)
- **Mailgun** (free tier: 5000 emails/month)

Không nên dùng Gmail cho production vì có rate limit.
