import { STATUS_LABEL, type AssetStatus } from '#/data/inventory'

const DOT: Record<AssetStatus, string> = {
  stock: 'bg-status-approved',
  assigned: 'bg-status-paid',
  repair: 'bg-type-expense',
  retired: 'bg-status-cancelled',
}

export function StatusPill({ s }: { s: AssetStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-micro font-medium whitespace-nowrap">
      <span className={`size-1.75 rounded-full ${DOT[s]}`} />
      {STATUS_LABEL[s]}
    </span>
  )
}
