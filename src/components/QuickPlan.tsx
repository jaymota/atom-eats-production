// Plan several products for one day in one go (same feel as the Order Hub's order form):
// type to search, type or tap the units, press Add. Products made recently come first.
// Size and pack come from the product; change them on the batch page if needed.
import { useEffect, useMemo, useState } from 'react'
import { addDays, dayLabel, todayIST, why } from '../lib/batches'
import { nextBatchNo, type Product } from '../lib/products'
import { supabase } from '../lib/supabase'
import { Button, ErrorBox, Input } from './ui'

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const STEP = 50

export default function QuickPlan({ day, onDone, onCancel }: { day: string; onDone: (msg: string) => void; onCancel: () => void }) {
  const [products, setProducts] = useState<Product[]>([])
  const [recent, setRecent] = useState<Record<string, number>>({})
  const [qty, setQty] = useState<Record<string, number>>({})
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

  const picked = Object.entries(qty).filter(([, n]) => n > 0)
  const set = (id: string, n: number) => setQty({ ...qty, [id]: Math.max(0, Math.min(99999, n)) })

  const add = async () => {
    setBusy(true)
    setError('')
    let done = 0
    for (const [id, n] of picked) {
      const { error: err } = await supabase.rpc('plan_batch', { p_product: id, p_date: day, p_units: n })
      if (err) {
        setBusy(false)
        setQty(Object.fromEntries(picked.slice(done)))
        return setError(`${products.find((p) => p.id === id)?.name}: ${why(err)}${done ? ` (${done} added before this)` : ''}`)
      }
      done++
    }
    setBusy(false)
    setQty({})
    onDone(`Added ${done} ${done === 1 ? 'batch' : 'batches'} to ${dayLabel(day)}`)
  }

  return (
    <div className="space-y-2 pb-32">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search product" autoFocus />
      <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
        {list.map((p) => {
          const n = qty[p.id] ?? 0
          return (
            <li key={p.id} className={`flex items-center gap-2 px-3 py-2 ${n ? 'bg-ae-yellow/30' : ''}`}>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-stone-900">{p.name}</div>
                <div className="text-xs text-stone-500">{p.grammage_g ? `${p.grammage_g} g · ` : ''}<span className="font-mono">{nextBatchNo(p) ?? 'no batch prefix'}</span></div>
              </div>
              <button type="button" aria-label="Less" className="h-11 w-11 shrink-0 rounded-lg border border-stone-300 bg-white text-xl font-bold" onClick={() => set(p.id, n - STEP)}>−</button>
              <input inputMode="numeric" aria-label={`Units of ${p.name}`} className="h-11 w-16 shrink-0 rounded-lg border border-stone-300 text-center text-base"
                value={n || ''} placeholder="0" onFocus={(e) => e.target.select()} onChange={(e) => set(p.id, Number(e.target.value.replace(/\D/g, '')) || 0)} />
              <button type="button" aria-label="More" className="h-11 w-11 shrink-0 rounded-lg bg-ae-blue text-xl font-bold text-ae-cream" onClick={() => set(p.id, n + STEP)}>+</button>
            </li>
          )
        })}
        {!list.length && <li className="px-3 py-3 text-sm text-stone-500">No product matches.</li>}
      </ul>
      <ErrorBox>{error}</ErrorBox>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-stone-200 bg-white/95 px-4 py-3 shadow-lg">
        {picked.length > 0 && (
          <div className="mx-auto mb-2 flex max-w-5xl flex-wrap gap-1.5">
            {picked.map(([id, n]) => (
              <button key={id} type="button" onClick={() => set(id, 0)} title="Remove"
                className="rounded-full bg-ae-yellow px-2.5 py-1 text-xs font-semibold text-ae-blue">
                {products.find((p) => p.id === id)?.name} · {n} ✕
              </button>
            ))}
          </div>
        )}
        <div className="mx-auto flex max-w-5xl gap-2">
          <Button tone="plain" onClick={onCancel}>Close</Button>
          <Button className="flex-1" disabled={busy || !picked.length} onClick={add}>
            {busy ? 'Adding…' : picked.length ? `Add ${picked.length} to ${dayLabel(day)}` : 'Type units to plan'}
          </Button>
        </div>
      </div>
    </div>
  )
}
