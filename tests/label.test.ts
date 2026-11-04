// The pack label must match what the team actually prints (photos from 4 Nov 2026).
import { describe, expect, it } from 'vitest'
import { packLabel } from '../src/lib/label'

describe('pack label', () => {
  it('Party Pack Salted Mini Knots 200 g, 9 months', () => {
    expect(packLabel({ mrp: 500, grammage_g: 200, shelf_life_months: 9 }, 200, 'WABSPK55', '2026-11-02')).toEqual({
      mrp: '500.00/-', usp: '2.50/g', mfg: '02.11.2026', exp: '01.08.2027', batch: 'WABSPK55', net: '200g', missing: [],
    })
  })
  it('Truffle Peanuts 50 g, 6 months', () => {
    const l = packLabel({ mrp: 125, grammage_g: 50, shelf_life_months: 6 }, 50, 'TA1SWTPP28', '2026-10-23')
    expect([l.mrp, l.usp, l.mfg, l.exp]).toEqual(['125.00/-', '2.50/g', '23.10.2026', '22.04.2027'])
  })
  it('Tiramisu 30 g, 6 months', () => {
    const l = packLabel({ mrp: 120, grammage_g: 30, shelf_life_months: 6 }, 30, 'PDCTP026', '2026-11-03')
    expect([l.mrp, l.usp, l.mfg, l.exp]).toEqual(['120.00/-', '4.00/g', '03.11.2026', '02.05.2027'])
  })
  it('another pack size has no MRP, and missing items are listed', () => {
    const l = packLabel({ mrp: 99, grammage_g: 30, shelf_life_months: null }, 500, null, '2026-11-04')
    expect([l.mrp, l.usp, l.net, l.missing]).toEqual([null, null, '500g', ['shelf life', 'batch no.']])
  })
})
