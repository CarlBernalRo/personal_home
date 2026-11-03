/**
 * Telegram job (independent from the automatic-debits one): forwards the app's notifications to Telegram.
 *
 * Every notification that has no Telegram status yet goes to the recipient's chat (if they linked one and kept that
 * zone on) and is then marked `telegramStatus: 'sent'` (or 'skipped'), so running the job again never repeats it.
 * Linking a chat is NOT done here: the Cloudflare Worker in workers/telegram-webhook does it the moment the person
 * presses "Iniciar" in the bot.
 *
 * Reads the service account from GOOGLE_APPLICATION_CREDENTIALS and the bot token from TELEGRAM_BOT_TOKEN. By default
 * it only LISTS what it would do; pass --apply to send.
 *
 *   npx tsx scripts/ci/send-telegram.ts           (dry run)
 *   npx tsx scripts/ci/send-telegram.ts --apply   (sends)
 */

process.env.TZ ||= 'America/Bogota'

import * as admin from 'firebase-admin'

const APPLY = process.argv.includes('--apply')
const TOKEN = process.env.TELEGRAM_BOT_TOKEN
const APP_URL = process.env.APP_URL || 'https://personalhome-3ee06.web.app'
if (!TOKEN) throw new Error('Falta TELEGRAM_BOT_TOKEN.')

admin.initializeApp({ credential: admin.credential.applicationDefault() })
const db = admin.firestore()
const { FieldValue } = admin.firestore

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

/** Notifications older than this are never sent: linking must not flood the chat with the whole history. */
const MAX_AGE_DAYS = 7

/**
 * Forward what has not been sent yet. Every notification carries a Telegram status: no `telegramStatus` = pending,
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
  console.log(`Fecha: ${new Date().toString()}  (${APPLY ? 'ACTÚA' : 'simulación'})`)
  console.log(`Bot del token: @${(await tg('getMe', {})).username}`)
  await sendPending()
  if (!APPLY) console.log('\nSimulación: no se envió nada. Agrega --apply.')
}

main().catch((e) => { console.error(e); process.exit(1) })
