import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { isDemo } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Avatar, buttonClass } from './ui'

export function Logo() {
  return (
    <Link to="/" className="flex min-h-11 items-center gap-2.5 rounded-full" aria-label="Trimmed, home">
      <span className="flex size-9 items-center justify-center rounded-xl bg-accent text-on-accent">
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 6h14M12 6v13" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
        </svg>
      </span>
      <span className="text-[17px] font-semibold tracking-tight">Trimmed</span>
    </Link>
  )
}

// worked out once when the page loads
const YEAR = new Date().getFullYear()

const navItems = [
  { to: '/#services', label: 'Services' },
  { to: '/#barbers', label: 'Barbers' },
  { to: '/#visit', label: 'Hours' },
]

export function SiteLayout() {
  const { session, profile } = useAuth()
  const { pathname } = useLocation()
  const onBooking = pathname.startsWith('/book')

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:bg-accent focus:px-4 focus:py-2 focus:text-on-accent">
        Skip to content
      </a>
      {isDemo && (
        <p className="bg-warn-bg py-1.5 text-center text-[13px] text-warn">Sample data: no database connected (development only)</p>
      )}

      <header className="sticky top-0 z-30 border-b border-glass-line bg-bg/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo />

          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {navItems.map((item) => (
              <Link key={item.to} to={item.to} className="rounded-full px-4 py-2 text-[15px] text-ink-2 transition hover:text-ink">
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            {!onBooking && (
              <Link to="/book" className={buttonClass('secondary', 'min-h-10 px-4 text-[14px]')}>
                Book
              </Link>
            )}
            {session ? (
              <NavLink
                to="/account"
                aria-label="My account"
                className="flex size-11 items-center justify-center rounded-full transition hover:bg-[var(--glass)]"
              >
                <Avatar name={profile?.full_name ?? session.email} url={profile?.avatar_url} size={34} />
              </NavLink>
            ) : (
              <Link to="/signin" className={buttonClass('ghost', 'min-h-10 px-4 text-[14px]')}>
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>

      <main id="main" className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-glass-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-[14px] text-ink-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>© {YEAR} Trimmed</p>
          <nav aria-label="Footer" className="-mx-3 flex">
            <Link to="/privacy" className="inline-flex min-h-11 items-center px-3 hover:text-ink">
              Privacy
            </Link>
            <Link to="/book" className="inline-flex min-h-11 items-center px-3 hover:text-ink">
              Book
            </Link>
            <Link to={session ? '/account' : '/signin'} className="inline-flex min-h-11 items-center px-3 hover:text-ink">
              {session ? 'My account' : 'Sign in'}
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
