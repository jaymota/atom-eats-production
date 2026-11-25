// Loss from counts, month by month: items that were less than the system said, in quantity and
// ₹ (at the last price when counted). Biggest losses first.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '../../components/ui'
import { fmtQty, rupees, type MatItem, type Place } from '../../lib/materials'
import { supabase } from '../../lib/supabase'

interface L { item_id: string; diff: number; rate: number | null; count: { counted_on: string; place_id: string } }

export default function LossTab({ items, places }: { items: MatItem[]; places: Place[] }) {
  const [lines, setLines] = useState<L[] | null>(null)
  useEffect(() => {
    supabase.from('mat_count_lines').select('item_id, diff, rate, count:mat_counts(counted_on, place_id)').lt('diff', 0)
      .then(({ data }) => setLines((data ?? []) as unknown as L[]))
  }, [])
  const byId = Object.fromEntries(items.map((i) => [i.id, i]))
  const placeName = Object.fromEntries(places.map((p) => [p.id, p.name]))
  if (lines === null) return <p className="text-sm text-stone-500">Loading…</p>
  if (!lines.length) return <Card><p className="text-sm text-stone-600">No loss recorded yet. Loss shows here after a count finds less than the system.</p></Card>

  const months = new Map<string, L[]>()
  for (const l of lines) { const m = l.count.counted_on.slice(0, 7); months.set(m, [...(months.get(m) ?? []), l]) }
  const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })

  return (
    <div className="space-y-4">
      {[...months.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([m, ls]) => {
        const rows = new Map<string, { qty: number; value: number; places: Set<string> }>()
        for (const l of ls) {
          const r = rows.get(l.item_id) ?? { qty: 0, value: 0, places: new Set<string>() }
          r.qty += -Number(l.diff); r.value += -Number(l.diff) * Number(l.rate ?? 0); r.places.add(placeName[l.count.place_id] ?? '')
          rows.set(l.item_id, r)
        }
        const sorted = [...rows.entries()].sort((a, b) => b[1].value - a[1].value || b[1].qty - a[1].qty)
        const total = sorted.reduce((s, [, r]) => s + r.value, 0)
        return (
          <div key={m} className="space-y-2">
            <h3 className="flex justify-between text-sm font-semibold text-stone-500"><span>{monthName(m)}</span><span className="text-red-700">{rupees(total)}</span></h3>
            <Card className="p-0 sm:p-0">
              <ul className="divide-y divide-stone-100">
                {sorted.map(([id, r], n) => (
                  <li key={id} className={`flex justify-between gap-3 px-4 py-2 text-sm ${n < 3 && r.value > 0 ? 'bg-red-50' : ''}`}>
                    <span><Link to={`/material/${id}`} className="font-semibold underline">{byId[id]?.name ?? '?'}</Link> <span className="text-xs text-stone-500">{[...r.places].join(', ')}</span></span>
                    <span className="whitespace-nowrap"><b>{fmtQty(r.qty, byId[id]?.unit ?? '')}</b> · {r.value ? rupees(r.value) : 'no price'}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        )
      })}
    </div>
  )
}
