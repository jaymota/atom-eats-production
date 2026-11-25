// Physical count at one place (admins). Only the boxes filled in are saved; the difference is
// recorded (minus = loss) and the stock becomes the count. Past counts are listed below.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, ErrorBox, Field, Input, OkBox, Select } from '../../components/ui'
import { dayLabel, todayIST, why } from '../../lib/batches'
import { countsChanged } from '../../lib/counts'
import { KIND_NAMES, fmtQty, mainPlace, matches, num, rupees, stockOf, type Kind, type MatItem, type Place, type StockLine } from '../../lib/materials'
import { supabase } from '../../lib/supabase'

interface PastCount { id: string; counted_on: string; note: string | null; place: { name: string }; person: { name: string } | null; lines: { diff: number; rate: number | null }[] }

export default function CountTab({ items, places, stock, reload, admin }: { items: MatItem[]; places: Place[]; stock: StockLine[]; reload: () => void; admin: boolean }) {
  const [place, setPlace] = useState(mainPlace(places)?.id ?? '')
  const [kind, setKind] = useState<Kind | ''>('')
  const [q, setQ] = useState('')
  const [date, setDate] = useState(todayIST())
  const [note, setNote] = useState('')
  const [counted, setCounted] = useState<Record<string, string>>({})
  const [boxes, setBoxes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [past, setPast] = useState<PastCount[]>([])

  const loadPast = useCallback(async () => {
    const { data } = await supabase.from('mat_counts').select('id, counted_on, note, place:mat_places(name), person:people(name), lines:mat_count_lines(diff, rate)')
      .order('created_at', { ascending: false }).limit(20)
    setPast((data ?? []) as unknown as PastCount[])
  }, [])
  useEffect(() => { loadPast() }, [loadPast])

  const value = (i: MatItem) => {
    const c = num(counted[i.id] ?? '')
    if (c != null) return c
    const b = num(boxes[i.id] ?? '')
    return b != null && i.box_size ? b * Number(i.box_size) : null
  }
  const list = useMemo(() => items.filter((i) => (!kind || i.kind === kind) && matches(q, i.name, i.code, i.grp)), [items, kind, q])
  const filled = items.filter((i) => value(i) != null)

  if (!admin) return <Card><p className="text-sm text-stone-600">Counts are saved by Siddhesh, Raveena, Anjana or Jay.</p></Card>

  const save = async () => {
    if (!window.confirm(`Save the count for ${filled.length} items at ${places.find((p) => p.id === place)?.name}? Stock becomes what you counted.`)) return
    setBusy(true)
    setError('')
    const { error: err } = await supabase.rpc('mat_count', { p_place: place, p_date: date, p_note: note, p_lines: filled.map((i) => ({ item: i.id, counted: value(i) })) })
    setBusy(false)
    if (err) return setError(why(err))
    setMsg(`Count saved for ${filled.length} items.`)
    setCounted({})
    setBoxes({})
    countsChanged()
    reload()
    loadPast()
  }

  return (
    <div className="space-y-4">
      <OkBox>{msg}</OkBox>
      <div className="grid gap-2 sm:grid-cols-4">
        <Field label="Place"><Select value={place} onChange={(e) => { setPlace(e.target.value); setCounted({}); setBoxes({}) }}>{places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        <Field label="Counted on"><Input type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Show"><Select value={kind} onChange={(e) => setKind(e.target.value as Kind | '')}><option value="">RM + PM</option><option value="RM">Raw materials</option><option value="PM">Packaging</option></Select></Field>
        <Field label="Find"><Input value={q} onChange={(e) => setQ(e.target.value)} /></Field>
      </div>
      <Card className="p-0 sm:p-0">
        <ul className="divide-y divide-stone-100">
          {list.map((i) => {
            const sys = stockOf(stock, i.id, place)
            const v = value(i)
            const diff = v == null ? null : v - sys
            return (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{i.name}</div>
                  <div className="text-xs text-stone-500">
                    {KIND_NAMES[i.kind]} · system {fmtQty(sys, i.unit)}
                    {diff != null && Math.abs(diff) > 0.0005 && <b className={diff < 0 ? 'text-red-700' : 'text-green-800'}> · {diff > 0 ? '+' : ''}{fmtQty(diff, i.unit)}{diff < 0 && i.last_rate ? ` (${rupees(diff * Number(i.last_rate))})` : ''}</b>}
                  </div>
                </div>
                {i.box_size && <Input value={boxes[i.id] ?? ''} onChange={(e) => setBoxes({ ...boxes, [i.id]: e.target.value.replace(/[^\d.]/g, '') })} inputMode="decimal" className="w-24 text-right" placeholder="boxes" />}
                <Input value={counted[i.id] ?? ''} onChange={(e) => setCounted({ ...counted, [i.id]: e.target.value.replace(/[^\d.]/g, '') })} inputMode="decimal"
                  className="w-28 text-right font-bold" placeholder={i.unit} />
              </li>
            )
          })}
        </ul>
      </Card>
      <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. 1 Dec monthly count" /></Field>
      <ErrorBox>{error}</ErrorBox>
      <Button onClick={save} disabled={busy || !filled.length}>{busy ? 'Saving…' : `Save count (${filled.length})`}</Button>

      {past.length > 0 && (
        <>
          <h3 className="text-sm font-semibold text-stone-500">Past counts</h3>
          <Card className="p-0 sm:p-0">
            <ul className="divide-y divide-stone-100">
              {past.map((c) => {
                const loss = c.lines.reduce((s, l) => s + Math.min(0, Number(l.diff)) * Number(l.rate ?? 0), 0)
                return (
                  <li key={c.id} className="flex justify-between gap-3 px-4 py-3 text-sm">
                    <span>{dayLabel(c.counted_on, { year: true })} · {c.place.name} · {c.lines.length} items{c.person ? ` · ${c.person.name}` : ''}{c.note ? ` · ${c.note}` : ''}</span>
                    <span className={loss < 0 ? 'font-bold text-red-700' : 'text-stone-500'}>{loss < 0 ? `Loss ${rupees(-loss)}` : '—'}</span>
                  </li>
                )
              })}
            </ul>
          </Card>
        </>
      )}
    </div>
  )
}
