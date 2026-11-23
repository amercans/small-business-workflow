import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { RequestDetail } from '#/components/RequestDetail'
import { loadAnyRequest } from '#/data/home'
import { guard } from '#/lib/guard'
import { t } from '#/i18n'

export const Route = createFileRoute('/all-requests/$id')({
  beforeLoad: guard('allRequests'),
  loader: async ({ params }) => {
    const res = await loadAnyRequest(params.id)
    if (!res.request) throw notFound()
    return { request: res.request, statusLabel: res.statusLabel }
  },
  notFoundComponent: () => (
    <section className="pb-10">
      <h1 className="text-display-sm font-semibold sm:text-display">{t('requests.notFound')}</h1>
      <Link to="/all-requests" className="btn btn-sec mt-6 no-underline">
        {t('requests.backToAll')}
      </Link>
    </section>
  ),
  component: Detail,
})

function Detail() {
  const { request, statusLabel } = Route.useLoaderData()
  return <RequestDetail r={request} statusLabel={statusLabel} back="all" requesterName={request.requesterName} canCancel={false} />
}
