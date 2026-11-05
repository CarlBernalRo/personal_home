import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  signInWithEmailAndPassword,
} from 'firebase/auth'
import { auth } from './firebase'

const provider = new GoogleAuthProvider()

/** Firebase Auth needs an email; the admin's "username" maps onto this domain. */
export const ADMIN_EMAIL_DOMAIN = 'gastoshogar.local'

export async function signInWithGoogle() {
  return await signInWithPopup(auth, provider)
}

export function usernameToEmail(username: string) {
  const u = username.trim().toLowerCase()
  return u.includes('@') ? u : `${u}@${ADMIN_EMAIL_DOMAIN}`
}

export async function signInAdmin(username: string, pass: string) {
  return await signInWithEmailAndPassword(auth, usernameToEmail(username), pass)
}

export async function logout() {
  // the saved last activity belongs to the session that ends: a later login starts a new hour
  try { Object.keys(localStorage).filter((k) => k.startsWith('last-activity-')).forEach((k) => localStorage.removeItem(k)) } catch { /* private mode */ }
  await signOut(auth)
}
