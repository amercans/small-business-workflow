export const DEFAULT_APP_NAME = 'Business Workflow'

export const appNameOr = (value: string | undefined | null): string => {
  const v = (value ?? '').replace(/[\r\n<>"]+/g, ' ').trim().slice(0, 60)
  return v || DEFAULT_APP_NAME
}

export const brandInitial = (name: string): string => (name.trim()[0] ?? 'B').toLocaleUpperCase()

export function cleanPanelUrl(value: string | undefined | null): string {
  try {
    const u = new URL(value ?? '')
    return /^https?:$/.test(u.protocol) ? u.origin : ''
  } catch {
    return ''
  }
}
