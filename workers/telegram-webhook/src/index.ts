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

import { createDb } from './db'
import { pendingSummaryNow } from './format'
import { COMMANDS, HELP, bogotaToday, runCommand } from './commands'
import { clearFlow, onCallback, onText, startFromImage, type FlowDeps } from './flow'
import { onActionCallback, onActionText, onPayFixedCallback } from './actions'
import { saveAutoDebits, sendDailyPending, sendTelegramAvisos, sendWeeklyClose, type JobName } from './jobs'
import { createTelegram } from './telegram'
import { EMPTY_EXTRACTED, extractFromImage, type AiRunner } from './vision'

interface Env {
  TELEGRAM_BOT_TOKEN: string
  WEBHOOK_SECRET: string
  FIREBASE_SERVICE_ACCOUNT: string
  /** Workers AI (bound in wrangler.toml): reads the screenshots. Without it the bot still works: it asks every field. */
  AI?: AiRunner
  /** Optional model override for the screenshot reader. */
  VISION_MODEL?: string
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

const APP_URL = 'https://personalhome-3ee06.web.app'

/**
 * The Cron Triggers declared in wrangler.toml, UTC (Colombia is UTC-5: 12:07 UTC = 7:07 a.m.; 13:00 UTC = 8:00 a.m.;
 * Monday 00:00 UTC = Sunday 7 p.m.).
 */
const CRON_JOBS: Record<string, JobName> = { '*/10 * * * *': 'telegram', '7 12 * * *': 'debits', '0 13 * * *': 'daily', '0 0 * * 1': 'weekly' }

/**
 * Runs one scheduled job and leaves its trace in `system/jobs` (when it ran, how long it took, what it did, or the error),
 * so it is easy to tell whether a job really ran. With `apply` false nothing is written or sent.
 */
async function runJob(env: Env, name: JobName, apply: boolean) {
  const { db, tg } = flowDeps(env)
  const started = Date.now()
  try {
    const result = name === 'telegram' ? await sendTelegramAvisos({ db, tg, appUrl: APP_URL }, apply)
      : name === 'daily' ? await sendDailyPending({ db, tg, appUrl: APP_URL }, apply)
      : name === 'weekly' ? await sendWeeklyClose({ db, tg, appUrl: APP_URL }, apply)
      : await saveAutoDebits({ db }, apply)
    if (apply) await db.patch('system/jobs', { [name]: { at: new Date(), ms: Date.now() - started, ok: true, ...result } })
    return { ok: true, job: name, apply, ...result }
  } catch (e: any) {
    if (apply) await db.patch('system/jobs', { [name]: { at: new Date(), ms: Date.now() - started, ok: false, error: String(e?.message ?? e).slice(0, 400) } }).catch(() => {})
    throw e
  }
}

/** "✓ Marcar como leída" under a notice: marks it in the app and leaves only the button that opens it. */
async function noticeCallback(env: Env, uid: string, cb: any) {
  const { db, tg } = flowDeps(env)
  const [, action, key] = String(cb.data ?? '').split(':')
  if (action !== 'r' || !key) { await tg.answer(cb.id); return }
  // the button only carries the key, not the `${uid}_` prefix (Telegram's callback_data caps at 64 bytes): try the
  // usual derived-notice id first, and the key as a whole id for the few notices that were never prefixed that way
  const n = (await db.get(`notifications/${uid}_${key}`)) ?? (await db.get(`notifications/${key}`))
  if (!n || n.userId !== uid) { await tg.answer(cb.id, 'Ese aviso ya no existe'); return }
  await db.patch(`notifications/${n.id}`, { read: true })
  await tg.answer(cb.id, '✓ Marcada como leída')
  const rows = ((cb.message?.reply_markup?.inline_keyboard ?? []) as any[][])
    .map((row) => row.filter((b) => !String(b.callback_data ?? '').startsWith('n:r:')).map((b) => ({ text: b.text, url: b.url })))
    .filter((row) => row.length > 0)
  await tg.editKeyboard?.(cb.message.chat.id, cb.message.message_id, rows)
}

const flowDeps = (env: Env): FlowDeps => {
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)
  return { db: createDb(sa.project_id, () => accessToken(sa)), tg: createTelegram(env.TELEGRAM_BOT_TOKEN) }
}

/** The owner (profile id) of a linked chat, if any. */
const ownerOf = async (env: Env, chatId: number) => (await usersWhere(env, 'telegramChatId', String(chatId)))[0]?.name.split('/').pop()

/**
 * The files of a screenshot in a message. A photo arrives from Telegram already compressed, in several sizes: the biggest
 * is read, and for keeping we take the largest copy up to ~900 px wide and ~350 KB (about 50-120 KB for a typical
 * screenshot), so storing it costs almost nothing. An image sent as a FILE is not compressed: it is kept only if small.
 */
const imageIn = (msg: any): { read: string; keep: string | null } | null => {
  if (Array.isArray(msg.photo) && msg.photo.length) {
    const sizes = [...msg.photo].sort((a: any, b: any) => (a.width ?? 0) - (b.width ?? 0))
    const small = sizes.filter((p: any) => (p.width ?? 0) <= 900 && (p.file_size ?? 0) <= 350_000)
    return { read: sizes[sizes.length - 1].file_id, keep: (small[small.length - 1] ?? sizes[0]).file_id }
  }
  if (/^image\//.test(msg.document?.mime_type ?? '')) return { read: msg.document.file_id, keep: (msg.document.file_size ?? Infinity) <= 400_000 ? msg.document.file_id : null }
  return null
}

async function handle(env: Env, msg: any) {
  if (!msg || msg.chat?.type !== 'private') return
  const chatId = msg.chat.id as number

  // a screenshot: read it and open the step-by-step registration
  const files = imageIn(msg)
  if (files) {
    const uid = await ownerOf(env, chatId)
    if (!uid) { await say(env, chatId, 'Primero vincula tu cuenta: entra a la app → <b>Perfil → Avisos</b> y toca <b>Vincular Telegram</b>.'); return }
    const deps = flowDeps(env)
    const today = bogotaToday()
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    await startFromImage(deps, uid, chatId, {
      // no AI binding = no reading: the flow then asks every field by hand
      extract: async () => {
        if (!env.AI) return EMPTY_EXTRACTED
        return extractFromImage({ AI: env.AI, VISION_MODEL: env.VISION_MODEL }, await deps.tg.download(files.read), iso)
      },
      keep: async () => (files.keep ? deps.tg.download(files.keep) : null),
    })
    return
  }

  if (!msg.text) return
  const text = String(msg.text).trim()

  if (/^\/cancelar/i.test(text)) {
    await clearFlow(flowDeps(env), chatId)
    await say(env, chatId, 'Listo, cancelé el registro en curso. No se guardó nada.')
    return
  }

  if (/^\/stop\b/i.test(text)) {
    for (const user of await usersWhere(env, 'telegramChatId', String(chatId))) await patchUser(env, user.name, ['telegramChatId', 'telegramLinkedAt'], {})
    await say(env, chatId, 'Listo, no te enviaré más avisos. Vuelve a vincular desde Perfil → Avisos cuando quieras.')
    return
  }

  // /setup from a linked chat: publishes the command menu (same as the POST route, without needing the secret)
  if (/^\/setup\b/i.test(text)) {
    const owner = (await usersWhere(env, 'telegramChatId', String(chatId)))[0]
    if (!owner) { await say(env, chatId, 'Primero vincula tu cuenta: entra a la app → <b>Perfil → Avisos</b> y toca <b>Vincular Telegram</b>.'); return }
    const r = await publishCommands(env)
    await say(env, chatId, r.ok
      ? `✅ Menú de comandos actualizado.\n<i>${r.seen.map((x) => `${x.language}: ${x.commands.map((c: string) => '/' + c).join(' ')}`).join('\n')}</i>\n\nCierra y abre el chat para verlo.`
      : 'No pude actualizar el menú ahora. Intenta de nuevo en un momento.')
    return
  }

  // read-only commands (/saldo, /proximos…): only for a chat that is linked to a profile
  if (/^\/(?!start\b|stop\b)\w+/i.test(text)) {
    const owner = (await usersWhere(env, 'telegramChatId', String(chatId)))[0]
    if (!owner) {
      await say(env, chatId, 'Primero vincula tu cuenta: entra a la app → <b>Perfil → Avisos</b> y toca <b>Vincular Telegram</b>.')
      return
    }
    const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)
    const db = createDb(sa.project_id, () => accessToken(sa))
    // /pendientes: the daily message on demand (with a note when there is nothing)
    if (/^\/pendientes(?:@\w+)?(?:\s|$)/i.test(text)) {
      try {
        const user = await db.get(`users/${owner.name.split('/').pop()!}`)
        const msg = await pendingSummaryNow({ db, appUrl: APP_URL, now: Date.now() }, user!)
        await flowDeps(env).tg.send(chatId, msg.text, msg.keyboard, { silent: msg.silent })
      } catch (e) { console.error(e); await say(env, chatId, 'No pude consultar tus pendientes ahora. Intenta de nuevo en un momento.') }
      return
    }
    let answer: string | null
    try { answer = await runCommand(db, owner.name.split('/').pop()!, text) } catch (e) { console.error(e); answer = 'No pude consultar tus datos ahora. Intenta de nuevo en un momento.' }
    await say(env, chatId, answer ?? `No conozco ese comando.\n\n${HELP}`)
    return
  }

  // free text: it may be the answer to a pending action (ej. "monto diferente") or to the registration flow
  if (!text.startsWith('/')) {
    const uid = await ownerOf(env, chatId)
    if (uid) {
      if (await onActionText(flowDeps(env), uid, chatId, text)) return
      if (await onText(flowDeps(env), uid, chatId, text)) return
    }
  }

  const code = text.match(/^\/start(?:@\w+)?\s+([A-Za-z0-9]{6,32})$/i)?.[1]?.toUpperCase()
  if (!code) {
    const known = (await usersWhere(env, 'telegramChatId', String(chatId)))[0]
    await say(env, chatId, known ? `Hola 👋 Tu cuenta ya está vinculada.\n\n${HELP}` : 'Hola 👋 Para recibir tus avisos, entra a la app → <b>Perfil → Avisos</b>, toca <b>Vincular Telegram</b> y abre el enlace que te muestra.')
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
  await say(env, chatId, `✅ <b>Telegram vinculado.</b> Aquí te llegarán tus avisos de Gastos Hogar.\n\n${HELP}`)
}

/**
 * Publishes the command list so Telegram shows it in the "/" menu. It is idempotent and harmless, so it runs from the POST /setup route,
 * from the /setup command of a linked chat, and every morning with the daily job (a new command shows up without anyone doing anything).
 */
async function publishCommands(env: Env) {
  // Telegram keeps one command list per scope AND language, and the most specific one wins. Something else may have
  // left lists in narrower scopes, so every scope/language is cleared first, then ours is set where it matters.
  const call = (method: string, body: Record<string, unknown>) =>
    fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const scopes = ['default', 'all_private_chats', 'all_group_chats', 'all_chat_administrators']
  const langs: (string | undefined)[] = [undefined, 'es', 'en', 'pt']
  await Promise.all(scopes.flatMap((scope) => langs.map((language_code) => call('deleteMyCommands', { scope: { type: scope }, ...(language_code ? { language_code } : {}) }))))
  // A list set for ONE chat is the most specific of all and beats everything above: it would keep an old menu in that chat
  // forever. The chats linked to a profile are cleared too.
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)
  const linked = (await createDb(sa.project_id, () => accessToken(sa)).query('users', [{ field: 'telegramChatId', op: 'GREATER_THAN', value: '' }]).catch(() => []))
    .map((u) => Number(u.telegramChatId)).filter(Boolean)
  await Promise.all(linked.flatMap((chat_id) => langs.map((language_code) => call('deleteMyCommands', { scope: { type: 'chat', chat_id }, ...(language_code ? { language_code } : {}) }))))
  const set = await Promise.all([undefined, 'es'].flatMap((language_code) =>
    ['default', 'all_private_chats'].map(async (scope) => (await call('setMyCommands', { commands: COMMANDS, scope: { type: scope }, ...(language_code ? { language_code } : {}) })).ok)))
  // The button next to the message box that opens the list: forced to the "commands" type, for everyone and for each linked chat
  // (a chat can keep a different button, or none, from something done earlier and the list would never show)
  const menuButton = { type: 'commands' }
  const menuSet = await Promise.all([call('setChatMenuButton', { menu_button: menuButton }), ...linked.map((chat_id) => call('setChatMenuButton', { chat_id, menu_button: menuButton }))])
  const menuOk = (await Promise.all(menuSet.map((r) => r.json().then((j: any) => !!j.ok).catch(() => false)))).every(Boolean)
  // what Telegram now has for the private chats, to see at a glance that the menu really has the new command
  const seen = await Promise.all([undefined, 'es'].map(async (language_code) => {
    const r: any = await (await call('getMyCommands', { scope: { type: 'all_private_chats' }, ...(language_code ? { language_code } : {}) })).json().catch(() => ({}))
    return { language: language_code ?? 'default', commands: (r.result ?? []).map((c: any) => c.command) }
  }))
  return { ok: set.every(Boolean), menuButton: menuOk, cleared: scopes.length * langs.length, chatsCleared: linked.length, set: set.length, seen }
}

export default {
  // Cloudflare fires this on the exact minute of each Cron Trigger
  async scheduled(event: { cron: string }, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    const job = CRON_JOBS[event.cron]
    if (job) ctx.waitUntil(runJob(env, job, true).catch((e) => console.error(`job ${job}:`, e)))
    if (job === 'daily') ctx.waitUntil(publishCommands(env).catch((e) => console.error('commands:', e)))
  },

  async fetch(request: Request, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<Response> {
    if (request.method !== 'POST') return new Response('ok')
    // POST /setup (same secret header): publishes the command list so Telegram shows the "/" menu
    if (new URL(request.url).pathname === '/setup') {
      if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) return new Response('forbidden', { status: 403 })
      return Response.json(await publishCommands(env), { status: 200 })
    }
    // POST /run/telegram | /run/debits | /run/daily (same secret header): runs a job now. Add ?apply=1 to really send / store;
    // without it the job only reports what it would do.
    const run = new URL(request.url).pathname.match(/^\/run\/(telegram|debits|daily|weekly)$/)
    if (run) {
      if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) return new Response('forbidden', { status: 403 })
      try {
        return Response.json(await runJob(env, run[1] as JobName, new URL(request.url).searchParams.get('apply') === '1'))
      } catch (e: any) {
        return Response.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 })
      }
    }
    // only Telegram knows this secret (it sends it in a header with every update)
    if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) return new Response('forbidden', { status: 403 })
    // Answer Telegram right away and do the work afterwards (reading a screenshot takes a few seconds)
    const update: any = await request.json().catch(() => ({}))
    ctx.waitUntil((async () => {
      try {
        const cb = update.callback_query
        if (cb?.message?.chat?.type === 'private') {
          const chatId = cb.message.chat.id as number
          const uid = await ownerOf(env, chatId)
          const deps = flowDeps(env)
          if (!uid) await deps.tg.answer(cb.id, 'Vincula tu cuenta primero')
          else if (String(cb.data ?? '').startsWith('n:')) await noticeCallback(env, uid, cb)
          else if (String(cb.data ?? '').startsWith('p:')) await onActionCallback(deps, uid, { id: cb.id, chatId, messageId: cb.message.message_id, data: String(cb.data ?? '') })
          else if (String(cb.data ?? '').startsWith('x:')) await onPayFixedCallback(deps, uid, { id: cb.id, chatId, messageId: cb.message.message_id, data: String(cb.data ?? '') })
          else await onCallback(deps, uid, { id: cb.id, chatId, messageId: cb.message.message_id, data: String(cb.data ?? '') })
        } else {
          await handle(env, update.message)
        }
      } catch (e) {
        // answer 200 anyway (above): a non-200 makes Telegram resend the same update over and over
        console.error(e)
      }
    })())
    return new Response('ok')
  },
}
