import { useState } from 'react'
import { ConfirmDialog } from './ConfirmDialog'
import { Field, fieldA11y } from './Field'
import { RequestSheet, SheetAside, SheetLayout } from './RequestSheet'
import { Select } from './Select'
import { SummaryCard } from './SummaryCard'
import { assetEditSchema, assetSchema, assignAsset, assignSchema, STATUS_LABEL, statusOf, submitAsset, toOffice, updateAsset, type Asset } from '#/data/inventory'
import { dateLabel } from '#/data/invoices'
import { useSession } from '#/lib/useSession'
import { useSubmit } from '#/lib/useSubmit'
import { t } from '#/i18n'

const CATEGORY_KEYS = ['camera', 'lens', 'gimbal', 'battery', 'charger', 'memoryCard', 'externalDrive', 'ssd', 'laptop', 'desktop', 'monitor', 'tablet'] as const

export interface AssignableUser {
  id: string
  displayName: string
}

export function AssetAddSheet({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (a: Asset) => void }) {
  return (
    <RequestSheet open={open} onClose={onClose} returnFocusKey="add-asset">
      <AssetAddForm onClose={onClose} onAdded={onAdded} />
    </RequestSheet>
  )
}

function AssetAddForm({ onClose, onAdded }: { onClose: () => void; onAdded: (a: Asset) => void }) {
  const TODAY = useSession().todayISO
  const [name, setName] = useState('')
  const [serial, setSerial] = useState('')
  const [date, setDate] = useState(TODAY)
  const [note, setNote] = useState('')
  const [category, setCategory] = useState('')
  const [qty, setQty] = useState('1')
  const [source, setSource] = useState('')
  const { errors, warning, busy, run, clear } = useSubmit({
    schema: assetSchema,
    submit: submitAsset,
    onClose,
    onSubmitted: (r) => onAdded(r.asset),
    build: () => ({ name, serial: serial || undefined, acquiredOn: date || undefined, note: note || undefined, category: category || undefined, quantity: qty ? Number(qty) : undefined, source: source || undefined }),
  })
  return (
    <SheetLayout
      title={t('assets.add.title')}
      subtitle={t('assets.add.subtitle')}
      onSubmit={run}
      onCancel={onClose}
      busy={busy}
      summary={
        <SummaryCard
          tone="leave"
          kicker={t('assets.equipment')}
          headline={name.trim() || t('assets.namePlaceholder')}
          big={STATUS_LABEL.stock}
          rows={[...(serial.trim() ? [{ label: t('assets.serial'), value: serial.trim() }] : []), ...(date ? [{ label: t('assets.acquired'), value: dateLabel(date) }] : [])]}
        />
      }
      aside={<SheetAside onay={t('assets.add.aside')} warning={warning} />}
    >
      <div className="mt-5 grid gap-3.5 sm:grid-cols-[1fr_7rem]">
        <Field id="as-cat" label={t('assets.category')} optional error={errors.category}>
          <input {...fieldA11y('as-cat', errors.category)} type="text" maxLength={60} value={category} list="as-cat-list" onChange={(e) => setCategory(e.target.value)} placeholder={t('assets.categoryPlaceholder')} className="input" />
          <datalist id="as-cat-list">
            {CATEGORY_KEYS.map((k) => t(`assets.categories.${k}`)).map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field id="as-qty" label={t('assets.quantity')} error={errors.quantity}>
          <input {...fieldA11y('as-qty', errors.quantity)} type="text" inputMode="numeric" value={serial.trim() ? '1' : qty} disabled={!!serial.trim()} onChange={(e) => { setQty(e.target.value.replace(/[^\d]/g, '').slice(0, 4)); clear('quantity') }} className="input num" />
        </Field>
      </div>
      <Field id="as-name" label={t('assets.model')} error={errors.name} className="mt-5.5">
        <input {...fieldA11y('as-name', errors.name)} type="text" maxLength={200} value={name} onChange={(e) => { setName(e.target.value); clear('name') }} placeholder={t('assets.modelPlaceholder')} className="input" />
      </Field>
      <div className="mt-5.5 grid gap-3.5 sm:grid-cols-2">
        <Field id="as-serial" label={t('assets.serial')} optional error={errors.serial}>
          <input {...fieldA11y('as-serial', errors.serial)} type="text" maxLength={100} value={serial} onChange={(e) => { setSerial(e.target.value); clear('serial') }} className="input" />
        </Field>
        <Field id="as-date" label={t('assets.acquiredOn')} error={errors.acquiredOn}>
          <input {...fieldA11y('as-date', errors.acquiredOn)} type="date" max={TODAY} value={date} onChange={(e) => { setDate(e.target.value); clear('acquiredOn') }} className="input" />
        </Field>
      </div>
      <Field id="as-source" label={t('assets.source')} optional hint={t('assets.sourceHint')} className="mt-5.5">
        <input {...fieldA11y('as-source', undefined, 'x')} type="text" maxLength={120} value={source} onChange={(e) => setSource(e.target.value)} className="input" />
      </Field>
      <Field id="as-note" label={t('assets.note')} optional hint={t('assets.noteHint')} className="mt-5.5">
        <textarea id="as-note" value={note} maxLength={1000} rows={2} onChange={(e) => setNote(e.target.value)} className="input min-h-13.5 resize-none" />
      </Field>
    </SheetLayout>
  )
}

const OTHER = '__other'

export function AssignSheet({ asset, users, onClose, onDone }: { asset: Asset | null; users: AssignableUser[]; onClose: () => void; onDone: () => void }) {
  return (
    <RequestSheet open={!!asset} onClose={onClose} returnFocusKey={asset ? `assign-${asset.id}` : ''}>
      {asset && <AssignForm asset={asset} users={users} onClose={onClose} onDone={onDone} />}
    </RequestSheet>
  )
}

function AssignForm({ asset, users, onClose, onDone }: { asset: Asset; users: AssignableUser[]; onClose: () => void; onDone: () => void }) {
  const TODAY = useSession().todayISO
  const [userId, setUserId] = useState('')
  const [other, setOther] = useState('')
  const [date, setDate] = useState(TODAY)
  const isOther = userId === OTHER
  const [note, setNote] = useState('')
  const { errors, warning, busy, run, clear } = useSubmit({
    schema: assignSchema,
    submit: (i) => assignAsset(i).then((r) => (r.ok ? { ok: true as const } : r)),
    onClose,
    onSubmitted: () => onDone(),
    build: () => ({ assetId: asset.id, userId: isOther ? undefined : userId || undefined, other: isOther ? other.trim() || undefined : undefined, date: date || undefined, note: note || undefined }),
  })
  const person = users.find((u) => u.id === userId)
  return (
    <SheetLayout
      title={t('assets.assign.title')}
      subtitle={asset.name}
      onSubmit={run}
      onCancel={onClose}
      busy={busy}
      summary={
        <SummaryCard
          tone="leave"
          kicker={t('assets.assign.kicker')}
          headline={asset.name}
          big={isOther ? other.trim() || t('assets.assign.other') : person?.displayName ?? t('assets.assign.choosePerson')}
          rows={[...(asset.serial ? [{ label: t('assets.serial'), value: asset.serial }] : []), ...(date ? [{ label: t('assets.handoverDate'), value: dateLabel(date) }] : [])]}
        />
      }
      aside={<SheetAside onay={t('assets.assign.aside')} warning={warning} />}
    >
      <Field id="asg-user" label={t('assets.assign.person')} error={errors.userId} className="mt-5">
        <Select {...fieldA11y('asg-user', errors.userId)} value={userId} onChange={(e) => { setUserId(e.target.value); clear('userId') }}>
          <option value="">{t('assets.choose')}</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName}
            </option>
          ))}
          <option value={OTHER}>{t('assets.assign.otherOption')}</option>
        </Select>
      </Field>
      {isOther && (
        <Field id="asg-other" label={t('assets.assign.whoHas')} className="mt-4" error={errors.other} hint={t('assets.assign.whoHasHint')}>
          <input {...fieldA11y('asg-other', errors.other)} type="text" maxLength={200} value={other} onChange={(e) => { setOther(e.target.value); clear('userId') }} placeholder={t('assets.assign.whoHasPlaceholder')} className="input" />
        </Field>
      )}
      <Field id="asg-date" label={t('assets.handoverDate')} error={errors.date} className="mt-5.5">
        <input {...fieldA11y('asg-date', errors.date)} type="date" max={TODAY} value={date} onChange={(e) => { setDate(e.target.value); clear('date') }} className="input" />
      </Field>
      <Field id="asg-note" label={t('assets.note')} optional className="mt-5.5">
        <textarea id="asg-note" value={note} maxLength={500} rows={2} onChange={(e) => setNote(e.target.value)} className="input min-h-13.5 resize-none" />
      </Field>
    </SheetLayout>
  )
}

export function AssetEditSheet({ asset, onClose, onSaved }: { asset: Asset | null; onClose: () => void; onSaved: () => void }) {
  return (
    <RequestSheet open={!!asset} onClose={onClose} returnFocusKey="edit-asset">
      {asset && <AssetEditForm key={asset.id} asset={asset} onClose={onClose} onSaved={onSaved} />}
    </RequestSheet>
  )
}

function AssetEditForm({ asset, onClose, onSaved }: { asset: Asset; onClose: () => void; onSaved: () => void }) {
  const TODAY = useSession().todayISO
  const [name, setName] = useState(asset.name)
  const [category, setCategory] = useState(asset.category)
  const [serial, setSerial] = useState(asset.serial)
  const [qty, setQty] = useState(String(asset.quantity))
  const [source, setSource] = useState(asset.source)
  const [date, setDate] = useState(asset.acquiredOn)
  const condition = asset.condition
  const [note, setNote] = useState(asset.note)
  const { errors, warning, busy, run, clear } = useSubmit({
    schema: assetEditSchema,
    submit: updateAsset,
    onClose,
    onSubmitted: () => onSaved(),
    build: () => ({
      id: asset.id, name, category: category || undefined, serial: serial || undefined, quantity: qty ? Number(qty) : undefined,
      source: source || undefined, acquiredOn: date || undefined, condition, note: note || undefined,
    }),
  })
  return (
    <SheetLayout
      title={t('assets.edit.title')}
      subtitle={asset.name}
      onSubmit={run}
      onCancel={onClose}
      busy={busy}
      submitLabel={t('assets.save')}
      summary={
        <SummaryCard
          tone="leave"
          kicker={category.trim() || t('assets.equipment')}
          headline={name.trim() || t('assets.namePlaceholder')}
          big={Number(qty) > 1 && !serial.trim() ? `× ${qty}` : STATUS_LABEL[statusOf(asset)]}
          rows={[...(serial.trim() ? [{ label: t('assets.serial'), value: serial.trim() }] : []), { label: t('assets.holder'), value: asset.holderName }]}
        />
      }
      aside={<SheetAside onay={t('assets.edit.aside')} warning={warning} />}
    >
      <div className="mt-5 grid gap-3.5 sm:grid-cols-[1fr_7rem]">
        <Field id="ae-cat" label={t('assets.category')} optional error={errors.category}>
          <input {...fieldA11y('ae-cat', errors.category)} type="text" maxLength={60} value={category} onChange={(e) => setCategory(e.target.value)} className="input" />
        </Field>
        <Field id="ae-qty" label={t('assets.quantity')} error={errors.quantity}>
          <input {...fieldA11y('ae-qty', errors.quantity)} type="text" inputMode="numeric" value={serial.trim() ? '1' : qty} disabled={!!serial.trim()} onChange={(e) => { setQty(e.target.value.replace(/[^\d]/g, '').slice(0, 4)); clear('quantity') }} className="input num" />
        </Field>
      </div>
      <Field id="ae-name" label={t('assets.model')} error={errors.name} className="mt-5.5">
        <input {...fieldA11y('ae-name', errors.name)} type="text" maxLength={200} value={name} onChange={(e) => { setName(e.target.value); clear('name') }} className="input" />
      </Field>
      <div className="mt-5.5 grid gap-3.5 sm:grid-cols-2">
        <Field id="ae-serial" label={t('assets.serial')} optional error={errors.serial}>
          <input {...fieldA11y('ae-serial', errors.serial)} type="text" maxLength={100} value={serial} onChange={(e) => { setSerial(e.target.value); clear('serial'); clear('quantity') }} className="input" />
        </Field>
        <Field id="ae-date" label={t('assets.acquiredOn')} optional error={errors.acquiredOn}>
          <input {...fieldA11y('ae-date', errors.acquiredOn)} type="date" max={TODAY} value={date} onChange={(e) => { setDate(e.target.value); clear('acquiredOn') }} className="input" />
        </Field>
      </div>
      <Field id="ae-source" label={t('assets.source')} optional className="mt-5.5">
        <input {...fieldA11y('ae-source')} type="text" maxLength={120} value={source} onChange={(e) => setSource(e.target.value)} className="input" />
      </Field>
      <Field id="ae-note" label={t('assets.note')} optional className="mt-5.5">
        <textarea id="ae-note" value={note} maxLength={1000} rows={2} onChange={(e) => setNote(e.target.value)} className="input min-h-13.5 resize-none" />
      </Field>
    </SheetLayout>
  )
}

export function OfficeDialog({ asset, onClose, onDone }: { asset: { id: string; name: string; holder: string | null; officeOn: string } | null; onClose: () => void; onDone: () => void }) {
  return asset ? <OfficeDialogInner key={asset.id} asset={asset} onClose={onClose} onDone={onDone} /> : null
}

function OfficeDialogInner({ asset, onClose, onDone }: { asset: { id: string; name: string; holder: string | null; officeOn: string }; onClose: () => void; onDone: () => void }) {
  const TODAY = useSession().todayISO
  const [date, setDate] = useState(asset.officeOn || TODAY)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <ConfirmDialog
      open
      title={STATUS_LABEL.stock}
      body={asset.holder ? t('assets.office.fromHolder', { name: asset.name, holder: asset.holder }) : t('assets.office.fixDate', { name: asset.name })}
      confirmLabel={t('assets.save')}
      busy={busy}
      onConfirm={async () => {
        if (!date) return setError(t('assets.office.dateRequired'))
        setBusy(true)
        const r = await toOffice(asset.id, date)
        setBusy(false)
        if (!r.ok) return setError(r.fieldErrors?.date ?? r.error)
        onClose()
        onDone()
      }}
      onCancel={onClose}
    >
      <label htmlFor="office-date" className="mt-3 block text-micro font-semibold text-muted">
        {t('assets.handoverDate')}
      </label>
      <input id="office-date" type="date" max={TODAY} value={date} aria-invalid={!!error || undefined} aria-describedby={error ? 'office-error' : undefined} onChange={(e) => { setDate(e.target.value); setError('') }} className="input mt-1.5" />
      {error && <p id="office-error" role="alert" className="mt-1.5 text-micro text-status-rejected">{error}</p>}
    </ConfirmDialog>
  )
}
