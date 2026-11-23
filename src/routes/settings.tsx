import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Select } from '#/components/Select'
import { loadSettings, saveApprovals, saveJobType } from '#/data/settings'
import { t } from '#/i18n'
import { APPROVER_ROLES, REQUEST_KINDS, ROLES, type ApprovalRules, type ApproverRole } from '#/lib/approvals'
import { guard } from '#/lib/guard'
import { jobTypeLabel, type JobType } from '#/lib/jobs'
import { roleLabel, type Role } from '#/lib/permissions'

export const Route = createFileRoute('/settings')({
  beforeLoad: guard('settings'),
  loader: () => loadSettings(),
  component: Settings,
})

function Settings() {
  const data = Route.useLoaderData()
  return (
    <section className="pb-10">
      <h1 className="text-display-sm font-semibold sm:text-display">{t('settings.title')}</h1>
      <p className="mt-2.5 max-w-[62ch] text-label text-muted">{t('settings.lead')}</p>
      <div className="mt-6 flex flex-col gap-6">
        <ApprovalsSection initial={data.approvals} />
        <JobTypesSection initial={data.jobTypes} />
      </div>
    </section>
  )
}

function ApprovalsSection({ initial }: { initial: ApprovalRules }) {
  const [rules, setRules] = useState<ApprovalRules>(initial)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const setRoute = (kind: (typeof REQUEST_KINDS)[number], requester: Role, approver: ApproverRole) =>
    setRules((r) => ({ ...r, routes: { ...r.routes, [kind]: { ...r.routes[kind], [requester]: approver } } }))
  const toggleAuto = (role: Role, on: boolean) => setRules((r) => ({ ...r, autoApprove: on ? [...new Set([...r.autoApprove, role])] : r.autoApprove.filter((x) => x !== role) }))

  async function save() {
    setBusy(true)
    setMsg(null)
    const res = await saveApprovals(rules)
    setBusy(false)
    if (!res.ok) return setMsg({ ok: false, text: res.error })
    setRules(res.approvals)
    setMsg({ ok: true, text: t('settings.approvals.saved') })
  }

  return (
    <section className="kar p-4.5 sm:p-6" aria-labelledby="settings-approvals">
      <h2 id="settings-approvals" className="text-row font-semibold">
        {t('settings.approvals.title')}
      </h2>
      <p className="mt-1.5 max-w-[70ch] text-small text-muted">{t('settings.approvals.lead')}</p>
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[36rem] border-separate border-spacing-y-1.5 text-left text-small">
          <thead>
            <tr>
              <th className="pr-3 text-micro font-semibold text-muted">{t('settings.approvals.requester')}</th>
              {ROLES.map((role) => (
                <th key={role} scope="col" className="px-1.5 text-micro font-semibold text-muted">
                  {roleLabel(role)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {REQUEST_KINDS.map((kind) => (
              <tr key={kind}>
                <th scope="row" className="pr-3 font-medium text-ink">
                  {t(`settings.approvals.kinds.${kind}`)}
                </th>
                {ROLES.map((role) => (
                  <td key={role} className="px-1.5">
                    <Select
                      aria-label={`${t(`settings.approvals.kinds.${kind}`)} · ${roleLabel(role)}`}
                      data-k={`route-${kind}-${role}`}
                      value={rules.routes[kind][role]}
                      disabled={rules.autoApprove.includes(role)}
                      onChange={(e) => setRoute(kind, role, e.target.value as ApproverRole)}
                      className="h-10 text-small"
                    >
                      {APPROVER_ROLES.map((a) => (
                        <option key={a} value={a}>
                          {roleLabel(a)}
                        </option>
                      ))}
                    </Select>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <fieldset className="mt-5">
        <legend className="text-micro font-semibold text-muted">{t('settings.approvals.auto')}</legend>
        <p className="mt-1 text-micro text-faint">{t('settings.approvals.autoHint')}</p>
        <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-2">
          {ROLES.map((role) => (
            <label key={role} className="flex cursor-pointer items-center gap-2 text-small">
              <input type="checkbox" data-k={`auto-${role}`} className="size-4.5 accent-[var(--color-blue)]" checked={rules.autoApprove.includes(role)} onChange={(e) => toggleAuto(role, e.target.checked)} />
              {roleLabel(role)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="button" data-k="save-approvals" onClick={save} disabled={busy} className="btn btn-pri">
          {t('settings.approvals.save')}
        </button>
        {msg && (
          <p role={msg.ok ? 'status' : 'alert'} className={`text-small font-medium ${msg.ok ? 'text-status-approved' : 'text-status-rejected'}`}>
            {msg.text}
          </p>
        )}
      </div>
    </section>
  )
}

function JobTypesSection({ initial }: { initial: JobType[] }) {
  const [types, setTypes] = useState<JobType[]>(initial)
  const [label, setLabel] = useState('')
  const [editing, setEditing] = useState<{ id: string; label: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run(input: Parameters<typeof saveJobType>[0]) {
    setBusy(true)
    setError('')
    const r = await saveJobType(input)
    setBusy(false)
    if (!r.ok) {
      setError(r.error)
      return false
    }
    setTypes(r.types)
    return true
  }

  return (
    <section className="kar p-4.5 sm:p-6" aria-labelledby="settings-job-types">
      <h2 id="settings-job-types" className="text-row font-semibold">
        {t('settings.jobTypes.title')}
      </h2>
      <p className="mt-1.5 max-w-[70ch] text-small text-muted">{t('settings.jobTypes.lead')}</p>
      <ul className="mt-4 flex flex-col divide-y divide-kar-line-2">
        {types.map((type) => (
          <li key={type.id} className="flex flex-wrap items-center gap-3 py-2.5">
            {editing?.id === type.id ? (
              <form
                className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
                onSubmit={async (e) => {
                  e.preventDefault()
                  if (await run({ id: type.id, label: editing.label, archived: type.archived })) setEditing(null)
                }}
              >
                <input aria-label={t('settings.jobTypes.rename')} className="input h-10 min-w-0 flex-1 text-small" maxLength={60} value={editing.label} onChange={(e) => setEditing({ id: type.id, label: e.target.value })} />
                <button type="submit" disabled={busy} className="btn btn-pri h-10 px-4 text-small">
                  {t('settings.jobTypes.save')}
                </button>
                <button type="button" onClick={() => setEditing(null)} className="btn btn-sec h-10 px-4 text-small">
                  {t('settings.jobTypes.cancel')}
                </button>
              </form>
            ) : (
              <>
                <span className={`min-w-0 flex-1 text-label ${type.archived ? 'text-faint line-through' : 'text-ink'}`}>{jobTypeLabel(type)}</span>
                {type.key && <span className="kar-pill off text-tab">{t('settings.jobTypes.builtIn')}</span>}
                {type.archived && <span className="kar-pill wait text-tab">{t('settings.jobTypes.archived')}</span>}
                {!type.key && !type.archived && (
                  <button type="button" onClick={() => setEditing({ id: type.id, label: type.label ?? '' })} className="min-h-9 rounded-full bg-wash px-3.5 py-1.5 text-micro font-semibold text-ink">
                    {t('settings.jobTypes.rename')}
                  </button>
                )}
                <button type="button" data-k={`archive-${type.id}`} disabled={busy} onClick={() => run({ id: type.id, archived: !type.archived })} className="min-h-9 rounded-full bg-wash px-3.5 py-1.5 text-micro font-semibold text-ink">
                  {type.archived ? t('settings.jobTypes.restore') : t('settings.jobTypes.archive')}
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form
        className="mt-4 flex flex-wrap items-center gap-2"
        onSubmit={async (e) => {
          e.preventDefault()
          if (await run({ label })) setLabel('')
        }}
      >
        <input aria-label={t('settings.jobTypes.newPlaceholder')} placeholder={t('settings.jobTypes.newPlaceholder')} className="input h-10 min-w-0 flex-1 text-small sm:max-w-sm" maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} />
        <button type="submit" data-k="add-job-type" disabled={busy || !label.trim()} className="btn btn-pri h-10 px-4 text-small">
          {t('settings.jobTypes.add')}
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-small text-status-rejected">
          {error}
        </p>
      )}
    </section>
  )
}
