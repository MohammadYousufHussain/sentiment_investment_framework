// Purely informational -- lets someone who wants their weights to literally
// sum to 100 see how close they are and nudge toward it, without the app
// forcing that constraint (weightedZ works fine at any total).
export default function WeightTotal({ total }) {
  const atTarget = Math.abs(total - 100) < 0.05
  return (
    <span className={`text-[10px] tabular ${atTarget ? 'text-good' : 'text-ink-muted'}`}>
      Σ weights: {total.toFixed(0)}{atTarget ? ' ✓ = 100' : ' (target 100)'}
    </span>
  )
}
