// The pack label as a white sticker, in the same order and format the team prints it.
import type { PackLabelData } from '../lib/label'

export function PackLabel({ l, compact }: { l: PackLabelData; compact?: boolean }) {
  const rows: [string, string | null][] = [
    ['MRP', l.mrp], ['USP', l.usp], ['MFG Date', l.mfg], ['EXP Date', l.exp], ['Batch No.', l.batch], ['Net Wt.', l.net],
  ]
  if (compact) {
    return (
      <div className="font-mono text-xs text-stone-700">
        🏷 {rows.filter(([, v]) => v).map(([k, v]) => `${k === 'Batch No.' ? '' : k.replace(' Date', '') + ' '}${v}`).join(' · ')}
        {l.missing.length > 0 && <span className="font-sans font-semibold text-amber-800"> · no {l.missing.join(', ')}</span>}
      </div>
    )
  }
  return (
    <div className="inline-block min-w-[16rem] rounded-lg border-2 border-stone-300 bg-white px-4 py-3 shadow-sm">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">Print on pack</div>
      <table className="font-mono text-base">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td className="pr-4 text-stone-500">{k}:</td>
              <td className={`font-bold ${v ? 'text-stone-900' : 'text-amber-700'}`}>{v ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {l.missing.length > 0 && <div className="mt-1 text-xs font-semibold text-amber-800">Missing: {l.missing.join(', ')}. Ask an admin to add it in Products.</div>}
    </div>
  )
}
