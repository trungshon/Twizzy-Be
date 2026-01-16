import nodemailer from 'nodemailer'
import { config } from 'dotenv'
config()

/**
 * Email service for sending OTP emails using nodemailer
 */
class EmailService {
  private transporter: nodemailer.Transporter

  constructor() {
    // Create reusable transporter object using SMTP transport
    this.transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST, // e.g., smtp.gmail.com
      port: 587,
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.EMAIL_USER, // your email
        pass: process.env.EMAIL_PASSWORD // your email password or app password
      }
    })

    // Verify connection configuration
    this.transporter.verify((error, success) => {
      if (error) {
        console.log('[EMAIL] Error connecting to email server:', error)
      } else {
        console.log('[EMAIL] Email server is ready to send messages')
      }
    })
  }

  /**
   * Send email verification OTP
   * @param email - User email
   * @param otp - OTP code
   */
  async sendEmailVerificationOTP(email: string, otp: string): Promise<void> {
    try {
      const mailOptions = {
        from: `"${process.env.EMAIL_FROM_NAME || 'Twizzy'}" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Xác thực email - Twizzy',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
              <h1 style="color: white; margin: 0;">Twizzy</h1>
            </div>
            <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
              <h2 style="color: #333; margin-top: 0;">Xác thực email của bạn</h2>
              <p style="color: #666; font-size: 16px; line-height: 1.6;">
                Chào bạn! Cảm ơn bạn đã đăng ký tài khoản Twizzy.
              </p>
              <p style="color: #666; font-size: 16px; line-height: 1.6;">
                Mã xác thực của bạn là:
              </p>
              <div style="background: white; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
                <span style="font-size: 32px; font-weight: bold; color: #667eea; letter-spacing: 5px;">${otp}</span>
              </div>
              <p style="color: #999; font-size: 14px; line-height: 1.6;">
                Mã này sẽ hết hạn sau <strong>10 phút</strong>.
              </p>
              <p style="color: #999; font-size: 14px; line-height: 1.6;">
                Nếu bạn không yêu cầu xác thực này, vui lòng bỏ qua email này.
              </p>
            </div>
            <div style="text-align: center; margin-top: 20px; color: #999; font-size: 12px;">
              <p>© ${new Date().getFullYear()} Twizzy. All rights reserved.</p>
            </div>
          </div>
        `
      }

      await this.transporter.sendMail(mailOptions)
      console.log(`[EMAIL] Verification OTP sent successfully to ${email}`)
    } catch (error) {
      console.error(`[EMAIL] Error sending verification OTP to ${email}:`, error)
      // Log to console as fallback
      console.log(`[EMAIL FALLBACK] Verification OTP for ${email}: ${otp}`)
      throw error
    }
  }

  /**
   * Send forgot password OTP
   * @param email - User email
   * @param otp - OTP code
   */
  async sendForgotPasswordOTP(email: string, otp: string): Promise<void> {
    try {
      const mailOptions = {
        from: `"${process.env.EMAIL_FROM_NAME || 'Twizzy'}" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Đặt lại mật khẩu - Twizzy',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
              <h1 style="color: white; margin: 0;">Twizzy</h1>
            </div>
            <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
              <h2 style="color: #333; margin-top: 0;">Đặt lại mật khẩu</h2>
              <p style="color: #666; font-size: 16px; line-height: 1.6;">
                Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn.
              </p>
              <p style="color: #666; font-size: 16px; line-height: 1.6;">
                Mã xác thực của bạn là:
              </p>
              <div style="background: white; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
                <span style="font-size: 32px; font-weight: bold; color: #f5576c; letter-spacing: 5px;">${otp}</span>
              </div>
              <p style="color: #999; font-size: 14px; line-height: 1.6;">
                Mã này sẽ hết hạn sau <strong>10 phút</strong>.
              </p>
              <p style="color: #e74c3c; font-size: 14px; line-height: 1.6;">
                <strong>⚠️ Lưu ý:</strong> Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này và bảo mật tài khoản của bạn.
              </p>
            </div>
            <div style="text-align: center; margin-top: 20px; color: #999; font-size: 12px;">
              <p>© ${new Date().getFullYear()} Twizzy. All rights reserved.</p>
            </div>
          </div>
        `
      }

      await this.transporter.sendMail(mailOptions)
      console.log(`[EMAIL] Forgot password OTP sent successfully to ${email}`)
    } catch (error) {
      console.error(`[EMAIL] Error sending forgot password OTP to ${email}:`, error)
      // Log to console as fallback
      console.log(`[EMAIL FALLBACK] Forgot password OTP for ${email}: ${otp}`)
      throw error
    }
  }
}

const emailService = new EmailService()
export default emailService
