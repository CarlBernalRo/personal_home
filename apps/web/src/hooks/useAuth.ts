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

      try {
        const userRef = doc(db, 'users', firebaseUser.uid)
        const userSnap = await getDoc(userRef)
        const existingProfile = userSnap.exists() ? userSnap.data() : null

        // Whitelist check in allowedUsers (the only source of truth for access and role)
        const snap = await getDocs(query(
          collection(db, 'allowedUsers'),
          where('email', '==', firebaseUser.email?.toLowerCase()),
        ))

        const allowedData = !snap.empty ? snap.docs[0].data() : null
        const hasAccess = !!allowedData && allowedData.active === true && allowedData.deleted !== true

        if (!hasAccess) {
          setAuthError(
            allowedData
              ? 'Tu acceso está desactivado. Contacta al administrador.'
              : 'Este usuario no tiene acceso autorizado a la aplicación. Contacta al administrador.',
          )
          setUser(null)
          await signOut(auth)
          return
        }

        // Create or sync profile
        if (!userSnap.exists()) {
          await setDoc(userRef, {
            uid:         firebaseUser.uid,
            email:       firebaseUser.email?.toLowerCase(),
            displayName: allowedData.name ?? firebaseUser.displayName ?? 'Usuario',
            photoURL:    firebaseUser.photoURL,
            role:        allowedData.role ?? 'integrante',
            householdId: null,
            createdAt:   serverTimestamp(),
          })
        } else if (allowedData.role && allowedData.role !== existingProfile?.role) {
          // Sync role changes
          await setDoc(userRef, { role: allowedData.role }, { merge: true })
        }

        setUser(firebaseUser)
        const profile = await getUserProfile(firebaseUser.uid)
        setProfile(profile)
        setLoading(false)
      } catch (err: unknown) {
        setUser(null)
        setProfile(null)
        setLoading(false)
      }
    })
    return unsub
  }, [setUser, setProfile, setLoading, setAuthError])
}

export function useAuth() {
  const store = useAuthStore()
  const isAdmin = store.profile?.role === 'admin'
  return { ...store, isAdmin: Boolean(isAdmin) }
}
