import { useEffect, useRef, useState, type ReactNode, type HTMLAttributes } from 'react'
import { clsx } from 'clsx'

export interface CurvedScrollContainerProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  height?: string | number
  maxHeight?: string | number
  themeColor?: 'brand' | 'cyan' | 'lime' | 'purple' | 'amber' | 'blue' | string
  corners?: 'both' | 'bottom-right' | 'top-right'
  notched?: boolean
  borderRadius?: number
  contentClassName?: string
  offset?: number
  /**
   * 'neon' (default): glowing thumb and a faint track. 'plain': the original inspiration — a thin
   * 4px line with no glow and a transparent track, hugging the container's border radius.
   */
  variant?: 'neon' | 'plain'
}

const COLOR_MAP: Record<string, { thumb: string; activeThumb: string; glow: string; track: string }> = {
  brand: {
    thumb: '#52b69a',
    activeThumb: '#d9ed92',
    glow: 'rgba(82, 182, 154, 0.95)',
    track: 'rgba(52, 160, 164, 0.22)',
  },
  neonpink: {
    thumb: '#52b69a',
    activeThumb: '#d9ed92',
    glow: 'rgba(82, 182, 154, 0.95)',
    track: 'rgba(52, 160, 164, 0.22)',
  },
  lime: {
    thumb: '#d9ed92',
    activeThumb: '#c3e250',
    glow: 'rgba(217, 237, 146, 0.95)',
    track: 'rgba(162, 197, 32, 0.22)',
  },
  ocean: {
    thumb: '#52b69a',
    activeThumb: '#75c5ae',
    glow: 'rgba(82, 182, 154, 0.95)',
    track: 'rgba(52, 160, 164, 0.22)',
  },
  teal: {
    thumb: '#34a0a4',
    activeThumb: '#52b69a',
    glow: 'rgba(52, 160, 164, 0.95)',
    track: 'rgba(22, 138, 173, 0.25)',
  },
  cyan: {
    thumb: '#34a0a4',
    activeThumb: '#52b69a',
    glow: 'rgba(52, 160, 164, 0.95)',
    track: 'rgba(22, 138, 173, 0.25)',
  },
  purple: {
    thumb: '#1e6091',
    activeThumb: '#57a3dd',
    glow: 'rgba(30, 96, 145, 0.95)',
    track: 'rgba(24, 78, 119, 0.25)',
  },
  amber: {
    thumb: '#fbbf24',
    activeThumb: '#f59e0b',
    glow: 'rgba(251, 191, 36, 0.9)',
    track: 'rgba(251, 191, 36, 0.2)',
  },
  blue: {
    thumb: '#168aad',
    activeThumb: '#1fb4e2',
    glow: 'rgba(22, 138, 173, 0.95)',
    track: 'rgba(30, 96, 145, 0.25)',
  },
}

export function CurvedScrollContainer({
  children,
  className,
  contentClassName,
  height,
  maxHeight,
  themeColor = 'brand',
  corners = 'both',
  notched = false,
  borderRadius: explicitRadius,
  offset = 6,
  variant = 'neon',
  style,
  ...props
}: CurvedScrollContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const trackPathRef = useRef<SVGPathElement>(null)
  const thumbPathRef = useRef<SVGPathElement>(null)

  const [hasScroll, setHasScroll] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  const isDraggingRef = useRef(false)
  const pointerIdRef = useRef<number | null>(null)
  const pathLengthRef = useRef(0)
  const thumbLengthRef = useRef(40)

  const activeColors = COLOR_MAP[themeColor] || {
    thumb: themeColor,
    activeThumb: themeColor,
    glow: 'rgba(0, 188, 255, 0.8)',
    track: 'rgba(255, 255, 255, 0.12)',
  }

  const OFFSET = offset
  const EXTRA_INSET = 2
  const MIN_START_RATIO = 0.8
  const MIN_THUMB = 26
  const SEGMENTS = 50

  useEffect(() => {
    const container = containerRef.current
    const content = contentRef.current
    const trackPath = trackPathRef.current
    const thumbPath = thumbPathRef.current
    if (!container || !content || !trackPath || !thumbPath) return

    function updateThumb() {
      if (!content || !trackPath || !thumbPath) return
      const scrollableHeight = content.scrollHeight - content.clientHeight
      if (scrollableHeight <= 1) {
        setHasScroll(false)
        thumbPath.setAttribute('d', '')
        return
      }

      const pathLength = pathLengthRef.current
      if (pathLength <= 0) return
      setHasScroll(true)

      const thumbLength = thumbLengthRef.current
      const scrollRatio = Math.max(0, Math.min(1, content.scrollTop / scrollableHeight))
      const startOffset = (pathLength - thumbLength) * scrollRatio
      const endOffset = startOffset + thumbLength

      const points: string[] = []
      for (let i = 0; i <= SEGMENTS; i++) {
        const t = startOffset + ((endOffset - startOffset) / SEGMENTS) * i
        const p = trackPath.getPointAtLength(t)
        points.push(`${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      }

      if (points.length > 0) {
        const segmentD = `M ${points[0]} ${points.slice(1).map((pt) => `L ${pt}`).join(' ')}`
        thumbPath.setAttribute('d', segmentD)
      }
    }

    function updatePath() {
      if (!container || !content || !trackPath || !thumbPath) return
      const w = container.clientWidth
      const h = container.clientHeight
      if (w === 0 || h === 0) return

      const scrollable = content.scrollHeight - content.clientHeight > 1
      setHasScroll(scrollable)
      if (!scrollable) {
        thumbPath.setAttribute('d', '')
        trackPath.setAttribute('d', '')
        return
      }

      let r = explicitRadius ?? 0
      if (explicitRadius === undefined) {
        const comp = parseFloat(getComputedStyle(container).borderRadius) || 0
        r = comp > 0 ? comp : notched ? 16 : 14
      }

      const effectiveRadius = Math.max(r - OFFSET, 2)
      const trackX = w - OFFSET
      const topY = OFFSET
      const bottomY = h - OFFSET
      const cornerX = Math.max(trackX - effectiveRadius, 0)

      const minStartX = w * MIN_START_RATIO
      let startX = trackX - effectiveRadius * EXTRA_INSET
      if (startX < minStartX) startX = minStartX
      if (startX > cornerX) startX = cornerX

      let d = ''
      if (notched) {
        const chamferSize = Math.max(12 - OFFSET, 4)
        d = `
          M ${trackX - chamferSize * 2} ${topY}
          L ${trackX - chamferSize} ${topY}
          L ${trackX} ${topY + chamferSize}
          L ${trackX} ${bottomY - chamferSize}
          L ${trackX - chamferSize} ${bottomY}
          L ${trackX - chamferSize * 2} ${bottomY}
        `
      } else if (corners === 'bottom-right') {
        d = `
          M ${trackX} ${topY}
          L ${trackX} ${bottomY - effectiveRadius}
          A ${effectiveRadius} ${effectiveRadius} 0 0 1 ${cornerX} ${bottomY}
          L ${startX} ${bottomY}
        `
      } else if (corners === 'top-right') {
        d = `
          M ${startX} ${topY}
          L ${cornerX} ${topY}
          A ${effectiveRadius} ${effectiveRadius} 0 0 1 ${trackX} ${topY + effectiveRadius}
          L ${trackX} ${bottomY}
        `
      } else {
        d = `
          M ${startX} ${topY}
          L ${cornerX} ${topY}
          A ${effectiveRadius} ${effectiveRadius} 0 0 1 ${trackX} ${topY + effectiveRadius}
          L ${trackX} ${bottomY - effectiveRadius}
          A ${effectiveRadius} ${effectiveRadius} 0 0 1 ${cornerX} ${bottomY}
          L ${startX} ${bottomY}
        `
      }

      trackPath.setAttribute('d', d)
      try {
        pathLengthRef.current = trackPath.getTotalLength()
      } catch {
        pathLengthRef.current = 0
      }

      const ratio = content.clientHeight / content.scrollHeight
      thumbLengthRef.current = Math.max(MIN_THUMB, pathLengthRef.current * ratio)

      updateThumb()
    }

    // Measure initially and after frame/animation settle
    updatePath()
    const rafId = requestAnimationFrame(() => updatePath())
    const timer50 = setTimeout(() => updatePath(), 50)
    const timer200 = setTimeout(() => updatePath(), 200)

    const onScroll = () => updateThumb()
    content.addEventListener('scroll', onScroll, { passive: true })

    const ro = new ResizeObserver(() => {
      updatePath()
    })
    ro.observe(container)
    ro.observe(content)

    const mo = new MutationObserver(() => {
      updatePath()
    })
    mo.observe(content, { childList: true, subtree: true, characterData: true })

    return () => {
      cancelAnimationFrame(rafId)
      clearTimeout(timer50)
      clearTimeout(timer200)
      content.removeEventListener('scroll', onScroll)
      ro.disconnect()
      mo.disconnect()
    }
  }, [explicitRadius, notched, offset, corners])

  const onPointerDownThumb = (e: React.PointerEvent<SVGPathElement>) => {
    e.preventDefault()
    e.stopPropagation()
    isDraggingRef.current = true
    setIsDragging(true)
    pointerIdRef.current = e.pointerId
    thumbPathRef.current?.setPointerCapture(e.pointerId)
  }

  const onPointerDownTrack = (e: React.PointerEvent<SVGPathElement>) => {
    if (!contentRef.current || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    let ratio = (e.clientY - rect.top) / rect.height
    ratio = Math.max(0, Math.min(1, ratio))
    const content = contentRef.current
    content.scrollTo({
      top: ratio * (content.scrollHeight - content.clientHeight),
      behavior: 'smooth',
    })
  }

  useEffect(() => {
    function onPointerMove(e: PointerEvent) {
      if (!isDraggingRef.current || !contentRef.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      let ratio = (e.clientY - rect.top) / rect.height
      ratio = Math.max(0, Math.min(1, ratio))
      const content = contentRef.current
      content.scrollTop = ratio * (content.scrollHeight - content.clientHeight)
    }

    function onPointerUp(e: PointerEvent) {
      if (!isDraggingRef.current) return
      isDraggingRef.current = false
      setIsDragging(false)
      if (pointerIdRef.current !== null && thumbPathRef.current) {
        try {
          thumbPathRef.current.releasePointerCapture(pointerIdRef.current)
        } catch {
          // ignore
        }
      }
      pointerIdRef.current = null
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)

    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [])

  return (
    <div
      ref={containerRef}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={clsx('relative overflow-hidden flex flex-col group/curved-scroll', className)}
      style={{ height, maxHeight, ...style }}
      {...props}
    >
      {/* Scrollable inner content with hidden browser scrollbar */}
      <div
        ref={contentRef}
        className={clsx(
          'w-full flex-1 min-h-0 overflow-y-auto overscroll-contain pr-4 sm:pr-5 scrollbar-none',
          contentClassName,
        )}
        style={{
          height: height ? '100%' : undefined,
          maxHeight: maxHeight ?? undefined,
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
      >
        {children}
      </div>

      {/* Curved SVG Scrollbar Overlay - ALWAYS in DOM to preserve refs and measurements */}
      <svg
        data-static="true"
        className={clsx(
          'absolute inset-0 w-full h-full pointer-events-none z-30 select-none transition-opacity duration-200',
          hasScroll ? (variant === 'plain' || isHovered || isDragging ? 'opacity-100' : 'opacity-85') : 'opacity-0',
        )}
        style={{ display: hasScroll ? 'block' : 'none' }}
        aria-hidden="true"
      >
        {/* Subtle track following the corner contour */}
        <path
          ref={trackPathRef}
          fill="none"
          stroke={variant === 'plain'
            ? (isDragging ? 'rgba(255, 255, 255, 0.08)' : 'transparent')
            : (isHovered || isDragging ? activeColors.track : 'rgba(255, 255, 255, 0.08)')}
          strokeWidth={variant === 'plain' ? (isDragging ? 6 : 4) : (isDragging ? 5.5 : 4)}
          strokeLinecap="round"
          onPointerDown={onPointerDownTrack}
          className="cursor-pointer pointer-events-auto transition-all duration-200"
        />

        {/* Neon curved thumb hugging the border radius */}
        <path
          ref={thumbPathRef}
          fill="none"
          stroke={isDragging ? activeColors.activeThumb : activeColors.thumb}
          strokeWidth={variant === 'plain' ? (isDragging ? 6 : 4) : (isDragging ? 6.5 : isHovered ? 5.5 : 4.5)}
          strokeLinecap="round"
          onPointerDown={onPointerDownThumb}
          className="cursor-grab active:cursor-grabbing pointer-events-auto transition-all duration-150"
          style={{
            filter: variant === 'plain' ? 'none' : `drop-shadow(0 0 ${isDragging ? 12 : isHovered ? 8 : 5}px ${activeColors.glow})`,
          }}
        />
      </svg>
    </div>
  )
}
