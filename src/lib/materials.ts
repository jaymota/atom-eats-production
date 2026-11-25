// Materials: raw materials (RM) and packaging (PM). Kept apart from finished stock. Stock is the
// sum of every move per item and place; all changes go through database functions.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

export type Kind = 'RM' | 'PM'
export type Unit = 'kg' | 'pcs'

export interface MatItem {
  id: string
  kind: Kind
  grp: string | null
  name: string
  code: string | null
  supplier: string | null
  unit: Unit
  box_size: number | null
  pouches_per_kg: number | null
  last_rate: number | null
  low_level: number | null
  count_only: boolean
  active: boolean
  note: string | null
}

export interface Place { id: string; name: string; kind: 'store' | 'maker'; manufacturer_id: string | null; is_main: boolean; sort: number; active: boolean }

export interface StockLine { item_id: string; place_id: string; qty: number }

export const KIND_NAMES: Record<Kind, string> = { RM: 'Raw materials', PM: 'Packaging' }

export const MOVE_NAMES: Record<string, string> = {
  opening: 'Opening stock', in: 'Received', used_make: 'Used in making', used_fill: 'Used in filling',
  used_maker: 'Used at manufacturer', sent: 'Moved', adjust: 'Correction', count: 'Count difference',
}

const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d

/** "12.5 kg", "1,200 pcs". */
export function fmtQty(n: number | null | undefined, unit: Unit | string): string {
  if (n == null) return '—'
  const v = unit === 'kg' ? round(Number(n)) : round(Number(n), 2)
  return `${v.toLocaleString('en-IN', { maximumFractionDigits: 3 })} ${unit}`
}

/** "608 boxes" alongside kg when an item has a box size. */
export const boxesText = (n: number, it: Pick<MatItem, 'box_size'>) =>
  it.box_size ? `${round(n / Number(it.box_size), 1).toLocaleString('en-IN')} boxes` : ''

export const rupees = (n: number | null | undefined) => (n == null ? '—' : `₹${Math.round(n).toLocaleString('en-IN')}`)

export function useMaterials() {
  const [items, setItems] = useState<MatItem[] | null>(null)
  const [places, setPlaces] = useState<Place[]>([])
  const [stock, setStock] = useState<StockLine[]>([])
  const load = useCallback(async () => {
    const [i, p, s] = await Promise.all([
      supabase.from('mat_items').select('*').eq('active', true).order('kind', { ascending: false }).order('grp').order('name'),
      supabase.from('mat_places').select('*').eq('active', true).order('sort').order('name'),
      supabase.from('mat_stock').select('item_id, place_id, qty'),
    ])
    setItems((i.data ?? []) as MatItem[])
    setPlaces((p.data ?? []) as Place[])
    setStock(((s.data ?? []) as StockLine[]).map((x) => ({ ...x, qty: Number(x.qty) })))
  }, [])
  useEffect(() => { load() }, [load])
  return { items, places, stock, reload: load }
}

/** Stock of one item: total and per place. */
export function stockOf(stock: StockLine[], itemId: string, placeId?: string): number {
  return round(stock.filter((s) => s.item_id === itemId && (!placeId || s.place_id === placeId)).reduce((a, s) => a + s.qty, 0), 4)
}

export const mainPlace = (places: Place[]) => places.find((p) => p.is_main) ?? places[0]

/** Words in any order: "pouch mep" finds "Printed Pouches - MEP". */
export const matches = (q: string, ...texts: (string | null | undefined)[]) => {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const hay = texts.filter(Boolean).join(' ').toLowerCase()
  return words.every((w) => hay.includes(w))
}

/** Parse a typed number, allowing "6.5" and blanks. */
export const num = (s: string) => (s.trim() === '' ? null : Number(s))

/** Planned batches whose materials run short at the main store (counting earlier batches first):
 *  batch id → names of the short items. Shown as a red line on batch cards. */
export function useShortBatches(from: string, to: string, refresh?: unknown): Record<string, string[]> {
  const [short, setShort] = useState<Record<string, string[]>>({})
  useEffect(() => {
    let live = true
    Promise.all([
      supabase.rpc('mat_plan_needs', { p_from: from, p_to: to }),
      supabase.from('mat_items').select('id, name'),
    ]).then(([{ data }, { data: it }]) => {
      if (!live) return
      const names = Object.fromEntries(((it ?? []) as { id: string; name: string }[]).map((i) => [i.id, i.name]))
      const out: Record<string, string[]> = {}
      for (const n of (data ?? []) as { batch_id: string; item_id: string; short: boolean }[]) {
        if (n.short) out[n.batch_id] = [...(out[n.batch_id] ?? []), names[n.item_id] ?? '?']
      }
      setShort(out)
    })
    return () => { live = false }
  }, [from, to, refresh])
  return short
}
