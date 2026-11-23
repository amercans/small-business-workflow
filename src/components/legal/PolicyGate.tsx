import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter } from '@tanstack/react-router'
import { LegalDoc } from './LegalDoc'
import { acceptPolicies } from '#/data/compliance'
import { DOC_ACC, DOC_ACK, DOCS, LEGAL_VERSION, type PolicyDoc } from '#/lib/legal'
import { t } from '#/i18n'

export function PolicyGate({ pending, name }: { pending: PolicyDoc[]; name: string }) {
  const router = useRouter()
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const all = pending.every((d) => checked[d])

  async function accept() {
    setBusy(true)
    const r = await acceptPolicies(LEGAL_VERSION, pending)
    if (!r.ok) {
      setError(r.error)
      setBusy(false)
      return
    }
    await router.invalidate()
  }

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-5 pt-2 pb-10" aria-labelledby="gate-title">
      <header className="px-1.5">
        <h1 id="gate-title" className="text-[2rem] leading-tight font-semibold tracking-[-0.03em] lg:text-[2.5rem]">
          {t('legal.gate.title', { name: name.split(' ')[0] })}
        </h1>
        <p className="mt-2 text-label text-muted">{t('legal.gate.lead')}</p>
      </header>
      {pending.map((d) => (
        <div key={d} className="kar px-5 py-5 sm:px-6.5 sm:py-6">
          <ScrollBox>
            <LegalDoc doc={DOCS[d]} compact />
          </ScrollBox>
          <label className="mt-4 flex cursor-pointer items-start gap-3 border-t border-kar-line-2 pt-4 text-label">
            <input type="checkbox" className="mt-1 size-4.5 accent-[var(--color-blue)]" checked={!!checked[d]} onChange={(e) => setChecked((c) => ({ ...c, [d]: e.target.checked }))} />
            <span>
              {t('legal.gate.read', { doc: DOC_ACC[d] })} <b className="font-semibold">{DOC_ACK[d]}</b>.
            </span>
          </label>
        </div>
      ))}
      {error && (
        <p role="alert" className="px-1.5 text-small text-status-rejected">
          {error}
        </p>
      )}
      <div className="px-1.5">
        <button type="button" onClick={accept} disabled={!all || busy} className="btn btn-pri">
          {t('legal.gate.submit')}
        </button>
      </div>
    </section>
  )
}

function ScrollBox({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState(false)
  const check = () => {
    const el = ref.current
    if (el) setMore(el.scrollTop + el.clientHeight < el.scrollHeight - 4)
  }
  useEffect(() => {
    check()
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div className="relative">
      <div
        ref={ref}
        onScroll={check}
        tabIndex={0}
        className="max-h-[22rem] overflow-y-auto rounded-md pr-2 focus-visible:outline-2 focus-visible:outline-blue"
        style={more ? { maskImage: 'linear-gradient(to bottom, #000 calc(100% - 4rem), transparent)', WebkitMaskImage: 'linear-gradient(to bottom, #000 calc(100% - 4rem), transparent)' } : undefined}
      >
        {children}
      </div>
      {more && (
        <span aria-hidden="true" className="pointer-events-none absolute right-3 bottom-1 rounded-full bg-surface/90 px-2.5 py-0.5 text-micro font-medium text-muted shadow-sm">
          {t('legal.gate.more')}
        </span>
      )}
    </div>
  )
}
