import { createContext, useContext, useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { authLogin, authLogout, authSignup, getCurrentUser } from './api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  // Resolved after the initial /api/auth/me check -- RequireAuth must not
  // redirect to /login before we know whether a session cookie exists.
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getCurrentUser()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false))

    // Fired by lib/api.js when any data endpoint returns 401 (expired or
    // deleted session) -- clearing user here makes RequireAuth redirect.
    const onUnauthorized = () => setUser(null)
    window.addEventListener('auth:unauthorized', onUnauthorized)
    return () => window.removeEventListener('auth:unauthorized', onUnauthorized)
  }, [])

  const value = {
    user,
    loading,
    async login(credentials) {
      const u = await authLogin(credentials)
      setUser(u)
      return u
    },
    async signup(details) {
      const u = await authSignup(details)
      setUser(u)
      return u
    },
    async logout() {
      await authLogout()
      setUser(null)
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}

export function RequireAuth({ children }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-page">
        <span className="text-sm text-ink-muted">Loading…</span>
      </div>
    )
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />
  }
  return children
}
