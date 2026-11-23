import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

if (process.argv.includes('--remote') || process.env.CI_REMOTE) {
  console.error('seed-dev is for the local database only; --remote refused.')
  process.exit(1)
}

const APP = join(import.meta.dirname, '..')
const DEMO_PASSWORD = 'demo-password'
const LEGAL_VERSION = '1.0'
const out: string[] = []

const q = (v: unknown): string =>
  v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? (v ? '1' : '0') : `'${String(v).replace(/'/g, "''")}'`
function ins(table: string, row: Record<string, unknown>) {
  const cols = Object.keys(row)
  out.push(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => q(row[c])).join(', ')});`)
}
const sql = (s: string) => out.push(s)

const ids: Record<string, number> = {}
const id = (prefix: string) => {
  ids[prefix] = (ids[prefix] ?? 0) + 1
  return `${prefix}${String(ids[prefix]).padStart(26 - prefix.length, '0')}`
}
const at = (s: string) => new Date(s).toISOString()
const minor = (n: number) => Math.round(n * 100)
const RATE = { TRY: 1, USD: 41.2, EUR: 47.5 } as const
type Cur = keyof typeof RATE
const micro = (c: Cur) => Math.round(RATE[c] * 1_000_000)
const toBase = (amountMinor: number, c: Cur) => Math.round((amountMinor * micro(c)) / 1_000_000)

async function pbkdf2(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 }, key, 256))
  const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))
  return `pbkdf2-sha256$100000$${b64(salt)}$${b64(bits)}`
}

const T0 = at('2026-01-05T08:30:00Z')
const PEOPLE = {
  alex: { name: 'Alex Sample', email: 'owner@example.com', role: 'owner', admin: 1, invoices: 0, hue: 47, dept: 'Leadership' },
  jordan: { name: 'Jordan Demo', email: 'approver@example.com', role: 'approver', admin: 0, invoices: 0, hue: 213, dept: 'Operations' },
  taylor: { name: 'Taylor Example', email: 'manager@example.com', role: 'manager', admin: 0, invoices: 0, hue: 158, dept: 'Client services' },
  sam: { name: 'Sam Placeholder', email: 'sam@example.com', role: 'employee', admin: 0, invoices: 1, hue: 289, dept: 'Design' },
  riley: { name: 'Riley Mock', email: 'riley@example.com', role: 'employee', admin: 0, invoices: 0, hue: 11, dept: 'Development' },
} as const
type Who = keyof typeof PEOPLE
const U = Object.fromEntries(Object.keys(PEOPLE).map((k) => [k, id('10')])) as Record<Who, string>

const hash = await pbkdf2(DEMO_PASSWORD)
for (const [k, p] of Object.entries(PEOPLE) as [Who, (typeof PEOPLE)[Who]][]) {
  ins('users', {
    id: U[k], email: p.email, full_name: p.name, display_name: p.name, department: p.dept, role: p.role, is_admin: p.admin, can_upload_invoices: p.invoices,
    avatar_hue: p.hue, status: 'active', password_hash: hash, password_changed_at: T0, email_verified_at: T0, locale: null,
    created_at: T0, updated_at: T0, created_by: k === 'alex' ? null : U.alex, updated_by: k === 'alex' ? null : U.alex,
  })
}
for (const [k, p] of Object.entries(PEOPLE) as [Who, (typeof PEOPLE)[Who]][]) {
  ins('leave_entitlements', { id: id('20'), user_id: U[k], year: 2026, entitled_days: p.role === 'employee' ? 14 : 20, created_by: U.alex, updated_by: U.alex, created_at: T0, updated_at: T0 })
  for (const doc of ['policy', 'kvkk']) ins('policy_acceptances', { id: id('21'), user_id: U[k], doc, version: LEGAL_VERSION, accepted_at: T0 })
}

const FILES: { key: string; file: string }[] = []
function attach(kind: string, parent: Record<string, string>, name: string, by: string, file: 'sample-receipt.jpg' | 'sample-document.pdf', createdAt: string) {
  const aid = id('90')
  const key = `att/2026/11/${aid}`
  ins('attachments', {
    id: aid, r2_key: key, kind, ...parent, original_name: name, content_type: file.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg',
    size_bytes: 2048, sha256: aid.toLowerCase().padEnd(64, 'a'), is_sensitive: 0, uploaded_by: by, created_at: createdAt,
  })
  FILES.push({ key, file })
}

interface Req {
  who: Who
  type: 'leave' | 'expense' | 'advance' | 'purchase' | 'travel'
  title: string
  submitted: string
  approverRole: 'manager' | 'approver' | 'owner'
  status: 'pending' | 'approved' | 'rejected' | 'paid'
  decidedBy?: Who
  decidedAt?: string
  decisionNote?: string
  paidAt?: string
  note?: string
  project?: string
  totalMinor?: number
}
function request(r: Req, detail: (rid: string, created: string) => void): string {
  const rid = id('30')
  const created = at(r.submitted)
  ins('requests', {
    id: rid, type: r.type, requester_id: U[r.who], status: 'draft', title: r.title, note: r.note ?? null, project: r.project ?? null,
    total_base_minor: r.type === 'leave' ? null : (r.totalMinor ?? null), approver_role: r.approverRole,
    created_at: created, created_by: U[r.who], updated_at: created, updated_by: U[r.who],
  })
  detail(rid, created)
  sql(`UPDATE requests SET status = 'pending', submitted_at = ${q(created)}, version = 2 WHERE id = ${q(rid)};`)
  if (r.status !== 'pending') {
    const st = r.status === 'rejected' ? 'rejected' : 'approved'
    sql(`UPDATE requests SET status = '${st}', decided_at = ${q(at(r.decidedAt!))}, decided_by = ${q(U[r.decidedBy!])}, decision_note = ${q(r.decisionNote ?? null)}, version = 3 WHERE id = ${q(rid)};`)
  }
  if (r.status === 'paid') sql(`UPDATE requests SET status = 'paid', paid_at = ${q(at(r.paidAt!))}, paid_by = ${q(U.jordan)}, version = 4 WHERE id = ${q(rid)};`)
  return rid
}
function items(rid: string, who: Who, created: string, lines: { date: string; category: string; description: string; amount: number; currency?: Cur; receipt: string }[]) {
  lines.forEach((l, i) => {
    const cur = l.currency ?? 'TRY'
    const amt = minor(l.amount)
    const iid = id('40')
    ins('request_items', {
      id: iid, request_id: rid, line_no: i + 1, expense_date: l.date, category: l.category, description: l.description, currency: cur, amount_minor: amt,
      fx_rate_micro: micro(cur), amount_base_minor: cur === 'TRY' ? amt : toBase(amt, cur), created_at: created, created_by: U[who], updated_at: created, updated_by: U[who],
    })
    attach('receipt', { request_item_id: iid }, l.receipt, U[who], 'sample-receipt.jpg', created)
  })
}
const sumBase = (lines: { amount: number; currency?: Cur }[]) => lines.reduce((s, l) => s + (l.currency && l.currency !== 'TRY' ? toBase(minor(l.amount), l.currency) : minor(l.amount)), 0)

const workshop = [
  { date: '2026-11-12', category: 'transport', description: 'Train tickets to the client workshop', amount: 1180, receipt: 'train-tickets.jpg' },
  { date: '2026-11-12', category: 'meals', description: 'Team lunch during the workshop', amount: 640, receipt: 'lunch-receipt.jpg' },
]
request({ who: 'sam', type: 'expense', title: 'Client workshop travel', submitted: '2026-11-13T09:10:00Z', approverRole: 'approver', status: 'pending', project: 'Northwind Sample Co. onboarding', totalMinor: sumBase(workshop), note: 'Workshop on site with the client team.' }, (rid, c) => items(rid, 'sam', c, workshop))

const conference = [{ date: '2026-10-28', category: 'other', description: 'Online conference ticket', amount: 149, currency: 'USD' as Cur, receipt: 'conference-ticket.jpg' }]
request({ who: 'riley', type: 'expense', title: 'Online conference ticket', submitted: '2026-10-29T11:00:00Z', approverRole: 'approver', status: 'paid', decidedBy: 'jordan', decidedAt: '2026-10-30T08:00:00Z', paidAt: '2026-11-03T10:00:00Z', totalMinor: sumBase(conference) }, (rid, c) => items(rid, 'riley', c, conference))

const ownExpense = [{ date: '2026-11-18', category: 'supplies', description: 'Printer paper and toner', amount: 2150, receipt: 'office-supplies.jpg' }]
request({ who: 'jordan', type: 'expense', title: 'Office supplies', submitted: '2026-11-19T07:45:00Z', approverRole: 'owner', status: 'pending', totalMinor: sumBase(ownExpense) }, (rid, c) => items(rid, 'jordan', c, ownExpense))

request({ who: 'sam', type: 'leave', title: 'Annual leave', submitted: '2026-11-02T08:00:00Z', approverRole: 'approver', status: 'approved', decidedBy: 'jordan', decidedAt: '2026-11-02T12:30:00Z' }, (rid) =>
  ins('leave_requests', { request_id: rid, kind: 'annual', start_date: '2026-12-07', end_date: '2026-12-09', work_days: 3, return_date: '2026-12-10', year: 2026 }),
)
request({ who: 'riley', type: 'leave', title: 'Annual leave', submitted: '2026-11-20T09:00:00Z', approverRole: 'approver', status: 'pending', note: 'End-of-year break.' }, (rid) =>
  ins('leave_requests', { request_id: rid, kind: 'annual', start_date: '2026-12-28', end_date: '2026-12-30', work_days: 3, return_date: '2026-12-31', year: 2026 }),
)
request({ who: 'taylor', type: 'leave', title: 'Unpaid leave', submitted: '2026-10-05T10:00:00Z', approverRole: 'approver', status: 'rejected', decidedBy: 'jordan', decidedAt: '2026-10-06T09:00:00Z', decisionNote: 'Overlaps with the quarterly review; please pick another week.' }, (rid) =>
  ins('leave_requests', { request_id: rid, kind: 'unpaid', start_date: '2026-10-19', end_date: '2026-10-20', work_days: 2, return_date: '2026-10-21', year: 2026 }),
)

request({ who: 'taylor', type: 'purchase', title: 'Ergonomic office chairs', submitted: '2026-11-16T13:20:00Z', approverRole: 'approver', status: 'pending', totalMinor: minor(2 * 7400), note: 'Two chairs for the new desks.' }, (rid) =>
  ins('purchase_requests', { request_id: rid, category: 'equipment', item_name: 'Ergonomic office chair', quantity: 2, unit_estimated_minor: minor(7400), estimated_minor: minor(14800), url: 'https://example.com/chair' }),
)

request({ who: 'riley', type: 'advance', title: 'Advance for client visit', submitted: '2026-11-04T08:15:00Z', approverRole: 'approver', status: 'paid', decidedBy: 'jordan', decidedAt: '2026-11-04T10:00:00Z', paidAt: '2026-11-05T09:00:00Z', totalMinor: minor(3000) }, (rid) =>
  ins('advance_requests', { request_id: rid, amount_minor: minor(3000), needed_on: '2026-11-10', payment_method: 'bank' }),
)

request({ who: 'sam', type: 'travel', title: 'Trip to the regional office', submitted: '2026-11-21T08:40:00Z', approverRole: 'approver', status: 'pending', totalMinor: minor(6500) }, (rid) =>
  ins('travel_requests', { request_id: rid, destination: 'Regional office', start_date: '2026-12-14', end_date: '2026-12-15', purpose: 'Quarterly planning session', transport: 'train', accommodation: 'hotel', estimated_budget_minor: minor(6500) }),
)

const CLIENTS = ['Northwind Sample Co.', 'Bluebird Example Ltd.', 'Lakeside Demo Group', 'Acme Placeholder Inc.']
const agreements: [string, string, string, string | null, number, 'yearly' | 'monthly' | 'one_time', string][] = [
  [CLIENTS[0], 'Annual design retainer', '2026-02-01', '2027-01-31', 360_000, 'yearly', 'Retainer'],
  [CLIENTS[1], 'Website maintenance', '2026-05-01', '2026-12-31', 12_500, 'monthly', 'Support'],
  [CLIENTS[2], 'Brand refresh project', '2026-09-15', '2027-03-15', 180_000, 'one_time', 'Project'],
  ['Sample Office Services', 'Office cleaning', '2026-01-01', null, 4_200, 'monthly', 'Supplier'],
]
for (const [cp, title, start, end, amount, period, tag] of agreements) {
  const aid = id('50')
  ins('agreements', { id: aid, counterparty: cp, title, start_date: start, end_date: end, currency: 'TRY', amount_minor: minor(amount), amount_period: period, tag, created_by: U.alex, updated_by: U.alex, created_at: at(`${start}T09:00:00Z`), updated_at: at(`${start}T09:00:00Z`) })
  attach('agreement_file', { agreement_id: aid }, `${tag.toLowerCase()}-agreement.pdf`, U.alex, 'sample-document.pdf', at(`${start}T09:00:00Z`))
}

let invN = 0
function invoice(o: { direction: 'in' | 'out'; firm: string; date: string; net: number; currency?: Cur; vat?: number; due?: string | null; settled?: string | null; by: Who; costKind?: 'direct' | 'overhead'; approval?: 'pending' | 'approved'; items?: { description: string; quantity: number; net: number; toInventory: boolean }[]; file?: boolean }) {
  const iid = id('60')
  const cur = o.currency ?? 'TRY'
  const net = minor(o.net)
  const vatBp = (o.vat ?? 20) * 100
  const vat = Math.round((net * vatBp) / 10_000)
  const created = at(`${o.date}T10:00:00Z`)
  ins('invoices', {
    id: iid, direction: o.direction, invoice_no: `DEMO-2026-${String(++invN).padStart(4, '0')}`, counterparty: o.firm, invoice_date: o.date, due_on: o.due ?? null,
    currency: cur, fx_rate_micro: micro(cur), vat_rate_bp: vatBp, net_minor: net, vat_minor: vat, net_base_minor: cur === 'TRY' ? net : toBase(net, cur), vat_base_minor: cur === 'TRY' ? vat : toBase(vat, cur),
    settled_on: o.settled ?? null, cost_kind: o.direction === 'in' ? (o.costKind ?? 'overhead') : null, approval_status: o.approval ?? 'approved',
    decided_at: o.direction === 'in' && (o.approval ?? 'approved') === 'approved' ? created : null, decided_by: o.direction === 'in' && (o.approval ?? 'approved') === 'approved' ? U.jordan : null,
    uploaded_by: U[o.by], created_by: U[o.by], updated_by: U[o.by], created_at: created, updated_at: created,
  })
  if (o.file !== false) attach('invoice_file', { invoice_id: iid }, `invoice-${invN}.pdf`, U[o.by], 'sample-document.pdf', created)
  const itemIds = (o.items ?? []).map((it, i) => {
    const itid = id('61')
    ins('invoice_items', { id: itid, invoice_id: iid, line_no: i + 1, description: it.description, quantity: it.quantity, unit_net_minor: minor(it.net / it.quantity), line_net_minor: minor(it.net), vat_rate_bp: vatBp, to_inventory: it.toInventory ? 1 : 0, created_by: U[o.by], updated_by: U[o.by], created_at: created, updated_at: created })
    return itid
  })
  return { id: iid, itemIds }
}

const hardware = invoice({ direction: 'in', firm: 'Sample Hardware Supply', date: '2026-10-08', net: 96_000, by: 'taylor', costKind: 'overhead', settled: '2026-10-15', items: [{ description: 'Laptop', quantity: 1, net: 64_000, toInventory: true }, { description: 'External monitor', quantity: 2, net: 32_000, toInventory: true }] })
invoice({ direction: 'in', firm: 'Example Cloud Services GmbH', date: '2026-11-02', net: 480, currency: 'EUR', vat: 0, by: 'sam', costKind: 'overhead', settled: '2026-11-05' })
invoice({ direction: 'in', firm: 'Demo Print House', date: '2026-11-18', net: 7_250, by: 'sam', costKind: 'direct', approval: 'pending' })
invoice({ direction: 'out', firm: CLIENTS[0], date: '2026-10-01', net: 30_000, due: '2026-10-31', settled: '2026-10-20', by: 'taylor' })
invoice({ direction: 'out', firm: CLIENTS[0], date: '2026-11-01', net: 30_000, due: '2026-12-01', by: 'taylor' })
invoice({ direction: 'out', firm: CLIENTS[1], date: '2026-11-03', net: 12_500, due: '2026-11-17', by: 'taylor' })
invoice({ direction: 'out', firm: CLIENTS[2], date: '2026-10-12', net: 90_000, due: '2026-11-11', settled: '2026-11-09', by: 'alex' })

const assets: { name: string; category: string; serial?: string; quantity?: number; itemId?: string; holder?: Who; since?: string }[] = [
  { name: 'Laptop', category: 'Computer', serial: 'DEMO-LT-0001', itemId: hardware.itemIds[0], holder: 'sam', since: '2026-10-12' },
  { name: 'External monitor', category: 'Display', quantity: 2, itemId: hardware.itemIds[1], holder: 'riley', since: '2026-10-12' },
  { name: 'Camera kit', category: 'Camera', serial: 'DEMO-CK-0042' },
  { name: 'Portable projector', category: 'Presentation', serial: 'DEMO-PJ-0007', holder: 'taylor', since: '2026-09-01' },
]
for (const a of assets) {
  const aid = id('70')
  ins('assets', { id: aid, name: a.name, category: a.category, serial_no: a.serial ?? null, quantity: a.quantity ?? 1, invoice_item_id: a.itemId ?? null, acquired_on: '2026-08-20', condition: 'active', created_by: U.taylor, updated_by: U.taylor, created_at: at('2026-08-20T09:00:00Z'), updated_at: at('2026-08-20T09:00:00Z') })
  if (a.holder) {
    const when = at(`${a.since}T09:00:00Z`)
    ins('assignments', { id: id('71'), asset_id: aid, user_id: U[a.holder], assigned_on: a.since!, assigned_by: U.taylor, created_at: when, updated_at: when, updated_by: U.taylor, acknowledged_at: when })
  }
}

const digital: { kind: string; name: string; vendor: string; period: string; cost: number; currency: Cur; seats: number; renews: string; users: Who[] }[] = [
  { kind: 'software', name: 'Design suite', vendor: 'Example Software', period: 'yearly', cost: 18_000, currency: 'TRY', seats: 3, renews: '2027-02-01', users: ['sam', 'riley'] },
  { kind: 'software', name: 'Team chat', vendor: 'Sample Collaboration', period: 'monthly', cost: 8, currency: 'USD', seats: 6, renews: '2026-12-01', users: ['alex', 'jordan', 'taylor', 'sam', 'riley'] },
  { kind: 'domain', name: 'example.com', vendor: 'Demo Registrar', period: 'yearly', cost: 650, currency: 'TRY', seats: 0, renews: '2027-05-10', users: [] },
]
for (const d of digital) {
  const did = id('80')
  ins('digital_assets', { id: did, kind: d.kind, name: d.name, vendor: d.vendor, period: d.period, cost_minor: minor(d.cost), currency: d.currency, seats: d.seats || null, renews_on: d.renews, status: 'active', verified: 1, created_by: U.taylor, updated_by: U.taylor, created_at: T0, updated_at: T0 })
  for (const w of d.users) ins('digital_asset_users', { asset_id: did, user_id: U[w], added_at: T0 })
}

const jobs: { client: string; title: string; kind: string; status: string; start: string; end: string | null; amount: number | null; members: [Who, number][] }[] = [
  { client: CLIENTS[0], title: 'Onboarding guide', kind: 'design', status: 'done', start: '2026-10-01', end: '2026-10-24', amount: 30_000, members: [['sam', 6000], ['taylor', 4000]] },
  { client: CLIENTS[1], title: 'Website maintenance, November', kind: 'support', status: 'active', start: '2026-11-01', end: '2026-11-30', amount: 12_500, members: [['riley', 10000]] },
  { client: CLIENTS[2], title: 'Brand refresh, phase one', kind: 'project', status: 'active', start: '2026-09-15', end: '2026-12-20', amount: 90_000, members: [['sam', 5000], ['riley', 2500], ['taylor', 2500]] },
  { client: CLIENTS[3], title: 'Process review workshop', kind: 'consulting', status: 'not_started', start: '2026-12-02', end: null, amount: null, members: [['taylor', 10000]] },
  { client: CLIENTS[0], title: 'Newsletter campaign', kind: 'marketing', status: 'done', start: '2026-08-10', end: '2026-08-28', amount: 8_000, members: [['sam', 10000]] },
]
for (const j of jobs) {
  const jid = id('85')
  const created = at(`${j.start}T09:00:00Z`)
  ins('jobs', { id: jid, client: j.client, title: j.title, kind: j.kind, status: j.status, start_date: j.start, end_date: j.end, amount_minor: j.amount === null ? null : minor(j.amount), created_by: U.taylor, updated_by: U.taylor, created_at: created, updated_at: created })
  for (const [w, bp] of j.members) ins('job_members', { job_id: jid, user_id: U[w], share_bp: bp, added_at: created, added_by: U.taylor })
}

const FIXED = { personnel: 410_000, office: 52_000, software: 9_500, equipment: 6_000, professional: 12_000, other: 3_500 }
for (const m of ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']) {
  for (const [kind, amount] of Object.entries(FIXED)) ins('fixed_costs', { id: id('95'), month: m, kind, amount_minor: minor(amount), created_by: U.alex, updated_by: U.alex, created_at: at(`${m}-01T08:00:00Z`), updated_at: at(`${m}-01T08:00:00Z`) })
}

sql(`UPDATE finance_settings SET usd_rate_micro = ${micro('USD')}, eur_rate_micro = ${micro('EUR')}, fx_updated_on = '2026-11-20';`)

const sqlPath = join(APP, 'seed/demo.sql')
writeFileSync(sqlPath, `${out.join('\n')}\n`)
console.log(`seed/demo.sql: ${out.length} statements, ${FILES.length} files`)

if (process.argv.includes('--apply')) {
  const run = (args: string[]) => execFileSync('npx', ['wrangler', ...args], { cwd: APP, stdio: ['ignore', 'ignore', 'inherit'] })
  run(['d1', 'execute', 'DB', '--local', '--file', 'seed/demo.sql'])
  let bucket = 'small-business-workflow-files'
  try {
    bucket = JSON.parse(readFileSync(join(APP, 'wrangler.jsonc'), 'utf8')).r2_buckets[0].bucket_name || bucket
  } catch {}
  for (const f of FILES) run(['r2', 'object', 'put', `${bucket}/${f.key}`, '--local', '--file', `seed/files/${f.file}`])
  console.log('Local D1 and R2 are ready. Demo accounts:')
  for (const p of Object.values(PEOPLE)) console.log(`  ${p.email} (${p.role}${p.admin ? ', admin' : ''})`)
  console.log(`Password for every demo account: ${DEMO_PASSWORD}`)
}
