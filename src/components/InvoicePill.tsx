import { beforeBooksHint } from '#/lib/invoice'
import { t } from '#/i18n'

export function InvoicePill({ className = 'ml-2 shrink-0' }: { className?: string }) {
  return <span className={`kar-pill ok text-tab ${className}`}>{t('invoices.pill.hasInvoice')}</span>
}

export function BeforeBooksPill({ className = 'ml-2 shrink-0', direction = 'in' }: { className?: string; direction?: 'in' | 'out' }) {
  return (
    <span className={`kar-pill wait text-tab ${className}`} title={beforeBooksHint(direction)}>
      {t('invoices.pill.beforeBooks')}
    </span>
  )
}

export function TitleRow({ children, pills }: { children: React.ReactNode; pills?: React.ReactNode }) {
  return (
    <span className="flex min-w-0 items-center">
      <span className="min-w-0 truncate">{children}</span>
      {pills}
    </span>
  )
}

export function ApprovalPill({ status, note, className = 'ml-2 shrink-0' }: { status: 'pending' | 'approved' | 'rejected'; note?: string; className?: string }) {
  if (status === 'pending')
    return (
      <span className={`kar-pill wait text-tab ${className}`} title={t('invoices.pill.pendingHint')}>
        {t('invoices.pill.pending')}
      </span>
    )
  if (status === 'rejected')
    return (
      <span className={`kar-pill no text-tab ${className}`} title={note ? t('invoices.pill.rejectedNote', { note }) : t('invoices.pill.rejectedHint')}>
        {t('invoices.pill.rejected')}
      </span>
    )
  return null
}
