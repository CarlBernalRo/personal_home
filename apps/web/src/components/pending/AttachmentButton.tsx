import { useState } from 'react'
import { Loader2, Paperclip } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { getAttachment } from '@/lib/firestore'

/** "Ver comprobante": opens the (small) copy of the screenshot that was sent from Telegram. Loaded only when asked for. */
export function AttachmentButton({ attachmentId, label = 'Ver comprobante' }: { attachmentId: string; label?: string }) {
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

  return (
    <>
      <button type="button" onClick={show} className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-300 transition hover:text-brand-200">
        <Paperclip size={13} /> {label}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Comprobante">
        {state === 'loading' || state === 'idle' ? (
          <div className="flex justify-center py-10"><Loader2 size={22} className="animate-spin text-brand-400" /></div>
        ) : state === 'missing' ? (
          <p className="py-8 text-center text-sm text-[#8a929a]">No se encontró la imagen. Puede que se haya eliminado.</p>
        ) : (
          <img src={src} alt="Comprobante enviado desde Telegram" className="mx-auto max-h-[65vh] w-auto max-w-full rounded-xl border border-white/10" />
        )}
      </Modal>
    </>
  )
}
