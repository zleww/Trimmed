import { useRef } from 'react'
import type { Barber, Branch, Rating } from '../../lib/types'
import { useReveal } from '../../lib/useReveal'
import { BarberCard } from '../Barbers'
import { MapPin } from '../icons'
import { Skeleton } from '../ui'
import { SectionHead } from './SectionHead'

type Props = {
  barbers?: Barber[]
  branches?: Branch[]
  ratings?: Record<string, Rating>
  loading: boolean
}

/** The barbers, grouped by location when there's more than one. Ratings are real reviews only. */
export function BarbersSection({ barbers, branches, ratings, loading }: Props) {
  const root = useRef<HTMLElement>(null)
  useReveal(root, [barbers?.length])
  const groups = branches && branches.length > 1 ? branches : [null]

  return (
    <section ref={root} id="barbers" aria-labelledby="barbers-title" className="scroll-mt-20 py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHead id="barbers-title" label="The barbers" title="Pick who cuts your hair." text="See their reviews, star your favourite, or take the first one free." />

        {loading && !barbers ? (
          <div className="mt-12 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="aspect-[4/5]" />
            ))}
          </div>
        ) : barbers?.length === 0 ? (
          <p className="glass mt-12 rounded-3xl p-6 text-center text-ink-2">Our barbers will be listed here soon.</p>
        ) : (
          groups.map((branch) => {
            const list = (barbers ?? []).filter((b) => !branch || b.branch_id === branch.id)
            if (list.length === 0) return null
            return (
              <div key={branch?.id ?? 'all'} className="mt-12">
                {branch && (
                  <h3 data-reveal className="mb-4 flex items-center gap-2 text-[17px] font-medium">
                    <MapPin size={18} className="text-accent-ink" />
                    {branch.name}
                  </h3>
                )}
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {list.map((barber) => (
                    <div data-reveal key={barber.id} className="min-w-0">
                      <BarberCard barber={barber} rating={ratings?.[barber.id]} />
                    </div>
                  ))}
                </div>
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}
