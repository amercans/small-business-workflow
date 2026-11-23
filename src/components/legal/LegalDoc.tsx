import type { LegalText } from '#/lib/legal'
import { t } from '#/i18n'

export function LegalDoc({ doc, compact }: { doc: LegalText; compact?: boolean }) {
  return (
    <div className={compact ? 'text-link leading-relaxed' : 'text-label leading-relaxed'}>
      <p role="note" className="mb-3 rounded-lg bg-kar-wash px-3 py-2 text-micro font-medium text-muted">{t('common.templateNotice')}</p>
      <h3 className="text-row font-semibold text-ink">{doc.title}</h3>
      {doc.intro && <p className="mt-2 text-muted">{doc.intro}</p>}
      {doc.sections.map((s) => (
        <section key={s.h} className="mt-4">
          <h4 className="font-semibold text-ink">{s.h}</h4>
          {s.p.map((p, i) => (
            <p key={i} className="mt-1.5 text-muted">
              {p}
            </p>
          ))}
        </section>
      ))}
    </div>
  )
}
