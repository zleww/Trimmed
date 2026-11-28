import { NavLink, useLocation } from 'react-router'
import { useAuth } from '../lib/auth'
import { Calendar, Home, Scissors, User } from './icons'

// pages with their own bottom bar or a form to finish: no tab bar there
const HIDDEN = ['/book', '/signin', '/signup', '/welcome', '/new-password']

/** Phones only: an app-style bar at the bottom so Book is always one tap away. */
export function useTabBar(): boolean {
  const { pathname } = useLocation()
  const { staffRole } = useAuth()
  return !staffRole && !HIDDEN.some((path) => pathname.startsWith(path))
}

export function TabBar() {
  const { session } = useAuth()
  // signed out: the account tabs go to sign in first, then come back
  const account = (to: string) => (session ? to : `/signin?next=${encodeURIComponent(to)}`)

  const tab = ({ isActive }: { isActive: boolean }) =>
    `flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl text-[11px] font-medium transition-colors ${
      isActive ? 'text-ink' : 'text-ink-3 hover:text-ink-2'
    }`

  return (
    <nav
      aria-label="Quick menu"
      className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 flex items-center gap-1 rounded-3xl border border-glass-line bg-bg/85 p-1.5 shadow-2xl backdrop-blur-xl md:hidden"
    >
      <NavLink to="/" end className={tab}>
        <Home size={20} />
        Home
      </NavLink>
      {/* the one main action: book */}
      <NavLink
        to="/book"
        className="flex min-h-12 flex-[1.3] flex-col items-center justify-center gap-0.5 rounded-2xl bg-accent text-[11px] font-semibold text-on-accent shadow-lg"
      >
        <Scissors size={20} />
        Book
      </NavLink>
      <NavLink to={account('/account')} end className={tab}>
        <Calendar size={20} />
        Bookings
      </NavLink>
      <NavLink to={account('/account/profile')} className={tab}>
        <User size={20} />
        Profile
      </NavLink>
    </nav>
  )
}
