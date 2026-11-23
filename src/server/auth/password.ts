export const PBKDF2_ITERATIONS = 100_000
export const MIN_PBKDF2_ITERATIONS = 80_000
export const MAX_PBKDF2_ITERATIONS = 100_000
export const MIN_PASSWORD_LENGTH = 10
export const MAX_PASSWORD_LENGTH = 200

const SALT_BYTES = 16
const KEY_BITS = 256
const ALGO = 'pbkdf2-sha256'

const enc = new TextEncoder()

export const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))
export const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, KEY_BITS)
  return new Uint8Array(bits)
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  const len = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < len; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}

export async function hashPassword(password: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const hash = await derive(password, salt, iterations)
  return `${ALGO}$${iterations}$${toB64(salt)}$${toB64(hash)}`
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const parts = (stored ?? '').split('$')
  if (parts.length !== 4 || parts[0] !== ALGO) {
    await derive(password, new Uint8Array(SALT_BYTES), PBKDF2_ITERATIONS)
    return false
  }
  const iterations = Number(parts[1])
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_PBKDF2_ITERATIONS) return false
  let salt: Uint8Array
  let expected: Uint8Array
  try {
    salt = fromB64(parts[2])
    expected = fromB64(parts[3])
  } catch {
    return false
  }
  if (password.length > MAX_PASSWORD_LENGTH) return false
  const actual = await derive(password, salt, iterations)
  return constantTimeEqual(actual, expected)
}

export function passwordIterations(raw: string | undefined | null): { iterations: number; adjusted: boolean } {
  const n = Number(raw)
  if (raw === undefined || raw === null || raw === '' || !Number.isFinite(n)) return { iterations: PBKDF2_ITERATIONS, adjusted: false }
  const clamped = Math.min(MAX_PBKDF2_ITERATIONS, Math.max(MIN_PBKDF2_ITERATIONS, Math.round(n)))
  return { iterations: clamped, adjusted: clamped !== n }
}

export function hashIterations(stored: string | null | undefined): number | null {
  const parts = (stored ?? '').split('$')
  return parts.length === 4 && parts[0] === ALGO ? Number(parts[1]) || null : null
}

export const needsRehash = (stored: string | null | undefined, iterations: number) => hashIterations(stored) !== iterations
