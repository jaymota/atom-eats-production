// Materials: raw materials and packaging, separate from finished stock. Tabs: Stock, Receive,
// Move (send to a manufacturer / closing stock there), Packaging per product, Recipes (recipe
// people only), Count, Short and Loss. Negative stock is shown in red at the top.
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button, Card, Input, Select } from '../components/ui'
import { useAuth } from '../lib/auth'
import { isAdmin } from '../lib/format'
import {
  KIND_NAMES, boxesText, fmtQty, matches, stockOf, useMaterials, type Kind, type MatItem, type Place, type StockLine,
} from '../lib/materials'
import CountTab from './materials/CountTab'
import LossTab from './materials/LossTab'
import MoveTab from './materials/MoveTab'
import PackTab from './materials/PackTab'
import ReceiveTab from './materials/ReceiveTab'
import RecipesTab from './materials/RecipesTab'
import ShortTab from './materials/ShortTab'
import ItemForm from './materials/ItemForm'

type Tab = 'stock' | 'receive' | 'move' | 'pack' | 'recipes' | 'count' | 'short' | 'loss'

export default function Materials() {
  const { me } = useAuth()
  const admin = isAdmin(me?.role)
  const data = useMaterials()
  const [params, setParams] = useSearchParams()
  const tabs: { k: Tab; label: string }[] = [
    { k: 'stock', label: 'Stock' },
    { k: 'receive', label: 'Receive' },
    { k: 'move', label: 'Move' },
    { k: 'pack', label: 'Packaging' },
    ...(me?.recipe_access ? [{ k: 'recipes' as Tab, label: 'Recipes' }] : []),
    { k: 'count', label: 'Count' },
    { k: 'short', label: 'Short' },
    { k: 'loss', label: 'Loss' },
  ]
  const tab: Tab = tabs.find((t) => t.k === params.get('tab'))?.k ?? 'stock'
  const go = (k: Tab) => setParams({ tab: k })

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-ae-blue">Materials</h2>
      <div className="flex gap-1 overflow-x-auto rounded-lg border border-stone-300 bg-white p-1 text-sm font-semibold">
        {tabs.map((t) => (
          <button key={t.k} type="button" onClick={() => go(t.k)}
            className={`whitespace-nowrap rounded-md px-3 py-2 ${tab === t.k ? 'bg-ae-blue text-ae-cream' : 'text-stone-600'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {data.items === null ? <p className="text-sm text-stone-500">Loading…</p> : (
        <>
          {tab === 'stock' && <StockTab items={data.items} places={data.places} stock={data.stock} admin={admin} reload={data.reload} />}
          {tab === 'receive' && <ReceiveTab {...data} items={data.items} />}
          {tab === 'move' && <MoveTab {...data} items={data.items} />}
          {tab === 'pack' && <PackTab items={data.items} />}
          {tab === 'recipes' && me?.recipe_access && <RecipesTab items={data.items} />}
          {tab === 'count' && <CountTab {...data} items={data.items} admin={admin} />}
          {tab === 'short' && <ShortTab items={data.items} places={data.places} stock={data.stock} />}
          {tab === 'loss' && <LossTab items={data.items} places={data.places} />}
        </>
      )}
    </div>
  )
}

/** Red box: every item below zero, at any place. Also used on Home. */
export function NegativeBox({ items, places, stock }: { items: MatItem[]; places: Place[]; stock: StockLine[] }) {
  const byId = Object.fromEntries(items.map((i) => [i.id, i]))
  const placeName = Object.fromEntries(places.map((p) => [p.id, p.name]))
  const neg = stock.filter((s) => s.qty < -0.0005 && byId[s.item_id])
  if (!neg.length) return null
  return (
    <div className="rounded-xl border-2 border-red-600 bg-red-50 p-4">
      <div className="font-bold text-red-800">⚠ {neg.length} below zero — fix the records</div>
      <ul className="mt-2 space-y-1 text-sm">
        {neg.map((s) => (
          <li key={s.item_id + s.place_id} className="flex justify-between gap-3">
            <Link to={`/material/${s.item_id}`} className="font-semibold text-red-900 underline">{byId[s.item_id].name}</Link>
            <span className="whitespace-nowrap font-bold text-red-800">{fmtQty(s.qty, byId[s.item_id].unit)} · {placeName[s.place_id]}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function StockTab({ items, places, stock, admin, reload }: { items: MatItem[]; places: Place[]; stock: StockLine[]; admin: boolean; reload: () => void }) {
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<Kind | ''>('')
  const [place, setPlace] = useState('')
  const [adding, setAdding] = useState(false)
  const placeName = Object.fromEntries(places.map((p) => [p.id, p.name]))

  const groups = useMemo(() => {
    const shown = items.filter((i) => (!kind || i.kind === kind) && matches(q, i.name, i.code, i.grp, i.supplier, i.note)
      && (!place || stock.some((s) => s.item_id === i.id && s.place_id === place && Math.abs(s.qty) > 0.0005)))
    const m = new Map<string, MatItem[]>()
    for (const i of shown) { const k = `${KIND_NAMES[i.kind]} · ${i.grp ?? 'Other'}`; m.set(k, [...(m.get(k) ?? []), i]) }
    return [...m.entries()]
  }, [items, kind, q, place, stock])

  return (
    <div className="space-y-4">
      <NegativeBox items={items} places={places} stock={stock} />
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" />
        <Select value={kind} onChange={(e) => setKind(e.target.value as Kind | '')}>
          <option value="">RM + PM</option><option value="RM">Raw materials</option><option value="PM">Packaging</option>
        </Select>
        <Select value={place} onChange={(e) => setPlace(e.target.value)}>
          <option value="">All places</option>
          {places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        {admin && <Button tone="plain" onClick={() => setAdding(!adding)}>+ Item</Button>}
      </div>
      {adding && <ItemForm onDone={() => { setAdding(false); reload() }} onCancel={() => setAdding(false)} />}
      {!groups.length && <Card><p className="text-sm text-stone-600">Nothing matches.</p></Card>}
      {groups.map(([g, list]) => (
        <div key={g} className="space-y-2">
          <h3 className="text-sm font-semibold text-stone-500">{g}</h3>
          <Card className="p-0 sm:p-0">
            <ul className="divide-y divide-stone-100">
              {list.map((i) => {
                const total = place ? stockOf(stock, i.id, place) : stockOf(stock, i.id)
                const parts = stock.filter((s) => s.item_id === i.id && Math.abs(s.qty) > 0.0005)
                const low = i.low_level != null && total <= Number(i.low_level)
                return (
                  <li key={i.id}>
                    <Link to={`/material/${i.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-ae-cream/40">
                      <div className="min-w-0">
                        <div className="font-semibold text-stone-900">{i.name}</div>
                        <div className="truncate text-xs text-stone-500">
                          {[i.code, i.count_only ? 'count only' : null, !place && parts.length > 1 || (!place && parts.length === 1 && placeName[parts[0].place_id] !== 'Gala 17')
                            ? parts.map((s) => `${placeName[s.place_id]} ${fmtQty(s.qty, i.unit)}`).join(' · ') : null].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-lg font-bold ${total < 0 ? 'text-red-700' : low ? 'text-amber-700' : 'text-ae-blue'}`}>{fmtQty(total, i.unit)}</div>
                        {i.box_size && total > 0 && <div className="text-xs text-stone-500">{boxesText(total, i)}</div>}
                        {low && total >= 0 && <div className="text-xs font-semibold text-amber-700">Low</div>}
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </Card>
        </div>
      ))}
    </div>
  )
}
