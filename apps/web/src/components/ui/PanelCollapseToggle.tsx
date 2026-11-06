import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { clsx } from 'clsx'
import { IconTip } from './IconTip'
import { SideTip } from './SideTip'
import { useLayoutStore } from '@/store/layout'

interface Props {
  /** sidebar: tooltip to the right (icon-only rail) · mobile: tooltip above (phone header) */
  variant?: 'sidebar' | 'mobile'
}

/** Global switch: collapses the left pane on every screen that has one, so the content on the right gets the full width. */
export function PanelCollapseToggle({ variant = 'mobile' }: Props) {
  const collapsed = useLayoutStore((s) => s.leftCollapsed)
  const toggleLeft = useLayoutStore((s) => s.toggleLeft)
  const label = collapsed ? 'Mostrar panel lateral' : 'Ocultar panel lateral'

  const button = (
    <button
      type="button"
      onClick={toggleLeft}
      aria-pressed={collapsed}
      aria-label={label}
      className={clsx(
        'relative rounded-lg p-1.5 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400',
        collapsed ? 'bg-brand-500/15 text-brand-300' : 'text-[#9aa4ac] hover:bg-white/5 hover:text-[#f3f5f6]',
      )}
    >
      <span className={clsx('panel-toggle-icon', collapsed && 'is-collapsed')}>
        {collapsed ? <PanelLeftOpen size={variant === 'mobile' ? 19 : 17} /> : <PanelLeftClose size={variant === 'mobile' ? 19 : 17} />}
      </span>
    </button>
  )

  return variant === 'sidebar' ? <SideTip label={label}>{button}</SideTip> : <IconTip text={label} className="inline-flex" placement="top">{button}</IconTip>
}
