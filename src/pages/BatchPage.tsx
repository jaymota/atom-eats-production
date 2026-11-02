// One batch: the plan, one big "Complete" (or "Stock received" for a contract manufacturer)
// button, what was made or received, and its history. Admins can also change, cancel or reopen it.
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Amount, MadeAt, StageBadge } from '../components/BatchCard'
import { Button, Card, ErrorBox, Field, Input, Select } from '../components/ui'
import { useAuth } from '../lib/auth'
import {
  BATCH_SELECT, OPEN_STAGES, PACK_NAMES, STAGE_NAMES, completeLabel, dayLabel, fmtKg, fmtN, isAwaiting, isLate, kgDone,
  lossPct, todayIST, unitsDone, why, type Batch, type PackType, type Stage,
} from '../lib/batches'
import { countsChanged } from '../lib/counts'
import { istDateTime, isAdmin } from '../lib/format'
import { useMakers, type Maker } from '../lib/makers'
import { supabase } from '../lib/supabase'
import { useWorkers, type Worker } from '../lib/workers'

interface Event { id: number; at: string; from_stage: Stage | null; to_stage: Stage; note: string | null; person: { name: string } | null }

export default function BatchPage() {
  const { id } = useParams()
  const { me } = useAuth()
  const admin = isAdmin(me?.role)
  const { list: workers, names } = useWorkers()
  const makers = useMakers()
  const [b, setB] = useState<Batch | null | undefined>(undefined)
  const [events, setEvents] = useState<Event[]>([])
  const [params] = useSearchParams()
  const [mode, setMode] = useState<'' | 'edit' | 'complete' | 'cancel' | 'reopen'>(params.get('do') === 'complete' ? 'complete' : '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [{ data }, { data: ev }] = await Promise.all([
      supabase.from('batches').select(BATCH_SELECT).eq('id', id!).maybeSingle(),
      supabase.from('batch_events').select('id, at, from_stage, to_stage, note, person:people(name)').eq('batch_id', id!).order('at', { ascending: false }),
    ])
    setB((data as unknown as Batch) ?? null)
    setEvents((ev ?? []) as unknown as Event[])
  }, [id])
  useEffect(() => { load() }, [load])

  const run = async (fn: string, args: Record<string, unknown>) => {
    setBusy(true)
    setError('')
    const { error: err } = await supabase.rpc(fn, args)
    setBusy(false)
    if (err) { setError(why(err)); return false }
    setMode('')
    countsChanged()
    await load()
    return true
  }

  if (b === undefined) return <p className="text-sm text-stone-500">Loading…</p>
  if (b === null) return <p className="text-sm text-stone-500">Batch not found.</p>

  const open = OPEN_STAGES.includes(b.stage)
  const done = unitsDone(b)
  const loss = lossPct(b.outputs)
  const third = !!b.manufacturer_id

  return (
    <div className="space-y-4">
      <Link to={b.planned_date ? `/plan?view=day&day=${b.planned_date}` : '/plan'} className="text-sm font-semibold text-ae-blue underline">‹ Plan</Link>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-bold text-ae-blue">{b.product.name}</h2>
          <MadeAt b={b} />
          {!open && <StageBadge stage={b.stage} />}
          {isLate(b) && <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">Late</span>}
          {isAwaiting(b) && <span className="rounded-full bg-amber-400 px-2 py-0.5 text-xs font-semibold text-stone-900">Awaiting stock</span>}
        </div>
        <Amount b={b} />
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <Item k="Batch no." v={<span className="font-mono">{b.batch_no ?? '—'}</span>} />
          <Item k="Planned for" v={b.planned_date ? dayLabel(b.planned_date, { weekday: true, year: true }) : '—'} />
          <Item k={third ? 'Received' : 'Made'} v={done ? `${fmtN(done)} units · ${fmtKg(kgDone(b))}` : '—'} />
          {third ? <Item k="Made at" v={b.maker?.name ?? '—'} /> : <Item k="Loss" v={loss == null ? '—' : `${loss.toFixed(1)}%`} />}
          {!third && b.workers.length > 0 && <Item k="Made by" v={b.workers.map((w) => names[w] ?? '?').join(', ')} />}
        </dl>
        {b.notes && <p className="text-sm text-stone-600">{b.notes}</p>}
        {b.cancel_reason && <p className="text-sm font-semibold text-red-700">Cancelled: {b.cancel_reason}</p>}
      </Card>

      <ErrorBox>{error}</ErrorBox>

      {open && !mode && (
        <div className="space-y-2">
          <Button className="min-h-14 w-full text-lg" onClick={() => setMode('complete')}>{completeLabel(b)}</Button>
          {admin && (
            <div className="flex flex-wrap gap-2">
              <Button tone="plain" onClick={() => setMode('edit')}>Edit</Button>
              <Button tone="danger" onClick={() => setMode('cancel')}>Cancel batch</Button>
            </div>
          )}
        </div>
      )}
      {!open && admin && !mode && <Button tone="plain" onClick={() => setMode('reopen')}>Reopen</Button>}

      {mode === 'complete' && <Complete b={b} workers={workers} busy={busy} onSave={(a) => run('move_to_inventory', { p_id: b.id, ...a })} onCancel={() => setMode('')} />}
      {mode === 'edit' && <Edit b={b} makers={makers} busy={busy} onSave={(a) => run('edit_batch', { p_id: b.id, ...a })} onCancel={() => setMode('')} />}
      {(mode === 'cancel' || mode === 'reopen') && (
        <Reason label={mode === 'cancel' ? 'Why cancel?' : 'Why reopen?'} busy={busy} danger={mode === 'cancel'}
          onSave={(r) => run(mode === 'cancel' ? 'cancel_batch' : 'reopen_batch', { p_id: b.id, p_reason: r })} onCancel={() => setMode('')} />
      )}

      {b.outputs.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-stone-500">{third ? 'Received' : 'Made'}</h3>
          <Card className="p-0 sm:p-0">
            <ul className="divide-y divide-stone-100">
              {[...b.outputs].sort((x, y) => x.made_on.localeCompare(y.made_on)).map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <div>
                    <span className="font-semibold">{dayLabel(o.made_on)}</span> · <b>{fmtN(o.units)} units</b> · {fmtKg(o.output_kg)}
                    {o.input_kg != null && <> · in {fmtKg(o.input_kg)}</>}
                    {o.packed_by && <div className="text-xs text-stone-500">{o.packed_by}</div>}
                    {o.note && <div className="text-xs text-stone-500">{o.note}</div>}
                  </div>
                  {admin && (
                    <button type="button" className="text-xs font-semibold text-red-700 underline" onClick={async () => {
                      const r = prompt('Remove this line? Give a reason:')
                      if (r) run('remove_output', { p_output: o.id, p_reason: r })
                    }}>Remove</button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-stone-500">History</h3>
        <Card className="p-0 sm:p-0">
          <ul className="divide-y divide-stone-100">
            {events.map((e) => (
              <li key={e.id} className="px-4 py-2 text-sm">
                <span className="font-semibold">{e.from_stage && e.from_stage !== e.to_stage ? `${STAGE_NAMES[e.from_stage]} → ` : ''}{STAGE_NAMES[e.to_stage]}</span>
                {e.note && <> · {e.note}</>}
                <div className="text-xs text-stone-500">{e.person?.name ?? 'Set-up'} · {istDateTime(e.at)}</div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  )
}

function Item({ k, v }: { k: string; v: ReactNode }) {
  return <div><dt className="text-xs text-stone-500">{k}</dt><dd className="font-semibold text-stone-800">{v}</dd></div>
}

/** Complete (in-house) or Stock received (contract manufacturer). */
function Complete({ b, workers, busy, onSave, onCancel }: { b: Batch; workers: Worker[]; busy: boolean; onSave: (a: Record<string, unknown>) => void; onCancel: () => void }) {
  const third = !!b.manufacturer_id
  const left = b.units_planned != null ? Math.max(0, b.units_planned - unitsDone(b)) : null
  const [date, setDate] = useState(todayIST())
  const [units, setUnits] = useState(left ? String(left) : '')
  const [kg, setKg] = useState('')
  const [input, setInput] = useState('')
  const [team, setTeam] = useState<string[]>(b.workers)
  const [more, setMore] = useState(false)
  const [note, setNote] = useState('')
  const autoKg = Number(units) > 0 && b.grammage_g ? (Number(units) * b.grammage_g) / 1000 : null
  const toggle = (id: string) => setTeam(team.includes(id) ? team.filter((x) => x !== id) : [...team, id])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    // Catch typos like 750740 instead of 740.
    const n = Number(units)
    if (b.units_planned && n > b.units_planned * 2 && !confirm(`${n.toLocaleString('en-IN')} units is ${Math.round(n / b.units_planned)}× the plan (${b.units_planned.toLocaleString('en-IN')}). Is that right?`)) return
    onSave({
      p_date: date, p_units: Math.round(Number(units)), p_output_kg: kg ? Number(kg) : null,
      p_input_kg: input ? Number(input) : null, p_more: more, p_note: note || null, p_workers: third ? null : team,
    })
  }
  return (
    <Card>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={third ? 'Units received' : 'Units made'}>
            <Input value={units} onChange={(e) => setUnits(e.target.value.replace(/\D/g, ''))} onFocus={(e) => e.target.select()} inputMode="numeric" required autoFocus className="text-xl font-bold" />
          </Field>
          <Field label="kg" hint={autoKg != null ? `Leave blank for ${fmtKg(autoKg)}` : undefined}>
            <Input value={kg} inputMode="decimal" onFocus={(e) => e.target.select()} className="text-xl font-bold" placeholder={autoKg != null ? String(Math.round(autoKg * 100) / 100) : ''}
              onChange={(e) => {
                const v = e.target.value.replace(/[^\d.]/g, '')
                setKg(v)
                if (Number(v) > 0 && b.grammage_g && !units) setUnits(String(Math.round((Number(v) * 1000) / b.grammage_g)))
              }} />
          </Field>
          <Field label="Date"><Input type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} required /></Field>
          {!third && <Field label="Input (kg)" hint="Optional, for loss %"><Input value={input} onChange={(e) => setInput(e.target.value)} inputMode="decimal" /></Field>}
        </div>
        {!third && (
          <div>
            <div className="mb-1 text-sm font-semibold text-stone-700">Made by</div>
            <div className="flex flex-wrap gap-2">
              {workers.filter((w) => w.active || team.includes(w.id)).map((w) => (
                <button key={w.id} type="button" onClick={() => toggle(w.id)}
                  className={`min-h-11 rounded-lg border px-4 font-semibold ${team.includes(w.id) ? 'border-ae-blue bg-ae-blue text-ae-cream' : 'border-stone-300 bg-white text-stone-700'}`}>
                  {w.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <label className="flex items-center gap-3 text-base font-semibold text-stone-800">
          <input type="checkbox" className="h-6 w-6" checked={more} onChange={(e) => setMore(e.target.checked)} />
          {third ? 'More stock to come' : 'More to make later'}
        </label>
        <div className="flex gap-2">
          <Button type="submit" className="flex-1" disabled={busy || units === ''}>{busy ? 'Saving…' : more ? 'Save, keep open' : completeLabel(b)}</Button>
          <Button tone="plain" onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </Card>
  )
}

function Edit({ b, makers, busy, onSave, onCancel }: { b: Batch; makers: Maker[]; busy: boolean; onSave: (a: Record<string, unknown>) => void; onCancel: () => void }) {
  const [date, setDate] = useState(b.planned_date ?? todayIST())
  const [units, setUnits] = useState(String(b.units_planned ?? ''))
  const [grams, setGrams] = useState(String(b.grammage_g ?? ''))
  const [pack, setPack] = useState<PackType>(b.pack_type)
  const [maker, setMaker] = useState(b.manufacturer_id ?? '')
  const [batchNo, setBatchNo] = useState(b.batch_no ?? '')
  const [notes, setNotes] = useState(b.notes ?? '')
  return (
    <Card>
      <form onSubmit={(e) => {
        e.preventDefault()
        onSave({ p_date: date, p_units: Math.round(Number(units)), p_grammage: grams ? Number(grams) : null, p_pack: pack, p_notes: notes, p_batch_no: batchNo, p_maker: maker || null })
      }} className="grid gap-3 sm:grid-cols-3">
        <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
        <Field label="Units"><Input value={units} onChange={(e) => setUnits(e.target.value.replace(/\D/g, ''))} inputMode="numeric" required /></Field>
        <Field label="or kg" hint="Works out the units">
          <Input inputMode="decimal" placeholder={units && grams ? String(Math.round((Number(units) * Number(grams)) / 10) / 100) : 'kg'}
            onChange={(e) => { const kg = Number(e.target.value.replace(/[^\d.]/g, '')); if (kg > 0 && Number(grams) > 0) setUnits(String(Math.round((kg * 1000) / Number(grams)))) }} />
        </Field>
        <Field label="Size (g)"><Input value={grams} onChange={(e) => setGrams(e.target.value)} inputMode="decimal" /></Field>
        <Field label="Pack">
          <Select value={pack} onChange={(e) => setPack(e.target.value as PackType)}>
            {(Object.keys(PACK_NAMES) as PackType[]).map((k) => <option key={k} value={k}>{PACK_NAMES[k]}</option>)}
          </Select>
        </Field>
        <Field label="Made at">
          <Select value={maker} onChange={(e) => setMaker(e.target.value)}>
            <option value="">In-house</option>
            {makers.filter((m) => m.active || m.id === maker).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        </Field>
        <Field label="Batch no."><Input value={batchNo} onChange={(e) => setBatchNo(e.target.value.toUpperCase())} /></Field>
        <div className="sm:col-span-2"><Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field></div>
        <div className="flex gap-2 sm:col-span-3">
          <Button type="submit" disabled={busy}>Save</Button>
          <Button tone="plain" onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </Card>
  )
}

function Reason({ label, busy, danger, onSave, onCancel }: { label: string; busy: boolean; danger?: boolean; onSave: (r: string) => void; onCancel: () => void }) {
  const [r, setR] = useState('')
  return (
    <Card>
      <form onSubmit={(e) => { e.preventDefault(); onSave(r) }} className="space-y-3">
        <Field label={label}><Input value={r} onChange={(e) => setR(e.target.value)} required autoFocus /></Field>
        <div className="flex gap-2">
          <Button type="submit" tone={danger ? 'danger' : 'primary'} disabled={busy || !r.trim()}>Save</Button>
          <Button tone="plain" onClick={onCancel}>Back</Button>
        </div>
      </form>
    </Card>
  )
}
