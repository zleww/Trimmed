import { lazy, Suspense, useRef, useState } from 'react'
import { Link } from 'react-router'
import { PHOTOS } from '../../content/photos'
import { api } from '../../lib/api'
import { addDays, formatTime, manilaToday, relativeDay } from '../../lib/dates'
import { gsap, MOTION, SplitText, useGSAP } from '../../lib/gsap'
import { scrollToSection, useLenis } from '../../lib/smooth'
import { useLoad } from '../../lib/useLoad'
import Magnet from '../reactbits/Magnet'
import ShinyText from '../reactbits/ShinyText'
import type { PoleMotion } from '../three/BarberPoleScene'
import { ArrowRight } from '../icons'
import { buttonClass, Skeleton } from '../ui'

// three.js is big: load it after the page is up, in its own file
const BarberPoleScene = lazy(() => import('../three/BarberPoleScene'))

type Props = {
  timeFormat: '12h' | '24h'
  firstServiceId?: string
  notSetUp: boolean
  menuLoading: boolean
}

/** Top of the page: the promise, the 3D barber pole in its gold ring, and the real next free time. */
export function Hero({ timeFormat, firstServiceId, notSetUp, menuLoading }: Props) {
  const root = useRef<HTMLElement>(null)
  const title = useRef<HTMLHeadingElement>(null)
  const lenis = useLenis()
  // the scroll position the 3D scene reads every frame (an object, so React doesn't re-render)
  const [motion] = useState<PoleMotion>(() => ({ scroll: 0 }))
  const [webglFailed, setWebglFailed] = useState(false)
  const lightTheme = document.documentElement.dataset.theme === 'light'

  // the earliest free time today or tomorrow, for any barber
  const next = useLoad(async () => {
    if (!firstServiceId) return null
    for (const date of [manilaToday(), addDays(manilaToday(), 1)]) {
      const slots = await api.freeSlots(firstServiceId, null, null, date)
      if (slots.length > 0) return { date, time: slots[0]!, count: slots.length }
    }
    return null
  }, [firstServiceId])

  useGSAP(
    () => {
      const mm = gsap.matchMedia()

      mm.add(MOTION.ok, () => {
        // headline: word by word, rising out of a mask and coming into focus
        const split = SplitText.create(title.current, {
          type: 'words',
          mask: 'words',
          autoSplit: true,
          onSplit(self) {
            return gsap.from(self.words, { yPercent: 100, filter: 'blur(8px)', opacity: 0, duration: 1.3, stagger: 0.06, delay: 0.15 })
          },
        })
        title.current?.classList.remove('split-pending')

        gsap.from('[data-hero-fade]', { y: 24, opacity: 0, duration: 1, stagger: 0.08, delay: 0.55 })
        gsap.from('[data-hero-ring]', { scale: 0.86, opacity: 0, duration: 1.8, ease: 'expo.out', delay: 0.2 })

        // scrolling away: the copy drifts up and dims, the 3D scene turns with the scroll
        gsap.to('[data-hero-copy]', {
          yPercent: -18,
          opacity: 0.25,
          ease: 'none',
          scrollTrigger: { trigger: root.current, start: 'top top', end: 'bottom top', scrub: 1 },
        })
        gsap.to(motion, {
          scroll: 1,
          ease: 'none',
          scrollTrigger: { trigger: root.current, start: 'top top', end: 'bottom top', scrub: 1 },
        })
        return () => split.revert()
      })

      mm.add(MOTION.reduce, () => {
        title.current?.classList.remove('split-pending')
        gsap.from('[data-hero-fade], [data-hero-ring]', { opacity: 0, duration: 0.6, ease: 'power1.out' })
      })
    },
    { scope: root },
  )

  return (
    <section ref={root} id="top" className="relative isolate overflow-hidden pt-28 pb-16 sm:pt-32 lg:flex lg:min-h-[100svh] lg:items-center lg:pt-24 lg:pb-12">
      {/* the room: warm smoke from the right, a cool shadow from the left */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 right-[-20%] size-[46rem] rounded-full bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--accent)_16%,transparent),transparent)] blur-2xl" />
        <div className="absolute bottom-[-30%] left-[-25%] size-[40rem] rounded-full bg-[radial-gradient(closest-side,var(--glow),transparent)] blur-2xl" />
        <p className="ghost-word absolute top-24 right-0 left-0 text-center font-display text-[30vw] leading-none tracking-[-0.05em] select-none lg:top-16 lg:text-[19vw]">
          Barber
        </p>
      </div>

      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-12 px-4 sm:px-6 lg:grid-cols-[1.08fr_1fr] lg:gap-10">
        <div data-hero-copy className="min-w-0">
          <div data-hero-fade className="flex items-center gap-3">
            <span className="h-px w-8 bg-accent" aria-hidden="true" />
            {/* ShinyText needs real hex colors, so pick them by theme */}
            <ShinyText
              text="Barbershop · Online booking"
              color={lightTheme ? '#885a0e' : '#d6a54e'}
              shineColor={lightTheme ? '#14121f' : '#f6ead0'}
              speed={3.2}
              className="label"
            />
          </div>

          <h1
            ref={title}
            className="split-pending mt-6 text-[clamp(2.9rem,12.5vw,6rem)] leading-[0.98] font-medium tracking-[-0.035em] text-balance"
          >
            The art of the <em className="font-normal text-accent-ink italic">clean cut.</em>
          </h1>

          <p data-hero-fade className="mt-6 max-w-md text-[17px] leading-relaxed text-ink-2">
            Choose your service, your barber and a time that's really free. The shop confirms it. You pay after the cut.
          </p>

          <div data-hero-fade className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Magnet padding={70} magnetStrength={3} wrapperClassName="w-full sm:w-auto" innerClassName="w-full sm:w-auto">
              <Link to="/book" className={buttonClass('primary', 'h-13 w-full px-8 text-[16px] sm:w-auto')}>
                Book an appointment
                <ArrowRight size={18} />
              </Link>
            </Magnet>
            <Link
              to="/#services"
              onClick={(e) => {
                e.preventDefault()
                scrollToSection(lenis, 'services')
              }}
              className={buttonClass('ghost', 'h-13 text-[15px]')}
            >
              Services and prices
            </Link>
          </div>
        </div>

        {/* the picture: a photo of a warm shop in a gold ring, the 3D pole standing in front and spilling past the edge */}
        <div data-hero-fade className="relative mx-auto w-full max-w-[min(88vw,30rem)] lg:max-w-[34rem]">
          <div data-hero-ring className="relative aspect-square">
            <div className="gold-ring absolute inset-[9%] overflow-hidden">
              <img
                src={PHOTOS.salonDim.src}
                alt=""
                width={PHOTOS.salonDim.width}
                height={PHOTOS.salonDim.height}
                fetchPriority="high"
                className="photo-warm size-full object-cover opacity-70"
              />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,transparent_30%,var(--bg)_92%)]" />
            </div>
            {/* thin outer orbit with a small bead on it, like the reference */}
            <div aria-hidden="true" className="absolute inset-0 rounded-full border border-glass-line" />
            <span aria-hidden="true" className="absolute top-[14%] right-[11%] size-2 rounded-full bg-accent shadow-[0_0_18px_4px_color-mix(in_srgb,var(--accent)_60%,transparent)]" />

            {!webglFailed && (
              <Suspense fallback={null}>
                <BarberPoleScene motion={motion} onFail={() => setWebglFailed(true)} className="absolute -inset-x-[6%] -inset-y-[14%]" />
              </Suspense>
            )}
          </div>

          {/* the real next free seat, read from the database */}
          <div className="glass absolute -bottom-4 left-1/2 w-[min(100%,17.5rem)] -translate-x-1/2 rounded-2xl px-4 py-3 sm:left-auto sm:-right-2 sm:translate-x-0">
            <div className="flex items-center gap-2 text-[13px] text-ink-2">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-good opacity-60 motion-reduce:hidden" />
                <span className="relative inline-flex size-2 rounded-full bg-good" />
              </span>
              Next free seat
            </div>
            {menuLoading || (next.loading && !next.data) ? (
              <Skeleton className="mt-2 h-7 w-36" />
            ) : next.data ? (
              <p className="mt-1 text-[15px] text-ink-2">
                <span className="num font-display text-[24px] font-medium text-ink">{formatTime(next.data.time, timeFormat)}</span>{' '}
                {relativeDay(next.data.date).toLowerCase()}
              </p>
            ) : (
              <p className="mt-1 text-[15px] text-ink-2">{notSetUp ? 'Online booking opens soon.' : 'Fully booked today and tomorrow.'}</p>
            )}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => scrollToSection(lenis, 'about')}
        className="absolute bottom-6 left-1/2 hidden -translate-x-1/2 cursor-pointer flex-col items-center gap-2 text-[11px] tracking-[0.28em] text-ink-3 uppercase hover:text-ink lg:flex"
      >
        Scroll
        <span aria-hidden="true" className="h-10 w-px bg-gradient-to-b from-ink-3 to-transparent" />
      </button>
    </section>
  )
}
