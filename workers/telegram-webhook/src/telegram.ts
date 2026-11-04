/** The few Telegram Bot API calls the flow needs, behind an interface so the flow can be tested without the network. */

export type Button = { text: string; data: string }
export type Keyboard = Button[][]

export interface Telegram {
  /** Sends a message and returns its id. */
  send(chatId: number, text: string, keyboard?: Keyboard): Promise<number>
  /** Rewrites a message (and its buttons). A "not modified" answer is not an error. */
  edit(chatId: number, messageId: number, text: string, keyboard?: Keyboard): Promise<void>
  /** Stops the spinner on a pressed button, optionally with a small notice. */
  answer(callbackId: string, text?: string): Promise<void>
  /** Bytes of a photo / image file the user sent. */
  download(fileId: string): Promise<{ bytes: Uint8Array; mime: string }>
}

const markup = (keyboard?: Keyboard) =>
  keyboard ? { reply_markup: { inline_keyboard: keyboard.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) } } : { reply_markup: { inline_keyboard: [] } }

export function createTelegram(token: string): Telegram {
  const call = async (method: string, body: Record<string, unknown>) => {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data: any = await res.json().catch(() => ({}))
    if (!data.ok) throw new Error(`Telegram ${method}: ${data.description ?? res.status}`)
    return data.result
  }
  return {
    async send(chatId, text, keyboard) {
      return (await call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...markup(keyboard) })).message_id
    },
    async edit(chatId, messageId, text, keyboard) {
      try { await call('editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...markup(keyboard) }) }
      catch (e: any) { if (!/not modified/i.test(String(e?.message))) throw e }
    },
    async answer(callbackId, text) {
      await call('answerCallbackQuery', { callback_query_id: callbackId, ...(text ? { text } : {}) }).catch(() => {})
    },
    async download(fileId) {
      const file = await call('getFile', { file_id: fileId })
      const res = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`)
      if (!res.ok) throw new Error(`No pude descargar la imagen (${res.status})`)
      const ext = String(file.file_path).split('.').pop()?.toLowerCase()
      const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg'
      return { bytes: new Uint8Array(await res.arrayBuffer()), mime }
    },
  }
}
