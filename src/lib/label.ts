// What to print on the pack, exactly as the team prints it:
//   MRP: 500.00/-   USP: 2.50/g   MFG Date: 02.11.2026   EXP Date: 01.08.2027   Batch No.: WABSPK55   Net Wt.: 200g
// Expiry = manufacturing date + shelf life − 1 day. USP = MRP ÷ grams.

/** "2026-11-02" → "02.11.2026" */
export const dotDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`

/** Manufacturing date + shelf life (months) − 1 day, as "2027-08-01". */
export function expiryDate(mfg: string, months: number | null | undefined): string | null {
  if (!months) return null
  const d = new Date(`${mfg}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + months)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

export interface PackLabelData {
  mrp: string | null
  usp: string | null
  mfg: string
  exp: string | null
  batch: string | null
  net: string | null
  missing: string[]
}

/**
 * The label for one pack. MRP only applies to the product's own pack size; for another size
 * (e.g. 500 g bulk) MRP and USP are left blank unless that size has its own MRP.
 */
export function packLabel(p: { mrp: number | null; grammage_g: number | null; shelf_life_months: number | null | undefined },
  grams: number | null, batchNo: string | null, mfg: string): PackLabelData {
  const g = grams ?? p.grammage_g
  const ownSize = g != null && p.grammage_g != null && Number(g) === Number(p.grammage_g)
  const mrp = ownSize && p.mrp != null ? Number(p.mrp) : null
  const exp = expiryDate(mfg, p.shelf_life_months)
  const missing: string[] = []
  if (ownSize && mrp == null) missing.push('MRP')
  if (!exp) missing.push('shelf life')
  if (!batchNo) missing.push('batch no.')
  return {
    mrp: mrp != null ? `${mrp.toFixed(2)}/-` : null,
    usp: mrp != null && g ? `${(mrp / Number(g)).toFixed(2)}/g` : null,
    mfg: dotDate(mfg),
    exp: exp ? dotDate(exp) : null,
    batch: batchNo,
    net: g ? (Number(g) >= 1000 && Number(g) % 1000 === 0 ? `${Number(g) / 1000}kg` : `${Number(g)}g`) : null,
    missing,
  }
}
