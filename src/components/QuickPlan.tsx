// Plan several products for one day in one go (same feel as the Order Hub's order form):
// type to search, type or tap the amount, press Add. Products made recently come first.
// Like the Excel planner, each product can be planned in units, kg or g; kg and g are turned
// into units with the pack size (2 kg of 60 g packs = 33 units).
// The pack size can be changed per batch (e.g. 500 g or 1 kg bulk), and a product that isn't
// in the list can be added on the spot (it gets a CUSTOM-0001 code and goes on "To check").
import { useCallback, useEffect, useMemo, useState } from 'react'
import { addDays, dayLabel, fmtN, todayIST, why } from '../lib/batches'
import { addMakerPrompt, likelyMakers, useMakers } from '../lib/makers'
import { CATEGORIES, nextBatchNo, sizeText, type Product } from '../lib/products'
import { supabase } from '../lib/supabase'
import { Button, ErrorBox, Field, Input, Select } from './ui'

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

type Mode = 'units' | 'kg' | 'g'
const STEP: Record<Mode, number> = { units: 50, kg: 1, g: 500 }
const MODES: Mode[] = ['units', 'kg', 'g']
const BULK_SIZES = [500, 1000]

/** How many units an amount means at this pack size, or null if it can't be worked out. */
function toUnits(grams: number | null, amount: number, mode: Mode): number | null {
  if (!amount) return 0
  if (mode === 'units') return Math.round(amount)
  if (!grams) return null
  return Math.round((mode === 'kg' ? amount * 1000 : amount) / grams)
}

const amountText = (n: number, mode: Mode) => (mode === 'units' ? `${fmtN(n)}` : `${n} ${mode}`)

function NewProduct({ startName, onAdded, onCancel }: { startName: string; onAdded: (p: Product) => void; onCancel: () => void }) {
  const [name, setName] = useState(startName)
  const [grams, setGrams] = useState('')
  const [category, setCategory] = useState('')
  const [prefix, setPrefix] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async () => {
    setBusy(true)
    setError('')
    const { data, error: err } = await supabase.rpc('add_custom_product', {
      p_name: name, p_grams: Number(grams), p_category: category || null, p_prefix: prefix || null,
    })
    if (err) { setBusy(false); return setError(why(err)) }
    const { data: p } = await supabase.from('products').select('*').eq('id', data as string).single()
    setBusy(false)
    if (p) onAdded(p as Product)
  }
  return (
    <div className="space-y-3 rounded-xl border border-ae-blue/30 bg-ae-cream/50 p-3">
      <p className="text-sm font-semibold text-ae-blue">New product</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Custom Diwali pretzel mix" autoFocus /></Field></div>
        <Field label="Pack size (g)"><Input value={grams} onChange={(e) => setGrams(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder="e.g. 30, 500, 1000" /></Field>
        <Field label="Category">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">—</option>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="Batch prefix" hint="Optional, e.g. PDCUS"><Input value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} autoCapitalize="characters" /></Field>
      </div>
      <p className="text-xs text-stone-500">It gets a temporary code (CUSTOM-0001) and goes on Products → To check.</p>
      <ErrorBox>{error}</ErrorBox>
      <div className="flex gap-2">
        <Button disabled={busy || !name.trim() || !(Number(grams) > 0)} onClick={save}>{busy ? 'Adding…' : 'Add product'}</Button>
        <Button tone="plain" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

export default function QuickPlan({ day, onDone, onCancel }: { day: string; onDone: (msg: string) => void; onCancel: () => void }) {
  const [products, setProducts] = useState<Product[]>([])
  const [recent, setRecent] = useState<Record<string, number>>({})
  const [amount, setAmount] = useState<Record<string, string>>({})
  const [mode, setMode] = useState<Record<string, Mode>>({})
  const [size, setSize] = useState<Record<string, number>>({})
  const [otherSize, setOtherSize] = useState<Record<string, boolean>>({})
  const [maker, setMaker] = useState<Record<string, string>>({})
  const makers = useMakers()
  const makerName = (id: string) => makers.find((m) => m.id === id)?.name
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const loadProducts = useCallback(async () => {
    const { data } = await supabase.from('products').select('*').eq('live', true).order('name')
    setProducts((data ?? []) as Product[])
  }, [])
  useEffect(() => {
    loadProducts()
    supabase.from('batches').select('product_id').gte('planned_date', addDays(todayIST(), -60)).neq('stage', 'cancelled').limit(3000)
      .then(({ data }) => {
        const n: Record<string, number> = {}
        for (const r of data ?? []) n[r.product_id] = (n[r.product_id] ?? 0) + 1
        setRecent(n)
      })
  }, [loadProducts])

  const list = useMemo(() => {
    const words = norm(q).split(' ').filter(Boolean)
    return products
      .filter((p) => words.every((w) => norm(`${p.name} ${p.sku} ${p.category ?? ''} ${p.grammage_g ?? ''}g`).includes(w)))
      .sort((a, b) => (recent[b.id] ?? 0) - (recent[a.id] ?? 0) || a.name.localeCompare(b.name))
  }, [products, q, recent])

  const byId = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products])
  const modeOf = (id: string) => mode[id] ?? 'units'
  const sizeOf = (p: Product) => size[p.id] ?? p.grammage_g ?? null
  const num = (id: string) => Number(amount[id] ?? 0) || 0
  const picked = Object.keys(amount)
    .filter((id) => num(id) > 0 && byId[id])
    .map((id) => {
      const p = byId[id]
      const g = sizeOf(p)
      return { p, g, amt: num(id), mode: modeOf(id), units: toUnits(g, num(id), modeOf(id)), custom: g != null && g !== p.grammage_g, maker: maker[id] || null }
    })
  const ready = picked.filter((x) => x.units && x.units > 0)

  const setAmt = (id: string, v: string) => {
    const clean = modeOf(id) === 'kg' ? v.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1') : v.replace(/\D/g, '')
    setAmount({ ...amount, [id]: clean })
  }
  const step = (id: string, dir: 1 | -1) => {
    const n = Math.max(0, Math.round((num(id) + dir * STEP[modeOf(id)]) * 1000) / 1000)
    setAmount({ ...amount, [id]: n ? String(n) : '' })
  }
  const switchMode = (id: string, m: Mode) => { setMode({ ...mode, [id]: m }); setAmount({ ...amount, [id]: '' }) }
  const pickSize = (p: Product, v: string) => {
    if (v === 'other') { setOtherSize({ ...otherSize, [p.id]: true }); return }
    setOtherSize({ ...otherSize, [p.id]: false })
    setSize({ ...size, [p.id]: Number(v) })
  }

  const add = async () => {
    setBusy(true)
    setError('')
    let done = 0
    for (const x of ready) {
      const notes = [x.mode === 'units' ? null : `Planned as ${amountText(x.amt, x.mode)}`].filter(Boolean).join('; ')
      const { error: err } = await supabase.rpc('plan_batch', {
        p_product: x.p.id, p_date: day, p_units: x.units,
        p_grammage: x.g, p_pack: x.custom && x.g && x.g >= 500 ? 'bulk' : null, p_notes: notes || null, p_maker: x.maker,
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
      {adding ? (
        <NewProduct startName={q} onCancel={() => setAdding(false)} onAdded={async (p) => {
          setAdding(false)
          await loadProducts()
          setQ(p.name)
        }} />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="w-full rounded-xl border-2 border-dashed border-ae-blue/30 px-4 py-2 text-sm font-semibold text-ae-blue">
          + New product{q.trim() ? ` “${q.trim()}”` : ''}
        </button>
      )}
      <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
        {list.map((p) => {
          const m = modeOf(p.id)
          const a = num(p.id)
          const g = sizeOf(p)
          const units = toUnits(g, a, m)
          const sizes = [...new Set([p.grammage_g, ...BULK_SIZES, ...(g && g !== p.grammage_g ? [g] : [])].filter((x): x is number => !!x))]
          return (
            <li key={p.id} className={`flex items-center gap-2 px-3 py-2 ${a ? 'bg-ae-yellow/30' : ''}`}>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-stone-900">{p.name}</div>
                <div className="text-xs text-stone-500"><span className="font-mono">{nextBatchNo(p) ?? 'no batch prefix'}</span>{p.sku.startsWith('CUSTOM-') && ' · new'}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {otherSize[p.id] ? (
                    <input inputMode="decimal" autoFocus aria-label={`Pack size of ${p.name} in grams`} placeholder="g"
                      className="h-7 w-16 rounded-md border border-ae-blue px-1 text-center text-xs"
                      onChange={(e) => { const v = Number(e.target.value.replace(/[^\d.]/g, '')); if (v > 0) setSize({ ...size, [p.id]: v }) }}
                      onBlur={() => setOtherSize({ ...otherSize, [p.id]: false })} />
                  ) : (
                    <select aria-label={`Pack size of ${p.name}`} value={g ?? ''} onChange={(e) => pickSize(p, e.target.value)}
                      className={`h-7 rounded-md border px-1 text-xs font-semibold ${g !== p.grammage_g ? 'border-ae-blue bg-ae-blue text-ae-cream' : 'border-stone-300 bg-white text-stone-700'}`}>
                      {!g && <option value="">size?</option>}
                      {sizes.map((s) => <option key={s} value={s}>{sizeText(s)}{s !== p.grammage_g && s >= 500 ? ' bulk' : ''}</option>)}
                      <option value="other">Other…</option>
                    </select>
                  )}
                  <div className="inline-flex rounded-md border border-stone-300 bg-white text-xs font-semibold">
                    {MODES.map((k) => (
                      <button key={k} type="button" onClick={() => switchMode(p.id, k)} disabled={k !== 'units' && !g}
                        className={`px-2 py-1 first:rounded-l-md last:rounded-r-md disabled:opacity-30 ${m === k ? 'bg-ae-blue text-ae-cream' : 'text-stone-600'}`}>{k}</button>
                    ))}
                  </div>
                  {a > 0 && m !== 'units' && <span className="text-xs font-semibold text-ae-blue">= {units ? fmtN(units) : 0} units</span>}
                </div>
                <select aria-label={`Where ${p.name} is made`} value={maker[p.id] ?? ''} onChange={async (e) => {
                    const v = e.target.value === '__new' ? await addMakerPrompt() : e.target.value
                    setMaker({ ...maker, [p.id]: v ?? maker[p.id] ?? '' })
                  }}
                  className={`mt-1 h-7 max-w-full rounded-md border px-1 text-xs font-semibold ${maker[p.id] ? 'border-ae-lilac bg-ae-lilac/30 text-ae-blue' : 'border-stone-300 bg-white text-stone-700'}`}>
                  <option value="">Made in-house</option>
                  {(() => {
                    const likely = likelyMakers(p.category, makers.filter((x) => x.active))
                    const rest = makers.filter((x) => x.active && !likely.includes(x))
                    return [...likely, ...rest].map((x) => <option key={x.id} value={x.id}>at {x.name}</option>)
                  })()}
                  <option value="__new">+ New manufacturer…</option>
                </select>
              </div>
              <button type="button" aria-label="Less" className="h-11 w-11 shrink-0 rounded-lg border border-stone-300 bg-white text-xl font-bold" onClick={() => step(p.id, -1)}>−</button>
              <input inputMode={m === 'kg' ? 'decimal' : 'numeric'} aria-label={`${m} of ${p.name}`} className="h-11 w-16 shrink-0 rounded-lg border border-stone-300 text-center text-base"
                value={amount[p.id] ?? ''} placeholder={m === 'units' ? '0' : m} onFocus={(e) => e.target.select()} onChange={(e) => setAmt(p.id, e.target.value)} />
              <button type="button" aria-label="More" className="h-11 w-11 shrink-0 rounded-lg bg-ae-blue text-xl font-bold text-ae-cream" onClick={() => step(p.id, 1)}>+</button>
            </li>
          )
        })}
        {!list.length && <li className="px-3 py-3 text-sm text-stone-500">No product matches. Use “+ New product” above.</li>}
      </ul>
      <ErrorBox>{error}</ErrorBox>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-stone-200 bg-white/95 px-4 py-3 shadow-lg">
        {picked.length > 0 && (
          <div className="mx-auto mb-2 flex max-w-5xl flex-wrap gap-1.5">
            {picked.map((x) => (
              <button key={x.p.id} type="button" onClick={() => setAmount({ ...amount, [x.p.id]: '' })} title="Remove"
                className="rounded-full bg-ae-yellow px-2.5 py-1 text-xs font-semibold text-ae-blue">
                {x.p.name}{x.custom && x.g ? ` ${sizeText(x.g)}` : ''} · {amountText(x.amt, x.mode)}{x.mode !== 'units' && ` (${fmtN(x.units ?? 0)})`}{x.maker && ` · at ${makerName(x.maker)}`} ✕
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
