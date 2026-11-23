import { brandInitial } from '#/config/brand'
import { runtimeConfig } from '#/config/runtime'

export function BrandMark({ size = 28, className = '' }: { size?: number; className?: string }) {
  const name = runtimeConfig().appName
  return (
    <span
      aria-hidden="true"
      className={`inline-grid place-items-center rounded-[28%] bg-ink font-bold text-on-dark ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.52), lineHeight: 1 }}
    >
      {brandInitial(name)}
    </span>
  )
}
