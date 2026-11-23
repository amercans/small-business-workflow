import { Icon } from './Icon'
import type { ApprovalAttachment } from '#/data/approvals'
import { t } from '#/i18n'

export function ApprovalDocs({ attachments }: { attachments: ApprovalAttachment[] }) {
  if (attachments.length === 0) {
    return <p className="pt-2 text-center text-micro text-faint">{t('approvals.docs.none')}</p>
  }
  const image = attachments.findIndex((a) => a.kind === 'image')
  const others = attachments.filter((_, i) => i !== image)
  return (
    <div className="flex flex-col items-center gap-3.5 pt-2">
      {image >= 0 && (
        <a href={`/files/${attachments[image].id}`} target="_blank" rel="noopener" className="flex flex-col items-center no-underline">
          <span className="mb-3.5 block text-center text-micro text-faint">
            {attachments[image].name} · {image + 1} / {attachments.length}
          </span>
          <img
            src={`/files/${attachments[image].id}`}
            alt={t('approvals.docs.alt', { name: attachments[image].name })}
            loading="lazy"
            className="max-h-[26rem] w-full max-w-[14.75rem] rounded-icon bg-surface object-contain shadow-ticket"
          />
        </a>
      )}
      <ul className="m-0 mt-2 flex list-none flex-wrap justify-center gap-2.5 p-0">
        {others.map((a) => (
          <li key={a.id}>
            <a
              href={`/files/${a.id}`}
              target="_blank"
              rel="noopener"
              className="grid h-18 w-26 place-items-center content-center gap-1 rounded-icon bg-surface px-2 text-center text-tab text-muted no-underline shadow-ticket hover:text-ink"
            >
              <Icon name="paper" size={image >= 0 ? 18 : 22} strokeWidth={1.5} />
              <span className="max-w-full truncate">{a.name}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}
