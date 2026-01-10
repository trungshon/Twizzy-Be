import { generateOTP } from '~/utils/otp'

/**
 * Email service for sending OTP emails
 * TODO: Integrate with actual email service (nodemailer, SendGrid, etc.)
 */
class EmailService {
  /**
   * Send email verification OTP
   * @param email - User email
   * @param otp - OTP code
   */
  async sendEmailVerificationOTP(email: string, otp: string): Promise<void> {
    // TODO: Implement actual email sending
    // Example with nodemailer:
    // await transporter.sendMail({
    //   from: process.env.EMAIL_FROM,
    //   to: email,
    //   subject: 'Verify your email',
    //   html: `Your verification code is: <strong>${otp}</strong><br>This code will expire in 10 minutes.`
    // })

    console.log(`[EMAIL] Verification OTP sent to ${email}: ${otp}`)
  }

  /**
   * Send forgot password OTP
   * @param email - User email
   * @param otp - OTP code
   */
  async sendForgotPasswordOTP(email: string, otp: string): Promise<void> {
    // TODO: Implement actual email sending
    // Example with nodemailer:
    // await transporter.sendMail({
    //   from: process.env.EMAIL_FROM,
    //   to: email,
    //   subject: 'Reset your password',
    //   html: `Your password reset code is: <strong>${otp}</strong><br>This code will expire in 10 minutes.`
    // })

    console.log(`[EMAIL] Forgot password OTP sent to ${email}: ${otp}`)
  }
}

const emailService = new EmailService()
export default emailService
