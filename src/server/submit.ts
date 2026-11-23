import { failedAssertion, isUniqueViolation, type Stmt } from './db/d1'
import { t } from '#/i18n'
import type { Ctx } from './ctx'
import { FileRejected, prepareFile, type PreparedFile } from './files'
import { isFileRef } from '#/lib/formData'

export type Fail = { ok: false; error: string; fieldErrors?: Record<string, string> }
export const fail = (error: string, field?: string): Fail => ({ ok: false, error, fieldErrors: field ? { [field]: error } : undefined })

export async function fileFrom(ref: unknown, files: Map<string, File>, field: string, opts: { required?: boolean; pdfOnly?: boolean } = {}): Promise<PreparedFile | null> {
  const f = isFileRef(ref) ? files.get(ref.$file) : undefined
  if (f) files.delete((ref as { $file: string }).$file)
  if (!f) {
    if (opts.required) throw new FileRejected(field, opts.pdfOnly ? t('server.files.contractRequired') : t('server.files.required'))
    return null
  }
  return prepareFile(f, field, opts)
}

export function fileError(e: unknown): Fail {
  if (e instanceof FileRejected) return fail(e.message, e.field)
  throw e
}

export async function commit(ctx: Ctx, stmts: Stmt[], files: PreparedFile[], errors: Record<string, Fail> = {}): Promise<Fail | null> {
  if (files.length) await ctx.store.put(files)
  try {
    await ctx.db.batch(stmts)
    return null
  } catch (e) {
    if (files.length) await ctx.store.discard(files)
    const code = failedAssertion(e, Object.keys(errors))
    if (code) return errors[code]
    if (errors.unique && isUniqueViolation(e)) return errors.unique
    throw e
  }
}
