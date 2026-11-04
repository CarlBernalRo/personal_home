import { useState } from 'react'
import { Loader2, Paperclip } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { getAttachment } from '@/lib/firestore'

interface Props {
  attachmentId: string
  /** Text of the button (full variant). */
  label?: string
  /**
   * Only the paperclip, for rows of a list: it goes just left of the row's type chip. It is a span with role="button" so it
   * can live inside a row that is itself a button, and its clicks (also those inside the picture window) do not reach that
   * row.
   */
  compact?: boolean
}

/** "Ver comprobante": opens the (small) copy of the screenshot that was sent from Telegram. Loaded only when asked for. */
export function AttachmentButton({ attachmentId, label = 'Ver comprobante', compact = false }: Props) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'missing'>('idle')
  const [src, setSrc] = useState('')

  async function show() {
    setOpen(true)
    if (state === 'ready' || state === 'loading') return
    setState('loading')
    try {
      const a = await getAttachment(attachmentId)
      if (!a) { setState('missing'); return }
      setSrc(`data:${a.mime};base64,${a.data}`)
      setState('ready')
    } catch { setState('missing') }
  }

  const viewer = (
    <Modal open={open} onClose={() => setOpen(false)} title="Comprobante">
      {state === 'loading' || state === 'idle' ? (
        <div className="flex justify-center py-10"><Loader2 size={22} className="animate-spin text-brand-400" /></div>
      ) : state === 'missing' ? (
        <p className="py-8 text-center text-sm text-[#8a929a]">No se encontró la imagen. Puede que se haya eliminado.</p>
      ) : (
        <img src={src} alt="Comprobante enviado desde Telegram" className="mx-auto max-h-[65vh] w-auto max-w-full rounded-xl border border-white/10" />
      )}
    </Modal>
  )

  if (compact) {
    // React events bubble through the portal of the Modal to its React parents: this wrapper keeps them away from the row
    return (
      <span className="inline-flex flex-shrink-0" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <span
          role="button"
          tabIndex={0}
          title="Ver comprobante"
          aria-label="Ver comprobante"
          onClick={show}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show() } }}
          // 28px round button; the invisible ::before widens the tap area beyond it (a thumb needs ~40px)
          className="relative inline-flex h-7 w-7 flex-shrink-0 cursor-pointer items-center justify-center rounded-full border border-brand-400/40 bg-brand-500/10 text-brand-300 transition before:absolute before:-inset-1.5 before:content-[''] hover:bg-brand-500/20 hover:text-brand-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400"
        >
          <Paperclip size={14} aria-hidden="true" />
        </span>
        {viewer}
      </span>
    )
  }

  return (
    <>
      <button type="button" onClick={show} className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-300 transition hover:text-brand-200">
        <Paperclip size={13} /> {label}
      </button>
      {viewer}
    </>
  )
}
