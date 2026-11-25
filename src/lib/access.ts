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
  '/materials': TEAM,
  '/material/:id': TEAM,
  '/reports': OFFICE,
  '/products': TEAM,
  '/team': TEAM,
  '/activity': TEAM,
  '/my-pin': ALL,
}

// A warehouse login allowed to send stock (Dashrath) also sees today's production, read-only.
const SENDER_PAGES = ['/', '/batch/:id', '/stock', '/transfer/:id', '/my-pin']

export const mayOpen = (path: string, role?: string, canSend?: boolean) =>
  (PAGE_ROLES[path] ?? TEAM).includes(role ?? '') || (role === 'warehouse' && !!canSend && SENDER_PAGES.includes(path))

/** Where each login lands. */
export const homeFor = (role?: string, canSend?: boolean) => (role === 'warehouse' && !canSend ? '/stock?tab=transfers' : '/')
