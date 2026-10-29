/**
 * One-time seed script — adds allowed users to Firestore.
 * Run once from the repo root:
 *   node scripts/seed.mjs
 *
 * Requires apps/web/.env.local to exist with VITE_FIREBASE_* values.
 * Requires scripts/allowed-users.json (gitignored, see allowed-users.example.json).
 * Temporarily sets Firestore rules to allow writes, OR use Firebase Console.
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load env variables from apps/web/.env.local
const envPath = resolve(__dirname, '../apps/web/.env.local')
const envContent = readFileSync(envPath, 'utf8')
const env = Object.fromEntries(
  envContent.split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => l.split('=').map(s => s.trim()))
)

const firebaseConfig = {
  apiKey:            env.VITE_FIREBASE_API_KEY,
  authDomain:        env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             env.VITE_FIREBASE_APP_ID,
}

// Dynamic import of Firebase SDK
const { initializeApp }    = await import('firebase/app')
const { getFirestore, doc, setDoc } = await import('firebase/firestore')

const app = initializeApp(firebaseConfig)
const db  = getFirestore(app)

// Load allowed users from scripts/allowed-users.json (gitignored)
const usersPath = resolve(__dirname, 'allowed-users.json')
const ALLOWED_USERS = JSON.parse(readFileSync(usersPath, 'utf8'))

console.log('Seeding allowedUsers...')

for (const user of ALLOWED_USERS) {
  const ref = doc(db, 'allowedUsers', user.id)
  await setDoc(ref, { email: user.email, name: user.name, active: user.active })
  console.log(`  ✓ ${user.name} (${user.email})`)
}

console.log('\nDone! Now restore your Firestore rules.')
process.exit(0)
