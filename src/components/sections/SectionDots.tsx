import { useState } from 'react'
import { ScrollTrigger, useGSAP } from '../../lib/gsap'
import { scrollToSection, useLenis } from '../../lib/smooth'
import { SECTIONS } from './Navbar'

/**
 * The little column of dots on the left edge (wide screens), like the reference.
 * The dot for the section on screen grows and turns amber; each one jumps to its section.
 */
export function SectionDots() {
  const lenis = useLenis()
  const [active, setActive] = useState<string>('top')

  useGSAP(() => {
    for (const { id } of SECTIONS) {
      const el = document.getElementById(id)
      if (!el) continue
      ScrollTrigger.create({
        trigger: el,
        start: 'top center',
        end: 'bottom center',
        onToggle: (self) => self.isActive && setActive(id),
      })
    }
  })

  return (
    <nav aria-label="Sections" className="fixed top-1/2 left-5 z-30 hidden -translate-y-1/2 flex-col gap-1 xl:flex">
      {SECTIONS.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => scrollToSection(lenis, s.id)}
          aria-label={`Go to ${s.label}`}
          aria-current={active === s.id ? 'true' : undefined}
          className="group flex size-6 cursor-pointer items-center justify-center"
        >
          <span
            className={`block rounded-full transition-all duration-500 ${
              active === s.id ? 'h-5 w-1.5 bg-accent' : 'size-1.5 bg-ink-3 group-hover:bg-ink'
            }`}
          />
        </button>
      ))}
    </nav>
  )
}
