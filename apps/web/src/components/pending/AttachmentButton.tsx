import { useEffect, useState } from 'react'
import { Download, ExternalLink, ImageOff, Loader2, Paperclip, Send } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
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

type State = 'idle' | 'loading' | 'ready' | 'missing'

const kb = (base64: string) => Math.max(1, Math.round((base64.length * 0.75) / 1024))

/** A real file from the base64 text (a data: address cannot be opened in a new tab, a blob can). */
function blobUrl(mime: string, base64: string) {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return URL.createObjectURL(new Blob([bytes], { type: mime }))
}

/** "Ver comprobante": opens the (small) copy of the screenshot that was sent from Telegram. Loaded only when asked for. */
export function AttachmentButton({ attachmentId, label = 'Ver comprobante', compact = false }: Props) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<State>('idle')
  const [file, setFile] = useState<{ mime: string; data: string } | null>(null)

  async function show() {
    setOpen(true)
    if (state === 'ready' || state === 'loading') return
    setState('loading')
    try {
      const a = await getAttachment(attachmentId)
      if (!a) { setState('missing'); return }
      setFile(a)
      setState('ready')
    } catch { setState('missing') }
  }

  // the real file for "abrir" and "descargar", made once the image is there and released when the window closes
  const [href, setHref] = useState('')
  useEffect(() => {
    if (!file || !open) return
    const url = blobUrl(file.mime, file.data)
    setHref(url)
    return () => { URL.revokeObjectURL(url); setHref('') }
  }, [file, open])

  const ext = file?.mime.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg'

  const viewer = (
    <Modal open={open} onClose={() => setOpen(false)} title="Comprobante">
      {state === 'loading' || state === 'idle' ? (
        <div className="space-y-3" role="status" aria-label="Cargando el comprobante">
          <div className="flex aspect-[3/4] max-h-[55vh] w-full animate-pulse items-center justify-center rounded-xl border border-white/10 bg-[#0d263a]">
            <Loader2 size={22} className="animate-spin text-brand-400" />
          </div>
          <p className="text-center text-xs text-[#8a929a]">Cargando el comprobante…</p>
        </div>
      ) : state === 'missing' ? (
        <div className="flex flex-col items-center gap-3 px-2 py-6 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-[#0d263a] text-[#6f7a83]"><ImageOff size={24} /></span>
          <div className="space-y-1">
            <p className="text-sm font-bold text-[#f0fae8]">No encontramos el comprobante</p>
            <p className="mx-auto max-w-xs text-xs leading-relaxed text-[#8a929a]">
              La imagen ya no está guardada: se borra cuando se descarta el movimiento en Pendientes, o si el registro se eliminó.
            </p>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>Cerrar</Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="overflow-hidden rounded-xl border border-white/10 bg-black/30">
            <img src={`data:${file!.mime};base64,${file!.data}`} alt="Comprobante enviado desde Telegram" className="mx-auto max-h-[60vh] w-auto max-w-full" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[11px] text-[#8a929a]"><Send size={11} className="text-sky-300" /> Enviado desde Telegram · {kb(file!.data)} KB</p>
            <div className="flex items-center gap-2">
              <a href={href || undefined} target="_blank" rel="noreferrer" aria-disabled={!href}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#0d263a] px-2.5 py-1.5 text-xs font-semibold text-[#c7ccd1] transition hover:text-white">
                <ExternalLink size={13} /> Abrir
              </a>
              <a href={href || undefined} download={`comprobante.${ext}`} aria-disabled={!href}
                className="inline-flex items-center gap-1.5 rounded-lg border border-brand-400/40 bg-brand-500/10 px-2.5 py-1.5 text-xs font-semibold text-brand-300 transition hover:bg-brand-500/20">
                <Download size={13} /> Descargar
              </a>
            </div>
          </div>
        </div>
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
