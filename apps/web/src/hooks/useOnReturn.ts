import { useEffect, useRef } from 'react'

/**
 * Runs `fn` when the person comes back to the app: the window gets focus, the tab becomes visible again, the page is restored
 * from the browser's back/forward cache, or the connection returns. A phone browser (and a tab in the background) often fires
 * only some of these, so listening to just `focus` leaves the screen showing what it knew hours ago.
 */
export function useOnReturn(fn: () => void) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    let last = 0
    const run = () => {
      // several of these events arrive together on one return: once is enough
      const now = Date.now()
      if (now - last < 1000) return
      last = now
      ref.current()
    }
    const onVisible = () => { if (document.visibilityState === 'visible') run() }
    window.addEventListener('focus', run)
    window.addEventListener('pageshow', run)
    window.addEventListener('online', run)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', run)
      window.removeEventListener('pageshow', run)
      window.removeEventListener('online', run)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
}
