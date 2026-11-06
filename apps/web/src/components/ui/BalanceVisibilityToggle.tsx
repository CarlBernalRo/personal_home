import { Eye, EyeOff } from 'lucide-react'
import { clsx } from 'clsx'
import { IconTip } from './IconTip'
import { SideTip } from './SideTip'
import { usePrivacyStore } from '@/store/privacy'

interface Props {
  /** sidebar: tooltip to the right (icon-only rail) · mobile: tooltip above (phone header) */
  variant?: 'sidebar' | 'mobile'
}

/** Global switch: hides account balances and other sensitive money figures wherever they show, until toggled back. */
export function BalanceVisibilityToggle({ variant = 'mobile' }: Props) {
  const hidden = usePrivacyStore((s) => s.hideBalances)
  const toggle = usePrivacyStore((s) => s.toggle)
  const label = hidden ? 'Mostrar saldos' : 'Ocultar saldos'

  const button = (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={hidden}
      aria-label={label}
      className={clsx(
        'relative rounded-lg p-1.5 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400',
        hidden ? 'bg-amber-500/15 text-amber-300' : 'text-[#9aa4ac] hover:bg-white/5 hover:text-[#f3f5f6]',
      )}
    >
      <span className={clsx('privacy-icon', hidden && 'is-active')}>
        {hidden ? <EyeOff size={variant === 'mobile' ? 19 : 17} /> : <Eye size={variant === 'mobile' ? 19 : 17} />}
      </span>
    </button>
  )

  return variant === 'sidebar' ? <SideTip label={label}>{button}</SideTip> : <IconTip text={label} className="inline-flex" placement="top">{button}</IconTip>
}
