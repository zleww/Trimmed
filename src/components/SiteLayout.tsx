import { Outlet, useLocation } from 'react-router'
import { isDemo } from '../lib/api'
import { SmoothScroll } from '../lib/smooth'
import { ScrollToTop } from './ScrollToTop'
import { Footer } from './sections/Footer'
import { Navbar } from './sections/Navbar'

// kept here too so older imports still work
export { Logo, LogoMark } from './Logo'

export function SiteLayout() {
  const { pathname } = useLocation()
  const onHome = pathname === '/'
  const onBooking = pathname.startsWith('/book')

  return (
    <SmoothScroll enabled={onHome}>
      <ScrollToTop />
      {/* overflow-x-clip: a safety net so one wide element can never make the whole page slide sideways on a phone */}
      <div className="flex min-h-dvh flex-col overflow-x-clip">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-full focus:bg-accent focus:px-4 focus:py-2 focus:text-on-accent">
          Skip to content
        </a>
        <Navbar />
        {isDemo && (
          <p className="mt-[4.5rem] bg-warn-bg py-1.5 text-center text-[13px] text-warn sm:mt-20">Sample data: no database connected (development only)</p>
        )}
        {/* the header is fixed: other pages get a spacer, the landing page runs under it */}
        {!onHome && !isDemo && <div aria-hidden="true" className="h-[4.5rem] shrink-0 sm:h-20" />}

        <main id="main" className="flex-1">
          <Outlet />
        </main>

        <Footer roomForBar={onBooking} />
      </div>
    </SmoothScroll>
  )
}
