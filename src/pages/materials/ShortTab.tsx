// Short: items below their low level, and what this week's and next week's plan needs from the
// main store (Gala 17) against what's there. Recipe amounts only show to recipe people.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '../../components/ui'
import { addDays, dayLabel, mondayOf, todayIST } from '../../lib/batches'
import { fmtQty, mainPlace, stockOf, type MatItem, type Place, type StockLine } from '../../lib/materials'
import { supabase } from '../../lib/supabase'

interface Need { batch_id: string; planned_date: string; item_id: string; need: number | null; short: boolean }

export default function ShortTab({ items, places, stock }: { items: MatItem[]; places: Place[]; stock: StockLine[] }) {
  const [needs, setNeeds] = useState<Need[] | null>(null)
  const [batches, setBatches] = useState<Record<string, { batch_no: string | null; product: { name: string } }>>({})
  // Late batches still open count too.
  const from = addDays(todayIST(), -30)
  const to = addDays(mondayOf(todayIST()), 13)
  const main = mainPlace(places)

  useEffect(() => {
    supabase.rpc('mat_plan_needs', { p_from: from, p_to: to }).then(async ({ data }) => {
      const n = (data ?? []) as Need[]
      setNeeds(n)
      const ids = [...new Set(n.filter((x) => x.short).map((x) => x.batch_id))]
      if (ids.length) {
        const { data: b } = await supabase.from('batches').select('id, batch_no, product:products(name)').in('id', ids)
        setBatches(Object.fromEntries(((b ?? []) as unknown as { id: string; batch_no: string | null; product: { name: string } }[]).map((x) => [x.id, x])))
      }
    })
  }, [from, to])

  const byId = Object.fromEntries(items.map((i) => [i.id, i]))
  const low = items.filter((i) => i.low_level != null && stockOf(stock, i.id) <= Number(i.low_level))
  const totals = new Map<string, { need: number | null; short: boolean; batches: Set<string> }>()
  for (const n of needs ?? []) {
    const t = totals.get(n.item_id) ?? { need: 0, short: false, batches: new Set<string>() }
    t.need = t.need == null || n.need == null ? null : t.need + Number(n.need)
    if (n.short) { t.short = true; t.batches.add(n.batch_id) }
    totals.set(n.item_id, t)
  }
  const short = [...totals.entries()].filter(([, t]) => t.short)

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-stone-500">Not enough for the plan · to {dayLabel(to)}</h3>
      {needs === null && <p className="text-sm text-stone-500">Checking the plan…</p>}
      {needs && !short.length && <Card><p className="text-sm text-green-800">Enough at {main?.name} for everything planned.</p></Card>}
      {short.length > 0 && (
        <Card className="p-0 sm:p-0">
          <ul className="divide-y divide-stone-100">
            {short.map(([id, t]) => {
              const i = byId[id]
              if (!i) return null
              const have = stockOf(stock, id, main?.id)
              return (
                <li key={id} className="space-y-1 px-4 py-3">
                  <div className="flex justify-between gap-3">
                    <Link to={`/material/${id}`} className="font-semibold text-red-800 underline">{i.name}</Link>
                    <span className="text-right text-sm">
                      {t.need != null && <>Need <b>{fmtQty(t.need, i.unit)}</b> · </>}have <b>{fmtQty(have, i.unit)}</b>
                      {t.need != null && <span className="block font-bold text-red-700">Short {fmtQty(t.need - have, i.unit)}</span>}
                    </span>
                  </div>
                  <div className="text-xs text-stone-500">
                    {[...t.batches].map((b) => <Link key={b} to={`/batch/${b}`} className="mr-2 underline">{batches[b]?.product.name ?? 'batch'} {batches[b]?.batch_no ?? ''}</Link>)}
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      <h3 className="text-sm font-semibold text-stone-500">Below low level</h3>
      {!low.length && <Card><p className="text-sm text-stone-600">Nothing below its low level. Set “Low at” on an item to flag it.</p></Card>}
      {low.length > 0 && (
        <Card className="p-0 sm:p-0">
          <ul className="divide-y divide-stone-100">
            {low.map((i) => (
              <li key={i.id} className="flex justify-between gap-3 px-4 py-3">
                <Link to={`/material/${i.id}`} className="font-semibold underline">{i.name}</Link>
                <span className="text-sm"><b className="text-amber-700">{fmtQty(stockOf(stock, i.id), i.unit)}</b> · low at {fmtQty(Number(i.low_level), i.unit)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
