// Batches: stages, dates and loading. All changes go through database functions (see the
// batches migration), which check the person's role and write the activity log.
import { supabase } from './supabase'

export type Stage = 'planned' | 'made' | 'manufacturing' | 'filling' | 'qc' | 'done' | 'moved' | 'cancelled'
export type PackType = 'pouch' | 'jar' | 'bulk' | 'party_pack'

export const STAGE_NAMES: Record<Stage, string> = {
  planned: 'Planned',
  made: 'To fill',
  manufacturing: 'Planned',
  filling: 'Planned',
  qc: 'Planned',
  done: 'Planned',
  moved: 'Done',
  cancelled: 'Cancelled',
}

/** Open (not done, not cancelled). Only "planned" is used now; the others are old stages. */
export const FLOOR_STAGES: Stage[] = ['planned', 'made', 'manufacturing', 'filling', 'qc', 'done']
export const OPEN_STAGES: Stage[] = FLOOR_STAGES

export const PACK_NAMES: Record<PackType, string> = { pouch: 'Pouch', jar: 'Jar', bulk: 'Bulk', party_pack: 'Party pack' }

export const STAGE_TONE: Record<Stage, string> = {
  planned: 'bg-stone-100 text-stone-700',
  made: 'bg-sky-100 text-sky-800',
  manufacturing: 'bg-stone-100 text-stone-700',
  filling: 'bg-stone-100 text-stone-700',
  qc: 'bg-stone-100 text-stone-700',
  done: 'bg-stone-100 text-stone-700',
  moved: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
}

/** The next step's button: Making done / Stock received (Planned) or Filling done (made, waiting to fill). */
export function nextStep(b: Pick<Batch, 'stage' | 'manufacturer_id'>): { label: string; mode: 'make' | 'receive' | 'fill' } | null {
  if (b.stage === 'made') return { label: 'Filling done', mode: 'fill' }
  if (!OPEN_STAGES.includes(b.stage)) return null
  return b.manufacturer_id ? { label: 'Stock received', mode: 'receive' } : { label: 'Making done', mode: 'make' }
}
export const completeLabel = (b: Pick<Batch, 'stage' | 'manufacturer_id'>) => nextStep(b)?.label ?? 'Done'

export interface Output {
  id: string
  batch_id: string
  made_on: string
  units: number
  output_kg: number | null
  input_kg: number | null
  packed_by: string | null
  note: string | null
  created_at: string
  grammage_g: number | null
  pack_type: PackType | null
}

export interface Batch {
  id: string
  batch_no: string | null
  product_id: string
  planned_date: string | null
  units_planned: number | null
  grammage_g: number | null
  pack_type: PackType
  notes: string | null
  stage: Stage
  workers: string[]
  cancel_reason: string | null
  imported: boolean
  created_at: string
  closed_at: string | null
  manufacturer_id: string | null
  maker: { name: string } | null
  made_kg: number | null
  made_on: string | null
  made_workers: string[]
  from_lot: string | null
  kept_in_bulk: boolean
  /** Bulk lots this batch put kg into (kept in bulk / put aside at filling). */
  lots?: { moves: { kg: number; kind: string }[] }[]
  product: { name: string; sku: string; category: string | null; shelf_life_months?: number | null; mrp?: number | null; grammage_g?: number | null }
  outputs: Output[]
}

export const BATCH_SELECT = '*, product:products(name, sku, category, shelf_life_months, mrp, grammage_g), maker:manufacturers(name), outputs:batch_outputs(*), lots:bulk_lots!bulk_lots_batch_id_fkey(moves:bulk_moves(kg, kind))'

// ---------- Dates (India time) ----------

/** Today in India as "2026-11-03". */
export function todayIST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** The Monday of the week that `iso` falls in. */
export function mondayOf(iso: string): string {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay() // 0 = Sunday
  return addDays(iso, -((day + 6) % 7))
}

/** "Tue 4 Nov" */
export function dayLabel(iso: string, opts: { weekday?: boolean; year?: boolean } = { weekday: true }): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
    timeZone: 'UTC', day: 'numeric', month: 'short',
    ...(opts.weekday ? { weekday: 'short' } : {}), ...(opts.year ? { year: 'numeric' } : {}),
  })
}

// ---------- Numbers ----------

export const unitsDone = (b: Pick<Batch, 'outputs'>) => b.outputs.reduce((s, o) => s + o.units, 0)
export const kgDone = (b: Pick<Batch, 'outputs'>) => b.outputs.reduce((s, o) => s + Number(o.output_kg ?? 0), 0)
export const expectedKg = (b: Pick<Batch, 'units_planned' | 'grammage_g'>) =>
  b.units_planned && b.grammage_g ? (b.units_planned * b.grammage_g) / 1000 : null

/** kg this batch put into bulk stock. */
export const bulkKg = (b: Pick<Batch, 'lots'>) =>
  (b.lots ?? []).reduce((s, l) => s + l.moves.filter((m) => m.kind === 'in').reduce((t, m) => t + Number(m.kg), 0), 0)

/** kg left over after filling: made − filled − put in bulk stock (null until made). */
export function leftKg(b: Pick<Batch, 'made_kg' | 'outputs' | 'lots'>, extraKg = 0): number | null {
  if (b.made_kg == null) return null
  return Math.round((Number(b.made_kg) - kgDone(b) - bulkKg(b) - extraKg) * 1000) / 1000
}

/** Loss % from what went in and what came out, when input was recorded. */
export function lossPct(outputs: Pick<Output, 'output_kg' | 'input_kg'>[]): number | null {
  const withInput = outputs.filter((o) => o.input_kg != null && Number(o.input_kg) > 0)
  if (!withInput.length) return null
  const inp = withInput.reduce((s, o) => s + Number(o.input_kg), 0)
  const out = withInput.reduce((s, o) => s + Number(o.output_kg ?? 0), 0)
  return ((inp - out) / inp) * 100
}

export const fmtKg = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n * 100) / 100} kg`)
export const fmtN = (n: number) => n.toLocaleString('en-IN')

// A made / received-in-bulk batch waiting to fill is "To fill", not late.
const overdue = (b: Pick<Batch, 'stage' | 'planned_date'>, today: string) =>
  OPEN_STAGES.includes(b.stage) && b.stage !== 'made' && !!b.planned_date && b.planned_date < today

/** An in-house batch whose day has passed and isn't done. */
export const isLate = (b: Pick<Batch, 'stage' | 'planned_date' | 'manufacturer_id'>, today = todayIST()) =>
  !b.manufacturer_id && overdue(b, today)

/** A contract-manufacturer batch whose day has passed and stock hasn't come in yet. */
export const isAwaiting = (b: Pick<Batch, 'stage' | 'planned_date' | 'manufacturer_id'>, today = todayIST()) =>
  !!b.manufacturer_id && overdue(b, today)

// ---------- Loading ----------

export async function loadBatches(build: (q: ReturnType<typeof base>) => ReturnType<typeof base>): Promise<Batch[]> {
  const out: Batch[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(base()).range(from, from + 999)
    if (error) throw error
    out.push(...((data ?? []) as unknown as Batch[]))
    if (!data || data.length < 1000) return out
  }
}
const base = () => supabase.from('batches').select(BATCH_SELECT)

/** Turns a database error into a friendly message. */
export function why(err: { message: string } | null): string {
  if (!err) return ''
  return /permission denied|JWT/i.test(err.message) ? 'Please log in again.' : err.message
}
