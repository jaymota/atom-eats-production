// Move materials between places (e.g. send seasoning and pouches to a manufacturer, or bring them
// back), and record the closing stock at a manufacturer after a production: used = there − left.
import { useEffect, useState, type FormEvent } from 'react'
import ItemPicker from '../../components/ItemPicker'
import { Button, Card, ErrorBox, Field, Input, OkBox, Select } from '../../components/ui'
import { useAuth } from '../../lib/auth'
import { dayLabel, todayIST, why } from '../../lib/batches'
import { countsChanged } from '../../lib/counts'
import { canPlan } from '../../lib/format'
import { fmtQty, mainPlace, num, stockOf, type MatItem, type Place, type StockLine } from '../../lib/materials'
import { supabase } from '../../lib/supabase'

export default function MoveTab({ items, places, stock, reload }: { items: MatItem[]; places: Place[]; stock: StockLine[]; reload: () => void }) {
  const { me } = useAuth()
  const [mode, setMode] = useState<'send' | 'close'>('send')
  const [msg, setMsg] = useState('')
  if (!canPlan(me?.role)) return <Card><p className="text-sm text-stone-600">Only the production team can move materials.</p></Card>
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button tone={mode === 'send' ? 'primary' : 'plain'} onClick={() => { setMode('send'); setMsg('') }}>Send</Button>
        <Button tone={mode === 'close' ? 'primary' : 'plain'} onClick={() => { setMode('close'); setMsg('') }}>Closing stock at manufacturer</Button>
      </div>
      <OkBox>{msg}</OkBox>
      {mode === 'send' ? (
        <SendForm items={items} places={places} stock={stock} onDone={(m) => { setMsg(m); countsChanged(); reload() }} />
      ) : (
        <CloseAtMaker items={items} places={places} stock={stock} onDone={(m) => { setMsg(m); countsChanged(); reload() }} />
      )}
    </div>
  )
}

function SendForm({ items, places, stock, onDone }: { items: MatItem[]; places: Place[]; stock: StockLine[]; onDone: (m: string) => void }) {
  const [from, setFrom] = useState(mainPlace(places)?.id ?? '')
  const [to, setTo] = useState(places.find((p) => p.kind === 'maker')?.id ?? '')
  const [lines, setLines] = useState<{ item: MatItem; qty: string }[]>([])
  const [date, setDate] = useState(todayIST())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const name = (id: string) => places.find((p) => p.id === id)?.name ?? ''

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error: err } = await supabase.rpc('mat_send', {
      p_from: from, p_to: to, p_lines: lines.map((l) => ({ item: l.item.id, qty: num(l.qty) })), p_date: date, p_note: note,
    })
    setBusy(false)
    if (err) return setError(why(err))
    onDone(`Moved ${lines.length} ${lines.length === 1 ? 'item' : 'items'} from ${name(from)} to ${name(to)}.`)
    setLines([])
    setNote('')
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="From"><Select value={from} onChange={(e) => setFrom(e.target.value)}>{places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <Field label="To"><Select value={to} onChange={(e) => setTo(e.target.value)}>{places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <Field label="Date"><Input type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <ItemPicker items={items.filter((i) => !lines.some((l) => l.item.id === i.id))} onPick={(i) => setLines([...lines, { item: i, qty: '' }])}
          extra={(i) => `${name(from)}: ${fmtQty(stockOf(stock, i.id, from), i.unit)}`} placeholder="Add an item to send" />
        {lines.length > 0 && (
          <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200">
            {lines.map((l, n) => (
              <li key={l.item.id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{l.item.name}</div>
                  <div className="text-xs text-stone-500">{name(from)}: {fmtQty(stockOf(stock, l.item.id, from), l.item.unit)}</div>
                </div>
                <Input value={l.qty} onChange={(e) => setLines(lines.map((x, k) => (k === n ? { ...x, qty: e.target.value.replace(/[^\d.]/g, '') } : x)))}
                  inputMode="decimal" className="w-28 text-right font-bold" placeholder={l.item.unit} />
                <button type="button" onClick={() => setLines(lines.filter((_, k) => k !== n))} className="text-sm text-red-700">✕</button>
              </li>
            ))}
          </ul>
        )}
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. for the chips order" /></Field>
        <ErrorBox>{error}</ErrorBox>
        <Button type="submit" disabled={busy || !lines.some((l) => Number(l.qty) > 0) || from === to}>{busy ? 'Saving…' : `Send to ${name(to)}`}</Button>
      </form>
    </Card>
  )
}

interface MakerBatch { id: string; batch_no: string | null; planned_date: string; product: { name: string } }

/** What's left at a manufacturer after a production. Also opened from a contract batch's page. */
export function CloseAtMaker({ items, places, stock, onDone, placeId, batchId }: {
  items: MatItem[]; places: Place[]; stock: StockLine[]; onDone: (m: string) => void; placeId?: string; batchId?: string
}) {
  const makers = places.filter((p) => p.kind === 'maker')
  const [place, setPlace] = useState(placeId ?? makers[0]?.id ?? '')
  const [batch, setBatch] = useState(batchId ?? '')
  const [batches, setBatches] = useState<MakerBatch[]>([])
  const [left, setLeft] = useState<Record<string, string>>({})
  const [extra, setExtra] = useState<MatItem[]>([])
  const [back, setBack] = useState(false)
  const [date, setDate] = useState(todayIST())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pl = places.find((p) => p.id === place)

  useEffect(() => {
    if (!pl?.manufacturer_id || batchId) return
    supabase.from('batches').select('id, batch_no, planned_date, product:products(name)').eq('manufacturer_id', pl.manufacturer_id)
      .neq('stage', 'cancelled').order('planned_date', { ascending: false }).limit(20)
      .then(({ data }) => setBatches((data ?? []) as unknown as MakerBatch[]))
  }, [pl?.manufacturer_id, batchId])

  const there = items.filter((i) => Math.abs(stockOf(stock, i.id, place)) > 0.0005 || extra.some((x) => x.id === i.id))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const lines = there.filter((i) => left[i.id] !== undefined && left[i.id] !== '').map((i) => ({ item: i.id, left: num(left[i.id]) }))
    const { error: err } = await supabase.rpc('mat_close_maker', { p_place: place, p_batch: batch || null, p_lines: lines, p_bring_back: back, p_date: date, p_note: note })
    setBusy(false)
    if (err) return setError(why(err))
    onDone(`Saved what's left at ${pl?.name}${back ? ' and brought it back to Gala 17' : ''}.`)
    setLeft({})
    setNote('')
  }

  if (!makers.length) return <Card><p className="text-sm text-stone-600">No manufacturers yet.</p></Card>
  return (
    <Card>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          {!placeId && <Field label="Manufacturer"><Select value={place} onChange={(e) => { setPlace(e.target.value); setLeft({}); setBatch('') }}>
            {makers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select></Field>}
          {!batchId && <Field label="For batch">
            <Select value={batch} onChange={(e) => setBatch(e.target.value)}>
              <option value="">—</option>
              {batches.map((b) => <option key={b.id} value={b.id}>{b.batch_no ?? 'no no.'} · {b.product.name} · {dayLabel(b.planned_date)}</option>)}
            </Select>
          </Field>}
          <Field label="Date"><Input type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        {!there.length && <p className="text-sm text-stone-600">Nothing at {pl?.name}. Send materials there first, or add an item below.</p>}
        {there.length > 0 && (
          <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200">
            {there.map((i) => {
              const has = stockOf(stock, i.id, place)
              const l = num(left[i.id] ?? '')
              return (
                <li key={i.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{i.name}</div>
                    <div className="text-xs text-stone-500">
                      There: {fmtQty(has, i.unit)}{l != null && ` · used ${fmtQty(has - l, i.unit)}`}
                      {l != null && i.pouches_per_kg && ` ≈ ${Math.round((has - l) * Number(i.pouches_per_kg))} pouches`}
                    </div>
                  </div>
                  <Input value={left[i.id] ?? ''} onChange={(e) => setLeft({ ...left, [i.id]: e.target.value.replace(/[^\d.]/g, '') })}
                    inputMode="decimal" className="w-28 text-right font-bold" placeholder="left" />
                </li>
              )
            })}
          </ul>
        )}
        <ItemPicker items={items.filter((i) => !there.some((x) => x.id === i.id))} onPick={(i) => setExtra([...extra, i])} placeholder="Add another item" />
        <label className="flex items-center gap-2 text-sm font-semibold text-stone-700">
          <input type="checkbox" checked={back} onChange={(e) => setBack(e.target.checked)} className="h-5 w-5" />
          Bring what's left back to Gala 17
        </label>
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <ErrorBox>{error}</ErrorBox>
        <Button type="submit" disabled={busy || !Object.values(left).some((v) => v !== '')}>{busy ? 'Saving…' : 'Save closing stock'}</Button>
      </form>
    </Card>
  )
}
