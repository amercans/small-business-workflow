export type FileRef = { $file: string }
export const isFileRef = (v: unknown): v is FileRef => !!v && typeof v === 'object' && typeof (v as FileRef).$file === 'string'

export function toFormData(input: unknown): FormData {
  const fd = new FormData()
  let n = 0
  const json = JSON.stringify(input, (_k, v) => {
    if (typeof File !== 'undefined' && v instanceof File) {
      const key = `f${n++}`
      fd.append(key, v, v.name)
      return { $file: key }
    }
    return v
  })
  fd.append('json', json ?? 'null')
  return fd
}
