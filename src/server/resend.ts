import type { Mailer } from './notify'

export interface ResendConfig {
  apiKey: string
  from: string
  only?: readonly string[]
}

const bare = (a: string) => (a.match(/<([^>]+)>/)?.[1] ?? a).trim().toLowerCase()
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim()

function fromWithName(from: string, name?: string): string {
  if (!name) return from
  const clean = oneLine(name).replace(/["<>\\]/g, '').slice(0, 80)
  return clean ? `"${clean}" <${bare(from)}>` : from
}

const toB64 = (b: Uint8Array) => {
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
}

export function resendMailer(cfg: ResendConfig, fetcher: typeof fetch = fetch): Mailer {
  const only = cfg.only?.map((a) => a.toLowerCase())
  return {
    async send(m) {
      const to = m.to.split(',').map((a) => a.trim()).filter(Boolean)
      if (only && (to.length === 0 || to.some((a) => !only.includes(bare(a))))) {
        console.log(JSON.stringify({ at: 'mail', skipped: 'not in MAIL_ONLY' }))
        return 'skipped'
      }
      const cc = (m.cc ?? []).filter((a) => !only || only.includes(bare(a)))
      const body: Record<string, unknown> = { from: fromWithName(cfg.from, m.fromName), to, subject: oneLine(m.subject), text: m.text }
      if (m.html) body.html = m.html
      if (cc.length) body.cc = cc
      if (m.replyTo) body.reply_to = m.replyTo
      if (m.headers) body.headers = m.headers
      if (m.attachments?.length) body.attachments = m.attachments.map((a) => ({ filename: a.name, content: toB64(a.bytes), content_type: a.contentType }))
      const res = await fetcher('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 200)}`)
    },
  }
}
