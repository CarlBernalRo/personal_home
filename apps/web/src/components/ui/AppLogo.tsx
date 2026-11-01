/**
 * The app's mark (same drawing as /favicon.svg): a solid house with rising bars on a notched brand-green
 * tile. Solid shapes, so it stays readable at sidebar and tab sizes.
 */
export function AppLogo({ className = 'w-8 h-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="Gastos Hogar" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 0H64V52L52 64H0V12Z" fill="#52b69a" />
      <path d="M32 11 55 30H48V53H16V30H9Z" fill="#0a1f2f" />
      <rect x="22" y="40" width="6" height="8" rx="1.5" fill="#d9ed92" />
      <rect x="29" y="34" width="6" height="14" rx="1.5" fill="#d9ed92" />
      <rect x="36" y="28" width="6" height="20" rx="1.5" fill="#d9ed92" />
    </svg>
  )
}
