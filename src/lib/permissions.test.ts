import { describe, expect, it } from 'vitest'
import { canAccess, canDecide, canMarkPaid, type Actor, type Role } from './permissions'

const u = (role: Role, extra: Partial<Actor> = {}): Actor => ({ id: role, role, isAdmin: false, canUploadInvoices: false, ...extra })
const employee = u('employee')
const flagged = u('employee', { canUploadInvoices: true })
const manager = u('manager', { isAdmin: true })
const approver = u('approver')
const owner = u('owner')

describe('canAccess', () => {
  it('keeps employees out of management areas; the invoice flag opens invoices only', () => {
    for (const a of ['approvals', 'overview', 'agreements', 'inventory', 'users', 'settings'] as const) {
      expect(canAccess(employee, a)).toBe(false)
      expect(canAccess(flagged, a)).toBe(false)
    }
    expect(canAccess(employee, 'invoices')).toBe(false)
    expect(canAccess(flagged, 'invoices')).toBe(true)
  })
  it('gives every management role the dashboard, agreements, invoices and inventory', () => {
    for (const r of [manager, approver, owner]) {
      for (const a of ['overview', 'agreements', 'invoices', 'inventory', 'approvals'] as const) expect(canAccess(r, a)).toBe(true)
    }
  })
  it('limits users and settings to admins', () => {
    expect(canAccess(manager, 'users')).toBe(true)
    expect(canAccess(manager, 'settings')).toBe(true)
    expect(canAccess(approver, 'users')).toBe(false)
    expect(canAccess(owner, 'settings')).toBe(false)
  })
})

describe('canDecide', () => {
  it('lets only the role the request waits on decide', () => {
    const req = { requesterId: 'someone', approverRole: 'approver' as const }
    expect(canDecide(approver, req)).toBe(true)
    for (const x of [employee, manager, owner]) expect(canDecide(x, req)).toBe(false)
    expect(canDecide(owner, { requesterId: 'approver', approverRole: 'owner' })).toBe(true)
  })
  it('never lets the requester decide and refuses requests without an approver role', () => {
    expect(canDecide(approver, { requesterId: 'approver', approverRole: 'approver' })).toBe(false)
    expect(canDecide(approver, { requesterId: 'someone' })).toBe(false)
  })
})

describe('canMarkPaid', () => {
  it('allows only the approver role on approved expenses and advances', () => {
    expect(canMarkPaid(approver, { type: 'expense', status: 'approved' })).toBe(true)
    expect(canMarkPaid(approver, { type: 'advance', status: 'approved' })).toBe(true)
    expect(canMarkPaid(approver, { type: 'expense', status: 'pending' })).toBe(false)
    expect(canMarkPaid(approver, { type: 'purchase', status: 'approved' })).toBe(false)
    expect(canMarkPaid(approver, { type: 'leave', status: 'approved' })).toBe(false)
    expect(canMarkPaid(manager, { type: 'expense', status: 'approved' })).toBe(false)
  })
})
