// Finished stock: what's at Gala 17 (factory) and Gala 6 (warehouse), by product, pack size and
// batch, with made date, expiry and age. The factory team sends stock to Gala 6 from here; the
// warehouse team confirms it on the transfer note. Admins can take stock out (samples, damaged…).
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Card, ErrorBox, Field, Input, OkBox } from '../components/ui'
import { useAuth } from '../lib/auth'
import { dayLabel, fmtN, todayIST, why } from '../lib/batches'
import { countsChanged } from '../lib/counts'
import { istDateTime, canPlan } from '../lib/format'
import { CATEGORIES, sizeText } from '../lib/products'
import {
  PLACE_NAMES, TRANSFER_SELECT, daysBetween, expiryInfo, loadStock, rowKey, transferStatus, type Place, type StockRow, type Transfer,
} from '../lib/stock'
import { supabase } from '../lib/supabase'

type Tab = Place | 'transfers'

export default function Stock() {
  const { me } = useAuth()
  const admin = canPlan(me?.role)
  const factory = me?.role === 'floor' || admin
  const [params, setParams] = useSearchParams()
  // Warehouse logins only see transfers.
  const warehouse = me?.role === 'warehouse'
  const tab: Tab = warehouse ? 'transfers' : (['gala17', 'gala6', 'transfers'] as const).find((t) => t === params.get('tab')) ?? 'gala17'
  const [rows, setRows] = useState<StockRow[] | null>(null)
  const [transfers, setTransfers] = useState<Transfer[] | null>(null)
  const [sending, setSending] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    const [s, { data: t }] = await Promise.all([
      warehouse ? Promise.resolve([] as StockRow[]) : loadStock(),
      supabase.from('transfers').select(TRANSFER_SELECT).order('sent_at', { ascending: false }).limit(200),
    ])
    setRows(s)
    setTransfers((t ?? []) as unknown as Transfer[])
  }, [warehouse])
  useEffect(() => { load() }, [load])

  const waiting = (transfers ?? []).filter((t) => t.status === 'sent')
  const toSign = (transfers ?? []).filter((t) => t.has_difference && !t.signed_off_at)
  const at = (p: Place) => (rows ?? []).filter((r) => r.location === p)
  const total = (p: Place) => at(p).reduce((s, r) => s + r.units, 0)

  const tabs: { k: Tab; label: string; n?: number }[] = [
    { k: 'gala17', label: 'Gala 17', n: total('gala17') },
    { k: 'gala6', label: 'Gala 6', n: total('gala6') },
    { k: 'transfers', label: 'Transfers', n: waiting.length + toSign.length },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-bold text-ae-blue">{warehouse ? 'Stock transfers' : 'Stock'}</h2>
        {factory && tab === 'gala17' && !sending && at('gala17').length > 0 && (
          <Button onClick={() => { setSending(true); setMsg('') }}>Send to Gala 6</Button>
        )}
      </div>
      {!warehouse && <div className="flex rounded-lg border border-stone-300 bg-white p-1 text-sm font-semibold">
        {tabs.map((t) => (
          <button key={t.k} type="button" onClick={() => { setParams({ tab: t.k }); setSending(false) }}
            className={`flex-1 rounded-md px-2 py-2 ${tab === t.k ? 'bg-ae-blue text-ae-cream' : 'text-stone-600'}`}>
            {t.label}{t.n ? <span className="ml-1 opacity-80">{t.k === 'transfers' ? `(${t.n})` : fmtN(t.n)}</span> : null}
          </button>
        ))}
      </div>}
      <OkBox>{msg}</OkBox>
      {rows === null && <p className="text-sm text-stone-500">Loading…</p>}

      {rows && tab !== 'transfers' && (sending && tab === 'gala17'
        ? <SendForm rows={at('gala17')} onCancel={() => setSending(false)} onSent={(id) => { setSending(false); countsChanged(); load(); window.location.hash = `#/transfer/${id}` }} />
        : <StockList rows={at(tab)} place={tab} admin={admin} onChanged={(m) => { setMsg(m); load() }} />)}

      {tab === 'transfers' && transfers && <TransferList transfers={transfers} warehouse={warehouse} />}
    </div>
  )
}

/** Stock grouped by product + size, each batch on its own line. */
function StockList({ rows, place, admin, onChanged }: { rows: StockRow[]; place: Place; admin: boolean; onChanged: (m: string) => void }) {
  const [out, setOut] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const groups = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    const m = new Map<string, StockRow[]>()
    for (const r of rows) {
      if (!words.every((w) => `${r.product.name} ${r.batch_no ?? ''} ${r.product.sku}`.toLowerCase().includes(w))) continue
      const k = `${r.product.name}|${r.grammage_g ?? ''}`
      m.set(k, [...(m.get(k) ?? []), r])
    }
    const rank = (c: string | null) => CATEGORIES.indexOf(c ?? 'Other') + 1 || 99
    return [...m.entries()].sort((a, b) => rank(a[1][0].product.category) - rank(b[1][0].product.category) || a[0].localeCompare(b[0]))
  }, [rows, q])

  if (!rows.length) {
    return <Card><p className="text-sm text-stone-600">Nothing at {PLACE_NAMES[place]} yet. Stock starts counting from production completed on 4 Nov 2026.</p></Card>
  }
  return (
    <div className="space-y-3">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search product or batch no." />
      {groups.map(([k, list]) => {
        const r0 = list[0]
        return (
          <Card key={k} className="p-0 sm:p-0">
            <div className="flex items-baseline justify-between gap-2 border-b border-stone-100 px-4 py-3">
              <div className="font-semibold text-stone-900">{r0.product.name}{r0.grammage_g ? <span className="whitespace-nowrap"> {sizeText(Number(r0.grammage_g))}</span> : ''}</div>
              <div className="whitespace-nowrap text-2xl font-bold text-ae-blue">{fmtN(list.reduce((s, r) => s + r.units, 0))}</div>
            </div>
            <ul className="divide-y divide-stone-100">
              {list.map((r) => {
                const ex = expiryInfo(r.expires_on)
                const age = Math.max(0, daysBetween(r.made_on, todayIST()))
                return (
                  <li key={rowKey(r)} className="space-y-2 px-4 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm">
                        <span className="font-mono font-semibold">{r.batch_no ?? 'no batch no.'}</span>
                        <span className="text-stone-500"> · made {dayLabel(r.made_on, { weekday: false })} · {age === 0 ? 'today' : `${age} d old`}</span>
                        <div className={`text-xs font-semibold ${ex.tone}`}>{r.expires_on && `${dayLabel(r.expires_on, { weekday: false, year: true })} · `}{ex.text}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-stone-900">{fmtN(r.units)}</span>
                        {admin && out !== rowKey(r) && <button type="button" className="text-xs font-semibold text-red-700 underline" onClick={() => setOut(rowKey(r))}>Take out</button>}
                      </div>
                    </div>
                    {out === rowKey(r) && <TakeOut r={r} place={place} onCancel={() => setOut(null)} onDone={(m) => { setOut(null); onChanged(m) }} />}
                  </li>
                )
              })}
            </ul>
          </Card>
        )
      })}
    </div>
  )
}

function TakeOut({ r, place, onCancel, onDone }: { r: StockRow; place: Place; onCancel: () => void; onDone: (m: string) => void }) {
  const [units, setUnits] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    const { error: err } = await supabase.rpc('adjust_fg', {
      p_location: place, p_product: r.product_id, p_grammage: r.grammage_g, p_batch: r.batch_id, p_made_on: r.made_on, p_units: Number(units), p_reason: reason,
    })
    setBusy(false)
    if (err) return setError(why(err))
    countsChanged()
    onDone(`Took ${units} × ${r.product.name} out of ${PLACE_NAMES[place]}.`)
  }
  return (
    <form onSubmit={submit} className="grid gap-2 rounded-lg border border-red-200 bg-red-50/40 p-3 sm:grid-cols-3">
      <Field label="Units"><Input value={units} onChange={(e) => setUnits(e.target.value.replace(/\D/g, ''))} inputMode="numeric" required autoFocus /></Field>
      <div className="sm:col-span-2"><Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} required placeholder="e.g. samples, damaged, expired" /></Field></div>
      <ErrorBox>{error}</ErrorBox>
      <div className="flex gap-2 sm:col-span-3">
        <Button type="submit" tone="danger" disabled={busy || !(Number(units) > 0) || !reason.trim()}>{busy ? 'Saving…' : 'Take out'}</Button>
        <Button tone="plain" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}

/** Pick batches and units at Gala 17 to send to Gala 6. */
function SendForm({ rows, onCancel, onSent }: { rows: StockRow[]; onCancel: () => void; onSent: (id: string) => void }) {
  const [qty, setQty] = useState<Record<string, string>>({})
  const [boxes, setBoxes] = useState('')
  const [note, setNote] = useState('')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const shown = rows.filter((r) => words.every((w) => `${r.product.name} ${r.batch_no ?? ''}`.toLowerCase().includes(w)))
  const picked = rows.filter((r) => Number(qty[rowKey(r)]) > 0)
  const units = picked.reduce((s, r) => s + Number(qty[rowKey(r)]), 0)
  const over = picked.find((r) => Number(qty[rowKey(r)]) > r.units)

  const send = async () => {
    setBusy(true)
    setError('')
    const { data, error: err } = await supabase.rpc('send_transfer', {
      p_lines: picked.map((r) => ({ product_id: r.product_id, grammage_g: r.grammage_g, batch_id: r.batch_id, made_on: r.made_on, units: Number(qty[rowKey(r)]) })),
      p_boxes: boxes ? Number(boxes) : null, p_note: note || null,
    })
    setBusy(false)
    if (err) return setError(why(err))
    onSent(data as string)
  }

  return (
    <div className="space-y-3 pb-32">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search product or batch no." />
      <Card className="p-0 sm:p-0">
        <ul className="divide-y divide-stone-100">
          {shown.map((r) => {
            const k = rowKey(r)
            const n = qty[k] ?? ''
            return (
              <li key={k} className={`flex items-center gap-2 px-3 py-2 ${Number(n) > 0 ? 'bg-ae-yellow/30' : ''}`}>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-stone-900">{r.product.name}{r.grammage_g ? ` ${sizeText(Number(r.grammage_g))}` : ''}</div>
                  <div className="text-xs text-stone-500"><span className="font-mono">{r.batch_no ?? '—'}</span> · {fmtN(r.units)} at Gala 17 · made {dayLabel(r.made_on, { weekday: false })}</div>
                </div>
                <button type="button" className="h-11 shrink-0 rounded-lg border border-stone-300 bg-white px-3 text-sm font-semibold" onClick={() => setQty({ ...qty, [k]: String(r.units) })}>All</button>
                <input inputMode="numeric" aria-label={`Units of ${r.product.name} ${r.batch_no ?? ''}`} placeholder="0" value={n} onFocus={(e) => e.target.select()}
                  onChange={(e) => setQty({ ...qty, [k]: e.target.value.replace(/\D/g, '') })}
                  className={`h-11 w-20 shrink-0 rounded-lg border text-center text-base ${Number(n) > r.units ? 'border-red-500 text-red-700' : 'border-stone-300'}`} />
              </li>
            )
          })}
        </ul>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Total boxes" hint="Optional"><Input value={boxes} onChange={(e) => setBoxes(e.target.value.replace(/\D/g, ''))} inputMode="numeric" /></Field>
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. van, driver" /></Field>
      </div>
      <ErrorBox>{over ? `Only ${over.units} of ${over.product.name} (${over.batch_no}) at Gala 17.` : error}</ErrorBox>
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-stone-200 bg-white/95 px-4 py-3 shadow-lg">
        <div className="mx-auto flex max-w-5xl gap-2">
          <Button tone="plain" onClick={onCancel}>Close</Button>
          <Button className="flex-1" disabled={busy || !picked.length || !!over} onClick={send}>
            {busy ? 'Sending…' : picked.length ? `Send ${fmtN(units)} units${boxes ? ` · ${boxes} boxes` : ''} to Gala 6` : 'Type units to send'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function TransferList({ transfers, warehouse }: { transfers: Transfer[]; warehouse: boolean }) {
  const nav = useNavigate()
  if (!transfers.length) return <Card><p className="text-sm text-stone-600">No transfers yet.</p></Card>
  const open = transfers.filter((t) => t.status === 'sent' || (t.has_difference && !t.signed_off_at))
  const done = transfers.filter((t) => !open.includes(t))
  const row = (t: Transfer) => {
    const s = transferStatus(t)
    const sent = t.lines.reduce((a, l) => a + l.units_sent, 0)
    const got = t.lines.reduce((a, l) => a + (l.units_received ?? 0), 0)
    return (
      <li key={t.id}>
        <button type="button" onClick={() => nav(`/transfer/${t.id}`)} className="block w-full px-4 py-3 text-left hover:bg-ae-cream/40">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono font-bold text-ae-blue">{t.transfer_no}</span>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.tone}`}>{s.label}</span>
          </div>
          <div className="text-sm text-stone-700">
            <b>{fmtN(sent)} units</b>{t.boxes_sent != null && ` · ${t.boxes_sent} boxes`} · {t.lines.length} {t.lines.length === 1 ? 'line' : 'lines'}
            {t.status === 'received' && got !== sent && <span className="font-semibold text-red-700"> · {fmtN(got)} received</span>}
          </div>
          <div className="text-xs text-stone-500">Sent {istDateTime(t.sent_at)} by {t.sender?.name ?? '—'}{t.receiver && ` · received by ${t.receiver.name}`}</div>
        </button>
      </li>
    )
  }
  return (
    <div className="space-y-3">
      {open.length > 0 && <Card className="p-0 sm:p-0"><ul className="divide-y divide-stone-100">{open.map(row)}</ul></Card>}
      {done.length > 0 && (
        <>
          <h3 className="text-sm font-semibold text-stone-500">Done</h3>
          <Card className="p-0 sm:p-0"><ul className="divide-y divide-stone-100">{done.map(row)}</ul></Card>
        </>
      )}
      {!warehouse && <p className="text-center text-xs text-stone-500"><Link to="/stock?tab=gala6" className="underline">See stock at Gala 6</Link></p>}
    </div>
  )
}
