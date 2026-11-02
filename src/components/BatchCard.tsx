// One batch in a list: product, batch number, units, stage, who's on it, and (on the floor)
// the big "next stage" button.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { NEXT, PACK_NAMES, STAGE_NAMES, STAGE_TONE, dayLabel, fmtN, isLate, unitsDone, why, type Batch } from '../lib/batches'
import { supabase } from '../lib/supabase'
import { Button } from './ui'

export function StageBadge({ stage }: { stage: Batch['stage'] }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${STAGE_TONE[stage]}`}>{STAGE_NAMES[stage]}</span>
}

export function BatchCard({ b, workerNames, showDate, onMoved }: {
  b: Batch
  workerNames: Record<string, string>
  showDate?: boolean
  /** Shows the next-stage button; called after a move. */
  onMoved?: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const next = NEXT[b.stage]
  const done = unitsDone(b)
  const late = isLate(b)

  const move = async () => {
    if (!next || next.to === 'inventory') return
    setBusy(true)
    setError('')
    const { error: err } = await supabase.rpc('move_batch', { p_id: b.id, p_to: next.to })
    setBusy(false)
    if (err) return setError(why(err))
    onMoved?.()
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <Link to={`/batch/${b.id}`} className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-stone-900">{b.product.name}</span>
          <StageBadge stage={b.stage} />
          {late && <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">Late</span>}
        </div>
        <div className="text-sm text-stone-600">
          {b.batch_no && <span className="font-mono">{b.batch_no} · </span>}
          {b.units_planned != null && <>{fmtN(b.units_planned)} × {b.grammage_g} g {PACK_NAMES[b.pack_type].toLowerCase()}</>}
          {done > 0 && <> · <b>{fmtN(done)}</b> packed</>}
          {showDate && b.planned_date && <> · {dayLabel(b.planned_date)}</>}
        </div>
        {b.workers.length > 0 && (
          <div className="text-xs text-stone-500">{b.workers.map((w) => workerNames[w] ?? '?').join(', ')}</div>
        )}
        {error && <div className="mt-1 text-xs font-semibold text-red-700">{error}</div>}
      </Link>
      {onMoved && next && (
        next.to === 'inventory'
          ? <Link to={`/batch/${b.id}?do=inventory`} className="min-h-12 rounded-lg bg-ae-blue px-4 py-3 text-sm font-semibold text-ae-cream">{next.label}</Link>
          : <Button className="min-h-12 px-4 text-sm" disabled={busy} onClick={move}>{busy ? '…' : next.label}</Button>
      )}
    </div>
  )
}
