export default function PlaceholderTab({ title, description, planned }) {
  return (
    <div className="border border-dashed border-hairline rounded-lg px-6 py-8">
      <p className="text-sm font-semibold text-ink-secondary">{title}</p>
      <p className="text-[12px] text-ink-muted mt-1 max-w-2xl leading-relaxed">{description}</p>
      {planned?.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {planned.map((item) => (
            <li key={item} className="flex items-start gap-2 text-[12px] text-ink-muted">
              <span className="w-1 h-1 rounded-full bg-ink-muted mt-1.5 shrink-0" />
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
