import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'

const inputClass =
  'w-full rounded-md border border-hairline bg-surface px-3 py-2.5 text-[14px] text-ink placeholder:text-ink-muted focus:outline-none focus:border-series-1 transition-colors'

export default function LoginPage() {
  const { user, loading, login, signup } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  // 'login' | 'signup'; landing's "Get started" links pass state.mode='signup'
  const [mode, setMode] = useState(location.state?.mode === 'signup' ? 'signup' : 'login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const from = location.state?.from ?? '/search'

  if (!loading && user) {
    return <Navigate to={from} replace />
  }

  async function onSubmit(e) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      if (mode === 'signup') {
        await signup({ name, email, password })
      } else {
        await login({ email, password })
      }
      navigate(from, { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  function switchMode(next) {
    setMode(next)
    setError(null)
  }

  return (
    <div className="min-h-screen bg-page text-ink flex flex-col">
      <header className="px-4 sm:px-8 py-5">
        <Link to="/" className="inline-flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-series-1 shadow-[0_0_8px_var(--color-series-1)]" />
          <span className="font-semibold tracking-tight text-[15px]">Sentix</span>
        </Link>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-sm">
          <h1 className="text-xl font-semibold tracking-tight">
            {mode === 'login' ? 'Sign in to Sentix' : 'Create your Sentix account'}
          </h1>
          <p className="text-[13px] text-ink-muted mt-1 mb-6">
            {mode === 'login'
              ? 'Welcome back — enter your details.'
              : 'Free while in early access. No card required.'}
          </p>

          <form onSubmit={onSubmit} className="space-y-4">
            {mode === 'signup' && (
              <label className="block">
                <span className="block text-[12px] font-medium text-ink-secondary mb-1.5">Name</span>
                <input
                  type="text"
                  required
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className={inputClass}
                />
              </label>
            )}

            <label className="block">
              <span className="block text-[12px] font-medium text-ink-secondary mb-1.5">Email</span>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className={inputClass}
              />
            </label>

            <label className="block">
              <span className="block text-[12px] font-medium text-ink-secondary mb-1.5">Password</span>
              <input
                type="password"
                required
                minLength={8}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
                className={inputClass}
              />
            </label>

            {error && (
              <p className="text-[12px] text-critical border border-critical/40 bg-critical/10 rounded-md px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-series-1 text-white text-[14px] font-medium py-2.5 hover:brightness-110 disabled:opacity-60 transition"
            >
              {submitting ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <p className="text-[13px] text-ink-muted mt-6 text-center">
            {mode === 'login' ? (
              <>
                New to Sentix?{' '}
                <button onClick={() => switchMode('signup')} className="text-series-1 hover:underline">
                  Create an account
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button onClick={() => switchMode('login')} className="text-series-1 hover:underline">
                  Sign in
                </button>
              </>
            )}
          </p>
        </div>
      </main>
    </div>
  )
}
