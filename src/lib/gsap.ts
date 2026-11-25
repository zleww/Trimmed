import { useGSAP } from '@gsap/react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'

// Register the plugins once, here. Components import gsap from this file, never straight from 'gsap',
// so the plugins are always ready before any animation runs.
gsap.registerPlugin(ScrollTrigger, SplitText, useGSAP)

// the house easing: fast start, long soft landing
gsap.defaults({ ease: 'expo.out', duration: 0.8 })

/** Media queries used with gsap.matchMedia(), so every animation has a calm version. */
export const MOTION = {
  ok: '(prefers-reduced-motion: no-preference)',
  reduce: '(prefers-reduced-motion: reduce)',
  desktopOk: '(min-width: 1024px) and (prefers-reduced-motion: no-preference)',
}

export function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia(MOTION.reduce).matches
}

export { gsap, ScrollTrigger, SplitText, useGSAP }
