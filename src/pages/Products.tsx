// The product list. Everyone can see it; admins add and edit products. Nothing is deleted:
// a product that is no longer made is set to Not live.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Badge, Button, Card, ErrorBox, Field, Input, Select } from '../components/ui'
import { useAuth } from '../lib/auth'
import { isAdmin } from '../lib/format'
import { CATEGORIES, MADE_BY, nextBatchNo, type MadeBy, type Product } from '../lib/products'
import { supabase } from '../lib/supabase'

type Tab = 'live' | 'off' | 'check'

const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s))

function ProductForm({ initial, onDone, onCancel }: { initial: Partial<Product>; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({
    sku: initial.sku ?? '',
    name: initial.name ?? '',
    category: initial.category ?? '',
    grammage_g: initial.grammage_g?.toString() ?? '',
    mrp: initial.mrp?.toString() ?? '',
    shelf_life_months: initial.shelf_life_months?.toString() ?? '',
    batch_prefix: initial.batch_prefix ?? '',
    next_batch_no: (initial.next_batch_no ?? 1).toString(),
    made_by: (initial.made_by ?? '') as MadeBy | '',
    live: initial.live ?? true,
    notes: initial.notes ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const row = {
      sku: f.sku.trim(),
      name: f.name.trim(),
      category: f.category || null,
      grammage_g: numOrNull(f.grammage_g),
      mrp: numOrNull(f.mrp),
      shelf_life_months: numOrNull(f.shelf_life_months),
      batch_prefix: f.batch_prefix.trim().toUpperCase() || null,
      next_batch_no: Math.max(1, Math.round(Number(f.next_batch_no) || 1)),
      made_by: f.made_by || null,
      live: f.live,
      notes: f.notes.trim() || null,
    }
    const q = initial.id
      ? supabase.from('products').update(row).eq('id', initial.id)
      : supabase.from('products').insert(row)
    const { error: err } = await q
    setBusy(false)
    if (err) {
      setError(err.code === '23505' ? 'That SKU is already used.'
        : err.message.includes('batch_prefix') ? 'Batch prefix: capital letters and numbers only, e.g. PDSWSP.'
        : err.message)
      return
    }
    onDone()
  }

  return (
    <form onSubmit={save} className="grid gap-3 sm:grid-cols-3">
      <Field label="Name"><Input value={f.name} onChange={set('name')} required /></Field>
      <Field label="SKU"><Input value={f.sku} onChange={set('sku')} required autoCapitalize="characters" /></Field>
      <Field label="Category">
        <Select value={f.category} onChange={set('category')}>
          <option value="">—</option>
          {[...new Set([...CATEGORIES, ...(f.category ? [f.category] : [])])].map((c) => <option key={c}>{c}</option>)}
        </Select>
      </Field>
      <Field label="Size (g)"><Input value={f.grammage_g} onChange={set('grammage_g')} inputMode="decimal" /></Field>
      <Field label="MRP (₹)"><Input value={f.mrp} onChange={set('mrp')} inputMode="decimal" /></Field>
      <Field label="Shelf life (months)"><Input value={f.shelf_life_months} onChange={set('shelf_life_months')} inputMode="numeric" /></Field>
      <Field label="Batch prefix"><Input value={f.batch_prefix} onChange={(e) => setF({ ...f, batch_prefix: e.target.value.toUpperCase() })} autoCapitalize="characters" /></Field>
      <Field label="Next batch no."><Input value={f.next_batch_no} onChange={set('next_batch_no')} inputMode="numeric" /></Field>
      <Field label="Made by">
        <Select value={f.made_by} onChange={set('made_by')}>
          <option value="">—</option>
          {(Object.keys(MADE_BY) as MadeBy[]).map((k) => <option key={k} value={k}>{MADE_BY[k]}</option>)}
        </Select>
      </Field>
      <Field label="Notes"><Input value={f.notes} onChange={set('notes')} /></Field>
      <label className="flex items-center gap-2 self-end pb-3 text-sm font-semibold text-stone-700">
        <input type="checkbox" className="h-5 w-5" checked={f.live} onChange={(e) => setF({ ...f, live: e.target.checked })} />
        Live
      </label>
      <div className="space-y-2 sm:col-span-3">
        <ErrorBox>{error}</ErrorBox>
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
          <Button tone="plain" onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </form>
  )
}

export default function Products() {
  const { me } = useAuth()
  const admin = isAdmin(me?.role)
  const [rows, setRows] = useState<Product[] | null>(null)
  const [tab, setTab] = useState<Tab>('live')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data } = await supabase.from('products').select('*').order('category').order('name')
    setRows((data ?? []) as Product[])
  }, [])
  useEffect(() => { load() }, [load])

  const all = rows ?? []
  // A live product with no shelf life can't get expiry dates, so it counts as "to check".
  const noShelf = (p: Product) => p.live && p.shelf_life_months == null
  const checks = (p: Product) => [...p.needs_check, ...(noShelf(p) ? ['No shelf life: needed for expiry dates'] : [])]
  const counts = { live: all.filter((p) => p.live).length, off: all.filter((p) => !p.live).length, check: all.filter((p) => checks(p).length).length }

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return all
      .filter((p) => (tab === 'live' ? p.live : tab === 'off' ? !p.live : checks(p).length > 0))
      .filter((p) => words.every((w) => `${p.name} ${p.sku} ${p.category ?? ''}`.toLowerCase().includes(w)))
  }, [all, tab, q])

  const groups = useMemo(() => {
    const m = new Map<string, Product[]>()
    for (const p of shown) m.set(p.category ?? 'Other', [...(m.get(p.category ?? 'Other') ?? []), p])
    const rank = (c: string) => (CATEGORIES.indexOf(c) + 1 || 99)
    return [...m.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
  }, [shown])

  const markChecked = async (p: Product) => {
    setError('')
    const { error: err } = await supabase.from('products').update({ needs_check: [] }).eq('id', p.id)
    if (err) setError(err.message)
    await load()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-bold text-ae-blue">Products</h2>
        {admin && !adding && <Button onClick={() => { setAdding(true); setEditing(null) }}>+ Add</Button>}
      </div>

      {adding && (
        <Card>
          <ProductForm initial={{}} onCancel={() => setAdding(false)} onDone={() => { setAdding(false); load() }} />
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        <div className="flex rounded-lg border border-stone-300 bg-white p-1 text-sm font-semibold">
          {([['live', 'Live'], ['off', 'Not live'], ['check', 'To check']] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={`rounded-md px-3 py-1.5 ${tab === k ? 'bg-ae-blue text-ae-cream' : 'text-stone-600'}`}>
              {label} <span className="opacity-70">{counts[k]}</span>
            </button>
          ))}
        </div>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="max-w-xs" />
      </div>

      <ErrorBox>{error}</ErrorBox>
      {!rows && <p className="text-sm text-stone-500">Loading…</p>}
      {rows && !shown.length && <p className="text-sm text-stone-500">Nothing here.</p>}

      {groups.map(([cat, list]) => (
        <div key={cat} className="space-y-2">
          <h3 className="text-sm font-semibold text-stone-500">{cat} · {list.length}</h3>
          <Card className="p-0 sm:p-0">
            <ul className="divide-y divide-stone-100">
              {list.map((p) => (
                <li key={p.id} className="px-4 py-3">
                  {editing === p.id ? (
                    <ProductForm initial={p} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); load() }} />
                  ) : (
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-stone-900">{p.name}</span>
                          {p.made_by && <Badge>{MADE_BY[p.made_by]}</Badge>}
                          {!p.live && <Badge tone="red">Not live</Badge>}
                        </div>
                        <div className="text-sm text-stone-600">
                          <span className="font-mono">{p.sku}</span>
                          {p.grammage_g != null && <> · {p.grammage_g} g</>}
                          {p.mrp != null && <> · ₹{p.mrp}</>}
                          {p.shelf_life_months != null && <> · {p.shelf_life_months} mo</>}
                          {' · '}Next batch: <span className="font-mono">{nextBatchNo(p) ?? '—'}</span>
                        </div>
                        {p.notes && <div className="text-xs text-stone-500">{p.notes}</div>}
                        {checks(p).map((c) => <div key={c} className="mt-1 text-xs font-semibold text-amber-800">⚠ {c}</div>)}
                      </div>
                      {admin && (
                        <div className="flex gap-2">
                          {p.needs_check.length > 0 && <Button tone="plain" className="min-h-10 px-3 text-sm" onClick={() => markChecked(p)}>Checked</Button>}
                          <Button tone="plain" className="min-h-10 px-3 text-sm" onClick={() => { setEditing(p.id); setAdding(false) }}>Edit</Button>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ))}
    </div>
  )
}
