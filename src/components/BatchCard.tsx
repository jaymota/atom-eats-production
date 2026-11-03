// One batch in a list: the product, the amount in big type (kg · units), where it's made,
// and (on the floor) the next step's button: Making done, Stock received or Filling done.
import { Link } from 'react-router-dom'
import {
  PACK_NAMES, STAGE_NAMES, STAGE_TONE, dayLabel, expectedKg, fmtKg, fmtN, isAwaiting, isLate, kgDone, nextStep, unitsDone, type Batch,
} from '../lib/batches'
import { sizeText } from '../lib/products'

export function StageBadge({ stage }: { stage: Batch['stage'] }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${STAGE_TONE[stage]}`}>{STAGE_NAMES[stage]}</span>
}

/** "30 kg · 750 units" in big type, with "40 g pouch" underneath. */
export function Amount({ b, big = true }: { b: Batch; big?: boolean }) {
  const kg = expectedKg(b)
  return (
    <div>
      <div className={`font-bold text-ae-blue ${big ? 'text-2xl' : 'text-lg'}`}>
        {kg != null && <>{fmtKg(kg)} · </>}{b.units_planned != null ? `${fmtN(b.units_planned)} units` : '—'}
      </div>
      <div className="text-sm text-stone-600">
        {b.grammage_g ? `${sizeText(b.grammage_g)} ` : ''}{PACK_NAMES[b.pack_type].toLowerCase()}
      </div>
    </div>
  )
}

export function MadeAt({ b }: { b: Pick<Batch, 'maker'> }) {
  if (!b.maker) return null
  return <span className="rounded-full bg-ae-lilac/30 px-2.5 py-0.5 text-xs font-semibold text-ae-blue">at {b.maker.name}</span>
}

export function BatchCard({ b, workerNames, showDate, floor }: {
  b: Batch
  workerNames: Record<string, string>
  showDate?: boolean
  /** Show the Complete / Stock received button. */
  floor?: boolean
}) {
  const done = unitsDone(b)
  const open = b.stage !== 'moved' && b.stage !== 'cancelled'
  const step = nextStep(b)

  return (
    <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
      <Link to={`/batch/${b.id}`} className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-stone-900">{b.product.name}</span>
          <MadeAt b={b} />
          {(!open || b.stage === 'made') && <StageBadge stage={b.stage} />}
          {b.kept_in_bulk && <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">In bulk stock</span>}
          {isLate(b) && <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">Late</span>}
          {isAwaiting(b) && <span className="rounded-full bg-amber-400 px-2 py-0.5 text-xs font-semibold text-stone-900">Awaiting stock</span>}
        </div>
        <Amount b={b} />
        {b.made_kg != null && (
          <div className="text-sm font-semibold text-sky-800">
            {fmtKg(b.made_kg)} {b.from_lot ? 'taken from bulk' : b.manufacturer_id ? 'received in bulk' : 'made'}{b.made_on && ` · ${dayLabel(b.made_on)}`}
          </div>
        )}
        <div className="text-xs text-stone-500">
          {b.batch_no && <span className="font-mono">{b.batch_no}</span>}
          {showDate && b.planned_date && <> · planned {dayLabel(b.planned_date)}</>}
          {done > 0 && <> · <b className="text-stone-700">{fmtN(done)} units · {fmtKg(kgDone(b))} {b.stage === 'moved' || b.stage === 'made' ? 'filled' : b.manufacturer_id ? 'received' : 'made'}</b></>}
          {b.workers.length > 0 && <> · {b.workers.map((w) => workerNames[w] ?? '?').join(', ')}</>}
        </div>
      </Link>
      {floor && step && (
        <Link to={`/batch/${b.id}?do=${step.mode}`}
          className="min-h-12 rounded-lg bg-ae-blue px-5 py-3 text-center text-base font-semibold text-ae-cream sm:text-sm">
          {step.label}
        </Link>
      )}
    </div>
  )
}
