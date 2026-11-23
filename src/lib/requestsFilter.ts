export type RequestsSearch = { q?: string; type?: string; status?: string; period?: string }
const inBrowser = typeof window !== 'undefined'
let last: RequestsSearch = {}
export const rememberRequestsSearch = (s: RequestsSearch) => { if (inBrowser) last = s }
export const lastRequestsSearch = (): RequestsSearch => (inBrowser ? last : {})
