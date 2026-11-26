import { useState, type ReactNode } from 'react'
import { Link, Navigate, NavLink, Outlet, useNavigate } from 'react-router'
import { Calendar, Grid, LogOut, Mail } from '../../components/icons'
import { LogoMark } from '../../components/Logo'
import { Skeleton } from '../../components/ui'
import { isDemo } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { initials } from '../../lib/format'

const today = new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'Asia/Manila' })

// The shop app shell: thin icon rail + top bar on big screens, tab bar on phones.
// This only hides screens; the database checks the role on every call.
export function ShopLayout() {
  const { session, profile, staffRole, signOut } = useAuth()
  const navigate = useNavigate()

  if (session === null) return <Navigate to="/signin?next=/shop" replace />
  if (session === undefined || staffRole === undefined) return <Skeleton className="m-6 h-64" />
  if (staffRole !== 'owner' && staffRole !== 'desk') {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="text-[30px]">For the shop only</h1>
        <p className="mt-2 text-ink-2">This page is for the owner and the front desk.</p>
        <Link to="/" className="mt-6 inline-block text-[15px] font-medium underline underline-offset-4">
          Back to home
        </Link>
      </div>
    )
  }

  const links = [
    ...(staffRole === 'owner' ? [{ to: '/shop', label: 'Dashboard', icon: Grid, end: true }] : []),
    { to: '/shop/requests', label: 'Requests', icon: Calendar, end: false },
    { to: '/shop/messages', label: 'Messages', icon: Mail, end: false },
  ]
  const leave = () => void signOut().then(() => navigate('/', { replace: true }))
  const role = staffRole === 'owner' ? 'Owner' : 'Front desk'
  const name = profile?.full_name ?? role

  return (
    <div className="shop-app min-h-dvh">
      {/* icon rail (desktop) */}
      <aside className="fixed inset-y-4 left-4 z-20 hidden w-[72px] flex-col items-center rounded-[28px] border border-line bg-card py-4 lg:flex">
        <Link to="/" aria-label="Trimmed, home" className="mb-8">
          <LogoMark size={40} />
        </Link>
        <nav aria-label="Shop" className="flex flex-col gap-2">
          {links.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              aria-label={label}
              title={label}
              className={({ isActive }) =>
                `grid size-11 place-items-center rounded-2xl border transition-colors ${
                  isActive ? 'border-transparent bg-ink text-bg' : 'border-line text-ink-2 hover:text-ink'
                }`
              }
            >
              <Icon size={20} />
            </NavLink>
          ))}
        </nav>
        <button onClick={leave} aria-label="Sign out" title="Sign out" className="mt-auto grid size-11 place-items-center rounded-2xl border border-line text-ink-2 hover:text-ink">
          <LogOut size={20} />
        </button>
      </aside>

      <div className="px-4 pt-4 pb-28 sm:px-6 lg:ml-[104px] lg:pr-6 lg:pb-8 lg:pl-0">
        {/* top bar */}
        <header className="flex items-center justify-between gap-3">
          <Link to="/" className="lg:hidden" aria-label="Trimmed, home">
            <LogoMark size={34} />
          </Link>
          <TodayLine />
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2.5 rounded-2xl border border-line bg-card py-1.5 pr-4 pl-1.5">
              <span className="grid size-9 place-items-center rounded-xl bg-raised text-[13px] font-medium">{initials(name)}</span>
              <span className="leading-tight">
                <span className="block max-w-[10rem] truncate text-[14px]">{name}</span>
                {name !== role && <span className="block text-[12px] text-ink-3">{role}</span>}
              </span>
            </div>
            <button onClick={leave} aria-label="Sign out" className="grid size-12 place-items-center rounded-2xl border border-line bg-card text-ink-2 lg:hidden">
              <LogOut size={18} />
            </button>
          </div>
        </header>

        <main id="main" className="mt-6">
          {isDemo && <p className="mb-4 rounded-full bg-warn-bg px-4 py-1.5 text-center text-[13px] text-warn">Sample data (development only)</p>}
          <Outlet />
        </main>
      </div>

      {/* tab bar (phone) */}
      <nav aria-label="Shop" className="fixed inset-x-3 bottom-3 z-20 flex rounded-3xl border border-line bg-card p-1.5 lg:hidden">
        {links.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 rounded-2xl py-2 text-[12px] ${isActive ? 'bg-ink text-bg' : 'text-ink-2'}`
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

/** /shop itself: the owner gets the dashboard, the desk goes straight to requests. */
export function ShopHome({ owner }: { owner: ReactNode }) {
  const { staffRole } = useAuth()
  return staffRole === 'owner' ? owner : <Navigate to="/shop/requests" replace />
}

// the date at the top left, worked out once when the screen opens
function TodayLine() {
  const [text] = useState(() => today.format(new Date()))
  return <p className="hidden text-[14px] text-ink-3 lg:block">{text}</p>
}
