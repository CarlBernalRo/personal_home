import { type HTMLAttributes } from 'react'
import { clsx } from 'clsx'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  notched?: boolean
}

export function Card({ className, children, notched = true, ...props }: CardProps) {
  return (
    <div
      className={clsx(
        'bg-[#0a1f2f] border border-brand-500/20 p-5 sm:p-6 shadow-sm transition-all',
        notched ? 'notch' : 'rounded-2xl',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}
