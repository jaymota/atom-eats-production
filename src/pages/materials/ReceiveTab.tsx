// Goods received: item, quantity (or boxes), supplier, rate, GST, date, expiry, place.
// Jeet, Dashrath, Anjana and admins. Recent receipts below; admins can remove a wrong one.
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import ItemPicker from '../../components/ItemPicker'
import { Button, Card, ErrorBox, Field, Input, OkBox, Select } from '../../components/ui'
import { useAuth } from '../../lib/auth'
import { dayLabel, todayIST, why } from '../../lib/batches'
import { countsChanged } from '../../lib/counts'
import { canPlan, isAdmin } from '../../lib/format'
import { fmtQty, mainPlace, num, rupees, stockOf, type MatItem, type Place, type StockLine } from '../../lib/materials'
import { supabase } from '../../lib/supabase'

interface Receipt {
  id: string; qty: number; boxes: number | null; supplier: string | null; rate: number | null; gst_pct: number | null
  received_on: string; expiry: string | null; bill_no: string | null; note: string | null
  item: { id: string; name: string; unit: string }; place: { name: string }; person: { name: string } | null
}

export default function ReceiveTab({ items, places, stock, reload }: { items: MatItem[]; places: Place[]; stock: StockLine[]; reload: () => void }) {
  const { me } = useAuth()
  const can = canPlan(me?.role)
  const [it, setIt] = useState<MatItem | null>(null)
  const [f, setF] = useState({ qty: '', boxes: '', supplier: '', rate: '', gst: '', date: todayIST(), expiry: '', bill: '', note: '', place: mainPlace(places)?.id ?? '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [recent, setRecent] = useState<Receipt[]>([])

  const loadRecent = useCallback(async () => {
    const { data } = await supabase.from('mat_receipts')
      .select('id, qty, boxes, supplier, rate, gst_pct, received_on, expiry, bill_no, note, item:mat_items(id, name, unit), place:mat_places(name), person:people(name)')
      .order('created_at', { ascending: false }).limit(40)
    setRecent((data ?? []) as unknown as Receipt[])
  }, [])
  useEffect(() => { loadRecent() }, [loadRecent])

  const pick = (i: MatItem) => { setIt(i); setF({ ...f, supplier: i.supplier ?? '', rate: i.last_rate?.toString() ?? '', qty: '', boxes: '' }); setMsg('') }
  const n = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value.replace(/[^\d.]/g, '') })
  const s = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const qty = num(f.qty) ?? (it?.box_size && num(f.boxes) ? Number(num(f.boxes)) * Number(it.box_size) : null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!it) return
    setBusy(true)
    setError('')
    const { error: err } = await supabase.rpc('mat_receive', {
      p_item: it.id, p_place: f.place || null, p_qty: qty, p_boxes: num(f.boxes), p_supplier: f.supplier, p_rate: num(f.rate), p_gst: num(f.gst),
      p_date: f.date, p_expiry: f.expiry || null, p_bill: f.bill, p_note: f.note,
    })
    setBusy(false)
    if (err) return setError(why(err))
    setMsg(`Received ${fmtQty(qty, it.unit)} of ${it.name}.`)
    setIt(null)
    setF({ ...f, qty: '', boxes: '', note: '', bill: '', expiry: '' })
    countsChanged()
    reload()
    loadRecent()
  }

  const remove = async (r: Receipt) => {
    const reason = window.prompt(`Remove ${fmtQty(r.qty, r.item.unit)} of ${r.item.name}? Reason:`)
    if (!reason) return
    const { error: err } = await supabase.rpc('mat_remove_receipt', { p_id: r.id, p_reason: reason })
    if (err) return setError(why(err))
    countsChanged()
    reload()
    loadRecent()
  }

  return (
    <div className="space-y-4">
      <OkBox>{msg}</OkBox>
      {can && (
        <Card className="space-y-3">
          {!it ? (
            <ItemPicker items={items} onPick={pick} extra={(i) => fmtQty(stockOf(stock, i.id), i.unit)} placeholder="Type what arrived" autoFocus />
          ) : (
            <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3">
              <div className="flex items-center justify-between gap-2 sm:col-span-3">
                <div>
                  <div className="text-lg font-bold text-ae-blue">{it.name}</div>
                  <div className="text-xs text-stone-500">In hand {fmtQty(stockOf(stock, it.id), it.unit)}</div>
                </div>
                <Button tone="plain" className="min-h-10 px-3 text-sm" onClick={() => setIt(null)}>Change</Button>
              </div>
              <Field label={`Quantity (${it.unit})`}>
                <Input value={f.qty} onChange={n('qty')} inputMode="decimal" autoFocus className="text-lg font-bold" placeholder={qty && !f.qty ? String(qty) : ''} />
              </Field>
              {it.box_size && <Field label="or boxes" hint={`${it.box_size} ${it.unit} per box`}><Input value={f.boxes} onChange={n('boxes')} inputMode="decimal" /></Field>}
              <Field label="Supplier"><Input value={f.supplier} onChange={s('supplier')} /></Field>
              <Field label={`Rate ₹ per ${it.unit}`}><Input value={f.rate} onChange={n('rate')} inputMode="decimal" /></Field>
              <Field label="GST %"><Input value={f.gst} onChange={n('gst')} inputMode="decimal" /></Field>
              <Field label="Received on"><Input type="date" value={f.date} max={todayIST()} onChange={s('date')} /></Field>
              <Field label="Expiry"><Input type="date" value={f.expiry} onChange={s('expiry')} /></Field>
              <Field label="Place">
                <Select value={f.place} onChange={s('place')}>{places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
              </Field>
              <Field label="Bill no."><Input value={f.bill} onChange={s('bill')} /></Field>
              <div className="sm:col-span-3"><Field label="Note"><Input value={f.note} onChange={s('note')} /></Field></div>
              <div className="sm:col-span-3"><ErrorBox>{error}</ErrorBox></div>
              <div className="flex gap-2 sm:col-span-3">
                <Button type="submit" disabled={busy || !(qty && qty > 0)}>{busy ? 'Saving…' : `Receive${qty ? ` ${fmtQty(qty, it.unit)}` : ''}`}</Button>
                <Button tone="plain" onClick={() => setIt(null)}>Cancel</Button>
              </div>
            </form>
          )}
        </Card>
      )}

      <h3 className="text-sm font-semibold text-stone-500">Recent</h3>
      {!recent.length && <Card><p className="text-sm text-stone-600">Nothing received yet.</p></Card>}
      {recent.length > 0 && (
        <Card className="p-0 sm:p-0">
          <ul className="divide-y divide-stone-100">
            {recent.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <div>
                  <Link to={`/material/${r.item.id}`} className="font-semibold text-stone-900 underline">{r.item.name}</Link>
                  <div className="text-xs text-stone-500">
                    {[dayLabel(r.received_on), r.place.name, r.supplier, r.rate != null ? `${rupees(r.rate)}/${r.item.unit}` : null, r.gst_pct != null ? `GST ${r.gst_pct}%` : null,
                      r.bill_no ? `Bill ${r.bill_no}` : null, r.expiry ? `Exp ${dayLabel(r.expiry, { year: true })}` : null, r.person?.name].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-green-800">+{fmtQty(r.qty, r.item.unit)}</span>
                  {isAdmin(me?.role) && <button type="button" onClick={() => remove(r)} className="text-xs text-red-700 underline">Remove</button>}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
