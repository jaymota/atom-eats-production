// Planning: Today · Tomorrow · Week. On a day, admins press "+ Plan", search products and type
// the units (several at once). The week view shows Mon–Sun; tap a day to plan it.
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BatchCard } from '../components/BatchCard'
import QuickPlan from '../components/QuickPlan'
import { Button, Card, ErrorBox, OkBox } from '../components/ui'
import { useAuth } from '../lib/auth'
import { addDays, dayLabel, fmtN, loadBatches, mondayOf, todayIST, why, type Batch } from '../lib/batches'
import { isAdmin } from '../lib/format'
import { supabase } from '../lib/supabase'
import { useWorkers } from '../lib/workers'

const batchesText = (n: number) => `${n} ${n === 1 ? 'batch' : 'batches'}`
const plannedUnits = (list: Batch[]) => list.filter((b) => b.stage !== 'cancelled').reduce((s, b) => s + (b.units_planned ?? 0), 0)

export default function Plan() {
  const [params, setParams] = useSearchParams()
  const today = todayIST()
  const tomorrow = addDays(today, 1)
  const view = params.get('view') === 'week' ? 'week' : 'day'
  const day = params.get('day') ?? today
  const week = mondayOf(params.get('week') ?? today)

  const tabs = [
    { label: 'Today', on: view === 'day' && day === today, go: () => setParams({ view: 'day', day: today }) },
    { label: 'Tomorrow', on: view === 'day' && day === tomorrow, go: () => setParams({ view: 'day', day: tomorrow }) },
    { label: 'Week', on: view === 'week', go: () => setParams({ view: 'week', week: mondayOf(view === 'day' ? day : today) }) },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-bold text-ae-blue">Plan</h2>
        <div className="flex rounded-lg border border-stone-300 bg-white p-1 text-sm font-semibold">
          {tabs.map((t) => (
            <button key={t.label} type="button" onClick={t.go} className={`rounded-md px-3 py-1.5 ${t.on ? 'bg-ae-blue text-ae-cream' : 'text-stone-600'}`}>{t.label}</button>
          ))}
        </div>
      </div>
      {view === 'day'
        ? <DayPlan day={day} setDay={(d) => setParams({ view: 'day', day: d })} plan={params.get('plan') === '1'} />
        : <WeekPlan monday={week} setWeek={(w) => setParams({ view: 'week', week: w })} openDay={(d) => setParams({ view: 'day', day: d, plan: '1' })} />}
    </div>
  )
}

/** One day's batches, with "+ Plan" for admins. */
export function DayPlan({ day, setDay, plan = false, floor = false }: { day: string; setDay?: (d: string) => void; plan?: boolean; floor?: boolean }) {
  const { me } = useAuth()
  const admin = isAdmin(me?.role)
  const { names } = useWorkers()
  const [rows, setRows] = useState<Batch[] | null>(null)
  const [planning, setPlanning] = useState(plan)
  const [msg, setMsg] = useState('')
  const today = todayIST()

  const load = useCallback(async () => {
    setRows(await loadBatches((q) => q.eq('planned_date', day).order('created_at')))
  }, [day])
  useEffect(() => { setRows(null); setMsg(''); load() }, [load])
  useEffect(() => { setPlanning(plan) }, [plan, day])

  const list = rows ?? []
  const when = day === today ? 'Today' : day === addDays(today, 1) ? 'Tomorrow' : null

  return (
    <div className="space-y-3">
      {setDay && (
        <div className="flex items-center gap-2">
          <Button tone="plain" className="min-h-10 px-3" onClick={() => setDay(addDays(day, -1))} aria-label="Previous day">‹</Button>
          <div className="flex-1 text-center font-semibold text-stone-800">
            {when ? `${when} · ` : ''}{dayLabel(day, { weekday: true, year: !when })}
            <div className="text-xs font-normal text-stone-500">{batchesText(list.filter((b) => b.stage !== 'cancelled').length)} · {fmtN(plannedUnits(list))} units</div>
          </div>
          <Button tone="plain" className="min-h-10 px-3" onClick={() => setDay(addDays(day, 1))} aria-label="Next day">›</Button>
        </div>
      )}

      <OkBox>{msg}</OkBox>
      {admin && (
        <Button tone={planning ? 'plain' : 'primary'} className="w-full" onClick={() => { setPlanning(!planning); setMsg('') }}>
          {planning ? '✕ Close planner' : `+ Plan ${when ? when.toLowerCase() : dayLabel(day)}`}
        </Button>
      )}
      {planning && <QuickPlan day={day} onCancel={() => setPlanning(false)} onDone={(m) => { setPlanning(false); setMsg(m); load() }} />}

      {rows === null && <p className="text-sm text-stone-500">Loading…</p>}
      {rows && !list.length && !planning && <Card><p className="text-sm text-stone-600">Nothing planned{admin ? ' yet.' : '.'}</p></Card>}
      {list.length > 0 && (
        <Card className="p-0 sm:p-0">
          <ul className="divide-y divide-stone-100">
            {list.map((b) => (
              <li key={b.id} className={b.stage === 'cancelled' ? 'opacity-50' : ''}>
                <BatchCard b={b} workerNames={names} floor={me?.role !== 'warehouse' && (floor || day <= today)} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

function WeekPlan({ monday, setWeek, openDay }: { monday: string; setWeek: (w: string) => void; openDay: (d: string) => void }) {
  const { me } = useAuth()
  const admin = isAdmin(me?.role)
  const { names } = useWorkers()
  const [rows, setRows] = useState<Batch[] | null>(null)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  const today = todayIST()

  const load = useCallback(async () => {
    setRows(await loadBatches((q) => q.gte('planned_date', monday).lte('planned_date', addDays(monday, 6)).order('created_at')))
  }, [monday])
  useEffect(() => { setRows(null); setMsg(''); load() }, [load])

  const copyLast = async () => {
    if (!confirm('Copy last week’s plan into this week? Each batch gets a new batch number.')) return
    setError('')
    const { data, error: err } = await supabase.rpc('copy_week', { p_from: addDays(monday, -7), p_to: monday })
    if (err) return setError(why(err))
    setMsg(data ? `Copied ${data} batches.` : 'Last week had nothing to copy.')
    load()
  }

  const list = rows ?? []
  const live = list.filter((b) => b.stage !== 'cancelled')

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button tone="plain" className="min-h-10 px-3" onClick={() => setWeek(addDays(monday, -7))} aria-label="Previous week">‹</Button>
        <div className="flex-1 text-center font-semibold text-stone-800">
          {dayLabel(monday, {})} – {dayLabel(days[6], { year: true })}
          <div className="text-xs font-normal text-stone-500">{batchesText(live.length)} · {fmtN(plannedUnits(list))} units</div>
        </div>
        <Button tone="plain" className="min-h-10 px-3" onClick={() => setWeek(addDays(monday, 7))} aria-label="Next week">›</Button>
      </div>
      {mondayOf(today) !== monday && (
        <div className="text-center"><button type="button" className="text-sm font-semibold text-ae-blue underline" onClick={() => setWeek(today)}>This week</button></div>
      )}
      {admin && rows && !list.some((b) => !b.imported) && <Button tone="plain" className="w-full" onClick={copyLast}>Copy last week</Button>}
      <OkBox>{msg}</OkBox>
      <ErrorBox>{error}</ErrorBox>

      {rows === null && <p className="text-sm text-stone-500">Loading…</p>}
      {rows && days.map((d) => {
        const here = list.filter((b) => b.planned_date === d)
        return (
          <div key={d} className="space-y-2">
            <div className="flex items-center justify-between">
              <button type="button" onClick={() => openDay(d)} className={`text-left text-sm font-semibold ${d === today ? 'text-ae-blue' : 'text-stone-500'}`}>
                {dayLabel(d)}{d === today && ' · Today'}{here.length > 0 && ` · ${fmtN(plannedUnits(here))} units`}
              </button>
              {admin && <button type="button" className="px-2 py-1 text-sm font-semibold text-ae-blue" onClick={() => openDay(d)}>+ Plan</button>}
            </div>
            {here.length > 0 && (
              <Card className="p-0 sm:p-0">
                <ul className="divide-y divide-stone-100">
                  {here.map((b) => <li key={b.id} className={b.stage === 'cancelled' ? 'opacity-50' : ''}><BatchCard b={b} workerNames={names} /></li>)}
                </ul>
              </Card>
            )}
          </div>
        )
      })}
    </div>
  )
}
