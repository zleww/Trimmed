import { useRef } from 'react'
import { PHOTOS } from '../../content/photos'
import { gsap, MOTION, useGSAP } from '../../lib/gsap'
import { useReveal } from '../../lib/useReveal'
import { Calendar, CheckCircle, Users } from '../icons'
import ScrollReveal from '../reactbits/ScrollReveal'

const PROMISES = [
  { Icon: CheckCircle, title: 'The price, up front', text: 'Every service shows its price and time before you book.' },
  { Icon: Users, title: 'Your barber', text: 'Pick the one you trust, or any barber for the earliest seat.' },
  { Icon: Calendar, title: 'Real free times', text: 'Only open times are shown. The desk confirms your request.' },
]

/** About us: the promise, read word by word as you scroll, beside a tall photo that drifts. */
export function About() {
  const root = useRef<HTMLElement>(null)
  useReveal(root)

  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add(MOTION.ok, () => {
        // the photo moves a little slower than the page: depth without any 3D cost
        gsap.fromTo('[data-drift]', { yPercent: -8 }, { yPercent: 8, ease: 'none', scrollTrigger: { trigger: root.current, start: 'top bottom', end: 'bottom top', scrub: 1 } })
        // the three promises slide in one by one
        gsap.from('[data-promise]', {
          x: 40,
          opacity: 0,
          duration: 1,
          stagger: 0.12,
          scrollTrigger: { trigger: '[data-promises]', start: 'top 80%', once: true },
        })
      })
      return () => mm.revert()
    },
    { scope: root },
  )

  return (
    <section ref={root} id="about" aria-labelledby="about-title" className="relative scroll-mt-20 py-24 sm:py-32">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-14 px-4 sm:px-6 lg:grid-cols-[1fr_1.1fr] lg:items-center lg:gap-20">
        {/* tall photo with an arched top, a small square one tucked over its corner */}
        <div data-reveal className="relative mx-auto w-full max-w-md lg:max-w-none">
          <div className="relative aspect-[4/5] overflow-hidden rounded-t-[999px] rounded-b-[2rem] border border-glass-line">
            <img
              data-drift
              src={PHOTOS.salonDim.src}
              alt={PHOTOS.salonDim.alt}
              width={PHOTOS.salonDim.width}
              height={PHOTOS.salonDim.height}
              loading="lazy"
              decoding="async"
              className="photo-warm absolute inset-x-0 top-[-8%] h-[116%] w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-bg/70 via-transparent to-transparent" />
          </div>
          <div className="absolute -right-2 -bottom-8 w-[42%] overflow-hidden rounded-[1.5rem] border border-glass-line shadow-2xl shadow-black/50 sm:-right-6">
            <img
              src={PHOTOS.beardMono.src}
              alt={PHOTOS.beardMono.alt}
              width={PHOTOS.beardMono.width}
              height={PHOTOS.beardMono.height}
              loading="lazy"
              decoding="async"
              className="aspect-[4/5] w-full object-cover"
            />
          </div>
        </div>

        <div className="min-w-0">
          <p data-reveal className="label flex items-center gap-3">
            <span aria-hidden="true" className="h-px w-8 bg-accent" />
            About us
          </p>
          <h2 id="about-title" data-reveal className="mt-5 text-[clamp(2.25rem,8vw,4rem)] leading-[1.02] font-medium tracking-[-0.03em] text-balance">
            A barbershop that keeps its word.
          </h2>

          <ScrollReveal
            containerClassName="mt-8"
            textClassName="font-display text-[clamp(1.25rem,4.6vw,1.75rem)] leading-[1.45] text-ink"
            baseOpacity={0.15}
            blurStrength={3}
            highlightColor="var(--accent)"
            wordAnimationEnd="bottom 55%"
          >
            No guessing at the chair. You see the price before you book, you choose who cuts your hair, and you only pick from
            times that are really free. The front desk confirms your request, and the seat is yours.
          </ScrollReveal>

          <ul data-promises className="mt-10 grid grid-cols-1 gap-3">
            {PROMISES.map(({ Icon, title, text }) => (
              <li data-promise key={title} className="glass flex items-start gap-4 rounded-2xl p-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-raised text-accent-ink">
                  <Icon size={19} />
                </span>
                <span>
                  <span className="block text-[16px] font-medium">{title}</span>
                  <span className="mt-0.5 block text-[15px] leading-relaxed text-ink-2">{text}</span>
                </span>
              </li>
            ))}
          </ul>

          {/* the shop's own story goes here once the owner writes it */}
          <blockquote data-reveal className="mt-10 border-l border-accent/60 pl-5 font-display text-[19px] text-ink-2 italic">
            [A few words from the owner about the shop]
          </blockquote>
        </div>
      </div>
    </section>
  )
}
