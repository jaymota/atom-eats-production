// Daily, weekly and monthly production reports, from what was filled each day (production
// history is never deleted). Everything is counted in units, one line per product and pack size
// ("Salted Pretzel Mini Knots 1 kg · 10 units"). Hover or tap a day on the chart to see what was
// made that day. Download any period as Excel.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button, Card } from '../components/ui'
import {
  PACK_NAMES, addDays, dayLabel, fmtKg, fmtN, lossPct, mondayOf, todayIST, type Batch, type Output, type PackType, type Stage,
} from '../lib/batches'
import { CATEGORIES, sizeText } from '../lib/products'
import { supabase } from '../lib/supabase'

type Kind = 'day' | 'week' | 'month'

interface OutRow extends Output {
  batch: { batch_no: string | null; pack_type: PackType; grammage_g: number | null; maker: { name: string } | null; product: { name: string; sku: string; category: string | null } }
}
type PlanRow = Pick<Batch, 'id' | 'units_planned' | 'planned_date' | 'stage'> & { outputs: { made_on: string; units: number }[] }

function period(kind: Kind, anchor: string) {
  if (kind === 'day') {
    const t = todayIST()
    const when = anchor === t ? 'Today · ' : anchor === addDays(t, -1) ? 'Yesterday · ' : ''
    return { from: anchor, to: anchor, label: `${when}${dayLabel(anchor, { weekday: true, year: true })}` }
  }
  if (kind === 'week') {
    const from = mondayOf(anchor)
    return { from, to: addDays(from, 6), label: `${dayLabel(from, {})} – ${dayLabel(addDays(from, 6), { year: true })}` }
  }
  const from = `${anchor.slice(0, 7)}-01`
  const next = new Date(`${from}T00:00:00Z`)
  next.setUTCMonth(next.getUTCMonth() + 1)
  const to = addDays(next.toISOString().slice(0, 10), -1)
  return { from, to, label: new Date(`${from}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', month: 'long', year: 'numeric' }) }
}

function shift(kind: Kind, from: string, n: number) {
  if (kind === 'day') return addDays(from, n)
  if (kind === 'week') return addDays(from, 7 * n)
  const d = new Date(`${from}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + n)
  return d.toISOString().slice(0, 10)
}

async function fetchOutputs(from: string, to: string): Promise<OutRow[]> {
  const out: OutRow[] = []
  for (let i = 0; ; i += 1000) {
    const { data } = await supabase.from('batch_outputs')
      .select('*, batch:batches(batch_no, pack_type, grammage_g, maker:manufacturers(name), product:products(name, sku, category))')
      .gte('made_on', from).lte('made_on', to).order('made_on').range(i, i + 999)
    out.push(...((data ?? []) as unknown as OutRow[]))
    if (!data || data.length < 1000) return out
  }
}

async function fetchPlanned(from: string, to: string): Promise<PlanRow[]> {
  const { data } = await supabase.from('batches').select('id, units_planned, planned_date, stage, outputs:batch_outputs(made_on, units)')
    .gte('planned_date', from).lte('planned_date', to).limit(5000)
  return (data ?? []) as unknown as PlanRow[]
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0)
const OPEN: Stage[] = ['planned', 'made', 'manufacturing', 'filling', 'qc', 'done']

/** Pack size of an output line (older lines use the batch's size). */
const sizeOf = (o: OutRow) => (o.grammage_g ?? o.batch.grammage_g) as number | null
const label = (name: string, size: number | null) => (size ? `${name} ${sizeText(Number(size))}` : name)

function change(now: number, before: number) {
  if (!before) return null
  const p = Math.round(((now - before) / before) * 100)
  return <span className={`text-xs font-semibold ${p >= 0 ? 'text-green-700' : 'text-red-700'}`}>{p >= 0 ? '▲' : '▼'} {Math.abs(p)}% vs before</span>
}

export default function Reports() {
  const [params, setParams] = useSearchParams()
  const by = params.get('by')
  const kind: Kind = by === 'month' ? 'month' : by === 'week' ? 'week' : 'day'
  const p = period(kind, params.get('from') ?? todayIST())
  const prev = period(kind, shift(kind, p.from, -1))
  const [outs, setOuts] = useState<OutRow[] | null>(null)
  const [prevOuts, setPrevOuts] = useState<OutRow[]>([])
  const [planned, setPlanned] = useState<PlanRow[]>([])
  const [hover, setHover] = useState<string | null>(null)

  useEffect(() => {
    setOuts(null)
    Promise.all([fetchOutputs(p.from, p.to), fetchOutputs(prev.from, prev.to), fetchPlanned(p.from, p.to)]).then(([a, b, c]) => {
      setOuts(a); setPrevOuts(b); setPlanned(c)
    })
  }, [p.from, p.to, prev.from, prev.to])

  const rows = outs ?? []
  const units = sum(rows.map((o) => o.units))
  const kg = sum(rows.map((o) => Number(o.output_kg ?? 0)))
  const prevUnits = sum(prevOuts.map((o) => o.units))
  const prevKg = sum(prevOuts.map((o) => Number(o.output_kg ?? 0)))

  const live = planned.filter((b) => b.stage !== 'cancelled')
  // Only batches that had a planned quantity count towards "planned → made".
  const withPlan = live.filter((b) => (b.units_planned ?? 0) > 0)
  const plannedUnits = sum(withPlan.map((b) => b.units_planned ?? 0))
  const madeOfPlanned = sum(withPlan.map((b) => sum(b.outputs.map((o) => o.units))))
  const cancelled = planned.length - live.length
  const today = todayIST()
  const late = live.filter((b) => {
    if (!b.planned_date) return false
    const first = b.outputs.map((o) => o.made_on).sort()[0]
    return first ? first > b.planned_date : OPEN.includes(b.stage) && b.planned_date < today
  }).length

  const byProduct = useMemo(() => {
    // One line per product and pack size, so 30 g pouches and 500 g bulk aren't added up as units.
    const m = new Map<string, { key: string; name: string; sku: string; size: number | null; category: string; units: number; kg: number; batches: Set<string>; outs: OutRow[] }>()
    for (const o of rows) {
      const k = `${o.batch.product.sku}|${sizeOf(o) ?? ''}`
      const r = m.get(k) ?? { key: k, name: o.batch.product.name, sku: o.batch.product.sku, size: sizeOf(o), category: o.batch.product.category ?? 'Other', units: 0, kg: 0, batches: new Set(), outs: [] }
      r.units += o.units; r.kg += Number(o.output_kg ?? 0); r.batches.add(o.batch_id); r.outs.push(o)
      m.set(k, r)
    }
    return [...m.values()].sort((a, b) => b.units - a.units)
  }, [rows])

  const byCategory = useMemo(() => {
    const m = new Map<string, { units: number; kg: number }>()
    for (const r of byProduct) {
      const c = m.get(r.category) ?? { units: 0, kg: 0 }
      c.units += r.units; c.kg += r.kg; m.set(r.category, c)
    }
    const rank = (c: string) => CATEGORIES.indexOf(c) + 1 || 99
    return [...m.entries()].sort((a, b) => rank(a[0]) - rank(b[0]))
  }, [byProduct])

  const byPlace = useMemo(() => {
    const m = new Map<string, { units: number; kg: number }>()
    for (const o of rows) {
      const k = o.batch.maker?.name ?? 'In-house'
      const c = m.get(k) ?? { units: 0, kg: 0 }
      c.units += o.units; c.kg += Number(o.output_kg ?? 0); m.set(k, c)
    }
    return [...m.entries()].sort((a, b) => Number(b[0] === 'In-house') - Number(a[0] === 'In-house') || b[1].kg - a[1].kg)
  }, [rows])

  const days: string[] = []
  for (let d = p.from; d <= p.to; d = addDays(d, 1)) days.push(d)
  const perDay = Object.fromEntries(days.map((d) => [d, 0]))
  for (const o of rows) perDay[o.made_on] = (perDay[o.made_on] ?? 0) + o.units
  const maxDay = Math.max(1, ...Object.values(perDay))
  // What was made on the hovered / tapped day, biggest first.
  const hoverList = useMemo(() => {
    if (!hover) return []
    const m = new Map<string, number>()
    for (const o of rows) if (o.made_on === hover) m.set(label(o.batch.product.name, sizeOf(o)), (m.get(label(o.batch.product.name, sizeOf(o))) ?? 0) + o.units)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [hover, rows])
  const overallLoss = lossPct(rows)

  const download = async () => {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
      { Measure: 'Period', Value: p.label },
      { Measure: 'Units produced', Value: units },
      { Measure: 'Output (kg)', Value: Math.round(kg * 100) / 100 },
      { Measure: 'Units planned (batches planned in period)', Value: plannedUnits },
      { Measure: 'Units made from those batches', Value: madeOfPlanned },
      { Measure: 'Late batches', Value: late },
      { Measure: 'Cancelled batches', Value: cancelled },
      { Measure: 'Average loss %', Value: overallLoss == null ? '' : Math.round(overallLoss * 10) / 10 },
    ]), 'Summary')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(byProduct.map((r) => {
      const l = lossPct(r.outs)
      return { SKU: r.sku, Product: label(r.name, r.size), 'Size (g)': r.size ?? '', Category: r.category, Batches: r.batches.size, Units: r.units, 'Output (kg)': Math.round(r.kg * 100) / 100, 'Loss %': l == null ? '' : Math.round(l * 10) / 10 }
    })), 'By product')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(byCategory.map(([c, v]) => ({ Category: c, Units: v.units, 'Output (kg)': Math.round(v.kg * 100) / 100 }))), 'By category')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(byPlace.map(([c, v]) => ({ 'Made at': c, Units: v.units, 'Output (kg)': Math.round(v.kg * 100) / 100 }))), 'By place')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map((o) => ({
      Date: o.made_on, SKU: o.batch.product.sku, Product: o.batch.product.name, 'Batch no.': o.batch.batch_no ?? '',
      'Made at': o.batch.maker?.name ?? 'In-house', Pack: PACK_NAMES[(o.pack_type ?? o.batch.pack_type) as PackType], 'Size (g)': sizeOf(o) ?? '', Units: o.units, 'Output (kg)': o.output_kg ?? '',
      'Input (kg)': o.input_kg ?? '', 'Packed by': o.packed_by ?? '', Note: o.note ?? '',
    }))), 'Every entry')
    XLSX.writeFile(wb, `Atom Eats production ${p.from} to ${p.to}.xlsx`)
  }

  const setKind = (k: Kind) => setParams({ by: k, from: k === 'day' ? todayIST() : p.from })
  const go = (n: number) => setParams({ by: kind, from: shift(kind, p.from, n) })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-bold text-ae-blue">Reports</h2>
        <div className="flex gap-2">
          <div className="flex rounded-lg border border-stone-300 bg-white p-1 text-sm font-semibold">
            {(['day', 'week', 'month'] as const).map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)} className={`rounded-md px-3 py-1.5 ${kind === k ? 'bg-ae-blue text-ae-cream' : 'text-stone-600'}`}>
                {k === 'day' ? 'Day' : k === 'week' ? 'Weekly' : 'Monthly'}
              </button>
            ))}
          </div>
          <Button tone="plain" className="min-h-10 px-3 text-sm" disabled={!outs} onClick={download}>Excel</Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button tone="plain" className="min-h-10 px-3" onClick={() => go(-1)} aria-label="Previous">‹</Button>
        <div className="flex-1 text-center font-semibold text-stone-800">{p.label}</div>
        <Button tone="plain" className="min-h-10 px-3" onClick={() => go(1)} aria-label="Next">›</Button>
      </div>
      {kind === 'day' && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {[{ l: 'Today', d: today }, { l: 'Yesterday', d: addDays(today, -1) }].map((x) => (
            <button key={x.l} type="button" onClick={() => setParams({ by: 'day', from: x.d })}
              className={`rounded-full border px-4 py-1.5 text-sm font-semibold ${p.from === x.d ? 'border-ae-blue bg-ae-blue text-ae-cream' : 'border-stone-300 bg-white text-stone-700'}`}>{x.l}</button>
          ))}
          <input type="date" aria-label="Pick a day" value={p.from} max={today} onChange={(e) => e.target.value && setParams({ by: 'day', from: e.target.value })}
            className="h-9 rounded-full border border-stone-300 bg-white px-3 text-sm" />
        </div>
      )}

      {!outs ? <p className="text-sm text-stone-500">Loading…</p> : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Units" value={fmtN(units)} extra={change(units, prevUnits)} />
            <Tile label="Output" value={fmtKg(kg)} extra={change(kg, prevKg)} />
            <Tile label="Planned → made" value={plannedUnits ? `${Math.round((madeOfPlanned / plannedUnits) * 100)}%` : '—'} extra={<span className="text-xs text-stone-500">{fmtN(madeOfPlanned)} of {fmtN(plannedUnits)}</span>} />
            <Tile label="Late · Cancelled" value={`${late} · ${cancelled}`} extra={<span className="text-xs text-stone-500">batches</span>} />
          </div>

          {kind === 'day' && <ProductTable byProduct={byProduct} big />}

          {kind !== 'day' && <Card>
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-sm font-semibold text-stone-700">Units per day</h3>
              <span className="text-xs text-stone-500">{hover ? `${dayLabel(hover)}: ${fmtN(perDay[hover])} units` : `Avg loss ${overallLoss == null ? '—' : `${overallLoss.toFixed(1)}%`}`}</span>
            </div>
            <div className="flex h-40 items-end gap-[2px] border-b border-stone-300" onMouseLeave={() => setHover(null)}>
              {days.map((d) => (
                <div key={d} className="group flex h-full flex-1 cursor-default items-end" onMouseEnter={() => setHover(d)} onClick={() => setHover(d)}
                  title={`${dayLabel(d)}: ${fmtN(perDay[d])} units`}>
                  <div className={`w-full rounded-t-[4px] ${hover === d ? 'bg-ae-blue-dark' : 'bg-ae-blue'}`}
                    style={{ height: `${(perDay[d] / maxDay) * 100}%`, minHeight: perDay[d] ? 2 : 0 }} />
                </div>
              ))}
            </div>
            <div className="mt-1 flex justify-between text-xs text-stone-500">
              <span>{dayLabel(p.from, {})}</span><span>{dayLabel(p.to, {})}</span>
            </div>
            {hover && (
              <div className="mt-3 rounded-lg bg-ae-cream/60 p-3">
                <div className="mb-1 flex items-baseline justify-between text-sm">
                  <span className="font-semibold text-ae-blue">{dayLabel(hover, { weekday: true })}</span>
                  <button type="button" className="text-xs font-semibold text-ae-blue underline" onClick={() => setParams({ by: 'day', from: hover })}>Open day</button>
                </div>
                {hoverList.length ? (
                  <ul className="space-y-0.5 text-sm">
                    {hoverList.map(([n, u]) => <li key={n} className="flex justify-between gap-3"><span>{n}</span><b className="whitespace-nowrap">{fmtN(u)} units</b></li>)}
                  </ul>
                ) : <p className="text-sm text-stone-500">Nothing made.</p>}
              </div>
            )}
          </Card>}

          {byPlace.length > 1 && (
            <Card className="p-0 sm:p-0">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-stone-200 text-left text-xs text-stone-500"><th className="px-4 py-2">Made at</th><th className="px-4 py-2 text-right">Units</th><th className="px-4 py-2 text-right">kg</th></tr></thead>
                <tbody className="divide-y divide-stone-100">
                  {byPlace.map(([c, v]) => (
                    <tr key={c}><td className="px-4 py-2 font-semibold">{c}</td><td className="px-4 py-2 text-right">{fmtN(v.units)}</td><td className="px-4 py-2 text-right">{Math.round(v.kg * 10) / 10}</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {byCategory.length > 0 && (
            <Card className="p-0 sm:p-0">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-stone-200 text-left text-xs text-stone-500"><th className="px-4 py-2">Category</th><th className="px-4 py-2 text-right">Units</th><th className="px-4 py-2 text-right">kg</th></tr></thead>
                <tbody className="divide-y divide-stone-100">
                  {byCategory.map(([c, v]) => (
                    <tr key={c}><td className="px-4 py-2 font-semibold">{c}</td><td className="px-4 py-2 text-right">{fmtN(v.units)}</td><td className="px-4 py-2 text-right">{Math.round(v.kg * 10) / 10}</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {kind !== 'day' && <ProductTable byProduct={byProduct} />}
        </>
      )}
    </div>
  )
}

function Tile({ label, value, extra }: { label: string; value: string; extra?: ReactNode }) {
  return (
    <Card className="p-3 sm:p-4">
      <div className="text-xs font-semibold text-stone-500">{label}</div>
      <div className="text-xl font-bold text-ae-blue">{value}</div>
      {extra}
    </Card>
  )
}

type ProductRow = { key: string; name: string; sku: string; size: number | null; units: number; kg: number; batches: Set<string>; outs: OutRow[] }

/** One line per product and pack size, in units. */
function ProductTable({ byProduct, big }: { byProduct: ProductRow[]; big?: boolean }) {
  return (
    <Card className="overflow-x-auto p-0 sm:p-0">
      {byProduct.length ? (
        <table className="w-full text-sm">
          <thead><tr className="border-b border-stone-200 text-left text-xs text-stone-500">
            <th className="px-4 py-2">Product</th><th className="px-2 py-2 text-right">Units</th><th className="px-2 py-2 text-right">kg</th><th className="hidden px-2 py-2 text-right sm:table-cell">Batches</th><th className="hidden px-4 py-2 text-right sm:table-cell">Loss</th>
          </tr></thead>
          <tbody className="divide-y divide-stone-100">
            {byProduct.map((r) => {
              const l = lossPct(r.outs)
              return (
                <tr key={r.key}>
                  <td className="px-4 py-2"><div className="font-semibold">{r.name}{r.size != null && <span className="whitespace-nowrap"> {sizeText(Number(r.size))}</span>}</div><div className="font-mono text-xs text-stone-500">{r.sku}</div></td>
                  <td className={`px-2 py-2 text-right font-bold text-ae-blue ${big ? 'text-xl' : ''}`}>{fmtN(r.units)}</td>
                  <td className="px-2 py-2 text-right">{Math.round(r.kg * 10) / 10}</td>
                  <td className="hidden px-2 py-2 text-right sm:table-cell">{r.batches.size}</td>
                  <td className="hidden px-4 py-2 text-right sm:table-cell">{l == null ? '—' : `${l.toFixed(1)}%`}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : <p className="p-4 text-sm text-stone-500">{big ? 'Nothing filled on this day.' : 'Nothing filled in this period.'}</p>}
    </Card>
  )
}
