// A free-standing relative weight -- not forced to sum to 100 with its
// siblings. Editing one never touches another's value (see IntegratedScorecard's
// comment on why the earlier auto-rebalancing pattern was dropped); callers
// show each weight's live share of the group's total separately.
export default function WeightInput({ value, onChange, title }) {
  return (
    <input
      type="number"
      step="1"
      min="0"
      value={value}
      onChange={(e) => {
        const parsed = parseFloat(e.target.value)
        onChange(Number.isFinite(parsed) ? Math.max(0, parsed) : 0)
      }}
      onClick={(e) => e.stopPropagation()}
      title={title}
      className="w-11 px-1 py-0.5 text-[10px] rounded border border-hairline bg-panel text-ink tabular text-right
                 focus:outline-none focus:ring-1 focus:ring-series-1/50"
    />
  )
}
