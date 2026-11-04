// Finished stock at Gala 17 (factory) and Gala 6 (warehouse), by batch, and the transfers
// between them. All changes go through database functions (send / receive / sign off / take out).
import { addDays, todayIST } from './batches'
import { expiryDate } from './label'
import { supabase } from './supabase'

export type Place = 'gala17' | 'gala6'
export const PLACE_NAMES: Record<Place | 'transit', string> = { gala17: 'Gala 17', gala6: 'Gala 6', transit: 'On the way' }

export interface StockRow {
  location: Place | 'transit'
  product_id: string
  grammage_g: number | null
  batch_id: string | null
  batch_no: string | null
  made_on: string
  units: number
  expires_on: string | null
  product: { name: string; sku: string; category: string | null; shelf_life_months: number | null }
}

export async function loadStock(): Promise<StockRow[]> {
  const { data } = await supabase.from('fg_stock')
    .select('location, product_id, grammage_g, batch_id, batch_no, made_on, units, expires_on, product:products(name, sku, category, shelf_life_months)')
    .order('made_on')
  return (data ?? []) as unknown as StockRow[]
}

export const rowKey = (r: Pick<StockRow, 'product_id' | 'grammage_g' | 'batch_id' | 'made_on'>) =>
  `${r.product_id}|${r.grammage_g ?? ''}|${r.batch_id ?? ''}|${r.made_on}`

export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

/** "Expires in 40 days", coloured: red if expired or under 30 days, amber under 60. */
export function expiryInfo(expires: string | null): { text: string; tone: string } {
  if (!expires) return { text: 'No shelf life set', tone: 'text-amber-800' }
  const d = daysBetween(todayIST(), expires)
  if (d < 0) return { text: `Expired ${-d} ${-d === 1 ? 'day' : 'days'} ago`, tone: 'text-red-700' }
  return { text: `Expires in ${d} ${d === 1 ? 'day' : 'days'}`, tone: d < 30 ? 'text-red-700' : d < 60 ? 'text-amber-800' : 'text-stone-500' }
}

export interface TransferLine {
  id: string
  product_id: string
  grammage_g: number | null
  batch_id: string | null
  batch_no: string | null
  made_on: string
  units_sent: number
  units_received: number | null
  product: { name: string; shelf_life_months: number | null }
}

export interface Transfer {
  id: string
  transfer_no: string
  status: 'sent' | 'received'
  boxes_sent: number | null
  boxes_received: number | null
  note: string | null
  receive_note: string | null
  sent_at: string
  received_at: string | null
  has_difference: boolean
  signed_off_at: string | null
  sign_off_note: string | null
  sender: { name: string } | null
  receiver: { name: string } | null
  signer: { name: string } | null
  lines: TransferLine[]
}

export const TRANSFER_SELECT =
  '*, sender:people!transfers_sent_by_fkey(name), receiver:people!transfers_received_by_fkey(name), signer:people!transfers_signed_off_by_fkey(name), ' +
  'lines:transfer_lines(*, product:products(name, shelf_life_months))'

/** Expiry of a transfer line (made date + shelf life). */
export const lineExpiry = (l: Pick<TransferLine, 'made_on' | 'product'>) => expiryDate(l.made_on, l.product.shelf_life_months)

export const transferStatus = (t: Pick<Transfer, 'status' | 'has_difference' | 'signed_off_at'>) =>
  t.status === 'sent'
    ? { label: 'Waiting at Gala 6', tone: 'bg-amber-400 text-stone-900' }
    : t.has_difference && !t.signed_off_at
      ? { label: 'Difference — needs sign-off', tone: 'bg-red-600 text-white' }
      : t.has_difference
        ? { label: 'Received · difference signed off', tone: 'bg-green-100 text-green-800' }
        : { label: 'Received', tone: 'bg-green-100 text-green-800' }

export const yesterday = () => addDays(todayIST(), -1)
