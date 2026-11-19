import type { ReactNode } from 'react'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api } from './api'
import { applyTheme } from './theme'
import type { Profile, Session } from './types'

type AuthValue = {
  /** undefined while checking the saved session, null when signed out */
  session: Session | null | undefined
  /** undefined while loading, null when the account has no profile yet */
  profile: Profile | null | undefined
  setProfile: (profile: Profile) => void
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<{ needsConfirm: boolean }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

// Holds "who is signed in" and their profile, so any screen can ask.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [profile, setProfileState] = useState<Profile | null | undefined>(undefined)

  useEffect(() => {
    api
      .getSession()
      .then(setSession)
      .catch(() => setSession(null))
    // sign in, sign out, or the email link opening the app
    return api.onSessionChange(setSession)
  }, [])

  const userId = session?.userId
  useEffect(() => {
    if (session === undefined) return
    if (!userId) {
      setProfileState(null)
      return
    }
    let current = true
    setProfileState(undefined)
    api
      .myProfile()
      .then((loaded) => {
        if (!current) return
        setProfileState(loaded)
        if (loaded) applyTheme(loaded.theme)
      })
      .catch(() => current && setProfileState(null))
    return () => {
      current = false
    }
    // only reload when the person changes, not on every token refresh
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, session === undefined])

  const setProfile = useCallback((next: Profile) => {
    setProfileState(next)
    applyTheme(next.theme)
  }, [])

  const value = useMemo<AuthValue>(
    () => ({
      session,
      profile,
      setProfile,
      signIn: async (email, password) => setSession(await api.signIn(email, password)),
      signUp: (email, password) => api.signUp(email, password),
      signOut: async () => {
        await api.signOut()
        setSession(null)
      },
    }),
    [session, profile, setProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
