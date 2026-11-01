import { clsx } from 'clsx'

interface ProgressBarProps {
  value: number // Percentage 0 - 100
  color?: string
  trackColor?: string
  size?: 'sm' | 'md' | 'lg'
  glow?: boolean
  className?: string
}

export function ProgressBar({
  value,
  color = '#52b69a',
  trackColor = '#0d263a',
  size = 'md',
  glow = true,
  className,
}: ProgressBarProps) {
  const clamped = Math.min(Math.max(value, 0), 100)

  const sizeClasses = {
    sm: 'h-2 p-[1.5px]',
    md: 'h-2.5 p-[2px]',
    lg: 'h-3.5 p-[2px]',
  }[size]

  return (
    <div
      className={clsx(
        'w-full border border-brand-500/20 rounded-full shadow-inner overflow-hidden relative',
        sizeClasses,
        className,
      )}
      style={{ backgroundColor: trackColor }}
    >
      <div
        className="h-full rounded-full transition-all duration-700 ease-out relative"
        style={{
          width: `${clamped}%`,
          backgroundColor: color,
          boxShadow: glow ? `0 0 10px ${color}80, inset 0 1px 0 rgba(255,255,255,0.4)` : 'inset 0 1px 0 rgba(255,255,255,0.3)',
        }}
      >
        {/* Subtle top sheen highlight */}
        <div className="absolute inset-0 bg-gradient-to-b from-white/30 to-transparent rounded-full pointer-events-none" />
      </div>
    </div>
  )
}
