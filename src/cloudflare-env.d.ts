declare module 'cloudflare:workers' {
  export interface R2Object {
    body: ReadableStream
    size: number
    arrayBuffer(): Promise<ArrayBuffer>
  }
  export interface R2Bucket {
    put(key: string, value: ArrayBuffer | Uint8Array, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown>
    get(key: string): Promise<R2Object | null>
    delete(key: string): Promise<void>
  }
  export function waitUntil(p: Promise<unknown>): void
  export const env: {
    ASSETS?: { fetch(request: Request): Promise<Response> }
    DB: import('./server/db/d1').Db
    FILES: R2Bucket
    APP_NAME?: string
    PANEL_URL?: string
    DEFAULT_LOCALE?: string
    CURRENCY?: string
    TIME_ZONE?: string
    HOLIDAY_COUNTRY?: string
    BOOKS_START_DATE?: string
    COMPANY_NAME?: string
    COMPANY_ADDRESS?: string
    COMPANY_REGISTRATION?: string
    COMPANY_CONTACT_EMAIL?: string
    ALLOWED_EMAIL_DOMAIN?: string
    ADMIN_EMAIL?: string
    SETUP_TOKEN?: string
    AUTH_MODE?: string
    PASSWORD_ITERATIONS?: string
    DEV_AUTH?: string
    ACTION_LIMIT?: { limit(o: { key: string }): Promise<{ success: boolean }> }
    AUTH_LIMIT?: { limit(o: { key: string }): Promise<{ success: boolean }> }
    MAIL_MODE?: string
    MAIL_FROM?: string
    MAIL_ONLY?: string
    RESEND_API_KEY?: string
    ACCOUNTING_TO?: string
    ACCOUNTING_CC?: string
    ACCOUNTING_REPLY_TO?: string
    ACCOUNTING_SALUTATION?: string
    ACCOUNTING_LOCALE?: string
  }
}
