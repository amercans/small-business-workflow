export function Switch({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; id?: string }) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 rounded-note bg-panel px-3.5 py-3 text-left text-link font-medium"
    >
      <span>{label}</span>
      <span aria-hidden="true" className={`relative h-6 w-10.5 shrink-0 rounded-full transition-colors duration-200 ${checked ? 'bg-blue' : 'bg-seg-off-dark'}`}>
        <span className={`absolute top-0.75 left-0.75 size-4.5 rounded-full bg-surface shadow-seg-on transition-transform duration-200 ease-settle ${checked ? 'translate-x-4.5' : ''}`} />
      </span>
    </button>
  )
}
