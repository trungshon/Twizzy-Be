/**
 * Generate a random OTP code
 * @param length - Length of OTP (default: 6)
 * @returns OTP string
 */
export function generateOTP(length: number = 6): string {
  const digits = '0123456789'
  let OTP = ''
  for (let i = 0; i < length; i++) {
    OTP += digits[Math.floor(Math.random() * 10)]
  }
  return OTP
}

/**
 * Calculate OTP expiration time
 * @param minutes - Minutes until expiration (default: 10)
 * @returns Expiration date
 */
export function getOTPExpiration(minutes: number = 10): Date {
  const expiration = new Date()
  expiration.setMinutes(expiration.getMinutes() + minutes)
  return expiration
}

/**
 * Check if OTP is expired
 * @param expirationDate - OTP expiration date
 * @returns true if expired, false otherwise
 */
export function isOTPExpired(expirationDate: Date): boolean {
  return new Date() > expirationDate
}
