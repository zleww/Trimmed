import { useRef } from 'react'
import { Link } from 'react-router'
import { SERVICE_PHOTOS } from '../../content/photos'
import { duration, peso } from '../../lib/format'
import type { Service } from '../../lib/types'
import { useReveal } from '../../lib/useReveal'
import { ArrowUpRight, Clock } from '../icons'
import LogoLoop from '../reactbits/LogoLoop'
import SpotlightCard from '../reactbits/SpotlightCard'
import { Skeleton } from '../ui'
import { SectionHead } from './SectionHead'

/**
 * Bento layout on wide screens: the first service is the big tile, the rest fill in beside it.
 * If the last row is short, its last tile stretches so there's never an empty hole.
 */
function tileClass(index: number, count: number) {
  if (index === 0) return 'lg:col-span-2 lg:row-span-2'
  if (index < 3) return ''
  const rest = count - 3
  const lastRow = rest % 3
  if (index === count - 1 && lastRow === 1) return 'lg:col-span-3'
  if (index === count - 1 && lastRow === 2) return 'lg:col-span-2'
  return ''
}

type Props = { services?: Service[]; loading: boolean; error: string | null }

export function Services({ services, loading, error }: Props) {
  const root = useRef<HTMLElement>(null)
  useReveal(root, [services?.length])

  return (
    <section ref={root} id="services" aria-labelledby="services-title" className="scroll-mt-20 py-24 sm:py-32">
      {/* the menu, sliding past like a sign in the window */}
      {services && services.length > 0 && (
        <div className="mb-20 border-y border-glass-line py-6 sm:mb-28">
          <LogoLoop
            logos={services.map((s) => ({
              node: (
                <span className="flex items-center gap-6 font-display text-[28px] text-ink-2 italic sm:text-[40px]">
                  {s.name}
                  <span aria-hidden="true" className="size-1.5 rotate-45 bg-accent" />
                </span>
              ),
              title: s.name,
            }))}
            speed={50}
            gap={48}
            logoHeight={48}
            pauseOnHover
            fadeOut
            fadeOutColor="var(--bg)"
            ariaLabel="Services we offer"
          />
        </div>
      )}

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHead id="services-title" label="Services" title="Every price, up front." text="What you see is what you pay, at the shop, after your cut." />

        <ul className="mt-12 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:auto-rows-[minmax(15rem,auto)] lg:grid-cols-3">
          {loading && !services
            ? Array.from({ length: 4 }, (_, i) => (
                <li key={i} className={tileClass(i, 4)}>
                  <Skeleton className="h-72 lg:h-full" />
                </li>
              ))
            : services?.map((service, i) => {
                const photo = SERVICE_PHOTOS[i % SERVICE_PHOTOS.length]!
                const big = i === 0
                return (
                  <li data-reveal key={service.id} className={`min-w-0 ${tileClass(i, services.length)}`}>
                    <SpotlightCard spotlightColor="rgba(214, 165, 78, 0.2)" className="group glass relative isolate h-full overflow-hidden rounded-[1.75rem]">
                      <Link to={`/book?service=${service.id}`} className="flex h-full min-h-72 flex-col justify-end p-5 sm:p-6">
                        <img
                          src={photo.src}
                          alt=""
                          width={photo.width}
                          height={photo.height}
                          loading="lazy"
                          decoding="async"
                          className="photo-warm absolute inset-0 -z-10 size-full object-cover opacity-55 transition duration-700 ease-out group-hover:scale-[1.04] group-hover:opacity-70"
                        />
                        <span aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-t from-bg via-bg/70 to-bg/10" />
                        <span className="flex items-end justify-between gap-4">
                          <span className="min-w-0">
                            <span className={`block font-display leading-tight ${big ? 'text-[34px] sm:text-[44px]' : 'text-[24px]'}`}>{service.name}</span>
                            {service.description && (
                              <span className="mt-1.5 line-clamp-2 block text-[15px] leading-relaxed text-ink-2">{service.description}</span>
                            )}
                            <span className="mt-3 flex items-center gap-2 text-[14px] text-ink-2">
                              <Clock size={15} />
                              {duration(service.duration_minutes)}
                            </span>
                          </span>
                          <span className="flex shrink-0 flex-col items-end gap-3">
                            <span className="num font-display text-[24px] text-accent-ink">{peso(service.price_centavos)}</span>
                            <span className="flex size-10 items-center justify-center rounded-full border border-glass-line text-ink transition group-hover:border-accent group-hover:bg-accent group-hover:text-on-accent">
                              <ArrowUpRight size={18} />
                              <span className="sr-only">Book {service.name}</span>
                            </span>
                          </span>
                        </span>
                      </Link>
                    </SpotlightCard>
                  </li>
                )
              })}
        </ul>
        {error && <p className="mt-6 text-bad">{error}</p>}
        {services?.length === 0 && <p className="glass mt-6 rounded-3xl p-6 text-center text-ink-2">Services and prices will be posted soon.</p>}
      </div>
    </section>
  )
}
