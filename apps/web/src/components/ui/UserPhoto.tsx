import { useEffect, useState } from 'react'
import { clsx } from 'clsx'

interface Props {
  name: string
  photoURL?: string | null
  /** Tailwind size classes, e.g. "w-8 h-8". */
  sizeClass: string
  textClass?: string
  className?: string
}

/**
 * The signed-in user's own photo. Google's photo host refuses images when the request carries a referrer (a 403/429
 * that leaves only the alt text on screen), so none is sent; if it still fails the initials are shown instead.
 */
export function UserPhoto({ name, photoURL, sizeClass, textClass = 'text-xs', className }: Props) {
  const [errored, setErrored] = useState(false)
  useEffect(() => { setErrored(false) }, [photoURL])

  if (photoURL && !errored) {
    return (
      <img
        src={photoURL}
        alt={name}
        referrerPolicy="no-referrer"
        onError={() => setErrored(true)}
        className={clsx(sizeClass, 'rounded-full ring-2 ring-brand-500/40 flex-shrink-0 object-cover', className)}
      />
    )
  }
  return (
    <div className={clsx(sizeClass, 'rounded-full bg-brand-500/20 border border-brand-500/30 flex items-center justify-center text-brand-400 font-bold flex-shrink-0', textClass, className)}>
      {name.slice(0, 2).toUpperCase()}
    </div>
  )
}
