// Type to find a material: shows the best matches as big tappable rows.
import { useState } from 'react'
import { Input } from './ui'
import { matches, type MatItem } from '../lib/materials'

export default function ItemPicker({ items, onPick, placeholder = 'Type to find an item', extra, autoFocus }: {
  items: MatItem[]
  onPick: (i: MatItem) => void
  placeholder?: string
  /** Shown on the right of each match, e.g. stock in hand. */
  extra?: (i: MatItem) => string
  autoFocus?: boolean
}) {
  const [q, setQ] = useState('')
  const found = q.trim() ? items.filter((i) => matches(q, i.name, i.code, i.grp, i.note)).slice(0, 8) : []
  return (
    <div className="space-y-1">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} />
      {found.length > 0 && (
        <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white">
          {found.map((i) => (
            <li key={i.id}>
              <button type="button" onClick={() => { onPick(i); setQ('') }} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-ae-cream/50">
                <span>
                  <span className="font-semibold text-stone-900">{i.name}</span>
                  <span className="ml-2 text-xs text-stone-500">{i.code ?? ''}</span>
                </span>
                {extra && <span className="whitespace-nowrap text-sm text-stone-600">{extra(i)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.trim() !== '' && !found.length && <p className="px-1 text-sm text-stone-500">No item matches.</p>}
    </div>
  )
}
