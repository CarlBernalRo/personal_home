/**
 * Telegram webhook (Cloudflare Worker): links a chat the moment the person presses "Iniciar" in the bot, instead of
 * waiting for the hourly GitHub job.
 *
 * Telegram POSTs every message sent to the bot here. The Worker only deals with linking:
 *   /start CODE  → finds the user whose profile holds that code (`telegramLinkCode`, made in Perfil → Avisos; valid
 *                  5 minutes, single use, and refused if more than one profile holds it), stores their `telegramChatId`
 *                  and answers in the chat
 *   /stop        → unlinks that chat
 * Sending the app's notifications stays in the GitHub job (scripts/ci/send-telegram.ts).
 *
 * Secrets (wrangler secret put …): TELEGRAM_BOT_TOKEN, WEBHOOK_SECRET (the same one given to Telegram's setWebhook),
 * FIREBASE_SERVICE_ACCOUNT (the JSON of a service account allowed to use Firestore).
 */

interface Env {
  TELEGRAM_BOT_TOKEN: string
  WEBHOOK_SECRET: string
  FIREBASE_SERVICE_ACCOUNT: string
}

/** A link code is valid for 5 minutes and works once (it is removed from the profile when it links). */
const CODE_TTL_MS = 5 * 60_000

// ── Google access token from the service account (RS256 JWT signed with WebCrypto) ──────────────────────────────
let cached: { token: string; exp: number } | null = null

const b64url = (data: ArrayBuffer | string) => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
  let s = ''
  bytes.forEach((b) => { s += String.fromCharCode(b) })
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function accessToken(sa: { client_email: string; private_key: string }) {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token
  const now = Math.floor(Date.now() / 1000)
  const claim = { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claim))}`
  const pem = sa.private_key.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '')
  const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned))
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(sig)}` }),
  })
  const data: any = await res.json()
  if (!data.access_token) throw new Error(`Token de Google: ${JSON.stringify(data)}`)
  cached = { token: data.access_token, exp: Date.now() + (data.expires_in ?? 3600) * 1000 }
  return cached.token
}

// ── Firestore REST ───────────────────────────────────────────────────────────────────────────────────────────────
async function firestore(env: Env, path: string, init: RequestInit & { json?: unknown } = {}) {
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)
  const url = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents${path}`
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${await accessToken(sa)}`, 'Content-Type': 'application/json' },
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  })
  const data: any = await res.json()
  if (!res.ok) throw new Error(`Firestore ${res.status}: ${JSON.stringify(data)}`)
  return data
}

/** Up to two users whose `field` equals `value` (two means the value is ambiguous). */
async function usersWhere(env: Env, field: string, value: string) {
  const rows: any[] = await firestore(env, ':runQuery', {
    method: 'POST',
    json: { structuredQuery: { from: [{ collectionId: 'users' }], where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } }, limit: 2 } },
  })
  return rows.filter((r) => r.document).map((r) => r.document) as { name: string; fields: Record<string, any> }[]
}

/** Writes `fields`; any path in `mask` that is not in `fields` is removed from the document. */
const patchUser = (env: Env, docName: string, mask: string[], fields: Record<string, unknown>) =>
  firestore(env, `/users/${docName.split('/').pop()}?${mask.map((m) => `updateMask.fieldPaths=${m}`).join('&')}`, { method: 'PATCH', json: { fields } })

// ── Telegram ─────────────────────────────────────────────────────────────────────────────────────────────────────
const say = (env: Env, chatId: number, text: string) =>
  fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  })

async function handle(env: Env, msg: any) {
  if (!msg?.text || msg.chat?.type !== 'private') return
  const chatId = msg.chat.id as number
  const text = String(msg.text).trim()

  if (/^\/stop\b/i.test(text)) {
    for (const user of await usersWhere(env, 'telegramChatId', String(chatId))) await patchUser(env, user.name, ['telegramChatId', 'telegramLinkedAt'], {})
    await say(env, chatId, 'Listo, no te enviaré más avisos. Vuelve a vincular desde Perfil → Avisos cuando quieras.')
    return
  }

  const code = text.match(/^\/start(?:@\w+)?\s+([A-Za-z0-9]{6,32})$/i)?.[1]?.toUpperCase()
  if (!code) {
    await say(env, chatId, 'Hola 👋 Para recibir tus avisos, entra a la app → <b>Perfil → Avisos</b>, toca <b>Vincular Telegram</b> y abre el enlace que te muestra.')
    return
  }

  // the code must belong to exactly one person; judged against when the message was SENT, not when it is read
  const matches = await usersWhere(env, 'telegramLinkCode', code)
  const user = matches.length === 1 ? matches[0] : undefined
  const issued = user?.fields.telegramLinkCodeAt?.timestampValue as string | undefined
  const sentAt = typeof msg.date === 'number' ? msg.date * 1000 : Date.now()
  if (!user || !issued || sentAt - Date.parse(issued) > CODE_TTL_MS) {
    await say(env, chatId, 'Ese código no es válido o ya venció. Genera uno nuevo desde Perfil → Avisos.')
    return
  }
  await patchUser(env, user.name, ['telegramChatId', 'telegramLinkedAt', 'telegramLinkCode', 'telegramLinkCodeAt'], {
    telegramChatId: { stringValue: String(chatId) },
    telegramLinkedAt: { timestampValue: new Date().toISOString() },
  })
  await say(env, chatId, '✅ <b>Telegram vinculado.</b> Aquí te llegarán tus avisos de Gastos Hogar. Escribe /stop para dejar de recibirlos.')
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') return new Response('ok')
    // only Telegram knows this secret (it sends it in a header with every update)
    if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) return new Response('forbidden', { status: 403 })
    try {
      const update: any = await request.json()
      await handle(env, update.message)
    } catch (e) {
      // answer 200 anyway: a non-200 makes Telegram resend the same update over and over
      console.error(e)
    }
    return new Response('ok')
  },
}
