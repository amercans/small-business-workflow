import { env } from 'cloudflare:workers'
import { t } from '#/i18n'
import { authorize, type AuthUser } from './auth/authorize'
import { attachmentForRead } from './db/attachments'
import { audit } from './db/d1'
import { downloadName } from './files'

const notFound = () => new Response(t('server.notFound'), { status: 404, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' } })

export async function handleFileRequest(request: Request, url: URL, user: AuthUser): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })
  const id = url.pathname.slice('/files/'.length)
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id)) return notFound()
  const att = await attachmentForRead(env.DB, id)
  if (!att || !authorize(user, { a: 'attachment.read', p: att.parent }).ok) return notFound()

  const obj = await env.FILES.get(att.r2Key)
  if (!obj) return notFound()
  if (att.sensitive) {
    await audit(env.DB, { actorId: user.id, action: 'attachment.view', entityType: 'attachment', entityId: id, meta: { ray: request.headers.get('cf-ray') } }).run()
  }
  const fileName = downloadName(att)
  const inline = att.contentType !== 'image/heic' && att.contentType !== 'image/heif' && url.searchParams.get('download') !== '1'
  return new Response(request.method === 'HEAD' ? null : obj.body, {
    headers: {
      'Content-Type': att.contentType,
      'Content-Length': String(obj.size),
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Cache-Control': 'private, no-store',
      'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  })
}
