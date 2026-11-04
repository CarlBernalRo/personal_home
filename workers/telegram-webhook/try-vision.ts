/**
 * Tries the screenshot reader on a local image, calling Cloudflare Workers AI through its REST API with the session that
 * `wrangler login` left on this computer (no key to paste). It prints what the model read, after validation.
 *
 *   cd apps\web
 *   npx vite-node ..\..\workers\telegram-webhook\try-vision.ts "C:\ruta\captura.png"
 *
 * Optional: $env:VISION_MODEL = "@cf/mistralai/mistral-small-3.1-24b-instruct" to try another model.
 */
import { existsSync, readFileSync } from 'fs'
import { extname, join } from 'path'
import os from 'os'
import { DEFAULT_VISION_MODEL, extractFromImage, type AiRunner } from './src/vision'

const configs = [
  join(process.env.APPDATA ?? '', 'xdg.config', '.wrangler', 'config', 'default.toml'),
  join(os.homedir(), '.wrangler', 'config', 'default.toml'),
  join(os.homedir(), '.config', '.wrangler', 'config', 'default.toml'),
]
const cfg = configs.find((p) => existsSync(p))
const token = cfg ? readFileSync(cfg, 'utf8').match(/oauth_token\s*=\s*"([^"]+)"/)?.[1] : undefined
if (!token) throw new Error('No hay sesión de wrangler: ejecuta "npx wrangler login" y vuelve a intentar.')

// the account is read from wrangler itself (`wrangler whoami` prints it); override with CLOUDFLARE_ACCOUNT_ID
const account = process.env.CLOUDFLARE_ACCOUNT_ID
async function accountId() {
  if (account) return account
  const res = await fetch('https://api.cloudflare.com/client/v4/accounts', { headers: { Authorization: `Bearer ${token}` } })
  const data: any = await res.json()
  const id = data?.result?.[0]?.id
  if (!id) throw new Error('No pude saber tu cuenta de Cloudflare: define CLOUDFLARE_ACCOUNT_ID.')
  return id as string
}

const ai: AiRunner = {
  async run(model, input) {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${await accountId()}/ai/run/${model}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    })
    const data: any = await res.json().catch(() => ({}))
    if (!res.ok || data.success === false) throw new Error(`Workers AI ${res.status}: ${JSON.stringify(data?.errors ?? data).slice(0, 300)}`)
    return data.result
  },
}

const file = process.argv[2]
if (!file) throw new Error('Uso: la ruta de una imagen como argumento.')
const mime = { '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }[extname(file).toLowerCase()] ?? 'image/jpeg'
const today = new Date().toISOString().slice(0, 10)
console.log(`Modelo: ${process.env.VISION_MODEL || DEFAULT_VISION_MODEL}`)
const started = Date.now()
const out = await extractFromImage({ AI: ai, VISION_MODEL: process.env.VISION_MODEL }, { bytes: new Uint8Array(readFileSync(file)), mime }, today)
console.log(`(${Date.now() - started} ms)`)
console.log(out)
