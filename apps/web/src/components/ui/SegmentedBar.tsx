import { useState } from 'react'
import { clsx } from 'clsx'
import { formatCOP } from '@/shared'

/** Text color that reads on a segment: dark on light fills (a pale lime account), white on dark ones. */
export function inkOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const lin = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  // white when it reads well enough (4.5:1), otherwise whichever of white / dark ink contrasts more
  const white = 1.05 / (lum + 0.05);
  const dark = (lum + 0.05) / 0.056;
  return white >= 4.5 || white >= dark ? '#ffffff' : '#06131d';
}

/** A share as text with its decimals (up to two, no trailing zeros), never rounded to a whole number: 99,7% · 0,3%. */
export const shareLabel = (share: number): string =>
  `${share.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`;

export interface BarPart {
  key: string
  label: string
  value: number
  color: string
}

interface Props {
  parts: BarPart[]
  /** What the whole bar stands for; defaults to the sum of the parts. */
  total?: number
  /** Name of the bar for screen readers. */
  label: string
  className?: string
  /** Part currently picked: the others dim. */
  activeKey?: string | null
  /** Writes each part's share inside it (default) or leaves the bar bare, for a slim one. */
  showShare?: boolean
  /** Writes the part's amount inside it instead of its percentage (only where it fits). */
  showValue?: boolean
  /** Makes the parts pickable (click again to put it back). */
  onSelect?: (key: string) => void
}

/**
 * One bar split into what makes up a whole: each part has its own color, a share label when it is wide
 * enough, and a tooltip with its amount. Hovering one part dims the rest.
 */
export function SegmentedBar({ parts, total, label, className, activeKey = null, onSelect, showShare = true, showValue = false }: Props) {
  const [active, setActive] = useState<string | null>(null)
  const whole = total ?? parts.reduce((sum, p) => sum + p.value, 0)
  const shown = parts.filter((p) => p.value > 0)
  const summary = shown.map((p) => `${p.label} ${shareLabel((p.value / whole) * 100)}`).join(', ')

  return (
    <div
      role="img"
      aria-label={`${label}: ${summary || 'sin datos'}`}
      className={clsx('flex gap-0.5 h-5 w-full rounded-md bg-[#0d263a] border border-white/[0.06] p-[2px]', className)}
      onMouseLeave={() => setActive(null)}
    >
      {whole > 0 && shown.map((p) => {
        const share = (p.value / whole) * 100
        return (
          <div
            key={p.key}
            title={`${p.label}: ${formatCOP(p.value)} · ${shareLabel(share)}`}
            onMouseEnter={() => setActive(p.key)}
            onClick={onSelect ? () => onSelect(p.key) : undefined}
            role={onSelect ? 'button' : undefined}
            tabIndex={onSelect ? 0 : undefined}
            aria-pressed={onSelect ? activeKey === p.key : undefined}
            onKeyDown={onSelect ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(p.key) } } : undefined}
            className={clsx(
              'h-full rounded-[4px] flex items-center justify-center min-w-[3px] transition-opacity',
              onSelect && 'cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-white/70',
              ((active && active !== p.key) || (activeKey && activeKey !== p.key)) && 'opacity-45',
            )}
            style={{ width: `${share}%`, backgroundColor: p.color }}
          >
            {showValue
              ? share >= 22 && <span className="text-[11px] font-bold font-mono whitespace-nowrap px-1" style={{ color: inkOn(p.color) }}>{formatCOP(p.value)}</span>
              : showShare && share >= 12 && <span className="text-[11px] font-bold font-mono whitespace-nowrap" style={{ color: inkOn(p.color) }}>{shareLabel(share)}</span>}
          </div>
        )
      })}
    </div>
  )
}
