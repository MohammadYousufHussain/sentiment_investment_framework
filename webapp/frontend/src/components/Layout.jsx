import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'

const navItems = [
  { to: '/search', label: 'Search', icon: SearchIcon },
  { to: '/companies', label: 'Companies', icon: BuildingIcon },
  { to: '/browse', label: 'Browse', icon: DatabaseIcon },
]

function SearchIcon(props) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <circle cx="9" cy="9" r="6.5" />
      <path d="M14 14L18 18" strokeLinecap="round" />
    </svg>
  )
}

function BuildingIcon(props) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <rect x="4" y="2.5" width="9" height="15" rx="0.5" />
      <path d="M7 6h3M7 9h3M7 12h3" strokeLinecap="round" />
      <path d="M13 8h3v9h-9" />
    </svg>
  )
}

function DatabaseIcon(props) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <ellipse cx="10" cy="5" rx="6.5" ry="2.5" />
      <path d="M3.5 5V15C3.5 16.38 6.41 17.5 10 17.5C13.59 17.5 16.5 16.38 16.5 15V5" strokeLinecap="round" />
      <path d="M3.5 10C3.5 11.38 6.41 12.5 10 12.5C13.59 12.5 16.5 11.38 16.5 10" strokeLinecap="round" />
    </svg>
  )
}

function MenuIcon(props) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M3 5.5h14M3 10h14M3 14.5h14" strokeLinecap="round" />
    </svg>
  )
}

function Wordmark() {
  return (
    <div className="flex items-center gap-2">
      <div className="w-2 h-2 rounded-full bg-series-1 shadow-[0_0_8px_var(--color-series-1)]" />
      <span className="font-semibold tracking-tight text-[15px]">Sentix</span>
    </div>
  )
}

function SidebarContent() {
  return (
    <>
      <div className="px-5 py-5 border-b border-hairline">
        <Wordmark />
        <p className="text-[11px] text-ink-muted mt-1 tracking-wide uppercase">Investment Research</p>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] font-medium transition-colors ${
                isActive
                  ? 'bg-panel text-ink'
                  : 'text-ink-secondary hover:text-ink hover:bg-panel/60'
              }`
            }
          >
            <Icon className="w-4 h-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="px-5 py-4 border-t border-hairline">
        <p className="text-[11px] text-ink-muted leading-relaxed">
          Stage A discovery → NER
          <br />
          Stage B deep ingestion
        </p>
      </div>
    </>
  )
}

function UserMenu() {
  const { user, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  if (!user) return null

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-panel transition-colors"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="w-6 h-6 rounded-full bg-series-1/20 border border-series-1/40 text-series-1 text-[11px] font-semibold flex items-center justify-center uppercase">
          {user.name?.[0] ?? user.email[0]}
        </span>
        <span className="hidden sm:block text-[13px] font-medium text-ink-secondary max-w-[140px] truncate">
          {user.name}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-56 rounded-lg border border-hairline bg-surface shadow-xl z-50 py-1.5">
          <div className="px-3.5 py-2 border-b border-hairline">
            <p className="text-[13px] font-medium text-ink truncate">{user.name}</p>
            <p className="text-[11px] text-ink-muted truncate">{user.email}</p>
          </div>
          <button
            onClick={logout}
            className="w-full text-left px-3.5 py-2 text-[13px] text-ink-secondary hover:text-ink hover:bg-panel transition-colors"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

export default function Layout({ children }) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()

  // Close the mobile drawer on navigation and on Escape.
  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e) => e.key === 'Escape' && setDrawerOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  return (
    <div className="min-h-screen flex flex-col bg-page text-ink">
      <header className="sticky top-0 z-30 h-14 shrink-0 border-b border-hairline bg-page/90 backdrop-blur flex items-center justify-between px-3 sm:px-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDrawerOpen(true)}
            className="md:hidden p-2 -ml-1 rounded-md text-ink-secondary hover:text-ink hover:bg-panel transition-colors"
            aria-label="Open navigation"
          >
            <MenuIcon className="w-5 h-5" />
          </button>
          <div className="md:hidden">
            <Wordmark />
          </div>
        </div>
        <UserMenu />
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Desktop sidebar */}
        <aside className="hidden md:flex w-56 shrink-0 border-r border-hairline flex-col">
          <SidebarContent />
        </aside>

        {/* Mobile drawer */}
        {drawerOpen && (
          <div className="md:hidden fixed inset-0 z-40">
            <div
              className="absolute inset-0 bg-black/60"
              onClick={() => setDrawerOpen(false)}
              aria-hidden="true"
            />
            <aside className="absolute inset-y-0 left-0 w-64 max-w-[80vw] bg-page border-r border-hairline flex flex-col shadow-2xl">
              <SidebarContent />
            </aside>
          </div>
        )}

        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  )
}
