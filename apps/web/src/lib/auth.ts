import { GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth'
import { auth } from './firebase'

const provider = new GoogleAuthProvider()

export async function signInWithGoogle() {
  await signInWithPopup(auth, provider)
  // Whitelist check and profile creation happen in useAuthListener
}

export async function logout() {
  await signOut(auth)
}
