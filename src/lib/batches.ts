// Batches: stages, dates and loading. All changes go through database functions (see the
// batches migration), which check the person's role and write the activity log.
import { supabase } from './supabase'

export type Stage = 'planned' | 'manufacturing' | 'filling' | 'qc' | 'done' | 'moved' | 'cancelled'
export type PackType = 'pouch' | 'jar' | 'bulk' | 'party_pack'

export const STAGE_NAMES: Record<Stage, string> = {
  planned: 'Planned',
  manufacturing: 'Manufacturing',
  filling: 'Filling',
  qc: 'QC',
  done: 'Done',
  moved: 'Moved to inventory',
  cancelled: 'Cancelled',
}

/** Stages a batch moves through on the floor, in order. */
export const FLOOR_STAGES: Stage[] = ['planned', 'manufacturing', 'filling', 'qc', 'done']
export const OPEN_STAGES: Stage[] = FLOOR_STAGES

export const PACK_NAMES: Record<PackType, string> = { pouch: 'Pouch', jar: 'Jar', bulk: 'Bulk', party_pack: 'Party pack' }

/** The big button on each stage. */
export const NEXT: Partial<Record<Stage, { to: Stage | 'inventory'; label: string }>> = {
  planned: { to: 'manufacturing', label: 'Start making' },
  manufacturing: { to: 'filling', label: 'Start filling' },
  filling: { to: 'qc', label: 'Send to QC' },
  qc: { to: 'done', label: 'QC passed' },
  done: { to: 'inventory', label: 'Move to inventory' },
}

export const STAGE_TONE: Record<Stage, string> = {
  planned: 'bg-stone-100 text-stone-700',
  manufacturing: 'bg-orange-100 text-orange-800',
  filling: 'bg-sky-100 text-sky-800',
  qc: 'bg-purple-100 text-purple-800',
  done: 'bg-green-100 text-green-800',
  moved: 'bg-ae-blue text-ae-cream',
  cancelled: 'bg-red-100 text-red-800',
}

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
  product: { name: string; sku: string; category: string | null }
  outputs: Output[]
}

export const BATCH_SELECT = '*, product:products(name, sku, category), outputs:batch_outputs(*)'

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

export const isLate = (b: Pick<Batch, 'stage' | 'planned_date'>, today = todayIST()) =>
  OPEN_STAGES.includes(b.stage) && !!b.planned_date && b.planned_date < today

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
