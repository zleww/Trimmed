import { useEffect } from 'react'
import { About } from '../components/sections/About'
import { BarbersSection } from '../components/sections/BarbersSection'
import { BookCta } from '../components/sections/BookCta'
import { Branches } from '../components/sections/Branches'
import { Contact } from '../components/sections/Contact'
import { Hero } from '../components/sections/Hero'
import { HowItWorks } from '../components/sections/HowItWorks'
import { Products } from '../components/sections/Products'
import { SectionDots } from '../components/sections/SectionDots'
import { Services } from '../components/sections/Services'
import Noise from '../components/reactbits/Noise'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { ScrollTrigger } from '../lib/gsap'
import { useLoad } from '../lib/useLoad'

/** The landing page. Order follows the menu: Home, About, Products, Services, Branches, Contact, with the call to book in the middle. */
export function HomePage() {
  const { profile } = useAuth()
  const timeFormat = profile?.time_format ?? '12h'
  const services = useLoad(() => api.listServices(), [])
  const branches = useLoad(() => api.listBranches(), [])
  const barbers = useLoad(() => api.listBarbers(), [])
  const hours = useLoad(() => api.openingHours(), [])
  const ratings = useLoad(() => api.barberRatings(), [])
  const branchRatings = useLoad(() => api.branchRatings(), [])

  // sections grow when their data arrives: re-measure so pinned and scrubbed parts start in the right place
  const ready = [services.data, branches.data, barbers.data, hours.data].filter(Boolean).length
  useEffect(() => {
    const frame = requestAnimationFrame(() => ScrollTrigger.refresh())
    return () => cancelAnimationFrame(frame)
  }, [ready])
  useEffect(() => {
    const refresh = () => ScrollTrigger.refresh()
    window.addEventListener('load', refresh)
    document.fonts?.ready.then(refresh).catch(() => {})
    return () => window.removeEventListener('load', refresh)
  }, [])

  return (
    <>
      {/* fine film grain over the whole page, 3% strong */}
      <Noise fixed opacity={0.035} fps={12} zIndex={35} />
      <SectionDots />

      <Hero
        timeFormat={timeFormat}
        firstServiceId={services.data?.[0]?.id}
        notSetUp={services.data?.length === 0}
        menuLoading={services.data === undefined && !services.error}
      />
      <About />
      <Products />
      <Services services={services.data} loading={services.loading} error={services.error} />
      <BookCta />
      <HowItWorks />
      <BarbersSection barbers={barbers.data} branches={branches.data} ratings={ratings.data} loading={barbers.loading} />
      <Branches branches={branches.data} ratings={branchRatings.data} loading={branches.loading} onReviewed={branchRatings.reload} />
      <Contact branches={branches.data} hours={hours.data ?? []} loading={branches.loading} timeFormat={timeFormat} />
    </>
  )
}
