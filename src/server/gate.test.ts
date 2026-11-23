import { describe, expect, it } from 'vitest'
import * as req from './services/requests'
import * as cmp from './services/compliance'
import { LEGAL_VERSION } from '#/lib/legal'
import { advanceInput, expenseInput, leaveInput, purchaseInput, setup, travelInput } from './testkit'

const asset = (s: ReturnType<typeof setup>, who: 'employeeA') => {
  const by = s.users.manager.id
  s.db.raw.prepare(`INSERT INTO assets (id, name, condition, created_by, updated_by) VALUES (?, 'Laptop', 'active', ?, ?)`).run('7'.padEnd(26, '0'), by, by)
  s.db.raw.prepare(`INSERT INTO assignments (id, asset_id, user_id, assigned_on, assigned_by, updated_by) VALUES (?, ?, ?, '2026-10-01', ?, ?)`).run('8'.padEnd(26, '0'), '7'.padEnd(26, '0'), s.users[who].id, by, by)
  return '8'.padEnd(26, '0')
}

describe('request gate (server)', () => {
  it('blocks every request type until the documents are accepted', async () => {
    const s = setup({ policies: false })
    const c = s.ctx('employeeA')
    const results = [
      await req.submitLeave(c, leaveInput()),
      await req.submitExpense(c, expenseInput()),
      await req.submitAdvance(c, advanceInput()),
      await req.submitPurchase(c, purchaseInput()),
      await req.submitTravel(c, travelInput()),
    ]
    for (const r of results) expect(r).toMatchObject({ ok: false, error: expect.stringContaining('belgeleri') })
    expect((await s.db.prepare(`SELECT COUNT(*) AS n FROM requests WHERE requester_id = ?`).bind(c.user.id).first<{ n: number }>())!.n).toBe(0)
    expect(await cmp.acceptPolicies(c, { version: LEGAL_VERSION, docs: ['policy', 'kvkk'] })).toEqual({ ok: true })
    expect((await req.submitLeave(c, leaveInput())).ok).toBe(true)
  })

  it('blocks while a physical assignment is unanswered and opens after confirming it', async () => {
    const s = setup()
    const id = asset(s, 'employeeA')
    const c = s.ctx('employeeA')
    expect(await req.submitAdvance(c, advanceInput())).toMatchObject({ ok: false, error: expect.stringContaining('zimmetli cihaz') })
    expect(await cmp.acknowledgeAssignment(c, id)).toEqual({ ok: true })
    expect((await req.submitAdvance(c, advanceInput())).ok).toBe(true)
  })

  it('reporting an assignment as incorrect also counts as an answer', async () => {
    const s = setup()
    const id = asset(s, 'employeeA')
    const c = s.ctx('employeeA')
    expect((await req.submitPurchase(c, purchaseInput())).ok).toBe(false)
    expect(await cmp.disputeAssignment(c, { id, note: 'Bende değil' })).toEqual({ ok: true })
    expect((await req.submitPurchase(c, purchaseInput())).ok).toBe(true)
  })
})

describe('assignment note', () => {
  it('a note written while assigning appears in the item\'s assignment history', async () => {
    const s = setup()
    const a = await (await import('./services/manage')).createAsset(s.ctx('manager'), { name: 'Laptop', acquiredOn: '2026-10-01' })
    if (!a.ok) throw new Error(a.error)
    const mng = await import('./services/manage')
    expect((await mng.assignAsset(s.ctx('manager'), { assetId: a.asset.id, userId: s.users.employeeA.id, date: '2026-10-10', note: 'Şarj aleti dahil' })).ok).toBe(true)
    const got = await mng.getAsset(s.ctx('manager'), a.asset.id)
    expect(got!.history[0]).toMatchObject({ userName: 'employeeA', note: 'Şarj aleti dahil' })
  })
})

import { downloadName } from './files'
describe('download name', () => {
  it('uses a fixed name for medical certificates and the stored name otherwise', () => {
    expect(downloadName({ name: 'Deniz Ornek-grip-tani.pdf', contentType: 'application/pdf', sensitive: true })).toBe('saglik-raporu.pdf')
    expect(downloadName({ name: 'rapor.jpeg', contentType: 'image/jpeg', sensitive: true })).toBe('saglik-raporu.jpg')
    expect(downloadName({ name: 'fis.jpg', contentType: 'image/jpeg', sensitive: false })).toBe('fis.jpg')
  })
})
