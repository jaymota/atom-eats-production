// Today. Admins can plan today right here. Every open batch due today or earlier is listed:
// "To make" (in-house, with a Complete button) and "Awaiting stock" (contract manufacturers,
// with Stock received). In-house batches past their day get a red Late box; contract ones just wait.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BatchCard } from '../components/BatchCard'
import QuickPlan from '../components/QuickPlan'
import { Button, Card, OkBox } from '../components/ui'
import { useAuth } from '../lib/auth'
import {
  FLOOR_STAGES, addDays, dayLabel, fmtN, isLate, loadBatches, todayIST, type Batch,
} from '../lib/batches'
import { isAdmin } from '../lib/format'
import { countsChanged } from '../lib/counts'
import { supabase } from '../lib/supabase'
import { useWorkers } from '../lib/workers'

export default function Home() {
  const { me } = useAuth()
  const admin = isAdmin(me?.role)
  const { names } = useWorkers()
  const [open, setOpen] = useState<Batch[] | null>(null)
  const [packedToday, setPackedToday] = useState(0)
  const [tomorrow, setTomorrow] = useState<number | null>(null)
  const [planning, setPlanning] = useState(false)
  const [msg, setMsg] = useState('')
  const today = todayIST()

  const load = useCallback(async () => {
    const [o, outs, tm] = await Promise.all([
      loadBatches((q) => q.in('stage', FLOOR_STAGES).lte('planned_date', today).order('planned_date').order('created_at')),
      supabase.from('batch_outputs').select('units').eq('made_on', today),
      supabase.from('batches').select('id', { count: 'exact', head: true }).eq('planned_date', addDays(today, 1)).neq('stage', 'cancelled'),
    ])
    setOpen(o)
    setPackedToday((outs.data ?? []).reduce((s, r) => s + r.units, 0))
    setTomorrow(tm.count ?? 0)
    countsChanged()
  }, [today])
  useEffect(() => { load() }, [load])

  if (!me) return null
  const list = open ?? []
  const late = list.filter((b) => isLate(b, today))
  const onToday = list.filter((b) => b.planned_date === today)

  const tiles = [
    { to: '/plan?view=day&day=' + today, label: 'To do today', n: onToday.length },
    { to: '/reports', label: 'Packed today', n: fmtN(packedToday) },
    { to: '/plan?view=day&day=' + addDays(today, 1), label: 'Tomorrow', n: tomorrow ?? '…' },
  ]

  const toMake = list.filter((b) => !b.manufacturer_id)
  const awaiting = list.filter((b) => !!b.manufacturer_id)

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-ae-blue">Today · {dayLabel(today)}</h2>

      <div className="grid grid-cols-3 gap-3">
        {tiles.map((t) => (
          <Link key={t.label} to={t.to} className="rounded-2xl border-2 border-ae-blue/20 bg-white p-3 text-center shadow-sm active:bg-ae-blue/5 sm:p-4">
            <div className="text-3xl font-bold text-ae-blue sm:text-4xl">{open ? t.n : '…'}</div>
            <div className="mt-1 text-sm font-semibold text-stone-700">{t.label}</div>
          </Link>
        ))}
      </div>

      <OkBox>{msg}</OkBox>
      {admin && (
        <Button tone={planning ? 'plain' : 'primary'} className="w-full" onClick={() => { setPlanning(!planning); setMsg('') }}>
          {planning ? '✕ Close planner' : '+ Plan today'}
        </Button>
      )}
      {planning && <QuickPlan day={today} onCancel={() => setPlanning(false)} onDone={(m) => { setPlanning(false); setMsg(m); load() }} />}

      {late.length > 0 && (
        <Card className="border-red-200 bg-red-50/50">
          <h3 className="mb-1 font-semibold text-red-800">⚠ Late ({late.length})</h3>
          <ul className="space-y-1 text-sm">
            {late.slice(0, 6).map((b) => (
              <li key={b.id}>
                <Link to={`/batch/${b.id}`} className="text-stone-800 underline decoration-stone-300">{b.product.name}</Link>{' '}
                <span className="text-xs text-stone-500">{b.batch_no} · planned {dayLabel(b.planned_date!)}</span>
              </li>
            ))}
            {late.length > 6 && <li className="text-xs text-stone-500">+{late.length - 6} more (below)</li>}
          </ul>
        </Card>
      )}

      {open === null && <p className="text-sm text-stone-500">Loading…</p>}
      {open && !list.length && !planning && <Card><p className="text-stone-600">Nothing to do today.</p></Card>}

      {[{ label: 'To make', here: toMake }, { label: 'Awaiting stock', here: awaiting }].map(({ label, here }) => here.length > 0 && (
        <div key={label} className="space-y-2">
          <h3 className="text-sm font-semibold text-stone-500">{label} · {here.length}</h3>
          <Card className="p-0 sm:p-0">
            <ul className="divide-y divide-stone-100">
              {here.map((b) => <li key={b.id}><BatchCard b={b} workerNames={names} showDate={b.planned_date !== today} floor /></li>)}
            </ul>
          </Card>
        </div>
      ))}
    </div>
  )
}
