import type { ZodError } from 'zod'

export function fieldErrors(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.')
    if (!(key in out)) out[key] = issue.message
  }
  return out
}

export function focusFirstInvalid(root: ParentNode = document): void {
  const el = root.querySelector<HTMLElement>('[aria-invalid="true"]')
  el?.focus()
  el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
}
