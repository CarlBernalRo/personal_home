import { useState } from 'react'
import { clsx } from 'clsx'

interface AvatarProps {
  name: string
  photoURL?: string | null
  size?: number
  color?: string
  className?: string
}

/** Shows the person's Google profile photo when available, falling back to
 *  their initials on a solid color — the same fallback every avatar spot
 *  already used before this component existed. */
export function Avatar({ name, photoURL, size = 36, color, className }: AvatarProps) {
  const [errored, setErrored] = useState(false)
  const initials = name.slice(0, 2).toUpperCase() || '?'

  if (photoURL && !errored) {
    return (
      <img
        src={photoURL}
        alt={name}
        onError={() => setErrored(true)}
        referrerPolicy="no-referrer"
        style={{ width: size, height: size }}
        className={clsx('rounded-full object-cover flex-shrink-0 ring-2 ring-white shadow-sm', className)}
      />
    )
  }

  return (
    <div
      style={{ width: size, height: size, backgroundColor: color }}
      className={clsx('rounded-full flex items-center justify-center flex-shrink-0 ring-2 ring-white shadow-sm', !color && 'bg-gray-900', className)}
    >
      <span className="text-white font-bold" style={{ fontSize: Math.max(9, size * 0.34) }}>{initials}</span>
    </div>
  )
}
