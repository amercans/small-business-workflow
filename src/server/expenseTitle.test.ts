import { describe, expect, it } from 'vitest'
import * as req from './services/requests'
import { form, jpg, setup } from './testkit'

const item = (description: string) => ({ date: '2026-10-20', amount: 100, currency: 'TRY', category: 'meals', description, fileName: 'fis.jpg', file: jpg() })

describe('multi-line expense title', () => {
  it('request lists show the first line plus the number of other lines', async () => {
    const s = setup()
    const c = s.ctx('employeeA')
    const r = await req.submitExpense(c, form({ items: [item('Ekip yemeği'), item('Taksi')], project: 'Örnek Ltd.' }))
    if (!r.ok) throw new Error(r.error)
    expect(r.requests[0].title).toBe('Ekip yemeği +1 kalem')
    expect((await req.myRequests(c)).requests[0].title).toBe('Ekip yemeği +1 kalem')
    const ap = await req.approvals(s.ctx('approver'))
    expect(ap.pending[0].title).toBe('Ekip yemeği +1 kalem')
  })

  it('a single-line expense uses the line description', async () => {
    const s = setup()
    const r = await req.submitExpense(s.ctx('employeeA'), form({ items: [item('Taksi')] }))
    if (!r.ok) throw new Error(r.error)
    expect(r.requests[0].title).toBe('Taksi')
  })
})

describe('expense exchange rate limits', () => {
  it('rejects an out-of-range foreign rate and a non-1 rate in the base currency', async () => {
    const s = setup()
    const c = s.ctx('employeeA')
    const mk = (currency: string, rate?: number) => form({ items: [{ ...item('Bilet'), currency, rate }] })
    expect(await req.submitExpense(c, mk('USD', 5_000_000))).toMatchObject({ ok: false, error: expect.stringContaining('sıfırdan büyük') })
    expect(await req.submitExpense(c, mk('USD', -1))).toMatchObject({ ok: false })
    expect(await req.submitExpense(c, mk('TRY', 30))).toMatchObject({ ok: false, error: expect.stringContaining('kur 1') })
    expect((await req.submitExpense(c, mk('USD', 35.5))).ok).toBe(true)
    expect((await req.submitExpense(c, mk('USD', 0.5))).ok).toBe(true)
    expect((await req.submitExpense(c, mk('TRY', 1))).ok).toBe(true)
  })
})
