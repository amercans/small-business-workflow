import { describe, expect, it } from 'vitest'
import { checkEmailDomain, normalizeEmail } from './email'

describe('checkEmailDomain', () => {
  it('accepts any well-formed address when no domain is set', () => {
    expect(checkEmailDomain('ece@ornek.invalid', '')).toEqual({ ok: true })
  })
  it('accepts the configured domain case-insensitively with or without the @ prefix and rejects others', () => {
    expect(checkEmailDomain('Ece@Sirket.COM', 'sirket.com')).toEqual({ ok: true })
    expect(checkEmailDomain('ece@sirket.com', '@sirket.com')).toEqual({ ok: true })
    const bad = checkEmailDomain('ece@baska.com', 'sirket.com')
    expect(bad.ok).toBe(false)
    expect(bad.error).toContain('@sirket.com')
  })
  it('does not treat a longer domain ending in the same text as a match', () => {
    expect(checkEmailDomain('x@evilsirket.com', 'sirket.com').ok).toBe(false)
  })
  it('rejects malformed addresses in every configuration', () => {
    expect(checkEmailDomain('ece', '').ok).toBe(false)
    expect(checkEmailDomain('ece@', 'sirket.com').ok).toBe(false)
    expect(checkEmailDomain('e ce@sirket.com', 'sirket.com').ok).toBe(false)
  })
  it('normalizeEmail', () => {
    expect(normalizeEmail('  Ece@X.com ')).toBe('ece@x.com')
  })
})
