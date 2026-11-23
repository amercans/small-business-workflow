import { useState } from 'react'
import { Field, fieldA11y } from './Field'
import { RequestSheet, SheetAside, SheetLayout } from './RequestSheet'
import { Select } from './Select'
import { SummaryCard } from './SummaryCard'
import { Switch } from './Switch'
import { LinkBox } from './LinkBox'
import { createResetLink, submitUser, userSchema, type AppUser } from '#/data/users'
import { t } from '#/i18n'
import { roleLabel, type Role } from '#/lib/permissions'
import { useSubmit } from '#/lib/useSubmit'

export function UserSheet({ target, actorId, emailDomain, mailDelivers, onClose, onSaved }: { target: AppUser | 'new' | null; actorId: string; emailDomain: string; mailDelivers: boolean; onClose: () => void; onSaved: (u: AppUser, warning?: string) => void }) {
  return (
    <RequestSheet open={target !== null} onClose={onClose} returnFocusKey={target && target !== 'new' ? `edit-${target.id}` : 'add-user'}>
      {target !== null && <UserForm user={target === 'new' ? null : target} actorId={actorId} emailDomain={emailDomain} mailDelivers={mailDelivers} onClose={onClose} onSaved={onSaved} />}
    </RequestSheet>
  )
}

const ROLES: Role[] = ['employee', 'manager', 'approver', 'owner']

function UserForm({ user, actorId, emailDomain, mailDelivers, onClose, onSaved }: { user: AppUser | null; actorId: string; emailDomain: string; mailDelivers: boolean; onClose: () => void; onSaved: (u: AppUser, warning?: string) => void }) {
  const isSelf = user?.id === actorId
  const [displayName, setName] = useState(user?.displayName ?? '')
  const [department, setDepartment] = useState(user?.department ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [role, setRole] = useState<Role>(user?.role ?? 'employee')
  const [leave, setLeave] = useState(String(user?.leaveEntitlement ?? 14))
  const [isAdmin, setAdmin] = useState(user?.isAdmin ?? false)
  const [canUpload, setCanUpload] = useState(user?.canUploadInvoices ?? false)
  const [canJobs, setCanJobs] = useState(user?.canManageJobs ?? false)
  const pending = user?.status === 'pending'
  const [active, setActive] = useState(pending || (user?.status ?? 'active') === 'active')
  const unverified = pending && !user?.emailVerified
  const [approveUnverified, setApproveUnverified] = useState(false)
  const [reset, setReset] = useState<{ busy: boolean; url?: string; error?: string }>({ busy: false })
  const [canLogin, setCanLogin] = useState(user?.canLogin ?? true)
  const shownEmail = user && !user.canLogin && email.endsWith('@no-login.invalid') ? '' : email

  const { errors, warning, busy, run, clear } = useSubmit({
    schema: userSchema,
    submit: submitUser,
    onClose,
    onSubmitted: (r) => onSaved(r.user, r.warning),
    build: () => ({
      id: user?.id,
      displayName,
      department: department.trim() || undefined,
      email: canLogin ? email : shownEmail,
      canLogin,
      role,
      isAdmin,
      canUploadInvoices: role === 'employee' && canUpload,
      canManageJobs: role === 'employee' && canJobs,
      leaveEntitlement: leave.trim() === '' ? undefined : Number(leave),
      status: active ? 'active' : 'inactive',
      approveUnverified: unverified && approveUnverified ? true : undefined,
    }),
  })

  const flags = [isAdmin ? t('users.sheet.flagAdmin') : null, role === 'employee' && canUpload ? t('users.sheet.flagInvoices') : null, role === 'employee' && canJobs ? t('users.sheet.flagJobs') : null, !active ? t('users.sheet.flagInactive') : null].filter(Boolean).join(' · ')

  async function makeReset() {
    if (!user) return
    setReset({ busy: true })
    const r = await createResetLink(user.id)
    setReset(r.ok ? { busy: false, url: r.url } : { busy: false, error: r.error })
  }

  return (
    <SheetLayout
      title={pending ? t('users.sheet.titlePending') : user ? t('users.sheet.titleEdit') : t('users.sheet.titleNew')}
      subtitle={t('users.sheet.subtitle')}
      onSubmit={run}
      onCancel={onClose}
      busy={busy}
      summary={
        <SummaryCard
          tone="leave"
          kicker={roleLabel(role)}
          headline={displayName.trim() || t('users.sheet.newUser')}
          big={t('users.days', { count: Number(leave) || 0 })}
          rows={[
            { label: t('users.sheet.emailRow'), value: <span className="break-all">{email.trim() || '—'}</span> },
            { label: t('users.sheet.leaveRow'), value: t('users.days', { count: Number(leave) || 0 }) },
            ...(flags ? [{ label: t('users.sheet.statusRow'), value: flags }] : []),
          ]}
        />
      }
      aside={<SheetAside onay={t('users.sheet.aside')} warning={warning} />}
    >
      <Field id="usr-name" label={t('users.sheet.name')} error={errors.displayName} className="mt-5">
        <input {...fieldA11y('usr-name', errors.displayName)} type="text" maxLength={60} value={displayName} onChange={(e) => { setName(e.target.value); clear('displayName') }} placeholder={t('users.sheet.namePlaceholder')} className="input" />
      </Field>

      <Field id="usr-dept" label={t('users.sheet.dept')} optional error={errors.department} hint={t('users.sheet.deptHint')} className="mt-5.5">
        <input {...fieldA11y('usr-dept', errors.department, 'x')} type="text" maxLength={80} value={department} onChange={(e) => { setDepartment(e.target.value); clear('department') }} placeholder={t('users.sheet.deptPlaceholder')} className="input" />
      </Field>

      <div className="mt-5.5">
        <Switch checked={canLogin} onChange={(v) => { setCanLogin(v); clear('email'); clear('canLogin') }} label={t('users.sheet.canLogin')} />
        {errors.canLogin ? (
          <p role="alert" className="mt-1.5 text-micro text-status-rejected">{errors.canLogin}</p>
        ) : (
          !canLogin && <p className="mt-1.5 text-micro text-faint">{t('users.sheet.noLoginHint')}</p>
        )}
      </div>

      {canLogin && (
        <Field id="usr-email" label={t('users.sheet.email')} error={errors.email} hint={emailDomain ? t('users.sheet.emailDomain', { domain: emailDomain }) : undefined} className="mt-5.5">
          <input {...fieldA11y('usr-email', errors.email, 'x')} type="email" inputMode="email" maxLength={200} value={shownEmail} onChange={(e) => { setEmail(e.target.value); clear('email') }} className="input" />
        </Field>
      )}

      <div className="mt-5.5 grid gap-3.5 sm:grid-cols-[1fr_9rem]">
        <Field id="usr-role" label={t('users.sheet.role')} error={errors.role}>
          <Select {...fieldA11y('usr-role', errors.role)} value={role} onChange={(e) => { setRole(e.target.value as Role); clear('role') }}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="usr-leave" label={t('users.sheet.leave')} error={errors.leaveEntitlement}>
          <input {...fieldA11y('usr-leave', errors.leaveEntitlement)} type="text" inputMode="numeric" value={leave} onChange={(e) => { setLeave(e.target.value.replace(/[^\d]/g, '')); clear('leaveEntitlement') }} className="input num" />
        </Field>
      </div>

      <div className="mt-5.5 flex flex-col gap-2.5">
        {role === 'employee' && <Switch checked={canUpload} onChange={setCanUpload} label={t('users.sheet.canUpload')} />}
        {role === 'employee' && <Switch checked={canJobs} onChange={setCanJobs} label={t('users.sheet.canJobs')} />}
        {canLogin && <Switch checked={isAdmin} onChange={(v) => { setAdmin(v); clear('isAdmin') }} label={t('users.sheet.isAdmin')} />}
        {errors.isAdmin && <p role="alert" className="text-micro text-status-rejected">{errors.isAdmin}</p>}
        {user && !pending && <Switch checked={active} onChange={(v) => { setActive(v); clear('status') }} label={t('users.sheet.active')} />}
        {pending && (
          <Field id="usr-decision" label={t('users.sheet.decision')}>
            <Select {...fieldA11y('usr-decision')} value={active ? 'active' : 'inactive'} onChange={(e) => { setActive(e.target.value === 'active'); clear('status') }}>
              <option value="active">{t('users.sheet.approve')}</option>
              <option value="inactive">{t('users.sheet.reject')}</option>
            </Select>
          </Field>
        )}
        {unverified && (
          <div role="note" className="rounded-xl bg-kar-wash px-3.5 py-3 text-micro text-ink">
            <p className="font-semibold text-status-rejected">{t('users.unverified')}</p>
            <p className="mt-1 text-muted">{mailDelivers ? t('users.sheet.unverifiedBlocked') : t('users.sheet.unverifiedWarn')}</p>
            {!mailDelivers && active && (
              <label className="mt-2.5 flex cursor-pointer items-start gap-2.5">
                <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-blue)]" checked={approveUnverified} onChange={(e) => { setApproveUnverified(e.target.checked); clear('status') }} />
                <span>{t('users.sheet.approveUnverified')}</span>
              </label>
            )}
          </div>
        )}
        {errors.status && <p role="alert" className="text-micro text-status-rejected">{errors.status}</p>}
        {isSelf && <p className="text-micro text-faint">{t('users.sheet.selfHint')}</p>}
      </div>

      {user && user.status === 'active' && user.canLogin && (
        <div className="mt-6 border-t border-kar-line-2 pt-5">
          <button type="button" data-k="reset-link" onClick={makeReset} disabled={reset.busy} className="btn btn-sec text-small">
            {reset.busy ? t('users.reset.busy') : t('users.reset.button')}
          </button>
          {reset.url && <LinkBox url={reset.url} note={t('users.reset.lead')} />}
          {reset.error && (
            <p role="alert" className="mt-2 text-micro text-status-rejected">
              {reset.error}
            </p>
          )}
        </div>
      )}
    </SheetLayout>
  )
}
