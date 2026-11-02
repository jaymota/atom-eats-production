import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export interface Maker { id: string; name: string; active: boolean }

/** Contract manufacturers (switched-off ones too, so old batches still show names). */
export function useMakers() {
  const [list, setList] = useState<Maker[]>([])
  useEffect(() => {
    supabase.from('manufacturers').select('id, name, active').order('name').then(({ data }) => setList((data ?? []) as Maker[]))
  }, [])
  return list
}

/** Which manufacturers usually make this kind of product (listed first when planning). */
export function likelyMakers(category: string | null, makers: Maker[]): Maker[] {
  const c = (category ?? '').toLowerCase()
  const want = /chips|truffle|potato/.test(c) ? ['a1 wafers', 'mota'] : /cracker|nacho/.test(c) ? ['blueberry'] : /choco/.test(c) ? ['mom'] : []
  return makers.filter((m) => want.some((w) => m.name.toLowerCase().includes(w)))
}
