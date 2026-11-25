// Add or change one item in the materials list (admins).
import { useState, type FormEvent } from 'react'
import { Button, ErrorBox, Field, Input, Select } from '../../components/ui'
import { why } from '../../lib/batches'
import type { MatItem } from '../../lib/materials'
import { supabase } from '../../lib/supabase'

export default function ItemForm({ item, onDone, onCancel }: { item?: MatItem; onDone: (id: string) => void; onCancel: () => void }) {
  const [f, setF] = useState({
    kind: item?.kind ?? 'RM', grp: item?.grp ?? '', name: item?.name ?? '', code: item?.code ?? '', supplier: item?.supplier ?? '',
    unit: item?.unit ?? 'kg', box_size: item?.box_size?.toString() ?? '', pouches_per_kg: item?.pouches_per_kg?.toString() ?? '',
    last_rate: item?.last_rate?.toString() ?? '', low_level: item?.low_level?.toString() ?? '', count_only: item?.count_only ?? false, note: item?.note ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const numOnly = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value.replace(/[^\d.]/g, '') })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { data, error: err } = await supabase.rpc('mat_save_item', { p_id: item?.id ?? null, p: f })
    setBusy(false)
    if (err) return setError(why(err))
    onDone(data as string)
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-xl border border-ae-blue/20 bg-ae-cream/40 p-4 sm:grid-cols-3">
      <div className="sm:col-span-2"><Field label="Name"><Input value={f.name} onChange={set('name')} required autoFocus /></Field></div>
      <Field label="Type">
        <Select value={f.kind} onChange={set('kind')}><option value="RM">Raw material</option><option value="PM">Packaging</option></Select>
      </Field>
      <Field label="Group"><Input value={f.grp} onChange={set('grp')} placeholder="e.g. Seasonings" /></Field>
      <Field label="Code"><Input value={f.code} onChange={set('code')} /></Field>
      <Field label="Supplier"><Input value={f.supplier} onChange={set('supplier')} /></Field>
      <Field label="Unit">
        <Select value={f.unit} onChange={set('unit')}><option value="kg">kg</option><option value="pcs">pcs</option></Select>
      </Field>
      <Field label="Box size" hint={`${f.unit} per box (optional)`}><Input value={f.box_size} onChange={numOnly('box_size')} inputMode="decimal" /></Field>
      <Field label="Low at" hint={`Flag when below (${f.unit})`}><Input value={f.low_level} onChange={numOnly('low_level')} inputMode="decimal" /></Field>
      <Field label="Last rate ₹" hint={`per ${f.unit}`}><Input value={f.last_rate} onChange={numOnly('last_rate')} inputMode="decimal" /></Field>
      {f.unit === 'kg' && f.kind === 'PM' && (
        <Field label="Pouches per kg" hint="Roll-form only"><Input value={f.pouches_per_kg} onChange={numOnly('pouches_per_kg')} inputMode="decimal" /></Field>
      )}
      <label className="flex items-center gap-2 self-end pb-3 text-sm font-semibold text-stone-700">
        <input type="checkbox" checked={f.count_only} onChange={(e) => setF({ ...f, count_only: e.target.checked })} className="h-5 w-5" />
        Count only (never used automatically)
      </label>
      <div className="sm:col-span-3"><Field label="Note"><Input value={f.note} onChange={set('note')} /></Field></div>
      <div className="sm:col-span-3"><ErrorBox>{error}</ErrorBox></div>
      <div className="flex gap-2 sm:col-span-3">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : item ? 'Save' : 'Add item'}</Button>
        <Button tone="plain" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}
