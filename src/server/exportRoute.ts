import { env } from 'cloudflare:workers'
import { t } from '#/i18n'
import { authorize, type AuthUser } from './auth/authorize'
import { reportSheets, validMonth } from './services/reports'
import { todayISO } from './time'
import { buildXlsx } from './xlsx'

const KINDS = { 'leave.xlsx': 'leave', 'expense.xlsx': 'expense', 'purchase.xlsx': 'purchase' } as const

export async function handleExportRequest(request: Request, url: URL, user: AuthUser): Promise<Response> {
  if (request.method !== 'GET') return new Response(null, { status: 405 })
  const kind = KINDS[url.pathname.slice('/exports/'.length) as keyof typeof KINDS]
  const month = url.searchParams.get('month')
  if (!kind || !validMonth(month) || !authorize(user, { a: 'report.read' }).ok) {
    return new Response(t('server.notFound'), { status: 404, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' } })
  }
  const { filename, sheets } = await reportSheets({ db: env.DB, user, store: { put: async () => {}, discard: async () => {} }, today: todayISO() }, kind, month)
  return new Response(buildXlsx(sheets) as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
