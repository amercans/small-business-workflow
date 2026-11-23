import { useState } from 'react'
import { createFileRoute, getRouteApi, Link } from '@tanstack/react-router'
import { Avatar } from '#/components/Avatar'
import { DataList, type Column } from '#/components/DataList'
import { Icon } from '#/components/Icon'
import { UserSheet } from '#/components/UserSheet'
import { loadUsers, revokeLink, type AppUser, type OpenLink } from '#/data/users'
import { formatDate } from '#/i18n/format'
import { guard } from '#/lib/guard'
import { roleLabel } from '#/lib/permissions'
import { useSheetState } from '#/lib/useSheetState'
import { t } from '#/i18n'
import { InviteDialog } from '#/components/InviteDialog'

export const Route = createFileRoute('/users')({
  validateSearch: (s: Record<string, unknown>): { new?: 1 } => (s.new === 1 || s.new === '1' ? { new: 1 } : {}),
  beforeLoad: guard('users'),
  loader: () => loadUsers(),
  component: Users,
})

const rootApi = getRouteApi('__root__')

function Users() {
  const { user: me } = rootApi.useRouteContext().session
  const { users: initial, emailDomain, mailDelivers, tokens } = Route.useLoaderData()
  const [links, setLinks] = useState<OpenLink[]>(tokens)
  const [linkError, setLinkError] = useState('')
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const [list, setList] = useState<AppUser[]>(initial)
  const [editing, setEditing] = useState<AppUser | null>(null)
  const [flash, setFlash] = useState('')
  const [inviting, setInviting] = useState(false)
  const add = useSheetState(search.new === 1, (open, replace) => void navigate({ search: open ? { new: 1 } : {}, replace }))
  const target: AppUser | 'new' | null = editing ?? (add.open ? 'new' : null)

  const columns: Column<AppUser>[] = [
    {
      key: 'name',
      header: t('users.cols.user'),
      primary: true,
      cell: (u) => (
        <span className="flex items-center gap-3">
          <Avatar name={u.displayName} hue={u.avatarHue} className="size-8" />
          <b className="text-row font-semibold">{u.displayName}</b>
          {!u.emailVerified && u.status === 'pending' && <span className="kar-pill wait text-tab">{t('users.unverified')}</span>}
        </span>
      ),
    },
    { key: 'email', header: t('users.cols.email'), cell: (u) => (u.canLogin ? <span className="text-link break-all text-muted">{u.email}</span> : <span className="kar-pill off">{t('users.noLogin')}</span>) },
    { key: 'role', header: t('users.cols.role'), cell: (u) => <span className="text-link">{roleLabel(u.role)}{u.isAdmin && <span className="ml-2 rounded-full bg-ink px-2 py-0.5 text-tab font-semibold text-on-dark">{t('users.admin')}</span>}</span> },
    { key: 'inv', header: t('users.cols.invoices'), cell: (u) => (u.role === 'employee' ? <span className="text-link">{u.canUploadInvoices ? t('users.yes') : '—'}</span> : <span className="text-faint">—</span>) },
    { key: 'jobs', header: t('users.cols.jobs'), cell: (u) => (u.role === 'employee' ? <span className="text-link">{u.canManageJobs ? t('users.yes') : '—'}</span> : <span className="text-faint">—</span>) },
    { key: 'leave', header: t('users.cols.leave'), right: true, cell: (u) => (u.canLogin ? <span className="num text-link">{t('users.days', { count: u.leaveEntitlement })}</span> : <span className="text-faint">—</span>) },
    {
      key: 'status',
      header: t('users.cols.status'),
      cell: (u) => (
        <span className="inline-flex items-center gap-1.5 text-micro font-medium">
          <span className={`size-1.75 rounded-full ${u.status === 'active' ? 'bg-status-approved' : u.status === 'pending' ? 'bg-status-pending' : 'bg-status-cancelled'}`} />
          {t(`users.status.${u.status}` as const)}
        </span>
      ),
    },
    {
      key: 'act',
      header: '',
      right: true,
      cell: (u) => (
        <button type="button" data-k={`edit-${u.id}`} onClick={() => setEditing(u)} className="min-h-9 rounded-full bg-wash px-3.5 py-1.5 text-micro font-semibold text-ink sm:min-h-0">
          {u.status === 'pending' ? t('users.review') : t('users.edit')}
        </button>
      ),
    },
  ]

  return (
    <section className="pb-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-display-sm font-semibold sm:text-display">{t('users.title')}</h1>
          <p className="mt-2.5 text-label text-muted">
            {t('users.summary', { active: list.filter((u) => u.status === 'active').length, total: list.length })}
            {list.some((u) => u.status === 'pending') && <b className="ml-2 font-semibold text-ink">· {t('users.pendingSummary', { count: list.filter((u) => u.status === 'pending').length })}</b>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Link to="/undertakings" className="btn btn-sec no-underline">
            {t('users.printUndertakings')}
          </Link>
          <button type="button" data-k="invite-user" onClick={() => setInviting(true)} className="btn btn-sec">
            {t('users.inviteButton')}
          </button>
          <button type="button" data-k="add-user" onClick={add.openSheet} className="btn btn-pri">
            <Icon name="plus" size={16} strokeWidth={2} />
            {t('users.add')}
          </button>
        </div>
      </div>

      {flash && (
        <p role="status" className="mt-4 text-link font-medium text-status-approved">
          {flash}
        </p>
      )}

      <div className="mt-6">
        <DataList label={t('users.title')} rows={list} columns={columns} template="minmax(0,2fr) minmax(0,2.2fr) minmax(0,1.5fr) 7rem 6.5rem 6rem 6rem 6rem" rowKey={(u) => u.id} />
      </div>

      <UserSheet
        mailDelivers={mailDelivers}
        target={target}
        actorId={me.id}
        emailDomain={emailDomain}
        onClose={() => (editing ? setEditing(null) : add.closeSheet())}
        onSaved={(u, warning) => {
          setList((l) => (l.some((x) => x.id === u.id) ? l.map((x) => (x.id === u.id ? u : x)) : [...l, u]))
          setFlash(`${t('users.saved', { name: u.displayName })}${warning ? ` ${warning}` : ''}`)
        }}
      />
      <section className="mt-8" aria-labelledby="open-links">
        <h2 id="open-links" className="text-row font-semibold">{t('users.links.title')}</h2>
        {links.length === 0 ? (
          <p className="mt-2 text-label text-muted">{t('users.links.empty')}</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {links.map((l) => (
              <li key={l.id} className="kar flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <span className="text-label">
                  <b className="font-semibold">{l.kind === 'invite' ? t('users.links.invite') : t('users.links.reset')}</b>
                  {' · '}
                  {t('users.links.for', { who: l.kind === 'reset' ? (l.userName ?? '') : (l.email ?? t('users.links.anyone')) })}
                  {l.kind === 'invite' && l.role ? ` · ${roleLabel(l.role)}` : ''}
                  <span className="text-muted">{' · '}{t('users.links.expires', { date: formatDate(l.expiresAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) })}</span>
                </span>
                <button
                  type="button"
                  className="min-h-9 rounded-full bg-wash px-3.5 py-1.5 text-micro font-semibold text-ink"
                  onClick={async () => {
                    setLinkError('')
                    const r = await revokeLink(l.id)
                    if (r.ok) setLinks((x) => x.filter((y) => y.id !== l.id))
                    else setLinkError(r.error)
                  }}
                >
                  {t('users.links.revoke')}
                </button>
              </li>
            ))}
          </ul>
        )}
        {linkError && (
          <p role="alert" className="mt-2 text-small text-status-rejected">
            {linkError}
          </p>
        )}
      </section>
      <InviteDialog open={inviting} onClose={() => setInviting(false)} emailDomain={emailDomain} />
    </section>
  )
}
