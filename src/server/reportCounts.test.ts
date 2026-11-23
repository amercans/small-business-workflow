import { describe, expect, it } from 'vitest'
import * as req from './services/requests'
import * as rep from './services/reports'
import { expenseInput, form, jpg, setup } from './testkit'

describe('expense report line counts', () => {
  it('approved line count excludes pending lines', async () => {
    const s = setup()
    const a = await req.submitExpense(s.ctx('employeeA'), form({ items: [
      { date: '2026-10-20', amount: 100, currency: 'TRY', category: 'meals', description: 'Öğle', fileName: 'fis.jpg', file: jpg() },
      { date: '2026-10-20', amount: 50, currency: 'TRY', category: 'transport', description: 'Taksi', fileName: 'fis.jpg', file: jpg() },
    ] }))
    const b = await req.submitExpense(s.ctx('employeeB'), expenseInput(300))
    if (!a.ok || !b.ok) throw new Error('gönderilemedi')
    expect((await req.decide(s.ctx('approver'), a.requests[0].id, 'approved')).ok).toBe(true)
    const r = await rep.expenseReport(s.ctx('manager'), '2026-10')
    expect(r.lines).toHaveLength(3)
    expect(r.totals).toMatchObject({ approved: 150, approvedCount: 2, pending: 300, pendingCount: 1 })
  })
})
