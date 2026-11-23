import { useState } from 'react'
import { t } from '#/i18n'

export function LinkBox({ url, note }: { url: string; note?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="input min-w-0 flex-1 text-small" aria-label="URL" data-k="generated-link" />
        <button
          type="button"
          className="btn btn-sec h-10 shrink-0 px-4 text-small"
          onClick={() => {
            void navigator.clipboard?.writeText(url).then(() => setCopied(true))
          }}
        >
          {copied ? t('users.copied') : t('users.copy')}
        </button>
      </div>
      {note && <p className="text-micro text-faint">{note}</p>}
    </div>
  )
}
