import { Navigate, NavLink, Outlet, useLocation } from 'react-router'
import { Calendar, Settings, User } from '../../components/icons'
import { Avatar, Skeleton } from '../../components/ui'
import { useAuth } from '../../lib/auth'

const tabs = [
  { to: '/account', label: 'Bookings', Icon: Calendar, end: true },
  { to: '/account/profile', label: 'Profile', Icon: User, end: false },
  { to: '/account/settings', label: 'Settings', Icon: Settings, end: false },
]

// Gate for the account pages: signed in, and the profile step done.
export function AccountLayout() {
  const { session, profile } = useAuth()
  const { pathname } = useLocation()

  if (session === null) return <Navigate to={`/signin?next=${encodeURIComponent(pathname)}`} replace />
  if (session === undefined || profile === undefined) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <Skeleton className="h-16" />
        <Skeleton className="mt-6 h-64" />
      </div>
    )
  }
  if (profile === null) return <Navigate to={`/welcome?next=${encodeURIComponent(pathname)}`} replace />

  return (
    <div className="mx-auto max-w-3xl px-4 pt-8 pb-20 sm:px-6 sm:pt-12">
      <div className="flex items-center gap-4">
        <Avatar name={profile.full_name} url={profile.avatar_url} size={56} />
        <div className="min-w-0">
          <p className="text-[14px] text-ink-2">Signed in as</p>
          <h1 className="truncate text-[24px] font-semibold tracking-tight">{profile.full_name}</h1>
        </div>
      </div>

      <nav aria-label="Account" className="glass mt-8 flex rounded-full p-1">
        {tabs.map(({ to, label, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              'flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full text-[14px] font-medium transition ' +
              (isActive ? 'bg-accent text-on-accent' : 'text-ink-2 hover:text-ink')
            }
          >
            <Icon size={16} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-8">
        <Outlet />
      </div>
    </div>
  )
}
