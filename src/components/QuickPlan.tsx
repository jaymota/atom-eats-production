// Plan several products for one day in one go (same feel as the Order Hub's order form):
// type to search, type or tap the amount, press Add. Products made recently come first.
// Like the Excel planner, each product can be planned in units, kg or g; kg and g are turned
// into units with the product's pack size (2 kg of 60 g packs = 33 units).
// Size and pack come from the product; change them on the batch page if needed.
import { useEffect, useMemo, useState } from 'react'
import { addDays, dayLabel, fmtN, todayIST, why } from '../lib/batches'
import { nextBatchNo, type Product } from '../lib/products'
import { supabase } from '../lib/supabase'
import { Button, ErrorBox, Input } from './ui'

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

type Mode = 'units' | 'kg' | 'g'
const STEP: Record<Mode, number> = { units: 50, kg: 1, g: 500 }
const MODES: Mode[] = ['units', 'kg', 'g']

/** How many units an amount means for this product, or null if it can't be worked out. */
function toUnits(p: Product, amount: number, mode: Mode): number | null {
  if (!amount) return 0
  if (mode === 'units') return Math.round(amount)
  if (!p.grammage_g) return null
  return Math.round((mode === 'kg' ? amount * 1000 : amount) / p.grammage_g)
}

const amountText = (n: number, mode: Mode) => (mode === 'units' ? `${fmtN(n)}` : `${n} ${mode}`)

export default function QuickPlan({ day, onDone, onCancel }: { day: string; onDone: (msg: string) => void; onCancel: () => void }) {
  const [products, setProducts] = useState<Product[]>([])
  const [recent, setRecent] = useState<Record<string, number>>({})
  const [amount, setAmount] = useState<Record<string, string>>({})
  const [mode, setMode] = useState<Record<string, Mode>>({})
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('products').select('*').eq('live', true).order('name').then(({ data }) => setProducts((data ?? []) as Product[]))
    supabase.from('batches').select('product_id').gte('planned_date', addDays(todayIST(), -60)).neq('stage', 'cancelled').limit(3000)
      .then(({ data }) => {
        const n: Record<string, number> = {}
        for (const r of data ?? []) n[r.product_id] = (n[r.product_id] ?? 0) + 1
        setRecent(n)
      })
  }, [])

  const list = useMemo(() => {
    const words = norm(q).split(' ').filter(Boolean)
    return products
      .filter((p) => words.every((w) => norm(`${p.name} ${p.sku} ${p.category ?? ''} ${p.grammage_g ?? ''}g`).includes(w)))
      .sort((a, b) => (recent[b.id] ?? 0) - (recent[a.id] ?? 0) || a.name.localeCompare(b.name))
  }, [products, q, recent])

  const byId = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products])
  const modeOf = (id: string) => mode[id] ?? 'units'
  const num = (id: string) => Number(amount[id] ?? 0) || 0
  const picked = Object.keys(amount)
    .filter((id) => num(id) > 0 && byId[id])
    .map((id) => ({ p: byId[id], amt: num(id), mode: modeOf(id), units: toUnits(byId[id], num(id), modeOf(id)) }))
  const ready = picked.filter((x) => x.units && x.units > 0)

  const setAmt = (id: string, v: string) => {
    const clean = modeOf(id) === 'kg' ? v.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1') : v.replace(/\D/g, '')
    setAmount({ ...amount, [id]: clean })
  }
  const step = (id: string, dir: 1 | -1) => {
    const m = modeOf(id)
    const n = Math.max(0, Math.round((num(id) + dir * STEP[m]) * 1000) / 1000)
    setAmount({ ...amount, [id]: n ? String(n) : '' })
  }
  const switchMode = (id: string, m: Mode) => { setMode({ ...mode, [id]: m }); setAmount({ ...amount, [id]: '' }) }

  const add = async () => {
    setBusy(true)
    setError('')
    let done = 0
    for (const x of ready) {
      const { error: err } = await supabase.rpc('plan_batch', {
        p_product: x.p.id, p_date: day, p_units: x.units,
        p_notes: x.mode === 'units' ? null : `Planned as ${amountText(x.amt, x.mode)}`,
      })
      if (err) {
        setBusy(false)
        const left = new Set(ready.slice(done).map((y) => y.p.id))
        setAmount(Object.fromEntries(Object.entries(amount).filter(([id]) => left.has(id))))
        return setError(`${x.p.name}: ${why(err)}${done ? ` (${done} added before this)` : ''}`)
      }
      done++
    }
    setBusy(false)
    setAmount({})
    onDone(`Added ${done} ${done === 1 ? 'batch' : 'batches'} to ${dayLabel(day)}`)
  }

  return (
    <div className="space-y-2 pb-32">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search product" autoFocus />
      <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
        {list.map((p) => {
          const m = modeOf(p.id)
          const a = num(p.id)
          const units = toUnits(p, a, m)
          return (
            <li key={p.id} className={`flex items-center gap-2 px-3 py-2 ${a ? 'bg-ae-yellow/30' : ''}`}>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-stone-900">{p.name}</div>
                <div className="text-xs text-stone-500">{p.grammage_g ? `${p.grammage_g} g · ` : ''}<span className="font-mono">{nextBatchNo(p) ?? 'no batch prefix'}</span></div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="inline-flex rounded-md border border-stone-300 bg-white text-xs font-semibold">
                    {MODES.map((k) => (
                      <button key={k} type="button" onClick={() => switchMode(p.id, k)} disabled={k !== 'units' && !p.grammage_g}
                        className={`px-2 py-1 first:rounded-l-md last:rounded-r-md disabled:opacity-30 ${m === k ? 'bg-ae-blue text-ae-cream' : 'text-stone-600'}`}>{k}</button>
                    ))}
                  </div>
                  {a > 0 && m !== 'units' && <span className="text-xs font-semibold text-ae-blue">= {units ? fmtN(units) : 0} units</span>}
                </div>
              </div>
              <button type="button" aria-label="Less" className="h-11 w-11 shrink-0 rounded-lg border border-stone-300 bg-white text-xl font-bold" onClick={() => step(p.id, -1)}>−</button>
              <input inputMode={m === 'kg' ? 'decimal' : 'numeric'} aria-label={`${m} of ${p.name}`} className="h-11 w-16 shrink-0 rounded-lg border border-stone-300 text-center text-base"
                value={amount[p.id] ?? ''} placeholder={m === 'units' ? '0' : m} onFocus={(e) => e.target.select()} onChange={(e) => setAmt(p.id, e.target.value)} />
              <button type="button" aria-label="More" className="h-11 w-11 shrink-0 rounded-lg bg-ae-blue text-xl font-bold text-ae-cream" onClick={() => step(p.id, 1)}>+</button>
            </li>
          )
        })}
        {!list.length && <li className="px-3 py-3 text-sm text-stone-500">No product matches.</li>}
      </ul>
      <ErrorBox>{error}</ErrorBox>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-stone-200 bg-white/95 px-4 py-3 shadow-lg">
        {picked.length > 0 && (
          <div className="mx-auto mb-2 flex max-w-5xl flex-wrap gap-1.5">
            {picked.map((x) => (
              <button key={x.p.id} type="button" onClick={() => setAmount({ ...amount, [x.p.id]: '' })} title="Remove"
                className="rounded-full bg-ae-yellow px-2.5 py-1 text-xs font-semibold text-ae-blue">
                {x.p.name} · {amountText(x.amt, x.mode)}{x.mode !== 'units' && ` (${fmtN(x.units ?? 0)})`} ✕
              </button>
            ))}
          </div>
        )}
        <div className="mx-auto flex max-w-5xl gap-2">
          <Button tone="plain" onClick={onCancel}>Close</Button>
          <Button className="flex-1" disabled={busy || !ready.length} onClick={add}>
            {busy ? 'Adding…' : ready.length ? `Add ${ready.length} to ${dayLabel(day)}` : 'Type an amount to plan'}
          </Button>
        </div>
      </div>
    </div>
  )
}
