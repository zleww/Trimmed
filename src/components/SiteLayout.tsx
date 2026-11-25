import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { isDemo } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Avatar, buttonClass } from './ui'

/**
 * The mark: a serif T on indigo black, an amber hairline frame and a small
 * amber diamond, like a razor maker's stamp. Same drawing as public/favicon.svg.
 * Fixed colors on purpose, so it looks the same in both themes.
 */
export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="shrink-0">
      <rect width="64" height="64" rx="15" fill="#0b0a14" />
      <rect x=".75" y=".75" width="62.5" height="62.5" rx="14.25" fill="none" stroke="#d6a54e" strokeOpacity=".5" strokeWidth="1.5" />
      <path
        fill="#ece5d6"
        d="M17 14h30v9.5h-1.2c-.6-3.1-2.2-4.5-5.2-4.5h-5.7v22.2c0 1.4.7 2 2.3 2.3l1.8.3V46H25v-2.2l1.8-.3c1.6-.3 2.3-.9 2.3-2.3V19h-5.7c-3 0-4.6 1.4-5.2 4.5H17z"
      />
      <path fill="#d6a54e" d="m32 49.5 2.5 2.5-2.5 2.5-2.5-2.5z" />
    </svg>
  )
}

export function Logo() {
  return (
    <Link to="/" className="flex min-h-11 items-center gap-2.5 rounded-full" aria-label="Trimmed, home">
      <LogoMark size={36} />
      <span className="font-display text-[21px] font-medium tracking-[-0.01em]">Trimmed</span>
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
  const { session, profile, staffRole } = useAuth()
  const { pathname } = useLocation()
  const onBooking = pathname.startsWith('/book')

  return (
    // overflow-x-clip: a safety net so one wide element can never make the whole page slide sideways on a phone
    <div className="flex min-h-dvh flex-col overflow-x-clip">
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
            {(staffRole === 'owner' || staffRole === 'desk') && (
              <NavLink
                to="/shop"
                className={({ isActive }) => buttonClass(isActive ? 'secondary' : 'ghost', 'min-h-10 px-4 text-[14px]')}
              >
                Shop
              </NavLink>
            )}
            {!onBooking && !staffRole && (
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

      {/* on the booking page a bar is fixed to the bottom of the phone screen: leave room so it never covers the footer links */}
      <footer className={`border-t border-glass-line ${onBooking ? 'pb-24 lg:pb-0' : ''}`}>
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
