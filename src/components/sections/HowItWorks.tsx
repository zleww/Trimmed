import { useRef } from 'react'
import { PHOTOS, type Photo } from '../../content/photos'
import { gsap, MOTION, useGSAP } from '../../lib/gsap'
import { useReveal } from '../../lib/useReveal'
import { SectionHead } from './SectionHead'

const STEPS: { title: string; text: string; photo: Photo }[] = [
  { title: 'Choose a service', text: 'See the price and how long it takes before you choose.', photo: PHOTOS.shearsComb },
  { title: 'Pick a barber and a time', text: 'Someone you know, or any barber for the earliest seat. Only real open times are shown.', photo: PHOTOS.razorTrim },
  { title: 'The shop confirms', text: 'The front desk checks your request and confirms it. Come in, sit down, pay after.', photo: PHOTOS.clientChair },
]

/**
 * How booking works. On wide screens the section pins while you scroll:
 * a gold line fills down the steps and the photo beside them changes with each one.
 * Phones get a plain list, each step with its own photo.
 */
export function HowItWorks() {
  const root = useRef<HTMLElement>(null)
  useReveal(root)

  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add(MOTION.desktopOk, () => {
        const steps = gsap.utils.toArray<HTMLElement>('[data-step]')
        const photos = gsap.utils.toArray<HTMLElement>('[data-step-photo]')
        gsap.set(steps.slice(1), { opacity: 0.3 })
        gsap.set(photos.slice(1), { opacity: 0, scale: 1.06 })

        const tl = gsap.timeline({
          defaults: { ease: 'none' },
          scrollTrigger: { trigger: '[data-pin]', start: 'center center', end: '+=160%', pin: true, scrub: 1 },
        })
        tl.fromTo('[data-progress]', { scaleY: 0 }, { scaleY: 1, duration: 3 }, 0)
        for (let i = 1; i < steps.length; i++) {
          tl.to(steps[i - 1]!, { opacity: 0.3, duration: 0.3 }, i)
            .to(steps[i]!, { opacity: 1, duration: 0.3 }, i)
            .to(photos[i - 1]!, { opacity: 0, duration: 0.4 }, i)
            .to(photos[i]!, { opacity: 1, scale: 1, duration: 0.4 }, i)
        }
      })
      return () => mm.revert()
    },
    { scope: root },
  )

  return (
    <section ref={root} aria-labelledby="how-title" className="py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHead id="how-title" label="How it works" title="Booked in under a minute." />

        <div data-pin className="mt-12 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_1fr] lg:items-center lg:gap-16">
          <ol className="relative">
            {/* the line the steps hang from; the gold part fills as you scroll (wide screens only) */}
            <span aria-hidden="true" className="absolute top-2 bottom-2 left-[1.15rem] w-px bg-glass-line" />
            <span aria-hidden="true" data-progress className="absolute top-2 bottom-2 left-[1.15rem] hidden w-px origin-top bg-accent lg:block" />
            {STEPS.map((step, i) => (
              <li data-step key={step.title} className="relative pb-10 pl-14 last:pb-0">
                <span className="num absolute top-0 left-0 flex size-[2.3rem] items-center justify-center rounded-full border border-glass-line bg-bg text-[13px] text-accent-ink">
                  0{i + 1}
                </span>
                <h3 className="font-display text-[26px] leading-tight sm:text-[30px]">{step.title}</h3>
                <p className="mt-2 max-w-sm text-[16px] leading-relaxed text-ink-2">{step.text}</p>
                {/* phones: each step shows its own photo */}
                <img
                  src={step.photo.src}
                  alt=""
                  width={step.photo.width}
                  height={step.photo.height}
                  loading="lazy"
                  decoding="async"
                  className="photo-warm mt-5 aspect-[16/10] w-full rounded-2xl border border-glass-line object-cover lg:hidden"
                />
              </li>
            ))}
          </ol>

          {/* wide screens: one frame, the photos cross-fade inside it */}
          <div aria-hidden="true" className="relative hidden aspect-[4/5] overflow-hidden rounded-[2rem] border border-glass-line lg:block">
            {STEPS.map((step, i) => (
              <img
                data-step-photo
                key={step.title}
                src={step.photo.src}
                alt=""
                width={step.photo.width}
                height={step.photo.height}
                loading="lazy"
                decoding="async"
                className={`photo-warm absolute inset-0 size-full object-cover ${i > 0 ? 'opacity-0' : ''}`}
              />
            ))}
            <div className="absolute inset-0 bg-gradient-to-t from-bg/60 to-transparent" />
          </div>
        </div>
      </div>
    </section>
  )
}
