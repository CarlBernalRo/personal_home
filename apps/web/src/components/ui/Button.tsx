import { type ButtonHTMLAttributes, forwardRef } from 'react'
import { clsx } from 'clsx'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  notched?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', notched = false, className, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={clsx(
          'inline-flex items-center justify-center gap-2 font-medium transition-all focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed interactive-press',
          notched ? 'notch-sm' : 'rounded-xl',
          {
            'bg-brand-500 text-[#051018] font-semibold hover:bg-brand-400 hover:shadow-[0_0_18px_rgba(52,160,164,0.5)] border border-brand-400/50':                               variant === 'primary',
            'bg-[#0d263a] text-[#f0fae8] border border-brand-500/25 hover:bg-[#133e5f] hover:border-brand-400/40 hover:text-white shadow-sm':                     variant === 'secondary',
            'text-[#97d4c3] hover:bg-white/10 hover:text-white border border-transparent hover:border-brand-500/20':                                              variant === 'ghost',
            'bg-red-600 text-white hover:bg-red-500 hover:shadow-[0_0_15px_rgba(239,68,68,0.35)] border border-red-400/40':                                     variant === 'danger',
          },
          {
            'px-3 py-1.5 text-sm': size === 'sm',
            'px-4 py-2 text-sm':   size === 'md',
            'px-6 py-3 text-base': size === 'lg',
          },
          className,
        )}
        {...props}
      >
        {children}
      </button>
    )
  },
)
Button.displayName = 'Button'
