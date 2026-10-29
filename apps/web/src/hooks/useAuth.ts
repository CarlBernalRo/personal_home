import { useEffect } from 'react'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { collection, query, where, getDocs, doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '@/lib/firebase'
import { getUserProfile } from '@/lib/firestore'
import { useAuthStore } from '@/store/auth'

export function useAuthListener() {
  const { setUser, setProfile, setLoading, setAuthError } = useAuthStore()

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      // User signed out — resolve loading immediately
      if (!firebaseUser) {
        setUser(null)
        setProfile(null)
        setLoading(false)
        return
      }

      // Whitelist check before accepting the session
      try {
        const snap = await getDocs(query(
          collection(db, 'allowedUsers'),
          where('email',  '==', firebaseUser.email),
          where('active', '==', true),
        ))

        if (snap.empty) {
          // Not authorized — store error, sign out, let the null event resolve loading
          setAuthError('Este correo no tiene acceso a la aplicación.')
          setUser(null)
          await signOut(auth)
          return
        }

        // Create profile on first login
        const userRef = doc(db, 'users', firebaseUser.uid)
        const userSnap = await getDoc(userRef)
        if (!userSnap.exists()) {
          const allowedData = snap.docs[0].data()
          await setDoc(userRef, {
            uid:         firebaseUser.uid,
            email:       firebaseUser.email,
            displayName: allowedData.name ?? firebaseUser.displayName,
            photoURL:    firebaseUser.photoURL,
            householdId: null,
            createdAt:   serverTimestamp(),
          })
        }

        setUser(firebaseUser)
        const profile = await getUserProfile(firebaseUser.uid)
        setProfile(profile)
        setLoading(false)
      } catch {
        setUser(null)
        setProfile(null)
        setLoading(false)
      }
    })
    return unsub
  }, [setUser, setProfile, setLoading, setAuthError])
}

export function useAuth() {
  return useAuthStore()
}
