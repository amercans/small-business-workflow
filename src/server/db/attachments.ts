import type { AttachmentParent, RequestKind, RequestState } from '../auth/authorize'
import type { PreparedFile } from '../files'
import type { Db } from './d1'

export type AttachmentKind = 'receipt' | 'invoice_file' | 'agreement_file' | 'health_report' | 'other'

export type ParentRef =
  | { requestId: string }
  | { requestItemId: string }
  | { invoiceId: string }
  | { agreementId: string }

export function insertAttachment(db: Db, f: PreparedFile, kind: AttachmentKind, parent: ParentRef, uploadedBy: string) {
  return db
    .prepare(
      `INSERT INTO attachments (id, r2_key, kind, request_id, request_item_id, invoice_id, agreement_id,
         original_name, content_type, size_bytes, sha256, is_sensitive, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      f.id, f.r2Key, kind,
      'requestId' in parent ? parent.requestId : null,
      'requestItemId' in parent ? parent.requestItemId : null,
      'invoiceId' in parent ? parent.invoiceId : null,
      'agreementId' in parent ? parent.agreementId : null,
      f.name, f.contentType, f.size, f.sha256, kind === 'health_report' ? 1 : 0, uploadedBy,
    )
}

export interface AttachmentForRead {
  r2Key: string
  name: string
  contentType: string
  sensitive: boolean
  parent: AttachmentParent
}

interface Row {
  r2_key: string
  original_name: string
  content_type: string
  is_sensitive: number
  invoice_id: string | null
  agreement_id: string | null
  inv_uploaded_by: string | null
  req_requester: string | null
  req_type: RequestKind | null
  req_status: RequestState | null
}

export async function attachmentForRead(db: Db, id: string): Promise<AttachmentForRead | null> {
  const r = await db
    .prepare(
      `SELECT a.r2_key, a.original_name, a.content_type, a.is_sensitive, a.invoice_id, a.agreement_id,
              i.uploaded_by AS inv_uploaded_by,
              r.requester_id AS req_requester, r.type AS req_type, r.status AS req_status
       FROM attachments a
       LEFT JOIN request_items it ON it.id = a.request_item_id
       LEFT JOIN requests r ON r.id = COALESCE(a.request_id, it.request_id)
       LEFT JOIN invoices i ON i.id = a.invoice_id
       WHERE a.id = ? AND a.archived_at IS NULL`,
    )
    .bind(id)
    .first<Row>()
  if (!r) return null
  let parent: AttachmentParent
  if (r.req_requester && r.req_type && r.req_status) {
    parent = { kind: 'request', request: { requesterId: r.req_requester, type: r.req_type, status: r.req_status }, sensitive: r.is_sensitive === 1 }
  } else if (r.invoice_id && r.inv_uploaded_by) {
    parent = { kind: 'invoice', uploadedBy: r.inv_uploaded_by }
  } else if (r.agreement_id) {
    parent = { kind: 'agreement' }
  } else return null
  return { r2Key: r.r2_key, name: r.original_name, contentType: r.content_type, sensitive: r.is_sensitive === 1, parent }
}

export interface AttachmentInfo {
  id: string
  name: string
  contentType: string
  sensitive: boolean
  requestItemId: string | null
}

type InfoRow = Omit<AttachmentInfo, 'sensitive'> & { sensitive: number }

const INFO = `SELECT a.id, a.original_name AS name, a.content_type AS contentType, a.is_sensitive AS sensitive, a.request_item_id AS requestItemId
  FROM attachments a`

export async function attachmentsOfRequest(db: Db, requestId: string): Promise<AttachmentInfo[]> {
  const rows = (
    await db
      .prepare(
        `${INFO} LEFT JOIN request_items it ON it.id = a.request_item_id
         WHERE (a.request_id = ? OR it.request_id = ?) AND a.archived_at IS NULL ORDER BY COALESCE(it.line_no, 0), a.created_at`,
      )
      .bind(requestId, requestId)
      .all<InfoRow>()
  ).results
  return rows.map((r) => ({ ...r, sensitive: r.sensitive === 1 }))
}

export async function attachmentsOf(db: Db, col: 'invoice_id' | 'agreement_id', id: string): Promise<AttachmentInfo[]> {
  const rows = (await db.prepare(`${INFO} WHERE a.${col} = ? AND a.archived_at IS NULL ORDER BY a.created_at`).bind(id).all<InfoRow>()).results
  return rows.map((r) => ({ ...r, sensitive: r.sensitive === 1 }))
}
