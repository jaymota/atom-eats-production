// Who sees which page. Everyone sees everything for now; recipes (Stage 3) are limited in the database.
const ALL = ['super_admin', 'admin', 'floor']

export const PAGE_ROLES: Record<string, string[]> = {
  '/': ALL,
  '/plan': ALL,
  '/batch/:id': ALL,
  '/reports': ALL,
  '/products': ALL,
  '/team': ALL,
  '/activity': ALL,
  '/my-pin': ALL,
}

export const mayOpen = (path: string, role?: string) => (PAGE_ROLES[path] ?? ALL).includes(role ?? '')

/** Where each login lands. */
export const homeFor = () => '/'
