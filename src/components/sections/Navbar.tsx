import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { Link, NavLink, useLocation } from 'react-router'
import { useAuth } from '../../lib/auth'
import { gsap, MOTION, ScrollTrigger, useGSAP } from '../../lib/gsap'
import { scrollToSection, useLenis } from '../../lib/smooth'
import { Menu, X } from '../icons'
import { Logo } from '../Logo'
import { Avatar, buttonClass } from '../ui'

// the landing page sections, in page order
export const SECTIONS = [
  { id: 'top', label: 'Home' },
  { id: 'about', label: 'About' },
  { id: 'products', label: 'Products' },
  { id: 'services', label: 'Services' },
  { id: 'contact', label: 'Contact' },
] as const

/**
 * Fixed header. At the top of the page it's see-through; after 50px of scroll
 * it pulls in to a frosted-glass pill. On phones the links move into a full-screen menu.
 */
export function Navbar() {
  const { session, profile, staffRole } = useAuth()
  const { pathname } = useLocation()
  const lenis = useLenis()
  const onHome = pathname === '/'
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const menu = useRef<HTMLDivElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)

  // glass pill after 50px (ScrollTrigger keeps it in step with Lenis)
  useGSAP(() => {
    const trigger = ScrollTrigger.create({ start: 50, end: 'max', onToggle: (self) => setScrolled(self.isActive) })
    setScrolled(trigger.isActive)
  }, [pathname])

  // full-screen menu: links rise in one after another
  useGSAP(
    () => {
      if (!open || !menu.current) return
      const mm = gsap.matchMedia()
      mm.add(MOTION.ok, () => {
        gsap.from(menu.current, { autoAlpha: 0, duration: 0.4, ease: 'power2.out' })
        gsap.from('[data-menu-item]', { yPercent: 110, autoAlpha: 0, duration: 0.9, stagger: 0.06, delay: 0.08 })
      })
      return () => mm.revert()
    },
    { dependencies: [open], scope: menu },
  )

  // while the menu is open: no page scroll, Esc closes it, focus starts inside
  useEffect(() => {
    if (!open) return
    const button = toggle.current
    document.documentElement.classList.add('menu-open')
    lenis?.stop()
    menu.current?.querySelector<HTMLElement>('a, button')?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.documentElement.classList.remove('menu-open')
      lenis?.start()
      window.removeEventListener('keydown', onKey)
      button?.focus()
    }
  }, [open, lenis])

  // on the landing page the links glide to the section; elsewhere they go home first
  const goTo = (event: MouseEvent, id: string) => {
    setOpen(false)
    if (!onHome) return
    event.preventDefault()
    // wait for the menu to close (it locks the page) before gliding
    window.setTimeout(() => scrollToSection(lenis, id), 60)
  }

  const hrefFor = (id: string) => (id === 'top' ? '/' : `/#${id}`)
  const pill = scrolled || !onHome

  return (
    <header className="fixed inset-x-0 top-0 z-40 px-3 pt-[max(env(safe-area-inset-top),0.5rem)] sm:px-5">
      <div
        className={`mx-auto flex h-14 items-center justify-between gap-2 rounded-full pr-2 pl-3 transition-[max-width,background-color,border-color,box-shadow] duration-500 ease-out sm:h-16 sm:pl-4 ${
          pill ? 'glass max-w-5xl' : 'max-w-7xl border border-transparent'
        }`}
      >
        <Logo />

        <nav aria-label="Main" className="hidden items-center lg:flex">
          {SECTIONS.map((s) => (
            <Link
              key={s.id}
              to={hrefFor(s.id)}
              onClick={(e) => goTo(e, s.id)}
              className="rounded-full px-3.5 py-2 text-[14px] text-ink-2 transition-colors hover:text-ink xl:px-4"
            >
              {s.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-1.5">
          {(staffRole === 'owner' || staffRole === 'desk') && (
            <NavLink to="/shop" className={({ isActive }) => buttonClass(isActive ? 'secondary' : 'ghost', 'hidden min-h-10 px-4 text-[14px] sm:inline-flex')}>
              Shop
            </NavLink>
          )}
          {session ? (
            <NavLink to="/account" aria-label="My account" className="flex size-11 items-center justify-center rounded-full transition hover:bg-[var(--glass)]">
              <Avatar name={profile?.full_name ?? session.email} url={profile?.avatar_url} size={34} />
            </NavLink>
          ) : (
            <Link to="/signin" className={buttonClass('secondary', 'min-h-10 px-4 text-[14px]')}>
              Sign in
            </Link>
          )}
          <button
            ref={toggle}
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="site-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            className="flex size-11 cursor-pointer items-center justify-center rounded-full text-ink transition hover:bg-[var(--glass)] lg:hidden"
          >
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {open && (
        <div
          ref={menu}
          id="site-menu"
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          className="fixed inset-0 z-50 flex flex-col bg-bg/95 px-6 pt-[max(env(safe-area-inset-top),1.25rem)] pb-[max(env(safe-area-inset-bottom),1.5rem)] backdrop-blur-xl lg:hidden"
        >
          <div className="flex h-12 items-center justify-between">
            <span className="label">Menu</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="flex size-11 cursor-pointer items-center justify-center rounded-full text-ink hover:bg-[var(--glass)]"
            >
              <X size={22} />
            </button>
          </div>
          <nav aria-label="Menu" className="mt-8 flex flex-1 flex-col">
            {SECTIONS.map((s, i) => (
              <div key={s.id} className="overflow-hidden border-b border-glass-line">
                <Link
                  data-menu-item
                  to={hrefFor(s.id)}
                  onClick={(e) => goTo(e, s.id)}
                  className="flex min-h-16 items-baseline gap-4 py-3 font-display text-[34px] leading-none text-ink"
                >
                  <span className="num w-6 font-sans text-[12px] text-ink-3">0{i + 1}</span>
                  {s.label}
                </Link>
              </div>
            ))}
          </nav>
          <div className="overflow-hidden">
            <Link data-menu-item to="/book" onClick={() => setOpen(false)} className={buttonClass('primary', 'h-13 w-full text-[16px]')}>
              Book an appointment
            </Link>
          </div>
        </div>
      )}
    </header>
  )
}
