import { useEffect } from 'react'
import { useLocation } from 'react-router'
import { scrollToSection, useLenis } from '../lib/smooth'

// New page: start at the top. A link like /#services scrolls to that section instead.
export function ScrollToTop() {
  const { pathname, hash } = useLocation()
  const lenis = useLenis()
  useEffect(() => {
    if (hash) {
      // sections fill in as data arrives: wait a moment so we land in the right place
      const timer = window.setTimeout(() => scrollToSection(lenis, hash.slice(1)), 250)
      return () => window.clearTimeout(timer)
    }
    if (lenis) lenis.scrollTo(0, { immediate: true })
    else window.scrollTo(0, 0)
  }, [pathname, hash, lenis])
  return null
}
