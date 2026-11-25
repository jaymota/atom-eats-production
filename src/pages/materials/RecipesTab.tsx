// Recipes (recipe access only: Jay, Siddhesh, Anjana). Ingredients for one batch in grams and
// what that batch makes in kg. Making done takes raw materials off as kg made ÷ batch makes ×
// ingredient. Ingredients not linked to a stock item (e.g. water) are not taken off.
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, ErrorBox, Input, OkBox, Select } from '../../components/ui'
import { why } from '../../lib/batches'
import { matches, type MatItem } from '../../lib/materials'
import { supabase } from '../../lib/supabase'

interface Prod { id: string; name: string; sku: string; category: string | null; live: boolean }
interface Line { item_id: string | null; ingredient: string; grams: number; sort: number }
interface Recipe { product_id: string; output_kg: number | null; note: string | null; lines: Line[] }

export default function RecipesTab({ items }: { items: MatItem[] }) {
  const [prods, setProds] = useState<Prod[]>([])
  const [recipes, setRecipes] = useState<Record<string, Recipe>>({})
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const rm = items.filter((i) => i.kind === 'RM')

  const load = useCallback(async () => {
    const [p, r] = await Promise.all([
      supabase.from('products').select('id, name, sku, category, live').order('live', { ascending: false }).order('category').order('name'),
      supabase.from('mat_recipes').select('product_id, output_kg, note, lines:mat_recipe_lines(item_id, ingredient, grams, sort)'),
    ])
    setProds((p.data ?? []) as Prod[])
    setRecipes(Object.fromEntries(((r.data ?? []) as Recipe[]).map((x) => [x.product_id, { ...x, lines: [...x.lines].sort((a, b) => a.sort - b.sort) }])))
  }, [])
  useEffect(() => { load() }, [load])

  const shown = prods.filter((p) => matches(q, p.name, p.sku, p.category) && (p.live || recipes[p.id]))

  return (
    <div className="space-y-4">
      <OkBox>{msg}</OkBox>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search product" />
      <Card className="p-0 sm:p-0">
        <ul className="divide-y divide-stone-100">
          {shown.map((p) => {
            const r = recipes[p.id]
            const linked = r ? r.lines.filter((l) => l.item_id).length : 0
            return (
              <li key={p.id}>
                <button type="button" onClick={() => setOpen(open === p.id ? null : p.id)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-ae-cream/40">
                  <span>
                    <span className="font-semibold text-stone-900">{p.name}</span>
                    <span className="block text-xs text-stone-500">{p.category}</span>
                  </span>
                  <span className={`text-right text-xs font-semibold ${!r ? 'text-stone-400' : r.output_kg ? 'text-green-800' : 'text-amber-700'}`}>
                    {!r ? 'No recipe' : r.output_kg ? `${r.lines.length} ingredients · makes ${r.output_kg} kg` : 'Set “one batch makes”'}
                    {r && linked < r.lines.length && <span className="block font-normal text-stone-500">{r.lines.length - linked} not in stock list</span>}
                  </span>
                </button>
                {open === p.id && (
                  <RecipeEditor p={p} r={r} items={rm} onCancel={() => setOpen(null)}
                    onDone={async () => { setMsg(`Saved the recipe for ${p.name}.`); setOpen(null); await load() }} />
                )}
              </li>
            )
          })}
        </ul>
      </Card>
    </div>
  )
}

function RecipeEditor({ p, r, items, onDone, onCancel }: { p: Prod; r?: Recipe; items: MatItem[]; onDone: () => void; onCancel: () => void }) {
  const [out, setOut] = useState(r?.output_kg?.toString() ?? '')
  const [note, setNote] = useState(r?.note ?? '')
  const [lines, setLines] = useState(r?.lines.map((l) => ({ item: l.item_id ?? '', ingredient: l.ingredient, grams: String(l.grams) })) ?? [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const total = lines.reduce((s, l) => s + (Number(l.grams) || 0), 0)
  const upd = (n: number, k: 'item' | 'ingredient' | 'grams', v: string) => setLines(lines.map((x, i) => (i === n ? { ...x, [k]: v } : x)))

  const save = async () => {
    setBusy(true)
    setError('')
    const { error: err } = await supabase.rpc('mat_set_recipe', {
      p_product: p.id, p_output_kg: out ? Number(out) : null, p_note: note,
      p_lines: lines.map((l) => ({ item: l.item || null, ingredient: l.ingredient, grams: l.grams })),
    })
    setBusy(false)
    if (err) return setError(why(err))
    onDone()
  }

  return (
    <div className="space-y-3 border-t border-ae-blue/10 bg-ae-cream/40 px-4 py-3">
      {note && <p className="text-xs text-stone-600">{note}</p>}
      <div className="hidden grid-cols-[1fr_1fr_6rem_2rem] gap-2 text-xs font-semibold text-stone-500 sm:grid">
        <span>Ingredient</span><span>Stock item (taken off)</span><span className="text-right">Grams</span><span />
      </div>
      {lines.map((l, n) => (
        <div key={n} className="grid grid-cols-[1fr_6rem_2rem] gap-2 sm:grid-cols-[1fr_1fr_6rem_2rem]">
          <Input value={l.ingredient} onChange={(e) => upd(n, 'ingredient', e.target.value)} />
          <Select value={l.item} onChange={(e) => upd(n, 'item', e.target.value)} className="col-span-3 row-start-2 sm:col-span-1 sm:row-start-auto">
            <option value="">Not in stock list</option>
            {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </Select>
          <Input value={l.grams} onChange={(e) => upd(n, 'grams', e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" className="text-right" />
          <button type="button" onClick={() => setLines(lines.filter((_, i) => i !== n))} className="text-sm text-red-700">✕</button>
        </div>
      ))}
      <Button tone="plain" className="min-h-10 px-3 text-sm" onClick={() => setLines([...lines, { item: '', ingredient: '', grams: '' }])}>+ Ingredient</Button>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="text-sm text-stone-700">Batch total <b>{(total / 1000).toFixed(3)} kg</b></div>
        <label className="flex items-center gap-2 text-sm font-semibold text-stone-700">
          One batch makes
          <Input value={out} onChange={(e) => setOut(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" className="w-24 text-right font-bold" /> kg
        </label>
      </div>
      {out && total > 0 && <p className="text-xs text-stone-500">Loss {Math.max(0, 100 - (Number(out) * 1000 / total) * 100).toFixed(1)}% · for every 1 kg made, {lines.filter((l) => l.item && Number(l.grams)).map((l) => `${(Number(l.grams) / Number(out) / 1000).toFixed(3)} kg ${items.find((i) => i.id === l.item)?.name ?? ''}`).join(', ')}</p>}
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note" />
      <ErrorBox>{error}</ErrorBox>
      <div className="flex gap-2">
        <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save recipe'}</Button>
        <Button tone="plain" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}
