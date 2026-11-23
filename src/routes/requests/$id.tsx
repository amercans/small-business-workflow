import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { RequestDetail } from '#/components/RequestDetail'
import { loadRequest } from '#/data/home'
import { t } from '#/i18n'

export const Route = createFileRoute('/requests/$id')({
  loader: async ({ params }) => {
    const res = await loadRequest(params.id)
    if (!res.request) throw notFound()
    return { request: res.request, statusLabel: res.statusLabel }
  },
  notFoundComponent: NotFound,
  component: Detail,
})

function Detail() {
  const { request, statusLabel } = Route.useLoaderData()
  return <RequestDetail r={request} statusLabel={statusLabel} back="mine" canCancel />
}

function NotFound() {
  return (
    <section className="pb-10">
      <h1 className="text-display-sm font-semibold sm:text-display">{t('requests.notFound')}</h1>
      <p className="mt-2.5 text-label text-muted">{t('requests.notFoundMine')}</p>
      <Link to="/requests" className="btn btn-sec mt-6 no-underline">
        {t('requests.backToMine')}
      </Link>
    </section>
  )
}
