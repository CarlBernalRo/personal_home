import { type HTMLAttributes } from 'react'
import { clsx } from 'clsx'

export function Card({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx('bg-white rounded-2xl shadow-sm border border-gray-100 p-5', className)}
      {...props}
    >
      {children}
    </div>
  )
}
