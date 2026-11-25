import Lenis from 'lenis'
import 'lenis/dist/lenis.css'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { gsap, prefersReducedMotion, ScrollTrigger } from './gsap'

/*
  Smooth scrolling with Lenis, only on the landing page.
  The booking and account pages keep normal scrolling (forms, the photo cropper and the
  fixed booking bar behave better without it). People who ask for less motion never get it.
*/

const LenisContext = createContext<Lenis | null>(null)

export function SmoothScroll({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [lenis, setLenis] = useState<Lenis | null>(null)

  useEffect(() => {
    if (!enabled || prefersReducedMotion()) return
    const instance = new Lenis({ autoRaf: false, lerp: 0.1 })
    // GSAP's clock drives Lenis, and every Lenis scroll tells ScrollTrigger to update
    instance.on('scroll', ScrollTrigger.update)
    const tick = (time: number) => instance.raf(time * 1000)
    gsap.ticker.add(tick)
    gsap.ticker.lagSmoothing(0)
    // Lenis lives outside React, so the effect is the right place to hand it over
    // oxlint-disable-next-line react/set-state-in-effect
    setLenis(instance)
    return () => {
      gsap.ticker.remove(tick)
      gsap.ticker.lagSmoothing(500, 33) // GSAP's default again
      instance.destroy()
      setLenis(null)
    }
  }, [enabled])

  return <LenisContext.Provider value={lenis}>{children}</LenisContext.Provider>
}

export function useLenis() {
  return useContext(LenisContext)
}

/** Scroll to a section by id, under the fixed header. Uses Lenis when it's on. */
export function scrollToSection(lenis: Lenis | null, id: string, immediate = false) {
  const target = id === 'top' ? 0 : document.getElementById(id)
  if (target === null) return
  if (lenis) {
    lenis.scrollTo(target, { offset: id === 'top' ? 0 : -80, immediate, force: true })
    return
  }
  if (typeof target === 'number') {
    window.scrollTo({ top: 0, behavior: immediate || prefersReducedMotion() ? 'auto' : 'smooth' })
  } else {
    target.scrollIntoView({ behavior: immediate || prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' })
  }
}
