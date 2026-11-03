import { useEffect, useRef, type RefObject } from 'react'

/**
 * Scrolls a horizontally scrollable timeline so today sits in the middle of what is visible. It waits until
 * the box really has a width (a collapsed block on a phone has none yet) and only does it once, so it never
 * fights the user after they start scrolling.
 * `todayX` gives where today is, in pixels from the left of the scrollable content (null = not on the axis).
 */
export function useFocusToday(ref: RefObject<HTMLElement>, todayX: () => number | null, ready: boolean) {
  const done = useRef(false)
  useEffect(() => {
    const el = ref.current
    if (!el || !ready) return
    const apply = () => {
      if (done.current || el.clientWidth === 0) return
      const x = todayX()
      if (x === null) return
      el.scrollLeft = Math.max(0, x - el.clientWidth / 2)
      done.current = true
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])
}
