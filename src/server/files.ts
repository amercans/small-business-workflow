import { ulid } from './db/d1'
import { t } from '#/i18n'

import { MAX_FILE_BYTES } from './limits'

export type AllowedType = 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/heic' | 'image/heif'

const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'])

export function sniffType(b: Uint8Array): AllowedType | null {
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x)
  if (at(0, 0x25, 0x50, 0x44, 0x46, 0x2d)) return 'application/pdf'
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  if (b.length >= 12 && at(4, 0x66, 0x74, 0x79, 0x70)) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11])
    if (HEIF_BRANDS.has(brand)) return brand.startsWith('he') ? 'image/heic' : 'image/heif'
  }
  return null
}

async function sha256Hex(b: Uint8Array) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', b as BufferSource))
  return [...h].map((x) => x.toString(16).padStart(2, '0')).join('')
}

export interface PreparedFile {
  id: string
  r2Key: string
  name: string
  contentType: AllowedType
  size: number
  sha256: string
  bytes: Uint8Array
}

export class FileRejected extends Error {
  constructor(
    public field: string,
    message: string,
  ) {
    super(message)
  }
}

export async function prepareFile(file: File, field: string, opts: { pdfOnly?: boolean } = {}): Promise<PreparedFile> {
  if (file.size < 1) throw new FileRejected(field, t('server.files.empty'))
  if (file.size > MAX_FILE_BYTES) throw new FileRejected(field, t('server.files.tooLarge'))
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.byteLength > MAX_FILE_BYTES) throw new FileRejected(field, t('server.files.tooLarge'))
  const type = sniffType(bytes)
  if (!type) throw new FileRejected(field, t('server.files.badType'))
  if (opts.pdfOnly && type !== 'application/pdf') throw new FileRejected(field, t('server.files.pdfOnly'))
  const id = ulid()
  const d = new Date()
  const r2Key = `att/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${id}`
  const EXT: Record<AllowedType, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/heif': 'heif' }
  const clean = (file.name || 'dosya').replace(/[\u0000-\u001f\\/]/g, '_').slice(0, 190)
  const ext = clean.split('.').pop()?.toLowerCase()
  const name = ext === EXT[type] || (type === 'image/jpeg' && ext === 'jpeg') ? clean : `${clean}.${EXT[type]}`
  return { id, r2Key, name, contentType: type, size: bytes.byteLength, sha256: await sha256Hex(bytes), bytes }
}

export function downloadName(att: { name: string; contentType: string; sensitive: boolean }): string {
  if (!att.sensitive) return att.name
  const ext: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/heif': 'heif' }
  return `saglik-raporu.${ext[att.contentType] ?? 'bin'}`
}
