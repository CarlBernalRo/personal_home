import { addDoc, collection, deleteDoc, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'

/**
 * What a stored attachment may weigh (after optimizing): same ceiling as the copies saved from Telegram. A Firestore
 * document holds 1 MB and the file goes inside as base64 (+33%), so 400 KB leaves a wide margin and keeps reads cheap.
 */
export const MAX_ATTACHMENT_BYTES = 400 * 1024
export const MAX_ATTACHMENT_LABEL = '400 KB'

export const formatBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const MAX_SIDE = 1400

const load = (file: File) => new Promise<HTMLImageElement>((resolve, reject) => {
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen')) }
  img.src = url
})

const toBlob = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))

/** The picture as a small JPEG: scaled down and recompressed until it fits (what keeps the weight minimal). */
export async function compressImage(file: File): Promise<Blob> {
  const img = await load(file)
  let scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height))
  for (let attempt = 0; attempt < 6; attempt++) {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.width * scale))
    canvas.height = Math.max(1, Math.round(img.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('No se pudo procesar la imagen')
    ctx.fillStyle = '#fff' // a transparent PNG would turn black as a JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    for (const q of [0.8, 0.65, 0.5]) {
      const blob = await toBlob(canvas, q)
      if (blob && blob.size <= MAX_ATTACHMENT_BYTES) return blob
    }
    scale *= 0.75
  }
  throw new Error(`La imagen sigue pesando más de ${MAX_ATTACHMENT_LABEL} aunque se redujo al máximo (tiene una resolución muy alta o demasiado detalle). Prueba con una captura de pantalla o una foto de menor resolución.`)
}

/** Anything that is not a picture (PDF, Word, Excel, text…) is stored as it is, or gzipped when that makes it lighter. */
export const isImage = (file: File) => file.type.startsWith('image/')

export interface PreparedAttachment {
  blob: Blob
  mime: string
  /** 'gzip' when the stored bytes are compressed and must be inflated before opening. */
  encoding?: 'gzip'
  originalSize: number
}

const canGzip = typeof CompressionStream !== 'undefined'

async function gzip(blob: Blob): Promise<Blob> {
  return new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob()
}

/** Inflates the base64 of a gzipped attachment back to the original file's base64. */
export async function gunzipBase64(base64: string): Promise<string> {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const out = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
  let s = ''
  for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode(...out.subarray(i, i + 0x8000))
  return btoa(s)
}

/**
 * Optimizes the picked file and checks it fits `MAX_ATTACHMENT_BYTES`. Pictures are scaled down and recompressed; other
 * files are gzipped when that helps. Throws an Error whose message tells the user why the file cannot be attached.
 */
export async function prepareAttachment(file: File): Promise<PreparedAttachment> {
  if (file.size === 0) throw new Error('El archivo está vacío (0 KB).')
  if (isImage(file)) {
    if (file.type === 'image/svg+xml' || file.type === 'image/gif') throw new Error('Este formato de imagen no se puede reducir. Usa JPG, PNG o WebP.')
    return { blob: await compressImage(file), mime: 'image/jpeg', originalSize: file.size }
  }
  const mime = file.type || 'application/octet-stream'
  if (file.size <= MAX_ATTACHMENT_BYTES) return { blob: file, mime, originalSize: file.size }
  // already-compressed formats (PDF, Office, zip) gain little: gzip is tried anyway, and only kept if it fits
  if (canGzip) {
    const zipped = await gzip(file)
    if (zipped.size <= MAX_ATTACHMENT_BYTES) return { blob: zipped, mime, encoding: 'gzip', originalSize: file.size }
    throw new Error(`El archivo pesa ${formatBytes(file.size)} (${formatBytes(zipped.size)} comprimido) y el máximo es ${MAX_ATTACHMENT_LABEL}. Los PDF y documentos ya vienen comprimidos y no se pueden reducir más: reduce su calidad o número de páginas, o adjunta una captura.`)
  }
  throw new Error(`El archivo pesa ${formatBytes(file.size)} y el máximo es ${MAX_ATTACHMENT_LABEL}. Tu navegador no puede comprimirlo: reduce su peso antes de adjuntarlo.`)
}

const toBase64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
  r.onerror = () => reject(new Error('No se pudo leer el archivo'))
  r.readAsDataURL(blob)
})

/** Compresses the picture and stores it in `attachments`; returns the id to put on the record. */
/** `sharedWith`: other people who may see it (the other members of a household, for an abono they receive). */
export async function saveAttachment(userId: string, file: File, sharedWith: string[] = []): Promise<string> {
  const { blob, mime, encoding } = await prepareAttachment(file)
  const ref = await addDoc(collection(db, 'attachments'), {
    userId, source: 'app', ...(sharedWith.length ? { sharedWith } : {}), mime, ...(encoding ? { encoding } : {}), name: file.name.slice(0, 120), size: blob.size, data: await toBase64(blob), createdAt: serverTimestamp(),
  })
  return ref.id
}

/** Removes a stored picture (a record that is deleted, or a picture that was not used in the end). */
export async function removeAttachment(id?: string | null) {
  if (id) await deleteDoc(doc(db, 'attachments', id)).catch(() => {})
}

/**
 * Stores the picked picture (if any), runs the write that records the movement with its id, and deletes the picture
 * again when that write fails, so a failed save leaves nothing behind.
 */
export async function withAttachment<T>(userId: string, file: File | null, write: (attachmentId?: string) => Promise<T>, sharedWith: string[] = []): Promise<T> {
  const id = file ? await saveAttachment(userId, file, sharedWith) : undefined
  try {
    return await write(id)
  } catch (e) {
    await removeAttachment(id)
    throw e
  }
}
