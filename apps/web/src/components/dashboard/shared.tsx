import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, type LucideIcon } from 'lucide-react'
import { IconTip } from '@/components/ui/IconTip'
import { clsx } from 'clsx'

/**
 * Categorical series colors, dark steps of the dataviz palette validated against #0a1f2f
 * (validated with validate_palette.js: adjacent CVD ΔE >= 8.4, normal vision ΔE >= 19.8, contrast >= 3:1). Fixed order: never re-sorted.
 */
export const SERIES = {
  fixed: '#3987e5',
  additional: '#d95926',
  occasional: '#8f6fe0',
  reserved: '#c98500',
  left: '#199e70',
} as const

export const SURFACE = '#0a1f2f'
/** Diverging poles for household balances (blue: they owe you, red: you owe). */
export const POLE = { owedToMe: '#3987e5', owed: '#e66767' } as const

/** Chrome tokens for recharts (axis text, hairline grid, baseline). */
export const CHART = {
  tick: { fill: '#8a929a', fontSize: 11 },
  grid: 'rgba(255,255,255,0.07)',
  axis: 'rgba(255,255,255,0.14)',
  text: '#f3f5f6',
}

/** $1,2M / $850K style, for axes where the full amount would not fit. */
export function compactCOP(n: number): string {
  const a = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1).replace('.', ',')}M`
  if (a >= 1_000) return `${sign}$${Math.round(a / 1_000)}K`
  return `${sign}$${Math.round(a)}`
}

interface CardProps {
  title: string
  /** Micro-label above the title (font-pixel). */
  eyebrow?: string
  icon: LucideIcon
  /** Accent of the icon chip. */
  tone?: string
  to?: string
  linkLabel?: string
  className?: string
  /** Explains what the card shows; appears as a tooltip on its icon. */
  info?: string
  children: ReactNode
}

/** Standard dashboard card: notched surface, icon chip, title and an optional link to the zone. */
export function DashCard({ title, eyebrow, icon: Icon, tone = '#52b69a', to, linkLabel = 'Ver todo', className, info, children }: CardProps) {
  return (
    <section className={clsx('notch bg-[#0a1f2f] border border-white/10 p-4 sm:p-5 shadow-xl min-w-0 flex flex-col gap-4', className)}>
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {(() => {
            const chip = (
              <div
                className="w-8 h-8 notch-sm flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: tone + '26', border: `1px solid ${tone}55`, color: tone }}
                aria-hidden={info ? undefined : true}
              >
                <Icon size={16} aria-hidden="true" />
              </div>
            )
            return info
              ? <IconTip text={info} className="inline-flex flex-shrink-0 cursor-help focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400">{chip}</IconTip>
              : chip
          })()}
          <div className="min-w-0">
            {eyebrow && <p className="font-pixel text-[9px] uppercase text-[#8a929a] truncate">{eyebrow}</p>}
            <h2 className="text-sm font-bold text-[#f0fae8] tracking-tight truncate">{title}</h2>
          </div>
        </div>
        {to && (
          <Link
            to={to}
            aria-label={`${linkLabel}: ${title}`}
            className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-brand-400 hover:text-brand-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400 focus-visible:outline-offset-2 transition-colors"
          >
            {linkLabel} <ArrowRight size={13} />
          </Link>
        )}
      </header>
      {children}
    </section>
  )
}

/** Short empty state for a card or chart with nothing to draw. */
export function EmptyNote({ children, icon: Icon, height }: { children: ReactNode; icon?: LucideIcon; height?: number }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 text-center text-xs text-[#8a929a] border border-dashed border-white/10 rounded-xl px-4 py-6"
      style={height ? { minHeight: height } : undefined}
    >
      {Icon && <Icon size={18} className="text-[#5f6a72]" aria-hidden="true" />}
      <p>{children}</p>
    </div>
  )
}

export interface TipRow {
  /** Series color: drawn as a short line key. */
  color?: string
  name: string
  value: string
  /** Bold the row (totals). */
  strong?: boolean
}

/** Tooltip body in the app's theme: values lead, names follow. */
export function TooltipBox({ title, rows, footer }: { title?: string; rows: TipRow[]; footer?: ReactNode }) {
  return (
    <div className="notch-sm bg-[#0d263a] border border-white/15 px-3 py-2 shadow-2xl min-w-[150px] max-w-[260px]">
      {title && <p className="text-[11px] font-semibold text-[#c7ccd1] mb-1.5 capitalize">{title}</p>}
      <div className="space-y-1">
        {rows.map((r) => (
          <p key={r.name} className="flex items-center justify-between gap-3 text-xs">
            <span className="flex items-center gap-1.5 min-w-0 text-[#9aa4ac]">
              {r.color && <span className="w-3 h-0.5 rounded-full flex-shrink-0" style={{ backgroundColor: r.color }} aria-hidden="true" />}
              <span className="truncate">{r.name}</span>
            </span>
            <span className={clsx('font-mono flex-shrink-0 text-[#f3f5f6]', r.strong ? 'font-bold' : 'font-semibold')}>{r.value}</span>
          </p>
        ))}
      </div>
      {footer && <div className="mt-1.5 pt-1.5 border-t border-white/10 text-[11px] text-[#9aa4ac]">{footer}</div>}
    </div>
  )
}

export interface LegendItem {
  label: string
  color: string
  /** 'line' draws a key for line series; bars and areas use a swatch. */
  kind?: 'bar' | 'line'
}

/** Legend in text tones; the color lives only in the key beside each name. */
export function Legend({ items, className }: { items: LegendItem[]; className?: string }) {
  return (
    <ul className={clsx('flex flex-wrap gap-x-4 gap-y-1.5', className)} aria-label="Leyenda">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5 text-[11px] text-[#c7ccd1]">
          {i.kind === 'line'
            ? <span className="w-3.5 h-0.5 rounded-full" style={{ backgroundColor: i.color }} aria-hidden="true" />
            : <span className="w-2.5 h-2.5 rounded-[3px]" style={{ backgroundColor: i.color }} aria-hidden="true" />}
          {i.label}
        </li>
      ))}
    </ul>
  )
}
