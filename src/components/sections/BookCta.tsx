import { lazy, Suspense, useRef } from 'react'
import { Link } from 'react-router'
import { PHOTOS } from '../../content/photos'
import { gsap, MOTION, useGSAP } from '../../lib/gsap'
import { useReveal } from '../../lib/useReveal'
import { ArrowRight } from '../icons'
import StarBorder from '../reactbits/StarBorder'

// the aurora is a WebGL shader: load it only when this part of the page is near
const Aurora = lazy(() => import('../reactbits/Aurora'))

/** The call to book, in the middle of the page: a chair in the dark, a slow aurora of amber light above it. */
export function BookCta() {
  const root = useRef<HTMLElement>(null)
  useReveal(root)

  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add(MOTION.ok, () => {
        // the photo settles from a slight zoom as the panel scrolls through
        gsap.fromTo(
          '[data-cta-photo]',
          { scale: 1.18, yPercent: -6 },
          { scale: 1, yPercent: 6, ease: 'none', scrollTrigger: { trigger: root.current, start: 'top bottom', end: 'bottom top', scrub: 1 } },
        )
      })
      return () => mm.revert()
    },
    { scope: root },
  )

  return (
    <section ref={root} aria-labelledby="book-title" className="px-3 py-10 sm:px-5">
      <div className="relative isolate mx-auto flex min-h-[78svh] max-w-7xl items-center justify-center overflow-hidden rounded-[2rem] border border-glass-line sm:rounded-[2.75rem]">
        <img
          data-cta-photo
          src={PHOTOS.chairSilver.src}
          alt=""
          width={PHOTOS.chairSilver.width}
          height={PHOTOS.chairSilver.height}
          loading="lazy"
          decoding="async"
          className="photo-warm absolute inset-0 -z-20 size-full object-cover"
        />
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,color-mix(in_srgb,var(--bg)_55%,transparent),var(--bg)_88%)]" />
        <div aria-hidden="true" className="absolute inset-x-0 top-0 -z-10 h-2/3 opacity-60 mix-blend-screen motion-reduce:hidden">
          <Suspense fallback={null}>
            <Aurora colorStops={['#2a2350', '#d6a54e', '#6b4716']} amplitude={0.9} blend={0.55} speed={0.6} />
          </Suspense>
        </div>

        <div className="px-6 py-20 text-center">
          <p data-reveal className="label">Your chair is ready</p>
          <h2 id="book-title" data-reveal className="mx-auto mt-5 max-w-3xl text-[clamp(2.6rem,10vw,6rem)] leading-[0.98] font-medium tracking-[-0.035em] text-balance">
            Book your <em className="font-normal text-accent-ink italic">appointment.</em>
          </h2>
          <p data-reveal className="mx-auto mt-6 max-w-md text-[17px] leading-relaxed text-ink-2">
            Pick a service, a barber and a free time. It takes about a minute.
          </p>
          <div data-reveal className="mt-10 flex justify-center">
            <StarBorder
              as={Link}
              to="/book"
              color="#e9c27a"
              backgroundColor="#d6a54e"
              textColor="#0b0a14"
              borderColor="rgba(236, 229, 214, 0.25)"
              radius={999}
              thickness={1.5}
              stars={2}
              className="inline-flex"
            >
              <span className="flex h-13 items-center gap-2 px-8 text-[16px] font-semibold">
                Book an appointment
                <ArrowRight size={18} />
              </span>
            </StarBorder>
          </div>
        </div>
      </div>
    </section>
  )
}
