import bcrypt from 'bcrypt'

const SALT_ROUNDS = 10 // Có thể tăng lên 12 hoặc 14 cho bảo mật cao hơn

async function hashPassword(password: string) {
  return await bcrypt.hash(password, SALT_ROUNDS)
}

async function verifyPassword(password: string, hashedPassword: string) {
  return await bcrypt.compare(password, hashedPassword)
}

export { hashPassword, verifyPassword }
