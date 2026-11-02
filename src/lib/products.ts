export type MadeBy = 'in_house' | 'third_party'

export const MADE_BY: Record<MadeBy, string> = { in_house: 'In-house', third_party: 'Third party' }

export const CATEGORIES = [
  'Salted Pretzels', 'Choco Pretzels', 'Spicy Pretzels', 'Sugar Pretzels', 'Truffle', 'Chips', 'Choco Potato',
  'Nuts', 'Trail Mix', 'Nachos', 'Crackers', 'Crunch Pops', 'Mahua', 'Other',
]

export interface Product {
  id: string
  sku: string
  name: string
  category: string | null
  grammage_g: number | null
  mrp: number | null
  shelf_life_months: number | null
  batch_prefix: string | null
  next_batch_no: number
  live: boolean
  made_by: MadeBy | null
  needs_check: string[]
  notes: string | null
}

/** The batch number the next batch of this product will get, e.g. "PDSWSP57". */
export const nextBatchNo = (p: Pick<Product, 'batch_prefix' | 'next_batch_no'>) =>
  p.batch_prefix ? `${p.batch_prefix}${p.next_batch_no}` : null
