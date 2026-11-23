import { useCallback, useState } from 'react'
import type { ZodType } from 'zod'
import { fieldErrors, focusFirstInvalid } from './form'
import { tn } from '#/i18n'

export type FailResult = { ok: false; error: string; fieldErrors?: Record<string, string> }

export function useSubmit<R extends { ok: true }>({
  schema,
  build,
  submit,
  onClose,
  onSubmitted,
}: {
  schema: ZodType
  build: () => unknown
  submit: (input: unknown) => Promise<R | FailResult>
  onClose: () => void
  onSubmitted: (result: R) => void | Promise<void>
}) {
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [warning, setWarning] = useState('')
  const [busy, setBusy] = useState(false)

  const focusSoon = () => requestAnimationFrame(() => focusFirstInvalid(document.querySelector('[role="dialog"]') ?? document))

  const clear = useCallback((key: string) => {
    setErrors((e) => {
      if (!(key in e)) return e
      const { [key]: _drop, ...rest } = e
      return rest
    })
    setWarning('')
  }, [])

  const run = async () => {
    if (busy) return
    const input = build()
    const parsed = schema.safeParse(input)
    if (!parsed.success) {
      const fe = fieldErrors(parsed.error)
      setErrors(fe)
      const n = Object.keys(fe).length
      setWarning(tn('forms.checkFields', n))
      focusSoon()
      return
    }
    setBusy(true)
    const res = await submit(input)
    setBusy(false)
    if (!res.ok) {
      setErrors(res.fieldErrors ?? {})
      setWarning(res.error)
      focusSoon()
      return
    }
    onClose()
    await onSubmitted(res)
  }

  return { errors, warning, busy, run, clear }
}
