import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export interface Maker { id: string; name: string; active: boolean }

const CHANGED = 'makers-changed'

/** Contract manufacturers (switched-off ones too, so old batches still show names). */
export function useMakers() {
  const [list, setList] = useState<Maker[]>([])
  useEffect(() => {
    const load = () => supabase.from('manufacturers').select('id, name, active').order('name').then(({ data }) => setList((data ?? []) as Maker[]))
    load()
    window.addEventListener(CHANGED, load)
    return () => window.removeEventListener(CHANGED, load)
  }, [])
  return list
}

/** Asks for a name and adds a manufacturer (admins only). Returns its id, or null if cancelled. */
export async function addMakerPrompt(): Promise<string | null> {
  const name = prompt('New contract manufacturer – name:')?.trim()
  if (!name) return null
  const { data, error } = await supabase.from('manufacturers').insert({ name }).select('id').single()
  if (error) {
    alert(error.code === '23505' ? 'That manufacturer is already on the list.' : error.message)
    return null
  }
  window.dispatchEvent(new Event(CHANGED))
  return data.id as string
}

/** Which manufacturers usually make this kind of product (listed first when planning). */
export function likelyMakers(category: string | null, makers: Maker[]): Maker[] {
  const c = (category ?? '').toLowerCase()
  const want = /chips|truffle|potato/.test(c) ? ['a1 wafers', 'mota'] : /cracker|nacho/.test(c) ? ['blueberry'] : /choco/.test(c) ? ['mom'] : []
  return makers.filter((m) => want.some((w) => m.name.toLowerCase().includes(w)))
}
