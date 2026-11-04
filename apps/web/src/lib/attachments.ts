import { addDoc, collection, deleteDoc, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'

/** Same ceiling as the copies saved from Telegram: a Firestore document holds 1 MB, the picture goes inside as base64. */
export const MAX_ATTACHMENT_BYTES = 600 * 1024
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
  if (!file.type.startsWith('image/')) throw new Error('Solo se pueden adjuntar imágenes (JPG, PNG, WebP).')
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
  throw new Error('La imagen es demasiado pesada incluso reducida')
}

const toBase64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
  r.onerror = () => reject(new Error('No se pudo leer la imagen'))
  r.readAsDataURL(blob)
})

/** Compresses the picture and stores it in `attachments`; returns the id to put on the record. */
/** `sharedWith`: other people who may see it (the other members of a household, for an abono they receive). */
export async function saveAttachment(userId: string, file: File, sharedWith: string[] = []): Promise<string> {
  const blob = await compressImage(file)
  const ref = await addDoc(collection(db, 'attachments'), {
    userId, source: 'app', ...(sharedWith.length ? { sharedWith } : {}), mime: 'image/jpeg', size: blob.size, data: await toBase64(blob), createdAt: serverTimestamp(),
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
