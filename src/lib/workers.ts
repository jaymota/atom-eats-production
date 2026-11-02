import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export interface Worker { id: string; name: string; active: boolean }

/** All floor workers (switched-off ones too, so old batches still show names). */
export function useWorkers() {
  const [list, setList] = useState<Worker[]>([])
  useEffect(() => {
    supabase.from('workers').select('id, name, active').order('name').then(({ data }) => setList((data ?? []) as Worker[]))
  }, [])
  const names = Object.fromEntries(list.map((w) => [w.id, w.name]))
  return { list, names }
}
