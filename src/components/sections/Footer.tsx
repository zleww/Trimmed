import type { MouseEvent } from 'react'
import { Link, useLocation } from 'react-router'
import { useAuth } from '../../lib/auth'
import { scrollToSection, useLenis } from '../../lib/smooth'
import { Logo } from '../Logo'
import { SECTIONS } from './Navbar'

// worked out once when the page loads
const YEAR = new Date().getFullYear()

const linkClass = 'inline-flex min-h-11 items-center text-[15px] text-ink-2 transition-colors hover:text-ink'

export function Footer({ roomForBar = false }: { roomForBar?: boolean }) {
  const { session } = useAuth()
  const { pathname } = useLocation()
  const lenis = useLenis()

  const goTo = (event: MouseEvent, id: string) => {
    if (pathname !== '/') return
    event.preventDefault()
    scrollToSection(lenis, id)
  }

  return (
    // on the booking page a bar is fixed to the bottom of the phone screen: leave room so it never covers the links
    <footer className={`relative overflow-hidden border-t border-glass-line ${roomForBar ? 'pb-24 lg:pb-0' : ''}`}>
      <div className="mx-auto max-w-6xl px-4 pt-14 pb-8 sm:px-6">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-[1.4fr_1fr_1fr]">
          <div className="col-span-2 max-w-xs sm:col-span-1">
            <Logo />
            <p className="mt-4 text-[15px] leading-relaxed text-ink-2">
              Book a barber in a few taps. Fixed prices, real free times, and you pay at the shop.
            </p>
          </div>
          <nav aria-label="Explore">
            <p className="label">Explore</p>
            <ul className="mt-3">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <Link to={s.id === 'top' ? '/' : `/#${s.id}`} onClick={(e) => goTo(e, s.id)} className={linkClass}>
                    {s.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <nav aria-label="Account">
            <p className="label">Your visit</p>
            <ul className="mt-3">
              <li>
                <Link to="/book" className={linkClass}>
                  Book an appointment
                </Link>
              </li>
              <li>
                <Link to={session ? '/account' : '/signin'} className={linkClass}>
                  {session ? 'My account' : 'Sign in'}
                </Link>
              </li>
              <li>
                <Link to="/privacy" className={linkClass}>
                  Privacy
                </Link>
              </li>
            </ul>
          </nav>
        </div>

        <div className="hairline mt-12" />
        <p className="mt-6 text-[13px] text-ink-3">© {YEAR} Trimmed</p>
      </div>

      {/* the name, huge and outlined, sitting in the floor of the page */}
      <p aria-hidden="true" className="ghost-word -mb-[0.22em] text-center font-display text-[26vw] leading-[0.8] font-medium tracking-[-0.04em] whitespace-nowrap">
        Trimmed
      </p>
    </footer>
  )
}
