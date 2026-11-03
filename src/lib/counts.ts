// Numbers for the menu badges: batches to do today (incl. late) and products to check.
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { FLOOR_STAGES, todayIST } from './batches'
import { supabase } from './supabase'

export interface Counts { today: number; check: number; transfers: number }

async function loadCounts(): Promise<Counts> {
  const [a, b, c] = await Promise.all([
    supabase.from('batches').select('id', { count: 'exact', head: true }).in('stage', FLOOR_STAGES).lte('planned_date', todayIST()),
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('live', true).or('needs_check.neq.{},shelf_life_months.is.null'),
    supabase.from('transfers').select('id', { count: 'exact', head: true }).or('status.eq.sent,and(has_difference.eq.true,signed_off_at.is.null)'),
  ])
  return { today: a.count ?? 0, check: b.count ?? 0, transfers: c.count ?? 0 }
}

/** Tell the menu badges to count again (after a batch moves on). */
export const countsChanged = () => window.dispatchEvent(new Event('counts-changed'))

export function useCounts(): Counts | null {
  const loc = useLocation()
  const [n, setN] = useState<Counts | null>(null)
  useEffect(() => {
    const go = () => { loadCounts().then(setN).catch(() => {}) }
    go()
    window.addEventListener('counts-changed', go)
    return () => window.removeEventListener('counts-changed', go)
  }, [loc.pathname, loc.key])
  return n
}
