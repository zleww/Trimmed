import { useEffect } from 'react'
import { useLocation } from 'react-router'

// New page: start at the top. A link like /#barbers scrolls to that section instead.
export function ScrollToTop() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (hash) {
      // wait a frame so the section exists after navigation
      requestAnimationFrame(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
      return
    }
    window.scrollTo(0, 0)
  }, [pathname, hash])
  return null
}
