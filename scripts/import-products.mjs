// One-time setup: loads the product list from a private JSON file (made on the laptop from the
// planner, product info, catalogue and website). Usage:  node scripts/import-products.mjs scratch/products.json
// Products already loaded (same SKU) are skipped. Needs the Supabase command-line tool to be logged in.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { createClient } from '@supabase/supabase-js'

const REF = 'jwniizfhmjobwvswgfjt'
const CLI = `${homedir()}/.local/tools/supabase-cli/supabase`
const keys = JSON.parse(execFileSync(CLI, ['projects', 'api-keys', '--project-ref', REF, '-o', 'json'], { stdio: ['ignore', 'pipe', 'ignore'] }))
const db = createClient(`https://${REF}.supabase.co`, keys.find((k) => k.name === 'service_role').api_key, { auth: { persistSession: false } })

const rows = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const { data: have } = await db.from('products').select('sku')
const known = new Set((have ?? []).map((r) => r.sku))
const fresh = rows.filter((r) => !known.has(r.sku)).map((r) => ({
  sku: r.sku, name: r.name, category: r.category, grammage_g: r.grammage_g, mrp: r.mrp,
  shelf_life_months: r.shelf_life_months ?? null, batch_prefix: r.batch_prefix ?? null, next_batch_no: r.next_batch_no ?? 1,
  live: r.live, made_by: r.made_by ?? null, needs_check: r.needs_check ?? [],
}))
if (fresh.length) {
  const { error } = await db.from('products').insert(fresh)
  if (error) throw error
}
console.log(`added ${fresh.length}, skipped ${rows.length - fresh.length} already there`)
