// One batch: the plan, the next step's big button, what was made / received / filled, and its
// history. Steps: Making done (kg) → Filling done (units, one line per size) for in-house;
// Stock received (packed, or in bulk → Filling done) for contract manufacturers.
// A made batch can be kept in bulk instead. Admins can also change, cancel or reopen it.
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Amount, MadeAt, StageBadge } from '../components/BatchCard'
import { Button, Card, ErrorBox, Field, Input, Select } from '../components/ui'
import { useAuth } from '../lib/auth'
import {
  BATCH_SELECT, OPEN_STAGES, PACK_NAMES, STAGE_NAMES, bulkKg, dayLabel, fmtKg, fmtN, isAwaiting, isLate, kgDone,
  leftKg, lossPct, nextStep, todayIST, unitsDone, why, type Batch, type PackType, type Stage,
} from '../lib/batches'
import { countsChanged } from '../lib/counts'
import { istDateTime, canPlan } from '../lib/format'
import { addMakerPrompt, useMakers, type Maker } from '../lib/makers'
import { sizeText } from '../lib/products'
import { supabase } from '../lib/supabase'
import { useWorkers, type Worker } from '../lib/workers'

interface Event { id: number; at: string; from_stage: Stage | null; to_stage: Stage; note: string | null; person: { name: string } | null }
type Mode = '' | 'edit' | 'make' | 'fill' | 'receive' | 'keep' | 'cancel' | 'reopen'

const round3 = (n: number) => Math.round(n * 1000) / 1000

export default function BatchPage() {
  const { id } = useParams()
  const { me } = useAuth()
  const admin = canPlan(me?.role)
  const { list: workers, names } = useWorkers()
  const makers = useMakers()
  const [b, setB] = useState<Batch | null | undefined>(undefined)
  const [events, setEvents] = useState<Event[]>([])
  const [params] = useSearchParams()
  const start = params.get('do')
  const [mode, setMode] = useState<Mode>(start === 'make' || start === 'fill' || start === 'receive' ? start : '')
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
  const step = nextStep(b)
  const done = unitsDone(b)
  const loss = lossPct(b.outputs)
  const third = !!b.manufacturer_id
  const left = leftKg(b)

  return (
    <div className="space-y-4">
      <Link to={b.planned_date ? `/plan?view=day&day=${b.planned_date}` : '/plan'} className="text-sm font-semibold text-ae-blue underline">‹ Plan</Link>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-bold text-ae-blue">{b.product.name}</h2>
          <MadeAt b={b} />
          {(!open || b.stage === 'made') && <StageBadge stage={b.stage} />}
          {b.kept_in_bulk && <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">Kept in bulk stock</span>}
          {isLate(b) && <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">Late</span>}
          {isAwaiting(b) && <span className="rounded-full bg-amber-400 px-2 py-0.5 text-xs font-semibold text-stone-900">Awaiting stock</span>}
        </div>
        <Amount b={b} />
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <Item k="Batch no." v={<span className="font-mono">{b.batch_no ?? '—'}</span>} />
          <Item k="Planned for" v={b.planned_date ? dayLabel(b.planned_date, { weekday: true, year: true }) : '—'} />
          {b.made_kg != null && <Item k={b.from_lot ? 'From bulk' : third ? 'Received in bulk' : 'Made'} v={`${fmtKg(b.made_kg)}${b.made_on ? ` · ${dayLabel(b.made_on)}` : ''}`} />}
          <Item k="Filled" v={done ? `${fmtN(done)} units · ${fmtKg(kgDone(b))}` : '—'} />
          {bulkKg(b) > 0 && <Item k="To bulk stock" v={fmtKg(bulkKg(b))} />}
          {b.made_kg != null && b.stage === 'moved' && !b.kept_in_bulk && left != null && <Item k="Loss" v={fmtKg(Math.max(0, left))} />}
          {b.made_kg == null && loss != null && <Item k="Loss" v={`${loss.toFixed(1)}%`} />}
          {b.made_workers.length > 0 && <Item k="Made by" v={b.made_workers.map((w) => names[w] ?? '?').join(', ')} />}
          {b.workers.length > 0 && <Item k="Filled by" v={b.workers.map((w) => names[w] ?? '?').join(', ')} />}
        </dl>
        {b.notes && <p className="text-sm text-stone-600">{b.notes}</p>}
        {b.cancel_reason && <p className="text-sm font-semibold text-red-700">Cancelled: {b.cancel_reason}</p>}
      </Card>

      <ErrorBox>{error}</ErrorBox>

      {open && !mode && me?.role !== 'warehouse' && (
        <div className="space-y-2">
          {step && <Button className="min-h-14 w-full text-lg" onClick={() => setMode(step.mode)}>{step.label}</Button>}
          <div className="flex flex-wrap gap-2">
            {b.stage === 'planned' && !third && <Button tone="plain" onClick={() => setMode('fill')}>Skip to filling</Button>}
            {b.stage === 'made' && <Button tone="plain" onClick={() => setMode('keep')}>Keep in bulk</Button>}
            {admin && <Button tone="plain" onClick={() => setMode('edit')}>Edit</Button>}
            {admin && <Button tone="danger" onClick={() => setMode('cancel')}>Cancel batch</Button>}
          </div>
        </div>
      )}
      {!open && admin && !mode && <Button tone="plain" onClick={() => setMode('reopen')}>Reopen</Button>}

      {mode === 'make' && <Make b={b} workers={workers} busy={busy} onSave={(a) => run('make_done', { p_id: b.id, ...a })} onCancel={() => setMode('')} />}
      {mode === 'receive' && <Receive b={b} busy={busy}
        onPacked={(a) => run('move_to_inventory', { p_id: b.id, ...a })} onBulk={(a) => run('make_done', { p_id: b.id, ...a })} onCancel={() => setMode('')} />}
      {mode === 'fill' && <Fill b={b} workers={workers} busy={busy} onSave={(a) => run('fill_done', { p_id: b.id, ...a })} onCancel={() => setMode('')} />}
      {mode === 'keep' && <Reason label={`Keep ${fmtKg(left)} in bulk stock? Note (optional)`} optional busy={busy}
        onSave={(r) => run('keep_in_bulk', { p_id: b.id, p_note: r || null })} onCancel={() => setMode('')} />}
      {mode === 'edit' && <Edit b={b} makers={makers} busy={busy} onSave={(a) => run('edit_batch', { p_id: b.id, ...a })} onCancel={() => setMode('')} />}
      {(mode === 'cancel' || mode === 'reopen') && (
        <Reason label={mode === 'cancel' ? 'Why cancel?' : 'Why reopen?'} busy={busy} danger={mode === 'cancel'}
          onSave={(r) => run(mode === 'cancel' ? 'cancel_batch' : 'reopen_batch', { p_id: b.id, p_reason: r })} onCancel={() => setMode('')} />
      )}

      {b.outputs.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-stone-500">Filled</h3>
          <Card className="p-0 sm:p-0">
            <ul className="divide-y divide-stone-100">
              {[...b.outputs].sort((x, y) => x.made_on.localeCompare(y.made_on) || x.created_at.localeCompare(y.created_at)).map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <div>
                    <span className="font-semibold">{dayLabel(o.made_on)}</span> · <b>{fmtN(o.units)} × {sizeText(Number(o.grammage_g ?? b.grammage_g ?? 0))}</b> · {fmtKg(o.output_kg)}
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

const selectAll = (e: { target: HTMLInputElement }) => e.target.select()
const decimal = (v: string) => v.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1')

function TeamPicker({ workers, team, setTeam, label }: { workers: Worker[]; team: string[]; setTeam: (t: string[]) => void; label: string }) {
  const toggle = (id: string) => setTeam(team.includes(id) ? team.filter((x) => x !== id) : [...team, id])
  return (
    <div>
      <div className="mb-1 text-sm font-semibold text-stone-700">{label}</div>
      <div className="flex flex-wrap gap-2">
        {workers.filter((w) => w.active || team.includes(w.id)).map((w) => (
          <button key={w.id} type="button" onClick={() => toggle(w.id)}
            className={`min-h-11 rounded-lg border px-4 font-semibold ${team.includes(w.id) ? 'border-ae-blue bg-ae-blue text-ae-cream' : 'border-stone-300 bg-white text-stone-700'}`}>
            {w.name}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Step 1 (in-house): how many kg were made. */
function Make({ b, workers, busy, onSave, onCancel }: { b: Batch; workers: Worker[]; busy: boolean; onSave: (a: Record<string, unknown>) => void; onCancel: () => void }) {
  const planKg = b.units_planned && b.grammage_g ? round3((b.units_planned * b.grammage_g) / 1000) : null
  const [kg, setKg] = useState(planKg ? String(planKg) : '')
  const [date, setDate] = useState(todayIST())
  const [team, setTeam] = useState<string[]>([])
  const [note, setNote] = useState('')
  const save = (keep: boolean) => (e?: FormEvent) => {
    e?.preventDefault()
    const n = Number(kg)
    if (planKg && n > planKg * 2 && !confirm(`${n} kg is ${Math.round(n / planKg)}× the plan (${planKg} kg). Is that right?`)) return
    onSave({ p_kg: n, p_date: date, p_workers: team, p_note: note || null, p_keep: keep })
  }
  return (
    <Card>
      <form onSubmit={save(false)} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="kg made" hint={planKg ? `Planned ${planKg} kg` : undefined}>
            <Input value={kg} onChange={(e) => setKg(decimal(e.target.value))} onFocus={selectAll} inputMode="decimal" required autoFocus className="text-xl font-bold" />
          </Field>
          <Field label="Date"><Input type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} required /></Field>
        </div>
        <TeamPicker workers={workers} team={team} setTeam={setTeam} label="Made by" />
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" className="flex-1" disabled={busy || !(Number(kg) > 0)}>{busy ? 'Saving…' : 'Making done · fill later'}</Button>
          <Button tone="plain" disabled={busy || !(Number(kg) > 0)} onClick={() => save(true)()}>Keep in bulk</Button>
          <Button tone="plain" onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </Card>
  )
}

/** Contract manufacturer: stock arrived, either packed (done) or in bulk (to fill). */
function Receive({ b, busy, onPacked, onBulk, onCancel }: {
  b: Batch; busy: boolean; onPacked: (a: Record<string, unknown>) => void; onBulk: (a: Record<string, unknown>) => void; onCancel: () => void
}) {
  const [how, setHow] = useState<'packed' | 'bulk'>('packed')
  const [units, setUnits] = useState(b.units_planned ? String(b.units_planned) : '')
  const [kg, setKg] = useState('')
  const [date, setDate] = useState(todayIST())
  const [note, setNote] = useState('')
  const [more, setMore] = useState(false)
  const [shelf, setShelf] = useState('')
  const [err, setErr] = useState('')
  const g = b.grammage_g ?? 0
  const planKg = b.units_planned && g ? round3((b.units_planned * g) / 1000) : null
  const kgFromUnits = Number(units) > 0 && g ? round3((Number(units) * g) / 1000) : null
  const kgNow = how === 'packed' ? (kg ? Number(kg) : kgFromUnits) : Number(kg) || null
  const short = planKg != null && kgNow != null ? round3(planKg - kgNow) : null

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (how === 'packed') {
      const se = await saveShelf(b, shelf)
      if (se) return setErr(se)
      const n = Number(units)
      if (b.units_planned && n > b.units_planned * 2 && !confirm(`${n} units is ${Math.round(n / b.units_planned)}× the plan. Is that right?`)) return
      onPacked({ p_date: date, p_units: Math.round(n), p_output_kg: kg ? Number(kg) : null, p_input_kg: null, p_more: more, p_note: note || null })
    } else {
      onBulk({ p_kg: Number(kg), p_date: date, p_note: note || null, p_keep: false })
    }
  }
  return (
    <Card>
      <form onSubmit={submit} className="space-y-4">
        <div className="flex rounded-lg border border-stone-300 bg-white p-1 text-sm font-semibold">
          {(['packed', 'bulk'] as const).map((k) => (
            <button key={k} type="button" onClick={() => setHow(k)} className={`flex-1 rounded-md px-3 py-2 ${how === k ? 'bg-ae-blue text-ae-cream' : 'text-stone-600'}`}>
              {k === 'packed' ? 'Received packed' : 'Received in bulk'}
            </button>
          ))}
        </div>
        {how === 'packed' && <LabelInfo b={b} date={date} shelf={shelf} setShelf={setShelf} />}
        <ErrorBox>{err}</ErrorBox>
        <div className="grid gap-3 sm:grid-cols-2">
          {how === 'packed' && (
            <Field label="Units received">
              <Input value={units} onFocus={selectAll} onChange={(e) => setUnits(e.target.value.replace(/\D/g, ''))} inputMode="numeric" required autoFocus className="text-xl font-bold" />
            </Field>
          )}
          <Field label={how === 'packed' ? 'kg received' : 'kg received in bulk'} hint={how === 'packed' && kgFromUnits != null ? `Leave blank for ${fmtKg(kgFromUnits)}` : undefined}>
            <Input value={kg} onFocus={selectAll} inputMode="decimal" className="text-xl font-bold" required={how === 'bulk'} autoFocus={how === 'bulk'}
              placeholder={how === 'packed' && kgFromUnits != null ? String(kgFromUnits) : ''}
              onChange={(e) => {
                const v = decimal(e.target.value)
                setKg(v)
                if (how === 'packed' && Number(v) > 0 && g && !units) setUnits(String(Math.round((Number(v) * 1000) / g)))
              }} />
          </Field>
          <Field label="Date"><Input type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} required /></Field>
        </div>
        {planKg != null && kgNow != null && (
          <p className={`text-sm font-semibold ${short! > 0 ? 'text-red-700' : 'text-green-800'}`}>
            Planned {fmtKg(planKg)}{b.units_planned ? ` (${fmtN(b.units_planned)} units)` : ''} · received {fmtKg(kgNow)}
            {short! > 0 ? ` · ${fmtKg(short)} short (${((short! / planKg) * 100).toFixed(1)}%)` : ''}
          </p>
        )}
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {how === 'packed' && (
          <label className="flex items-center gap-3 text-base font-semibold text-stone-800">
            <input type="checkbox" className="h-6 w-6" checked={more} onChange={(e) => setMore(e.target.checked)} /> More stock to come
          </label>
        )}
        <div className="flex gap-2">
          <Button type="submit" className="flex-1" disabled={busy || (how === 'packed' ? units === '' : !(Number(kg) > 0))}>
            {busy ? 'Saving…' : how === 'packed' ? (more ? 'Save, keep open' : 'Stock received') : 'Received in bulk · fill later'}
          </Button>
          <Button tone="plain" onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </Card>
  )
}

/** Made date + shelf life → expiry. */
function expiryOf(made: string, months: number | null | undefined): string | null {
  if (!months) return null
  const d = new Date(`${made}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + months)
  return d.toISOString().slice(0, 10)
}

/** Shows batch no. · mfg · expiry, and asks for the shelf life if the product has none yet. */
function LabelInfo({ b, date, shelf, setShelf }: { b: Batch; date: string; shelf: string; setShelf: (v: string) => void }) {
  const known = b.product.shelf_life_months
  const months = known ?? (Number(shelf) || null)
  const exp = expiryOf(date, months)
  return (
    <div className={`rounded-lg p-3 text-sm ${known ? 'bg-ae-cream/50' : 'border border-amber-300 bg-amber-50'}`}>
      <div className="font-semibold text-stone-800">
        Batch <span className="font-mono">{b.batch_no ?? '—'}</span> · Mfg {dayLabel(date, { weekday: false, year: true })} · Exp {exp ? dayLabel(exp, { weekday: false, year: true }) : '—'}
      </div>
      {!known && (
        <div className="mt-2 flex items-center gap-2">
          <span className="font-semibold text-amber-900">Shelf life not set. Months:</span>
          <input inputMode="numeric" value={shelf} onChange={(e) => setShelf(e.target.value.replace(/\D/g, ''))} placeholder="e.g. 6"
            className="h-10 w-20 rounded-lg border border-amber-400 bg-white text-center font-bold" aria-label="Shelf life in months" />
        </div>
      )}
    </div>
  )
}

/** Saves the shelf life first if it was just filled in. */
async function saveShelf(b: Batch, shelf: string): Promise<string | null> {
  if (b.product.shelf_life_months || !Number(shelf)) return null
  const { error } = await supabase.rpc('set_shelf_life', { p_product: b.product_id, p_months: Number(shelf) })
  return error ? why(error) : null
}

interface Line { grams: string; units: string }

/** Step 2: units filled, one line per pack size, plus optional kg into Bulk stock. Rest = loss. */
function Fill({ b, workers, busy, onSave, onCancel }: { b: Batch; workers: Worker[]; busy: boolean; onSave: (a: Record<string, unknown>) => void; onCancel: () => void }) {
  const g0 = b.grammage_g ?? 0
  const fromKg = b.made_kg != null ? leftKg(b) : null
  const startUnits = fromKg != null && g0 ? Math.floor((fromKg * 1000) / g0) : b.units_planned ? Math.max(0, b.units_planned - unitsDone(b)) : 0
  const [lines, setLines] = useState<Line[]>([{ grams: g0 ? String(g0) : '', units: startUnits ? String(startUnits) : '' }])
  const [toBulk, setToBulk] = useState('')
  const [date, setDate] = useState(todayIST())
  const [team, setTeam] = useState<string[]>(b.workers)
  const [note, setNote] = useState('')
  const [more, setMore] = useState(false)
  const [input, setInput] = useState('')
  const [shelf, setShelf] = useState('')
  const [err, setErr] = useState('')

  const lineKg = (l: Line) => (Number(l.units) > 0 && Number(l.grams) > 0 ? (Number(l.units) * Number(l.grams)) / 1000 : 0)
  const filledKg = round3(lines.reduce((s, l) => s + lineKg(l), 0))
  const bulkKg = Number(toBulk) || 0
  const leftover = fromKg != null ? round3(fromKg - filledKg - bulkKg) : null
  const units = lines.reduce((s, l) => s + (Number(l.units) || 0), 0)
  const set = (i: number, k: keyof Line, v: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)))
  const sizes = [...new Set([g0, 30, 50, 70, 120, 200, 250, 500, 1000].filter((x) => x > 0))].sort((x, y) => x - y)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const se = await saveShelf(b, shelf)
    if (se) return setErr(se)
    if (leftover != null && leftover < -0.05 && !confirm(`That's ${fmtKg(-leftover)} more than the ${fmtKg(fromKg)} made. Is that right?`)) return
    if (b.units_planned && units > b.units_planned * 2 && !confirm(`${units} units is ${Math.round(units / b.units_planned)}× the plan. Is that right?`)) return
    onSave({
      p_date: date, p_lines: lines.filter((l) => Number(l.units) > 0).map((l) => ({ grams: Number(l.grams), units: Math.round(Number(l.units)) })),
      p_to_bulk_kg: bulkKg, p_workers: team, p_note: note || null, p_more: more, p_input_kg: fromKg == null && input ? Number(input) : null,
    })
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-4">
        <LabelInfo b={b} date={date} shelf={shelf} setShelf={setShelf} />
        <ErrorBox>{err}</ErrorBox>
        {fromKg != null && <p className="text-sm font-semibold text-sky-800">{fmtKg(fromKg)} to fill</p>}
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="flex items-end gap-2">
              <div className="w-32 shrink-0">
                <Field label={i === 0 ? 'Pack size' : ''}>
                  <Select value={l.grams} onChange={(e) => set(i, 'grams', e.target.value)}>
                    {!l.grams && <option value="">size?</option>}
                    {sizes.map((s) => <option key={s} value={s}>{sizeText(s)}{s !== g0 && s >= 500 ? ' bulk' : ''}</option>)}
                  </Select>
                </Field>
              </div>
              <div className="min-w-0 flex-1">
                <Field label={i === 0 ? 'Units filled' : ''}>
                  <Input value={l.units} onFocus={selectAll} onChange={(e) => set(i, 'units', e.target.value.replace(/\D/g, ''))} inputMode="numeric" autoFocus={i === 0} className="text-xl font-bold" />
                </Field>
              </div>
              <div className="w-20 shrink-0 pb-3 text-right text-sm text-stone-600">{fmtKg(lineKg(l))}</div>
              {lines.length > 1 && <button type="button" aria-label="Remove line" className="pb-3 text-lg font-bold text-red-700" onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button>}
            </div>
          ))}
          <button type="button" className="text-sm font-semibold text-ae-blue underline" onClick={() => setLines([...lines, { grams: '', units: '' }])}>+ Another size</button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Put into bulk stock (kg)" hint="Optional: kg kept aside unfilled">
            <Input value={toBulk} onFocus={selectAll} onChange={(e) => setToBulk(decimal(e.target.value))} inputMode="decimal" placeholder="0" />
          </Field>
          <Field label="Date"><Input type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} required /></Field>
          {fromKg == null && <Field label="Input (kg)" hint="Optional, for loss %"><Input value={input} onChange={(e) => setInput(decimal(e.target.value))} inputMode="decimal" /></Field>}
        </div>
        <p className="text-sm font-semibold text-stone-700">
          {fmtN(units)} units · {fmtKg(filledKg)} filled{bulkKg > 0 && ` · ${fmtKg(bulkKg)} to bulk`}
          {leftover != null && !more && (leftover >= 0
            ? <span className="text-red-700"> · loss {fmtKg(leftover)}{fromKg ? ` (${((leftover / fromKg) * 100).toFixed(1)}%)` : ''}</span>
            : <span className="text-amber-800"> · {fmtKg(-leftover)} more than made</span>)}
        </p>
        <TeamPicker workers={workers} team={team} setTeam={setTeam} label="Filled by" />
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <label className="flex items-center gap-3 text-base font-semibold text-stone-800">
          <input type="checkbox" className="h-6 w-6" checked={more} onChange={(e) => setMore(e.target.checked)} /> More to fill later
        </label>
        <div className="flex gap-2">
          <Button type="submit" className="flex-1" disabled={busy || (units === 0 && bulkKg === 0)}>{busy ? 'Saving…' : more ? 'Save, keep open' : 'Filling done'}</Button>
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
        <Field label="Units"><Input value={units} onFocus={selectAll} onChange={(e) => setUnits(e.target.value.replace(/\D/g, ''))} inputMode="numeric" required /></Field>
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
          <Select value={maker} onChange={async (e) => {
            const v = e.target.value === '__new' ? await addMakerPrompt() : e.target.value
            setMaker(v ?? maker)
          }}>
            <option value="">In-house</option>
            {makers.filter((m) => m.active || m.id === maker).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            <option value="__new">+ New manufacturer…</option>
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

function Reason({ label, busy, danger, optional, onSave, onCancel }: { label: string; busy: boolean; danger?: boolean; optional?: boolean; onSave: (r: string) => void; onCancel: () => void }) {
  const [r, setR] = useState('')
  return (
    <Card>
      <form onSubmit={(e) => { e.preventDefault(); onSave(r) }} className="space-y-3">
        <Field label={label}><Input value={r} onChange={(e) => setR(e.target.value)} required={!optional} autoFocus /></Field>
        <div className="flex gap-2">
          <Button type="submit" tone={danger ? 'danger' : 'primary'} disabled={busy || (!optional && !r.trim())}>{optional ? 'Keep in bulk' : 'Save'}</Button>
          <Button tone="plain" onClick={onCancel}>Back</Button>
        </div>
      </form>
    </Card>
  )
}
