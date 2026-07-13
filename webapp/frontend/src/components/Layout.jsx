import { NavLink } from 'react-router-dom'

const navItems = [
  { to: '/', label: 'Search', icon: SearchIcon },
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

export default function Layout({ children }) {
  return (
    <div className="min-h-screen flex bg-page text-ink">
      <aside className="w-56 shrink-0 border-r border-hairline flex flex-col">
        <div className="px-5 py-5 border-b border-hairline">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-series-1 shadow-[0_0_8px_var(--color-series-1)]" />
            <span className="font-semibold tracking-tight text-[15px]">Sentinel</span>
          </div>
          <p className="text-[11px] text-ink-muted mt-1 tracking-wide uppercase">News Ingestion Console</p>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
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
      </aside>

      <main className="flex-1 min-w-0">{children}</main>
    </div>
  )
}
