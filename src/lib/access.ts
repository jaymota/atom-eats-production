// Who sees which page. The database enforces the same limits, so a hidden page can't be reached
// by typing its address. Warehouse (Zeeshan, Tejashree): only stock transfers. Floor (Jeet): no reports.
const ALL = ['super_admin', 'admin', 'floor', 'warehouse']
const TEAM = ['super_admin', 'admin', 'floor']
const OFFICE = ['super_admin', 'admin']

export const PAGE_ROLES: Record<string, string[]> = {
  '/': TEAM,
  '/plan': TEAM,
  '/batch/:id': TEAM,
  '/stock': ALL,
  '/transfer/:id': ALL,
  '/bulk': TEAM,
  '/reports': OFFICE,
  '/products': TEAM,
  '/team': TEAM,
  '/activity': TEAM,
  '/my-pin': ALL,
}

export const mayOpen = (path: string, role?: string) => (PAGE_ROLES[path] ?? TEAM).includes(role ?? '')

/** Where each login lands. */
export const homeFor = (role?: string) => (role === 'warehouse' ? '/stock?tab=transfers' : '/')
