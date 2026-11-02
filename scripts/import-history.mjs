// One-time setup: loads past production (e.g. the October planner) as closed batches, from a
// private JSON file made on the laptop. Usage:  node scripts/import-history.mjs scratch/october.json
// Run once: it refuses if imported batches already exist for those dates.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { createClient } from '@supabase/supabase-js'

const REF = 'jwniizfhmjobwvswgfjt'
const CLI = `${homedir()}/.local/tools/supabase-cli/supabase`
const keys = JSON.parse(execFileSync(CLI, ['projects', 'api-keys', '--project-ref', REF, '-o', 'json'], { stdio: ['ignore', 'pipe', 'ignore'] }))
const db = createClient(`https://${REF}.supabase.co`, keys.find((k) => k.name === 'service_role').api_key, { auth: { persistSession: false } })

const groups = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const dates = groups.flatMap((g) => g.outputs.map((o) => o.made_on)).sort()
const { count } = await db.from('batches').select('id', { count: 'exact', head: true }).eq('imported', true)
  .gte('planned_date', dates[0]).lte('planned_date', dates.at(-1))
if (count) throw new Error(`Already imported (${count} batches in that period).`)

const { data: prods } = await db.from('products').select('id, sku, name')
const bySku = Object.fromEntries(prods.map((p) => [p.sku, p]))
let n = 0
for (const g of groups) {
  const p = bySku[g.sku]
  if (!p) { console.log('no product for', g.sku); continue }
  const pack = g.grammage >= 500 ? 'bulk' : p.name.toLowerCase().includes('party pack') ? 'party_pack' : g.pm === 'jar' ? 'jar' : 'pouch'
  const last = g.outputs.map((o) => o.made_on).sort().at(-1)
  const { data: b, error } = await db.from('batches').insert({
    batch_no: g.batch_no, product_id: p.id, planned_date: g.planned, units_planned: g.units_planned || null,
    grammage_g: g.grammage, pack_type: pack, stage: 'moved', imported: true, closed_at: `${last}T18:00:00+05:30`,
    notes: 'From the October 2026 planner',
  }).select('id').single()
  if (error) throw error
  const { error: e2 } = await db.from('batch_outputs').insert(g.outputs.map((o) => ({ batch_id: b.id, ...o })))
  if (e2) throw e2
  await db.from('batch_events').insert({ batch_id: b.id, from_stage: null, to_stage: 'moved', note: 'Imported from the October 2026 planner', at: `${last}T18:00:00+05:30` })
  n++
}
await db.from('activity').insert({ kind: 'history_imported', summary: `Set-up loaded ${n} batches of past production (${dates[0]} to ${dates.at(-1)}) from the planner` })
console.log(`imported ${n} batches`)
