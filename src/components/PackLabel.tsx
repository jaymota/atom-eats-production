// The pack label as a white sticker, in the same order and format the team prints it.
import type { PackLabelData } from '../lib/label'

export function PackLabel({ l, compact, small }: { l: PackLabelData; compact?: boolean; small?: boolean }) {
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
    <div className={`inline-block rounded-lg border-2 border-stone-300 bg-white shadow-sm ${small ? 'px-3 py-2' : 'min-w-[16rem] px-4 py-3'}`}>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-stone-500">Print on pack</div>
      <table className={`font-mono ${small ? 'text-xs leading-snug' : 'text-base'}`}>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td className={`text-stone-500 ${small ? 'pr-2' : 'pr-4'}`}>{k}:</td>
              <td className={`font-bold ${v ? 'text-stone-900' : 'text-amber-700'}`}>{v ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {l.missing.length > 0 && <div className="mt-1 text-xs font-semibold text-amber-800">Missing: {l.missing.join(', ')}.{!small && ' Ask an admin to add it in Products.'}</div>}
    </div>
  )
}
