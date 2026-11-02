// Home = Today. Every open batch that is due today or earlier (late), grouped by stage,
// with one big button to move each forward. Admins also see the last 7 days at a glance.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BatchCard } from '../components/BatchCard'
import { Card } from '../components/ui'
import { useAuth } from '../lib/auth'
import {
  FLOOR_STAGES, STAGE_NAMES, addDays, dayLabel, fmtN, isLate, loadBatches, todayIST, type Batch,
} from '../lib/batches'
import { isAdmin } from '../lib/format'
import { useWorkers } from '../lib/workers'

export default function Home() {
  const { me } = useAuth()
  const { names } = useWorkers()
  const [open, setOpen] = useState<Batch[] | null>(null)
  const [week, setWeek] = useState<Batch[]>([])
  const today = todayIST()

  const load = useCallback(async () => {
    const [o, w] = await Promise.all([
      loadBatches((q) => q.in('stage', FLOOR_STAGES).lte('planned_date', today).order('planned_date').order('created_at')),
      loadBatches((q) => q.gte('planned_date', addDays(today, -6)).lte('planned_date', today).neq('stage', 'cancelled')),
    ])
    setOpen(o)
    setWeek(w)
  }, [today])
  useEffect(() => { load() }, [load])

  if (!me) return null
  const list = open ?? []
  const late = list.filter((b) => isLate(b, today))
  const planned7 = week.reduce((s, b) => s + (b.units_planned ?? 0), 0)
  const made7 = week.reduce((s, b) => s + b.outputs.reduce((t, o) => t + o.units, 0), 0)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-bold text-ae-blue">Today · {dayLabel(today)}</h2>
        <Link to="/plan" className="text-sm font-semibold text-ae-blue underline">Week plan</Link>
      </div>

      {isAdmin(me.role) && (
        <div className="grid grid-cols-3 gap-3">
          <Tile label="Today" value={list.filter((b) => b.planned_date === today).length} />
          <Tile label="Late" value={late.length} red={late.length > 0} />
          <Tile label="Last 7 days" value={planned7 ? `${Math.round((made7 / planned7) * 100)}%` : '—'} sub={`${fmtN(made7)} of ${fmtN(planned7)} units`} />
        </div>
      )}

      {open === null && <p className="text-sm text-stone-500">Loading…</p>}
      {open && !list.length && (
        <Card><p className="text-stone-600">Nothing planned for today.</p></Card>
      )}

      {FLOOR_STAGES.map((s) => {
        const here = list.filter((b) => b.stage === s)
        if (!here.length) return null
        return (
          <div key={s} className="space-y-2">
            <h3 className="text-sm font-semibold text-stone-500">{STAGE_NAMES[s]} · {here.length}</h3>
            <Card className="p-0 sm:p-0">
              <ul className="divide-y divide-stone-100">
                {here.map((b) => <li key={b.id}><BatchCard b={b} workerNames={names} showDate={b.planned_date !== today} onMoved={load} /></li>)}
              </ul>
            </Card>
          </div>
        )
      })}
    </div>
  )
}

function Tile({ label, value, sub, red }: { label: string; value: string | number; sub?: string; red?: boolean }) {
  return (
    <Card className="p-3 sm:p-4">
      <div className="text-xs font-semibold text-stone-500">{label}</div>
      <div className={`text-2xl font-bold ${red ? 'text-red-700' : 'text-ae-blue'}`}>{value}</div>
      {sub && <div className="text-xs text-stone-500">{sub}</div>}
    </Card>
  )
}
