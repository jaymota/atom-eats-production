// A transfer note (TN-0001): what Gala 17 sent and what Gala 6 received, by batch, with made
// and expiry dates. Print it or share it on WhatsApp. The warehouse team confirms receipt here;
// a difference needs a sign-off by Siddhesh or Jay.
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button, Card, ErrorBox, Field, Input, Logo } from '../components/ui'
import { useAuth } from '../lib/auth'
import { dayLabel, fmtN, why } from '../lib/batches'
import { countsChanged } from '../lib/counts'
import { istDateTime } from '../lib/format'
import { sizeText } from '../lib/products'
import { TRANSFER_SELECT, lineExpiry, transferStatus, type Transfer } from '../lib/stock'
import { supabase } from '../lib/supabase'

const d = (iso: string | null) => (iso ? dayLabel(iso, { weekday: false, year: true }) : '—')
/** "5 Nov 26" */
const short = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: '2-digit' }) : '—')

function whatsappText(t: Transfer): string {
  const lines = t.lines.map((l) => {
    const name = `${l.product.name}${l.grammage_g ? ` ${sizeText(Number(l.grammage_g))}` : ''}`
    const got = t.status === 'received' && l.units_received !== l.units_sent ? ` (received ${l.units_received})` : ''
    return `• ${name} – ${l.units_sent} units – batch ${l.batch_no ?? '—'} – mfg ${d(l.made_on)} – exp ${d(lineExpiry(l))}${got}`
  })
  const sent = t.lines.reduce((a, l) => a + l.units_sent, 0)
  return [
    `*Atom Eats – Transfer note ${t.transfer_no}*`,
    `Gala 17 → Gala 6 · ${istDateTime(t.sent_at)}`,
    ...lines,
    `Total: ${sent} units${t.boxes_sent != null ? ` · ${t.boxes_sent} boxes` : ''}`,
    `Sent by ${t.sender?.name ?? '—'}${t.receiver ? ` · Received by ${t.receiver.name} ${istDateTime(t.received_at)}` : ' · Not received yet'}`,
    t.note ? `Note: ${t.note}` : '',
  ].filter(Boolean).join('\n')
}

export default function TransferPage() {
  const { id } = useParams()
  const { me } = useAuth()
  const [t, setT] = useState<Transfer | null | undefined>(undefined)
  const [signOff, setSignOff] = useState(false)
  const [receiving, setReceiving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data } = await supabase.from('transfers').select(TRANSFER_SELECT).eq('id', id!).maybeSingle()
    setT((data as unknown as Transfer) ?? null)
  }, [id])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    supabase.from('people').select('sign_off').eq('id', me?.id ?? '').maybeSingle().then(({ data }) => setSignOff(!!data?.sign_off))
  }, [me?.id])

  if (t === undefined) return <p className="text-sm text-stone-500">Loading…</p>
  if (t === null) return <p className="text-sm text-stone-500">Transfer not found.</p>

  const s = transferStatus(t)
  const canReceive = t.status === 'sent' && ['super_admin', 'admin', 'warehouse'].includes(me?.role ?? '')
  const sent = t.lines.reduce((a, l) => a + l.units_sent, 0)
  const got = t.lines.reduce((a, l) => a + (l.units_received ?? 0), 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link to="/stock?tab=transfers" className="text-sm font-semibold text-ae-blue underline">‹ Transfers</Link>
        <div className="flex gap-2">
          <Button tone="plain" className="min-h-10 px-3 text-sm" onClick={() => window.print()}>Print</Button>
          <a href={`https://wa.me/?text=${encodeURIComponent(whatsappText(t))}`} target="_blank" rel="noreferrer"
            className="inline-flex min-h-10 items-center rounded-lg bg-green-600 px-3 text-sm font-semibold text-white">Share on WhatsApp</a>
        </div>
      </div>

      <Card className="space-y-4 print:border-0 print:shadow-none">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Logo className="h-10" />
            <h2 className="mt-2 text-xl font-bold text-ae-blue">Transfer note {t.transfer_no}</h2>
            <div className="text-sm font-semibold text-stone-700">Gala 17 (factory) → Gala 6 (warehouse)</div>
          </div>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.tone} print:border print:border-stone-400`}>{s.label}</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-stone-300 text-left text-xs text-stone-500">
              <th className="py-2 pr-2">Product</th><th className="px-2 py-2">Batch · Mfg · Exp</th>
              <th className="px-2 py-2 text-right">Sent</th>{t.status === 'received' && <th className="py-2 pl-2 text-right">Received</th>}
            </tr></thead>
            <tbody className="divide-y divide-stone-100">
              {t.lines.map((l) => (
                <tr key={l.id}>
                  <td className="py-2 pr-2 font-semibold">{l.product.name}{l.grammage_g ? <span className="whitespace-nowrap"> {sizeText(Number(l.grammage_g))}</span> : ''}</td>
                  <td className="px-2 py-2 text-xs">
                    <div className="font-mono font-semibold">{l.batch_no ?? '—'}</div>
                    <div className="whitespace-nowrap text-stone-600">Mfg {short(l.made_on)}</div>
                    <div className="whitespace-nowrap text-stone-600">Exp {short(lineExpiry(l))}</div>
                  </td>
                  <td className="px-2 py-2 text-right font-bold">{fmtN(l.units_sent)}</td>
                  {t.status === 'received' && (
                    <td className={`py-2 pl-2 text-right font-bold ${l.units_received !== l.units_sent ? 'text-red-700' : ''}`}>{fmtN(l.units_received ?? 0)}</td>
                  )}
                </tr>
              ))}
              <tr className="border-t-2 border-stone-300">
                <td colSpan={2} className="py-2 font-semibold">Total{t.boxes_sent != null && ` · ${t.boxes_sent} boxes sent`}{t.boxes_received != null && ` · ${t.boxes_received} boxes received`}</td>
                <td className="px-2 py-2 text-right font-bold">{fmtN(sent)}</td>
                {t.status === 'received' && <td className={`py-2 pl-2 text-right font-bold ${got !== sent ? 'text-red-700' : ''}`}>{fmtN(got)}</td>}
              </tr>
            </tbody>
          </table>
        </div>

        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-stone-500">Sent by</dt><dd className="font-semibold">{t.sender?.name ?? '—'} · {istDateTime(t.sent_at)}</dd></div>
          <div><dt className="text-xs text-stone-500">Received by</dt><dd className="font-semibold">{t.receiver ? `${t.receiver.name} · ${istDateTime(t.received_at)}` : 'Not yet'}</dd></div>
          {t.note && <div><dt className="text-xs text-stone-500">Note</dt><dd>{t.note}</dd></div>}
          {t.receive_note && <div><dt className="text-xs text-stone-500">Receiving note</dt><dd>{t.receive_note}</dd></div>}
          {t.signed_off_at && <div className="sm:col-span-2"><dt className="text-xs text-stone-500">Difference signed off</dt><dd className="font-semibold">{t.signer?.name} · {istDateTime(t.signed_off_at)} · {t.sign_off_note}</dd></div>}
        </dl>
        <div className="hidden grid-cols-2 gap-8 pt-10 text-sm print:grid">
          <div className="border-t border-stone-400 pt-1">Sent by (sign)</div>
          <div className="border-t border-stone-400 pt-1">Received by (sign)</div>
        </div>
      </Card>

      <ErrorBox>{error}</ErrorBox>
      <div className="print:hidden">
        {canReceive && !receiving && <Button className="min-h-14 w-full text-lg" onClick={() => setReceiving(true)}>Receive at Gala 6</Button>}
        {receiving && <Receive t={t} onCancel={() => setReceiving(false)} onDone={async () => { setReceiving(false); countsChanged(); await load() }} onError={setError} />}
        {t.has_difference && !t.signed_off_at && signOff && <SignOff t={t} onDone={async () => { countsChanged(); await load() }} onError={setError} />}
        {t.has_difference && !t.signed_off_at && !signOff && <p className="text-sm font-semibold text-red-700">Waiting for Siddhesh or Jay to sign off the difference.</p>}
      </div>
    </div>
  )
}

function Receive({ t, onCancel, onDone, onError }: { t: Transfer; onCancel: () => void; onDone: () => void; onError: (e: string) => void }) {
  const [got, setGot] = useState<Record<string, string>>(Object.fromEntries(t.lines.map((l) => [l.id, String(l.units_sent)])))
  const [boxes, setBoxes] = useState(t.boxes_sent != null ? String(t.boxes_sent) : '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const diff = t.lines.some((l) => Number(got[l.id]) !== l.units_sent) || (t.boxes_sent != null && boxes !== '' && Number(boxes) !== t.boxes_sent)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (diff && !note.trim()) return onError('There is a difference from what was sent. Please add a note saying why.')
    setBusy(true)
    onError('')
    const { error } = await supabase.rpc('receive_transfer', {
      p_id: t.id, p_lines: t.lines.map((l) => ({ line_id: l.id, units: Number(got[l.id] || 0) })), p_boxes: boxes ? Number(boxes) : null, p_note: note || null,
    })
    setBusy(false)
    if (error) return onError(why(error))
    onDone()
  }
  return (
    <Card>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm font-semibold text-stone-700">Count what arrived. Change a number only if it's different from what was sent.</p>
        <ul className="divide-y divide-stone-100">
          {t.lines.map((l) => (
            <li key={l.id} className="flex items-center gap-2 py-2">
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-semibold">{l.product.name}{l.grammage_g ? ` ${sizeText(Number(l.grammage_g))}` : ''}</div>
                <div className="text-xs text-stone-500"><span className="font-mono">{l.batch_no ?? '—'}</span> · sent {fmtN(l.units_sent)}</div>
              </div>
              <input inputMode="numeric" aria-label={`Units received of ${l.product.name}`} value={got[l.id]} onFocus={(e) => e.target.select()}
                onChange={(e) => setGot({ ...got, [l.id]: e.target.value.replace(/\D/g, '') })}
                className={`h-12 w-24 rounded-lg border text-center text-lg font-bold ${Number(got[l.id]) !== l.units_sent ? 'border-red-500 text-red-700' : 'border-stone-300'}`} />
            </li>
          ))}
        </ul>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Boxes received" hint={t.boxes_sent != null ? `${t.boxes_sent} sent` : 'Optional'}>
            <Input value={boxes} onFocus={(e) => e.target.select()} onChange={(e) => setBoxes(e.target.value.replace(/\D/g, ''))} inputMode="numeric" />
          </Field>
          <Field label={diff ? 'Why is it different?' : 'Note'}><Input value={note} onChange={(e) => setNote(e.target.value)} required={diff} /></Field>
        </div>
        {diff && <p className="text-sm font-semibold text-red-700">Different from what was sent. Siddhesh or Jay will need to sign it off.</p>}
        <div className="flex gap-2">
          <Button type="submit" className="flex-1" disabled={busy}>{busy ? 'Saving…' : 'Received at Gala 6'}</Button>
          <Button tone="plain" onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </Card>
  )
}

function SignOff({ t, onDone, onError }: { t: Transfer; onDone: () => void; onError: (e: string) => void }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Card className="border-red-200 bg-red-50/40">
      <form onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        onError('')
        const { error } = await supabase.rpc('sign_off_transfer', { p_id: t.id, p_note: note })
        setBusy(false)
        if (error) return onError(why(error))
        onDone()
      }} className="space-y-3">
        <Field label="Sign off the difference: what happened?"><Input value={note} onChange={(e) => setNote(e.target.value)} required placeholder="e.g. 5 packets torn in transit" /></Field>
        <Button type="submit" disabled={busy || !note.trim()}>{busy ? 'Saving…' : 'Sign off'}</Button>
      </form>
    </Card>
  )
}
