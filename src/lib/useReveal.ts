import type { RefObject } from 'react'
import { gsap, MOTION, ScrollTrigger, useGSAP } from './gsap'

/**
 * The default entrance for a section: anything marked data-reveal fades up 40px
 * when it reaches 80% down the screen, once. Items that arrive together are staggered.
 * `deps` re-runs it when new items appear (for example when the services finish loading).
 */
export function useReveal(scope: RefObject<HTMLElement | null>, deps: unknown[] = []) {
  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add(MOTION.ok, () => {
        const items = gsap.utils.toArray<HTMLElement>('[data-reveal]')
        if (items.length === 0) return
        gsap.set(items, { opacity: 0, y: 40 })
        ScrollTrigger.batch(items, {
          start: 'top 80%',
          once: true,
          onEnter: (batch) => gsap.to(batch, { opacity: 1, y: 0, duration: 0.9, stagger: 0.08, overwrite: true }),
        })
      })
      return () => mm.revert()
    },
    { scope, dependencies: deps, revertOnUpdate: true },
  )
}
