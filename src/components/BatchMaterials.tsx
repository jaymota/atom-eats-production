// On a batch page: materials this batch used (packaging for everyone; raw materials only for
// recipe people), roll-pouch loss, and for a contract batch the closing stock at the manufacturer.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card } from './ui'
import { useAuth } from '../lib/auth'
import { countsChanged } from '../lib/counts'
import { canPlan } from '../lib/format'
import { MOVE_NAMES, fmtQty, useMaterials } from '../lib/materials'
import { supabase } from '../lib/supabase'
import { CloseAtMaker } from '../pages/materials/MoveTab'

interface Move { id: number; qty: number; kind: string; item: { id: string; name: string; unit: string; pouches_per_kg: number | null } }

export default function BatchMaterials({ batchId, makerId, units }: { batchId: string; makerId: string | null; units: number }) {
  const { me } = useAuth()
  const [moves, setMoves] = useState<Move[] | null>(null)
  const [closing, setClosing] = useState(false)
  const mats = useMaterials()
  const load = useCallback(async () => {
    const { data } = await supabase.from('mat_moves').select('id, qty, kind, item:mat_items(id, name, unit, pouches_per_kg)').eq('batch_id', batchId).order('id')
    setMoves((data ?? []) as unknown as Move[])
  }, [batchId])
  useEffect(() => { load() }, [load])

  const makerPlace = makerId ? mats.places.find((p) => p.manufacturer_id === makerId) : undefined
  if (moves === null) return null
  if (!moves.length && !makerPlace) return null

  // Add up per item and kind (a batch filled over several days has several lines).
  const rows = new Map<string, Move>()
  for (const m of moves) {
    const k = `${m.kind}|${m.item.id}`
    const r = rows.get(k)
    rows.set(k, r ? { ...r, qty: Number(r.qty) + Number(m.qty) } : { ...m, qty: Number(m.qty) })
  }
  const rolls = [...rows.values()].filter((m) => m.kind === 'used_maker' && m.item.pouches_per_kg && m.qty < 0)

  return (
    <Card className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-ae-blue">Materials used</h3>
        {makerPlace && canPlan(me?.role) && !closing && (
          <Button tone="plain" className="min-h-10 px-3 text-sm" onClick={() => setClosing(true)}>Closing stock at {makerPlace.name}</Button>
        )}
      </div>
      {!moves.length && !closing && <p className="text-sm text-stone-500">Nothing recorded yet. After stock comes back, record what's left at {makerPlace?.name}.</p>}
      {rows.size > 0 && (
        <ul className="divide-y divide-stone-100 text-sm">
          {[...rows.values()].map((m) => (
            <li key={m.kind + m.item.id} className="flex justify-between gap-3 py-1.5">
              <span><Link to={`/material/${m.item.id}`} className="underline">{m.item.name}</Link> <span className="text-xs text-stone-500">{MOVE_NAMES[m.kind]}</span></span>
              <b className={m.qty < 0 ? 'text-stone-900' : 'text-green-800'}>{fmtQty(-m.qty, m.item.unit)}</b>
            </li>
          ))}
        </ul>
      )}
      {!me?.recipe_access && moves.length > 0 && <p className="text-xs text-stone-400">Raw materials used in making are only shown to recipe people.</p>}
      {rolls.map((m) => {
        const pouches = Math.round(-m.qty * Number(m.item.pouches_per_kg))
        const loss = pouches - units
        return (
          <p key={m.item.id} className={`rounded-lg px-3 py-2 text-sm ${loss > 0 ? 'bg-red-50 text-red-800' : 'bg-green-50 text-green-800'}`}>
            {m.item.name}: {fmtQty(-m.qty, 'kg')} ≈ {pouches.toLocaleString('en-IN')} pouches for {units.toLocaleString('en-IN')} units
            {loss > 0 ? ` · roll loss ${loss.toLocaleString('en-IN')} pouches (${((loss / pouches) * 100).toFixed(1)}%)` : ''}
          </p>
        )
      })}
      {closing && makerPlace && mats.items && (
        <CloseAtMaker items={mats.items} places={mats.places} stock={mats.stock} placeId={makerPlace.id} batchId={batchId}
          onDone={() => { setClosing(false); countsChanged(); mats.reload(); load() }} />
      )}
      {closing && <Button tone="plain" className="min-h-10 px-3 text-sm" onClick={() => setClosing(false)}>Cancel</Button>}
    </Card>
  )
}
