import { useState } from 'react'
import { ConfirmDialog } from './ConfirmDialog'
import { Field, fieldA11y } from './Field'
import { LinkBox } from './LinkBox'
import { Select } from './Select'
import { createInviteLink } from '#/data/users'
import { formatDate } from '#/i18n/format'
import { t } from '#/i18n'
import { roleLabel, type Role } from '#/lib/permissions'

const ROLES: Role[] = ['employee', 'manager', 'approver', 'owner']

export function InviteDialog({ open, onClose, emailDomain }: { open: boolean; onClose: () => void; emailDomain: string }) {
  const [role, setRole] = useState<Role>('employee')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null)

  const close = () => {
    setLink(null)
    setError('')
    setEmail('')
    onClose()
  }

  async function create() {
    if (link) return close()
    setBusy(true)
    setError('')
    const r = await createInviteLink({ role, email: email.trim() || undefined })
    setBusy(false)
    if (!r.ok) return setError(r.error)
    setLink({ url: r.url, expiresAt: r.expiresAt })
  }

  return (
    <ConfirmDialog open={open} title={t('users.invite.title')} body={t('users.invite.lead')} confirmLabel={link ? t('users.invite.close') : t('users.invite.create')} cancelLabel={t('users.invite.close')} onConfirm={create} onCancel={close} busy={busy}>
      {link ? (
        <div className="mt-2">
          <p className="text-small font-medium text-ink">{t('users.invite.ready')}</p>
          <LinkBox url={link.url} note={t('users.invite.expires', { date: formatDate(link.expiresAt, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) })} />
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-4">
          <Field id="inv-role" label={t('users.invite.role')}>
            <Select {...fieldA11y('inv-role')} value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="inv-email" label={t('users.invite.email')} optional hint={emailDomain ? `${t('users.invite.emailHint')} ${t('users.sheet.emailDomain', { domain: emailDomain })}` : t('users.invite.emailHint')}>
            <input {...fieldA11y('inv-email', undefined, 'x')} type="email" inputMode="email" maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} className="input" />
          </Field>
          {error && (
            <p role="alert" className="text-small text-status-rejected">
              {error}
            </p>
          )}
        </div>
      )}
    </ConfirmDialog>
  )
}
