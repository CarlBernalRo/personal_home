import type { ReactNode } from 'react'
import { StickyNote, MessageSquare } from 'lucide-react'
import clsx from 'clsx'

type Tone = 'amber' | 'sky'

const TONES: Record<Tone, { paper: string; border: string; title: string; text: string; line: string; fold: string }> = {
  amber: {
    paper: 'bg-amber-200/[0.07]', border: 'border-amber-300/25', title: 'text-amber-200', text: 'text-amber-50',
    line: 'rgba(252,211,77,0.16)', fold: 'rgba(252,211,77,0.35)',
  },
  sky: {
    paper: 'bg-sky-200/[0.06]', border: 'border-sky-300/25', title: 'text-sky-200', text: 'text-sky-50',
    line: 'rgba(125,211,252,0.15)', fold: 'rgba(125,211,252,0.35)',
  },
}

interface NoteProps {
  title: string
  icon?: ReactNode
  tone?: Tone
  children: string
}

/** A sheet of notepaper: tinted page, ruled lines and a folded corner. */
export function NoteSheet({ title, icon, tone = 'amber', children }: NoteProps) {
  const t = TONES[tone]
  return (
    <div className={clsx('relative overflow-hidden rounded-xl border border-l-4 px-3.5 pt-2.5 pb-3 shadow-sm', t.paper, t.border)}>
      {/* folded corner */}
      <span aria-hidden className="absolute top-0 right-0 h-4 w-4" style={{ background: `linear-gradient(225deg, transparent 50%, ${t.fold} 50%)` }} />
      <p className={clsx('flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider mb-1.5', t.title)}>
        {icon} {title}
      </p>
      <p
        className={clsx('text-[13px] whitespace-pre-line break-words', t.text)}
        style={{ lineHeight: '1.5rem', backgroundImage: `repeating-linear-gradient(transparent, transparent calc(1.5rem - 1px), ${t.line} calc(1.5rem - 1px), ${t.line} 1.5rem)` }}
      >
        {children}
      </p>
    </div>
  )
}

interface Props {
  /** The annotation configured on the expense (account number, agreement, reminder…). Nothing is rendered when empty. */
  notes?: string
}

/** Read-only annotations of a fixed expense. They are edited from the expense's configuration. */
export function NotesCard({ notes }: Props) {
  const text = (notes ?? '').trim()
  if (!text) return null
  return <NoteSheet title="Anotaciones" icon={<StickyNote size={12} />}>{text}</NoteSheet>
}

/** The comment left when a payment was registered. */
export function PaymentComment({ comment }: { comment?: string }) {
  const text = (comment ?? '').trim()
  if (!text) return null
  return <NoteSheet title="Comentario del pago" tone="sky" icon={<MessageSquare size={12} />}>{text}</NoteSheet>
}
