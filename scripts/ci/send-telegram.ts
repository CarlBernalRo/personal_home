/**
 * Telegram job (independent from the automatic-debits one): links chats and forwards the app's notifications.
 *
 *  1. LINK — reads what people wrote to the bot. `/start CODE` links that chat to the user whose profile holds that
 *     code (`telegramLinkCode`, generated from Perfil → Avisos); `/stop` unlinks it.
 *  2. SEND — every notification that has no Telegram status yet goes to the recipient's chat (if they linked one and kept
 *     that zone on), and is then marked `telegramStatus: 'sent'` (or 'skipped'), so running the job again never repeats it.
 *
 * State (the last update read) lives in `system/telegram`. Reads the service account from
 * GOOGLE_APPLICATION_CREDENTIALS and the bot token from TELEGRAM_BOT_TOKEN. By default it only LISTS what it would do;
 * pass --apply to link, send and save state.
 *
 *   npx tsx scripts/ci/send-telegram.ts           (dry run)
 *   npx tsx scripts/ci/send-telegram.ts --apply   (acts)
 */

process.env.TZ ||= 'America/Bogota'

import * as admin from 'firebase-admin'

const APPLY = process.argv.includes('--apply')
const TOKEN = process.env.TELEGRAM_BOT_TOKEN
const APP_URL = process.env.APP_URL || 'https://personalhome-3ee06.web.app'
if (!TOKEN) throw new Error('Falta TELEGRAM_BOT_TOKEN.')

admin.initializeApp({ credential: admin.credential.applicationDefault() })
const db = admin.firestore()
const { FieldValue, Timestamp } = admin.firestore
const stateRef = db.doc('system/telegram')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

async function tg(method: string, body: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const data: any = await res.json().catch(() => ({}))
  if (!data.ok) throw Object.assign(new Error(`Telegram ${method}: ${data.description ?? res.status}`), { code: data.error_code })
  return data.result
}

const say = (chatId: number | string, text: string) => (APPLY ? tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }) : Promise.resolve())

/** 1. Chats that wrote to the bot: link or unlink them. Returns the next update offset. */
async function linkChats(offset: number) {
  const updates: any[] = await tg('getUpdates', { offset, timeout: 0, allowed_updates: ['message'] })
  console.log(`${updates.length} mensaje(s) nuevo(s) para el bot.`)
  let next = offset
  for (const u of updates) {
    next = Math.max(next, u.update_id + 1)
    const msg = u.message
    if (!msg?.text || msg.chat?.type !== 'private') continue
    const chatId = msg.chat.id as number
    const text = String(msg.text).trim()

    if (/^\/stop\b/i.test(text)) {
      const users = await db.collection('users').where('telegramChatId', '==', String(chatId)).get()
      for (const d of users.docs) {
        console.log(`  · desvincula ${d.id.slice(0, 6)}… (chat ${chatId})`)
        if (APPLY) await d.ref.update({ telegramChatId: FieldValue.delete(), telegramLinkedAt: FieldValue.delete() })
      }
      await say(chatId, 'Listo, no te enviaré más avisos. Vuelve a vincular desde Perfil → Avisos cuando quieras.')
      continue
    }

    const code = text.match(/^\/start(?:@\w+)?\s+([A-Za-z0-9]{6,32})$/i)?.[1]?.toUpperCase()
    if (!code) {
      await say(chatId, 'Hola 👋 Para recibir tus avisos, entra a la app → <b>Perfil → Avisos</b>, toca <b>Vincular Telegram</b> y abre el enlace que te muestra.')
      continue
    }
    const found = await db.collection('users').where('telegramLinkCode', '==', code).limit(1).get()
    const doc = found.docs[0]
    const issued = doc?.get('telegramLinkCodeAt')?.toMillis?.() as number | undefined
    if (!doc || (issued && Date.now() - issued > 48 * 3600_000)) {
      console.log(`  · código ${code} inválido o vencido (chat ${chatId})`)
      await say(chatId, 'Ese código no es válido o ya venció. Genera uno nuevo desde Perfil → Avisos.')
      continue
    }
    console.log(`  · vincula ${doc.id.slice(0, 6)}… con el chat ${chatId}`)
    if (APPLY) {
      await doc.ref.update({
        telegramChatId: String(chatId), telegramLinkedAt: FieldValue.serverTimestamp(),
        telegramLinkCode: FieldValue.delete(), telegramLinkCodeAt: FieldValue.delete(),
      })
    }
    await say(chatId, '✅ <b>Telegram vinculado.</b> Aquí te llegarán tus avisos de Gastos Hogar. Escribe /stop para dejar de recibirlos.')
  }
  return next
}

/** Notifications older than this are never sent: linking must not flood the chat with the whole history. */
const MAX_AGE_DAYS = 7

/**
 * 2. Forward what has not been sent yet. Every notification carries a Telegram status: no `telegramStatus` = pending,
 * 'sent' = delivered, 'skipped' = deliberately not sent (dismissed, zone switched off, too old). Only pending ones
 * are looked at, so running the job again never repeats a message.
 */
async function sendPending() {
  const users = await db.collection('users').where('telegramChatId', '>', '').get()
  const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000
  let sent = 0
  let skipped = 0
  for (const u of users.docs) {
    const p = u.data()
    const zones: string[] | undefined = Array.isArray(p.telegramZones) ? p.telegramZones : undefined
    const mine = await db.collection('notifications').where('userId', '==', u.id).get()
    const pending = mine.docs
      .filter((d) => !d.get('telegramStatus') && d.get('telegramSent') !== true)
      .sort((a, b) => (a.get('createdAt')?.toMillis?.() ?? 0) - (b.get('createdAt')?.toMillis?.() ?? 0))
    for (const d of pending) {
      const n = d.data()
      const created = n.createdAt?.toMillis?.() ?? 0
      const why = n.archived ? 'descartado' : created < cutoff ? `de hace más de ${MAX_AGE_DAYS} días` : zones && !zones.includes(n.zone) ? 'zona apagada' : ''
      if (why) {
        skipped++
        if (APPLY) await d.ref.update({ telegramStatus: 'skipped', telegramAt: FieldValue.serverTimestamp() })
        continue
      }
      const icon = n.severity === 'critical' ? '🔴' : n.severity === 'warning' ? '🟠' : n.severity === 'success' ? '🟢' : '🔵'
      const link = n.link ? `\n<a href="${APP_URL}${n.link}">Abrir en la app</a>` : ''
      const text = `${icon} <b>${esc(String(n.title ?? ''))}</b>\n${esc(String(n.body ?? ''))}${link}`
      console.log(`  · ${u.id.slice(0, 6)}… [${n.zone}] ${n.title}`)
      if (!APPLY) { sent++; continue }
      try {
        await tg('sendMessage', { chat_id: p.telegramChatId, text, parse_mode: 'HTML', disable_web_page_preview: true })
        await d.ref.update({ telegramStatus: 'sent', telegramSent: true, telegramAt: FieldValue.serverTimestamp() })
        sent++
      } catch (e: any) {
        console.error(`    ✗ ${e.message}`)
        // the person blocked the bot or deleted the chat: forget it instead of failing every run (the rest stay pending)
        if (e.code === 403) { await u.ref.update({ telegramChatId: FieldValue.delete() }); break }
      }
      await sleep(60) // Telegram allows ~30 messages per second; stay far below
    }
  }
  console.log(`${users.size} usuario(s) con Telegram: ${sent} ${APPLY ? 'enviados' : 'por enviar'}, ${skipped} omitidos.`)
}

async function main() {
  const started = new Date()
  console.log(`Fecha: ${started.toString()}  (${APPLY ? 'ACTÚA' : 'simulación'})`)
  const me = await tg('getMe', {})
  console.log(`Bot del token: @${me.username}`)
  const state = (await stateRef.get()).data() ?? {}

  const offset = await linkChats(Number(state.offset ?? 0))

  await sendPending()

  if (APPLY) await stateRef.set({ offset }, { merge: true })
  else console.log('\nSimulación: no se envió ni guardó nada. Agrega --apply.')
}

main().catch((e) => { console.error(e); process.exit(1) })
