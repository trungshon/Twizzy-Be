import databaseService from '~/services/database.services'
import { REGEX_USERNAME } from '~/constants/regex'

/**
 * Generate a unique username from name or email
 * @param name - User's name
 * @param email - User's email
 * @returns Unique username
 */
export async function generateUsername(name: string, email: string): Promise<string> {
  // Extract base from name (remove spaces, special chars, lowercase)
  const nameBase = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^a-z0-9]/g, '') // Remove special characters
    .substring(0, 10) // Max 10 chars

  // Extract base from email (part before @)
  const emailBase = email
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .substring(0, 10)

  // Try name-based username first
  let base = nameBase || emailBase || 'user'

  // Ensure minimum length of 4
  if (base.length < 4) {
    base = base.padEnd(4, '0')
  }

  // Try base username first
  let username = base
  let counter = 1
  const maxAttempts = 1000

  while (counter < maxAttempts) {
    // Check if username exists
    const existingUser = await databaseService.users.findOne({ username })

    if (!existingUser) {
      // Check if username matches regex
      if (REGEX_USERNAME.test(username)) {
        return username
      }
    }

    // Generate new username with counter
    const suffix = counter.toString()
    const maxLength = 15 - suffix.length
    username = base.substring(0, maxLength) + suffix
    counter++
  }

  // Fallback: use timestamp if all attempts fail
  const timestamp = Date.now().toString().slice(-6)
  username = `user${timestamp}`

  // Final check
  const existingUser = await databaseService.users.findOne({ username })
  if (existingUser) {
    // Last resort: add random number
    username = `user${timestamp}${Math.floor(Math.random() * 1000)}`
  }

  return username
}
