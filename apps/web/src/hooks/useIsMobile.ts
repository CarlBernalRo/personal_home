import { useEffect, useState } from 'react'

/** True on phone-width screens (below the `sm` breakpoint): where dialogs and menus become bottom sheets. */
export function useIsMobile(): boolean {
  const query = '(max-width: 639px)'
  const [mobile, setMobile] = useState(() => (typeof window === 'undefined' ? false : window.matchMedia(query).matches))
  useEffect(() => {
    const mq = window.matchMedia(query)
    const update = () => setMobile(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return mobile
}
