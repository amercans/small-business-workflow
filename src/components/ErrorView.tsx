import { Link, useRouter } from '@tanstack/react-router'
import { clientError } from '#/lib/clientError'
import { t } from '#/i18n'

export function ErrorView({ error }: { error: unknown }) {
  const router = useRouter()
  const msg = clientError(error)
  const known = msg !== clientError(new Error(''))
  return (
    <section className="pb-10">
      <h1 className="text-display-sm font-semibold sm:text-display">{t('errors.title')}</h1>
      <p className="mt-2.5 max-w-xl text-label text-muted">{known ? msg : t('errors.loadFailed')}</p>
      <div className="mt-6 flex flex-wrap gap-2.5">
        <button type="button" onClick={() => location.reload()} className="btn btn-pri">
          {t('errors.reload')}
        </button>
        <button type="button" onClick={() => void router.navigate({ to: '/' })} className="btn btn-sec">
          {t('errors.home')}
        </button>
      </div>
    </section>
  )
}

export function NotFoundView() {
  return (
    <section className="pb-10">
      <h1 className="text-display-sm font-semibold sm:text-display">{t('errors.notFound')}</h1>
      <p className="mt-2.5 text-label text-muted">{t('errors.notFoundBody')}</p>
      <Link to="/" className="btn btn-sec mt-6 no-underline">
        {t('errors.home')}
      </Link>
    </section>
  )
}
