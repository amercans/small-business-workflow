import type { ClipboardEvent } from 'react'
import { baseCurrency, cleanMoneyInput, CURRENCY_SYMBOL, formatOnBlur, parseMoney } from '#/lib/money'

export function MoneyInput({
  value,
  onChange,
  suffix = CURRENCY_SYMBOL[baseCurrency()],
  placeholder = '0,00',
  className = '',
  ...a11y
}: {
  value: string
  onChange: (v: string) => void
  suffix?: string
  placeholder?: string
  className?: string
  id?: string
  'aria-invalid'?: true
  'aria-describedby'?: string
}) {
  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text')
    const n = parseMoney(text)
    if (n === null) return
    e.preventDefault()
    onChange(formatOnBlur(text))
  }
  return (
    <span className={`relative block ${className}`}>
      <input
        {...a11y}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(cleanMoneyInput(e.target.value))}
        onBlur={() => onChange(formatOnBlur(value))}
        onPaste={onPaste}
        className={`input num ${suffix ? 'pr-10' : ''}`}
      />
      {suffix && (
        <span aria-hidden="true" className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-link text-faint">
          {suffix}
        </span>
      )}
    </span>
  )
}
