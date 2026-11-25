// One material: stock per place, details, and every movement (received, used, moved, counted).
// Admins can edit it, correct the stock, merge it into another item or delete it.
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import ItemPicker from '../components/ItemPicker'
import { Button, Card, ErrorBox, Field, Input, Select } from '../components/ui'
import { useAuth } from '../lib/auth'
import { dayLabel, why } from '../lib/batches'
import { countsChanged } from '../lib/counts'
import { isAdmin } from '../lib/format'
import { KIND_NAMES, MOVE_NAMES, boxesText, fmtQty, mainPlace, num, rupees, stockOf, useMaterials } from '../lib/materials'
import { supabase } from '../lib/supabase'
import ItemForm from './materials/ItemForm'

interface Move { id: number; qty: number; kind: string; on_date: string; note: string | null; batch_id: string | null; place_id: string; person: { name: string } | null; batch: { batch_no: string | null; product: { name: string } } | null }

export default function MaterialItem() {
  const { id } = useParams()
  const { me } = useAuth()
  const admin = isAdmin(me?.role)
  const nav = useNavigate()
  const { items, places, stock, reload } = useMaterials()
  const [moves, setMoves] = useState<Move[] | null>(null)
  const [mode, setMode] = useState<'' | 'edit' | 'adjust' | 'merge'>('')
  const [error, setError] = useState('')
  const [adj, setAdj] = useState({ qty: '', place: '', reason: '', sign: '-' })

  const loadMoves = useCallback(async () => {
    const { data } = await supabase.from('mat_moves')
      .select('id, qty, kind, on_date, note, batch_id, place_id, person:people(name), batch:batches(batch_no, product:products(name))')
      .eq('item_id', id!).order('on_date', { ascending: false }).order('id', { ascending: false }).limit(300)
    setMoves((data ?? []) as unknown as Move[])
  }, [id])
  useEffect(() => { loadMoves() }, [loadMoves])

  const it = items?.find((i) => i.id === id)
  if (items === null) return <p className="text-sm text-stone-500">Loading…</p>
  if (!it) return <p className="text-sm text-stone-500">Item not found (it may have been deleted or merged). <Link to="/materials" className="underline">Materials</Link></p>
  const placeName = Object.fromEntries(places.map((p) => [p.id, p.name]))
  const total = stockOf(stock, it.id)
  const parts = stock.filter((s) => s.item_id === it.id && Math.abs(s.qty) > 0.0005)
  const done = () => { setMode(''); countsChanged(); reload(); loadMoves() }

  const adjust = async () => {
    const q = num(adj.qty)
    if (!q) return
    setError('')
    const { error: err } = await supabase.rpc('mat_adjust', { p_item: it.id, p_place: adj.place || mainPlace(places)?.id, p_qty: adj.sign === '-' ? -q : q, p_reason: adj.reason })
    if (err) return setError(why(err))
    setAdj({ qty: '', place: '', reason: '', sign: '-' })
    done()
  }
  const remove = async () => {
    const reason = window.prompt(`Delete ${it.name} from the list? Its history is kept. Reason:`)
    if (reason === null) return
    const { error: err } = await supabase.rpc('mat_delete_item', { p_id: it.id, p_reason: reason })
    if (err) return setError(why(err))
    countsChanged()
    nav('/materials')
  }
  const merge = async (into: { id: string; name: string }) => {
    if (!window.confirm(`Merge ${it.name} into ${into.name}? All its stock and history move to ${into.name}.`)) return
    const { error: err } = await supabase.rpc('mat_merge_items', { p_from: it.id, p_into: into.id })
    if (err) return setError(why(err))
    countsChanged()
    nav(`/material/${into.id}`)
  }

  return (
    <div className="space-y-4">
      <Link to="/materials" className="text-sm font-semibold text-ae-blue underline">‹ Materials</Link>
      <Card className="space-y-3">
        <div>
          <h2 className="text-xl font-bold text-ae-blue">{it.name}</h2>
          <div className="text-sm text-stone-600">{[KIND_NAMES[it.kind], it.grp, it.code, it.supplier, it.count_only ? 'count only' : null].filter(Boolean).join(' · ')}</div>
          {it.note && <div className="text-xs text-stone-500">{it.note}</div>}
        </div>
        <div className={`text-3xl font-bold ${total < 0 ? 'text-red-700' : 'text-ae-blue'}`}>{fmtQty(total, it.unit)} <span className="text-base font-normal text-stone-500">{it.box_size && total > 0 ? boxesText(total, it) : ''}</span></div>
        {parts.length > 0 && (
          <div className="flex flex-wrap gap-2 text-sm">
            {parts.map((s) => <span key={s.place_id} className={`rounded-full px-3 py-1 ${s.qty < 0 ? 'bg-red-100 text-red-800' : 'bg-stone-100'}`}>{placeName[s.place_id]} <b>{fmtQty(s.qty, it.unit)}</b></span>)}
          </div>
        )}
        <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-stone-500">Last rate</dt><dd>{it.last_rate != null ? `${rupees(it.last_rate)}/${it.unit}` : '—'}</dd></div>
          <div><dt className="text-xs text-stone-500">Value</dt><dd>{it.last_rate != null && total > 0 ? rupees(total * Number(it.last_rate)) : '—'}</dd></div>
          <div><dt className="text-xs text-stone-500">Low at</dt><dd>{it.low_level != null ? fmtQty(Number(it.low_level), it.unit) : '—'}</dd></div>
          {it.box_size && <div><dt className="text-xs text-stone-500">Box</dt><dd>{fmtQty(Number(it.box_size), it.unit)}</dd></div>}
          {it.pouches_per_kg && <div><dt className="text-xs text-stone-500">Pouches per kg</dt><dd>{it.pouches_per_kg}</dd></div>}
        </dl>
        {admin && !mode && (
          <div className="flex flex-wrap gap-2">
            <Button tone="plain" onClick={() => setMode('edit')}>Edit</Button>
            <Button tone="plain" onClick={() => setMode('adjust')}>Correct stock</Button>
            <Button tone="plain" onClick={() => setMode('merge')}>Merge into…</Button>
            <Button tone="danger" onClick={remove}>Delete</Button>
          </div>
        )}
        <ErrorBox>{error}</ErrorBox>
        {mode === 'edit' && <ItemForm item={it} onDone={done} onCancel={() => setMode('')} />}
        {mode === 'adjust' && (
          <div className="grid gap-3 rounded-xl border border-ae-blue/20 bg-ae-cream/40 p-4 sm:grid-cols-4">
            <Field label="Add or take off"><Select value={adj.sign} onChange={(e) => setAdj({ ...adj, sign: e.target.value })}><option value="-">Take off</option><option value="+">Add</option></Select></Field>
            <Field label={`Amount (${it.unit})`}><Input value={adj.qty} onChange={(e) => setAdj({ ...adj, qty: e.target.value.replace(/[^\d.]/g, '') })} inputMode="decimal" /></Field>
            <Field label="Place"><Select value={adj.place || mainPlace(places)?.id} onChange={(e) => setAdj({ ...adj, place: e.target.value })}>{places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
            <Field label="Reason"><Input value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} placeholder="damaged, sample, correction…" /></Field>
            <div className="flex gap-2 sm:col-span-4">
              <Button onClick={adjust} disabled={!num(adj.qty) || !adj.reason.trim()}>Save</Button>
              <Button tone="plain" onClick={() => setMode('')}>Cancel</Button>
            </div>
          </div>
        )}
        {mode === 'merge' && (
          <div className="space-y-2 rounded-xl border border-ae-blue/20 bg-ae-cream/40 p-4">
            <p className="text-sm text-stone-700">Merge <b>{it.name}</b> into (same unit, {it.unit}):</p>
            <ItemPicker items={items.filter((i) => i.id !== it.id && i.unit === it.unit)} onPick={merge} autoFocus />
            <Button tone="plain" onClick={() => setMode('')}>Cancel</Button>
          </div>
        )}
      </Card>

      <h3 className="text-sm font-semibold text-stone-500">History</h3>
      {moves === null && <p className="text-sm text-stone-500">Loading…</p>}
      {moves && !moves.length && <Card><p className="text-sm text-stone-600">No movements yet.</p></Card>}
      {moves && moves.length > 0 && (
        <Card className="p-0 sm:p-0">
          <ul className="divide-y divide-stone-100">
            {moves.map((m) => (
              <li key={m.id} className="flex justify-between gap-3 px-4 py-2 text-sm">
                <div className="min-w-0">
                  <div className="font-semibold">{MOVE_NAMES[m.kind] ?? m.kind} <span className="font-normal text-stone-500">· {placeName[m.place_id]}</span></div>
                  <div className="text-xs text-stone-500">
                    {dayLabel(m.on_date)}
                    {m.batch_id && <> · <Link to={`/batch/${m.batch_id}`} className="underline">{m.batch?.product.name} {m.batch?.batch_no ?? ''}</Link></>}
                    {m.note && ` · ${m.note}`}{m.person && ` · ${m.person.name}`}
                  </div>
                </div>
                <span className={`whitespace-nowrap font-bold ${Number(m.qty) < 0 ? 'text-red-700' : 'text-green-800'}`}>{Number(m.qty) > 0 ? '+' : ''}{fmtQty(Number(m.qty), it.unit)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
