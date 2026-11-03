// Bulk stock: product made or received in bulk and not filled yet, kept by batch number so its
// age is clear. Admins can take kg for filling (it appears under "To fill" on that day) or write
// some off with a reason.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, ErrorBox, Field, Input, OkBox, Select } from '../components/ui'
import { useAuth } from '../lib/auth'
import { addDays, dayLabel, fmtKg, todayIST, why } from '../lib/batches'
import { countsChanged } from '../lib/counts'
import { isAdmin } from '../lib/format'
import { CATEGORIES, sizeText } from '../lib/products'
import { supabase } from '../lib/supabase'

interface Lot {
  id: string
  batch_no: string | null
  made_on: string
  source: 'kept' | 'received' | 'put_aside' | 'opening'
  note: string | null
  kg_left: number
  kg_in: number | null
  product: { name: string; category: string | null; grammage_g: number | null }
  maker: { name: string } | null
}

const SOURCE: Record<Lot['source'], string> = { kept: 'Kept in bulk', received: 'Received in bulk', put_aside: 'Put aside at filling', opening: 'Opening stock' }

const ageDays = (iso: string) => Math.round((Date.parse(`${todayIST()}T00:00:00Z`) - Date.parse(`${iso}T00:00:00Z`)) / 86_400_000)

export default function BulkStock() {
  const { me } = useAuth()
  const admin = isAdmin(me?.role)
  const nav = useNavigate()
  const [lots, setLots] = useState<Lot[] | null>(null)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<{ id: string; mode: 'take' | 'off' } | null>(null)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data } = await supabase.from('bulk_stock')
      .select('id, batch_no, made_on, source, note, kg_left, kg_in, product:products(name, category, grammage_g), maker:manufacturers(name)')
      .gt('kg_left', 0).order('made_on')
    setLots((data ?? []) as unknown as Lot[])
  }, [])
  useEffect(() => { load() }, [load])

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return (lots ?? []).filter((l) => words.every((w) => `${l.product.name} ${l.batch_no ?? ''}`.toLowerCase().includes(w)))
  }, [lots, q])

  const groups = useMemo(() => {
    const m = new Map<string, Lot[]>()
    for (const l of shown) m.set(l.product.name, [...(m.get(l.product.name) ?? []), l])
    const rank = (c: string | null) => CATEGORIES.indexOf(c ?? 'Other') + 1 || 99
    return [...m.entries()].sort((a, b) => rank(a[1][0].product.category) - rank(b[1][0].product.category) || a[0].localeCompare(b[0]))
  }, [shown])

  const total = shown.reduce((s, l) => s + Number(l.kg_left), 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-bold text-ae-blue">Bulk stock</h2>
        {lots && <span className="text-sm font-semibold text-stone-600">{fmtKg(total)} in {shown.length} {shown.length === 1 ? 'lot' : 'lots'}</span>}
      </div>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search product or batch no." />
      <OkBox>{msg}</OkBox>
      <ErrorBox>{error}</ErrorBox>
      {lots === null && <p className="text-sm text-stone-500">Loading…</p>}
      {lots && !shown.length && <Card><p className="text-sm text-stone-600">{lots.length ? 'Nothing matches.' : 'No bulk stock. Use “Keep in bulk” on a made batch, or “Received in bulk” for a contract manufacturer.'}</p></Card>}

      {groups.map(([name, list]) => (
        <div key={name} className="space-y-2">
          <h3 className="text-sm font-semibold text-stone-500">{name} · {fmtKg(list.reduce((s, l) => s + Number(l.kg_left), 0))}</h3>
          <Card className="p-0 sm:p-0">
            <ul className="divide-y divide-stone-100">
              {list.map((l) => {
                const age = ageDays(l.made_on)
                return (
                  <li key={l.id} className="space-y-2 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-2xl font-bold text-ae-blue">{fmtKg(Number(l.kg_left))}</div>
                        <div className="text-sm text-stone-600">
                          <span className="font-mono">{l.batch_no ?? 'no batch no.'}</span> · {SOURCE[l.source]}{l.maker && ` · ${l.maker.name}`}
                        </div>
                        <div className={`text-xs font-semibold ${age > 60 ? 'text-red-700' : age > 30 ? 'text-amber-800' : 'text-stone-500'}`}>
                          {dayLabel(l.made_on, { weekday: false, year: true })} · {age === 0 ? 'today' : `${age} ${age === 1 ? 'day' : 'days'} old`}
                          {l.kg_in != null && Number(l.kg_in) !== Number(l.kg_left) && ` · ${fmtKg(Number(l.kg_in))} at start`}
                        </div>
                        {l.note && l.note !== SOURCE[l.source] && <div className="text-xs text-stone-500">{l.note}</div>}
                      </div>
                      {admin && open?.id !== l.id && (
                        <div className="flex gap-2">
                          <Button className="min-h-11 px-4 text-sm" onClick={() => { setOpen({ id: l.id, mode: 'take' }); setMsg(''); setError('') }}>Take for filling</Button>
                          <Button tone="plain" className="min-h-11 px-3 text-sm" onClick={() => { setOpen({ id: l.id, mode: 'off' }); setMsg(''); setError('') }}>Write off</Button>
                        </div>
                      )}
                    </div>
                    {open?.id === l.id && (
                      <LotAction lot={l} mode={open.mode} onCancel={() => setOpen(null)} onDone={async (m, batchId) => {
                        setOpen(null)
                        countsChanged()
                        await load()
                        if (batchId) nav(`/batch/${batchId}`)
                        else setMsg(m)
                      }} onError={setError} />
                    )}
                  </li>
                )
              })}
            </ul>
          </Card>
        </div>
      ))}
    </div>
  )
}

function LotAction({ lot, mode, onCancel, onDone, onError }: {
  lot: Lot; mode: 'take' | 'off'; onCancel: () => void; onDone: (msg: string, batchId?: string) => void; onError: (e: string) => void
}) {
  const [kg, setKg] = useState(String(lot.kg_left))
  const [day, setDay] = useState(todayIST())
  const [grams, setGrams] = useState(String(lot.product.grammage_g ?? ''))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const g0 = lot.product.grammage_g ?? 0
  const sizes = [...new Set([g0, 500, 1000].filter((x) => x > 0))]
  const units = Number(kg) > 0 && Number(grams) > 0 ? Math.round((Number(kg) * 1000) / Number(grams)) : null

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    onError('')
    if (mode === 'take') {
      const { data, error } = await supabase.rpc('take_for_filling', { p_lot: lot.id, p_kg: Number(kg), p_date: day, p_grams: Number(grams) || null })
      setBusy(false)
      if (error) return onError(why(error))
      onDone('', data as string)
    } else {
      const { error } = await supabase.rpc('write_off_bulk', { p_lot: lot.id, p_kg: Number(kg), p_reason: reason })
      setBusy(false)
      if (error) return onError(why(error))
      onDone(`Wrote off ${kg} kg of ${lot.product.name}.`)
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-lg border border-ae-blue/20 bg-ae-cream/40 p-3 sm:grid-cols-3">
      <Field label={mode === 'take' ? 'kg to fill' : 'kg to write off'}>
        <Input value={kg} onFocus={(e) => e.target.select()} onChange={(e) => setKg(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" required autoFocus className="text-lg font-bold" />
      </Field>
      {mode === 'take' ? (
        <>
          <Field label="Fill on">
            <Select value={day} onChange={(e) => setDay(e.target.value)}>
              <option value={todayIST()}>Today</option>
              <option value={addDays(todayIST(), 1)}>Tomorrow</option>
            </Select>
          </Field>
          <Field label="Into" hint={units ? `≈ ${units} units` : undefined}>
            <Select value={grams} onChange={(e) => setGrams(e.target.value)}>
              {sizes.map((s) => <option key={s} value={s}>{sizeText(s)}{s !== g0 ? ' bulk' : ''}</option>)}
            </Select>
          </Field>
        </>
      ) : (
        <div className="sm:col-span-2"><Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} required placeholder="e.g. spoiled, sample, repacked" /></Field></div>
      )}
      <div className="flex gap-2 sm:col-span-3">
        <Button type="submit" tone={mode === 'off' ? 'danger' : 'primary'} disabled={busy || !(Number(kg) > 0) || (mode === 'off' && !reason.trim())}>
          {busy ? 'Saving…' : mode === 'take' ? 'Take for filling' : 'Write off'}
        </Button>
        <Button tone="plain" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}
