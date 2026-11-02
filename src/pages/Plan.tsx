// The week plan (Mon–Sun). Admins add batches, copy last week's plan, and open a batch to
// change or cancel it. Everyone can look.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BatchCard } from '../components/BatchCard'
import { Button, Card, ErrorBox, Field, Input, OkBox, Select } from '../components/ui'
import { useAuth } from '../lib/auth'
import {
  PACK_NAMES, addDays, dayLabel, fmtKg, fmtN, loadBatches, mondayOf, todayIST, why, type Batch, type PackType,
} from '../lib/batches'
import { isAdmin } from '../lib/format'
import { CATEGORIES, nextBatchNo, type Product } from '../lib/products'
import { supabase } from '../lib/supabase'
import { useWorkers } from '../lib/workers'

export function guessPack(p: Pick<Product, 'name'>): PackType {
  const n = p.name.toLowerCase()
  return n.includes('party pack') ? 'party_pack' : n.includes('jar') ? 'jar' : n.startsWith('bulk') ? 'bulk' : 'pouch'
}

/** Product picker grouped by category (live products only). */
export function ProductSelect({ products, value, onChange }: { products: Product[]; value: string; onChange: (id: string) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, Product[]>()
    for (const p of products.filter((x) => x.live || x.id === value)) m.set(p.category ?? 'Other', [...(m.get(p.category ?? 'Other') ?? []), p])
    const rank = (c: string) => CATEGORIES.indexOf(c) + 1 || 99
    return [...m.entries()].sort((a, b) => rank(a[0]) - rank(b[0]))
  }, [products, value])
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} required>
      <option value="" disabled>Choose…</option>
      {groups.map(([cat, list]) => (
        <optgroup key={cat} label={cat}>
          {list.map((p) => <option key={p.id} value={p.id}>{p.name}{p.grammage_g ? ` · ${p.grammage_g} g` : ''}</option>)}
        </optgroup>
      ))}
    </Select>
  )
}

function AddBatch({ products, date, onDone, onCancel }: { products: Product[]; date: string; onDone: (msg: string) => void; onCancel: () => void }) {
  const [productId, setProductId] = useState('')
  const [day, setDay] = useState(date)
  const [units, setUnits] = useState('')
  const [grams, setGrams] = useState('')
  const [pack, setPack] = useState<PackType>('pouch')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const product = products.find((p) => p.id === productId)

  const pick = (id: string) => {
    setProductId(id)
    const p = products.find((x) => x.id === id)
    if (p) { setGrams(p.grammage_g?.toString() ?? ''); setPack(guessPack(p)) }
  }

  const kg = Number(units) > 0 && Number(grams) > 0 ? (Number(units) * Number(grams)) / 1000 : null

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error: err } = await supabase.rpc('plan_batch', {
      p_product: productId, p_date: day, p_units: Math.round(Number(units)),
      p_grammage: grams ? Number(grams) : null, p_pack: pack, p_notes: notes || null, p_batch_no: null,
    })
    setBusy(false)
    if (err) return setError(why(err))
    onDone(`Planned ${units} × ${product?.name}`)
  }

  return (
    <form onSubmit={save} className="grid gap-3 sm:grid-cols-3">
      <div className="sm:col-span-2"><Field label="Product"><ProductSelect products={products} value={productId} onChange={pick} /></Field></div>
      <Field label="Date"><Input type="date" value={day} onChange={(e) => setDay(e.target.value)} required /></Field>
      <Field label="Units"><Input value={units} onChange={(e) => setUnits(e.target.value.replace(/\D/g, ''))} inputMode="numeric" required /></Field>
      <Field label="Size (g)"><Input value={grams} onChange={(e) => setGrams(e.target.value)} inputMode="decimal" /></Field>
      <Field label="Pack">
        <Select value={pack} onChange={(e) => setPack(e.target.value as PackType)}>
          {(Object.keys(PACK_NAMES) as PackType[]).map((k) => <option key={k} value={k}>{PACK_NAMES[k]}</option>)}
        </Select>
      </Field>
      <div className="sm:col-span-3"><Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field></div>
      <div className="space-y-2 sm:col-span-3">
        {product && (
          <p className="text-sm text-stone-600">
            Batch no.: <span className="font-mono font-semibold">{nextBatchNo(product) ?? 'none (add a prefix in Products)'}</span>
            {kg != null && <> · Expected {fmtKg(kg)}</>}
          </p>
        )}
        <ErrorBox>{error}</ErrorBox>
        <div className="flex gap-2">
          <Button type="submit" disabled={busy || !productId || !units}>{busy ? 'Saving…' : 'Add'}</Button>
          <Button tone="plain" onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </form>
  )
}

export default function Plan() {
  const { me } = useAuth()
  const admin = isAdmin(me?.role)
  const { names } = useWorkers()
  const [params, setParams] = useSearchParams()
  const monday = mondayOf(params.get('week') ?? todayIST())
  const [rows, setRows] = useState<Batch[] | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [adding, setAdding] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  const today = todayIST()

  const load = useCallback(async () => {
    setRows(await loadBatches((q) => q.gte('planned_date', monday).lte('planned_date', addDays(monday, 6)).order('created_at')))
  }, [monday])
  useEffect(() => { setRows(null); load() }, [load])
  useEffect(() => {
    supabase.from('products').select('*').order('name').then(({ data }) => setProducts((data ?? []) as Product[]))
  }, [])

  const go = (n: number) => { setAdding(null); setMsg(''); setParams({ week: addDays(monday, n * 7) }) }

  const copyLast = async () => {
    if (!confirm('Copy last week’s plan into this week? Each batch gets a new batch number.')) return
    setError('')
    const { data, error: err } = await supabase.rpc('copy_week', { p_from: addDays(monday, -7), p_to: monday })
    if (err) return setError(why(err))
    setMsg(data ? `Copied ${data} batches.` : 'Last week had nothing to copy.')
    load()
  }

  const list = rows ?? []
  const live = list.filter((b) => b.stage !== 'cancelled')
  const weekUnits = live.reduce((s, b) => s + (b.units_planned ?? 0), 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-bold text-ae-blue">Plan</h2>
        {admin && (
          <div className="flex gap-2">
            {!list.some((b) => !b.imported) && <Button tone="plain" onClick={copyLast}>Copy last week</Button>}
            <Button onClick={() => { setAdding(today >= monday && today <= days[6] ? today : monday); setMsg('') }}>+ Add</Button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button tone="plain" className="min-h-10 px-3" onClick={() => go(-1)} aria-label="Previous week">‹</Button>
        <div className="flex-1 text-center font-semibold text-stone-800">
          {dayLabel(monday, {})} – {dayLabel(days[6], { year: true })}
          <div className="text-xs font-normal text-stone-500">{live.length} batches · {fmtN(weekUnits)} units</div>
        </div>
        <Button tone="plain" className="min-h-10 px-3" onClick={() => go(1)} aria-label="Next week">›</Button>
      </div>
      {mondayOf(today) !== monday && (
        <div className="text-center"><button type="button" className="text-sm font-semibold text-ae-blue underline" onClick={() => setParams({})}>This week</button></div>
      )}

      <OkBox>{msg}</OkBox>
      <ErrorBox>{error}</ErrorBox>

      {adding && (
        <Card>
          <AddBatch products={products} date={adding} onCancel={() => setAdding(null)} onDone={(m) => { setAdding(null); setMsg(m); load() }} />
        </Card>
      )}

      {rows === null && <p className="text-sm text-stone-500">Loading…</p>}
      {rows && days.map((d) => {
        const here = list.filter((b) => b.planned_date === d)
        const units = here.filter((b) => b.stage !== 'cancelled').reduce((s, b) => s + (b.units_planned ?? 0), 0)
        return (
          <div key={d} className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className={`text-sm font-semibold ${d === today ? 'text-ae-blue' : 'text-stone-500'}`}>
                {dayLabel(d)}{d === today && ' · Today'}{here.length > 0 && ` · ${fmtN(units)} units`}
              </h3>
              {admin && <button type="button" className="px-2 text-sm font-semibold text-ae-blue" onClick={() => { setAdding(d); setMsg('') }}>+ Add</button>}
            </div>
            {here.length > 0 && (
              <Card className="p-0 sm:p-0">
                <ul className="divide-y divide-stone-100">
                  {here.map((b) => <li key={b.id} className={b.stage === 'cancelled' ? 'opacity-50' : ''}><BatchCard b={b} workerNames={names} /></li>)}
                </ul>
              </Card>
            )}
          </div>
        )
      })}
    </div>
  )
}
