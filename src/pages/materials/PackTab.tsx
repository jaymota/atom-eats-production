// Packaging per product and pack size: what one pack uses (pouch, jar, labels…). Used to take
// packaging off at Filling done. Roll-form pouches: 1 per pack, turned into kg with pouches per kg.
import { useCallback, useEffect, useState } from 'react'
import ItemPicker from '../../components/ItemPicker'
import { Button, Card, ErrorBox, Input, OkBox } from '../../components/ui'
import { useAuth } from '../../lib/auth'
import { why } from '../../lib/batches'
import { canPlan } from '../../lib/format'
import { matches, type MatItem } from '../../lib/materials'
import { sizeText } from '../../lib/products'
import { supabase } from '../../lib/supabase'

interface Prod { id: string; name: string; sku: string; category: string | null; grammage_g: number | null; live: boolean }
interface Rule { product_id: string; grammage_g: number; item_id: string; qty: number }

export default function PackTab({ items }: { items: MatItem[] }) {
  const { me } = useAuth()
  const can = canPlan(me?.role)
  const [prods, setProds] = useState<Prod[]>([])
  const [rules, setRules] = useState<Rule[]>([])
  const [q, setQ] = useState('')
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [open, setOpen] = useState<{ p: Prod; g: number } | null>(null)
  const [msg, setMsg] = useState('')
  const pm = items.filter((i) => i.kind === 'PM')
  const byId = Object.fromEntries(items.map((i) => [i.id, i]))

  const load = useCallback(async () => {
    const [p, r] = await Promise.all([
      supabase.from('products').select('id, name, sku, category, grammage_g, live').eq('live', true).order('category').order('name'),
      supabase.from('mat_pack_rules').select('product_id, grammage_g, item_id, qty'),
    ])
    setProds((p.data ?? []) as Prod[])
    setRules(((r.data ?? []) as Rule[]).map((x) => ({ ...x, grammage_g: Number(x.grammage_g), qty: Number(x.qty) })))
  }, [])
  useEffect(() => { load() }, [load])

  const sizesOf = (p: Prod) => [...new Set([Number(p.grammage_g ?? 0), ...rules.filter((r) => r.product_id === p.id).map((r) => r.grammage_g), 500, 1000].filter((g) => g > 0))]
  const has = (p: Prod, g: number) => rules.some((r) => r.product_id === p.id && r.grammage_g === g)
  const shown = prods.filter((p) => matches(q, p.name, p.sku, p.category) && (!onlyMissing || !has(p, Number(p.grammage_g ?? 0))))
  const missing = prods.filter((p) => p.grammage_g && !has(p, Number(p.grammage_g))).length

  return (
    <div className="space-y-4">
      <OkBox>{msg}</OkBox>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search product" />
        <Button tone={onlyMissing ? 'primary' : 'plain'} onClick={() => setOnlyMissing(!onlyMissing)}>Missing ({missing})</Button>
      </div>
      <Card className="p-0 sm:p-0">
        <ul className="divide-y divide-stone-100">
          {shown.map((p) => (
            <li key={p.id} className="space-y-2 px-4 py-3">
              <div className="font-semibold text-stone-900">{p.name} <span className="text-xs font-normal text-stone-500">{p.sku}</span></div>
              <div className="flex flex-wrap gap-2">
                {sizesOf(p).map((g) => {
                  const lines = rules.filter((r) => r.product_id === p.id && r.grammage_g === g)
                  const main = g === Number(p.grammage_g)
                  return (
                    <button key={g} type="button" disabled={!can} onClick={() => setOpen({ p, g })}
                      className={`rounded-lg border px-3 py-2 text-left text-sm ${lines.length ? 'border-green-300 bg-green-50' : main ? 'border-red-300 bg-red-50' : 'border-stone-200 bg-white text-stone-500'}`}>
                      <span className="font-semibold">{sizeText(g)}{g >= 500 && !main ? ' bulk' : ''}</span>
                      <span className="block text-xs">{lines.length ? lines.map((l) => `${l.qty} × ${byId[l.item_id]?.name ?? '?'}`).join(', ') : main ? 'Not set' : '—'}</span>
                    </button>
                  )
                })}
              </div>
              {open?.p.id === p.id && (
                <PackEditor p={p} g={open.g} items={pm} start={rules.filter((r) => r.product_id === p.id && r.grammage_g === open.g)} byId={byId}
                  onCancel={() => setOpen(null)} onDone={async () => { setMsg(`Saved packaging for ${p.name} ${sizeText(open.g)}.`); setOpen(null); await load() }} />
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}

function PackEditor({ p, g, items, start, byId, onDone, onCancel }: {
  p: Prod; g: number; items: MatItem[]; start: Rule[]; byId: Record<string, MatItem>; onDone: () => void; onCancel: () => void
}) {
  const [lines, setLines] = useState(start.map((r) => ({ item: byId[r.item_id], qty: String(r.qty) })).filter((l) => l.item))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async () => {
    setBusy(true)
    setError('')
    const { error: err } = await supabase.rpc('mat_set_pack', { p_product: p.id, p_grams: g, p_lines: lines.map((l) => ({ item: l.item.id, qty: Number(l.qty) })) })
    setBusy(false)
    if (err) return setError(why(err))
    onDone()
  }
  return (
    <div className="space-y-2 rounded-lg border border-ae-blue/20 bg-ae-cream/40 p-3">
      <div className="text-sm font-semibold text-ae-blue">One {sizeText(g)} pack uses:</div>
      <p className="text-xs text-stone-500">How many go into one pack, not the stock. Stock is on the Stock tab.</p>
      {lines.map((l, n) => (
        <div key={l.item.id} className="flex items-center gap-2">
          <Input value={l.qty} onChange={(e) => setLines(lines.map((x, k) => (k === n ? { ...x, qty: e.target.value.replace(/[^\d.]/g, '') } : x)))}
            inputMode="decimal" className="w-20 text-right font-bold" />
          <span className="min-w-0 flex-1 text-sm">
            <b>{l.item.unit === 'kg' ? (Number(l.qty) === 1 ? 'pouch' : 'pouches') : 'pcs'}</b> of {l.item.name} <span className="text-stone-500">per pack</span>
            {l.item.unit === 'kg' && <span className="block text-xs text-stone-500">{l.item.pouches_per_kg
              ? `Roll: ${l.item.pouches_per_kg} pouches per kg → takes off ${(Math.round(((Number(l.qty) || 0) * 10000) / Number(l.item.pouches_per_kg)) / 10).toLocaleString('en-IN')} g of roll per pack`
              : 'Set pouches per kg on this roll first, or nothing is taken off'}</span>}
          </span>
          <button type="button" onClick={() => setLines(lines.filter((_, k) => k !== n))} className="text-sm text-red-700">✕</button>
        </div>
      ))}
      <ItemPicker items={items.filter((i) => !lines.some((l) => l.item.id === i.id))} onPick={(i) => setLines([...lines, { item: i, qty: '1' }])} placeholder="Add pouch, jar, label…" />
      <ErrorBox>{error}</ErrorBox>
      <div className="flex gap-2">
        <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        <Button tone="plain" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}
