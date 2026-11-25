import { useRef } from 'react'
import { PHOTOS } from '../../content/photos'
import { PRODUCTS } from '../../content/products'
import { peso } from '../../lib/format'
import { useReveal } from '../../lib/useReveal'
import SpotlightCard from '../reactbits/SpotlightCard'
import { SectionHead } from './SectionHead'

/** The pomades the shop sells at the desk. The list lives in src/content/products.ts. */
export function Products() {
  const root = useRef<HTMLElement>(null)
  useReveal(root)

  return (
    <section ref={root} id="products" aria-labelledby="products-title" className="scroll-mt-20 py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHead
          id="products-title"
          label="Products"
          title="Pomades, picked by your barber."
          text="Not sure which one? Ask your barber what suits your hair, then pick it up at the front desk."
        />

        <div className="mt-12 grid grid-cols-1 gap-3 lg:grid-cols-[1.15fr_1fr]">
          <figure data-reveal className="relative min-h-72 overflow-hidden rounded-[2rem] border border-glass-line">
            <img
              src={PHOTOS.toolsSlate.src}
              alt={PHOTOS.toolsSlate.alt}
              width={PHOTOS.toolsSlate.width}
              height={PHOTOS.toolsSlate.height}
              loading="lazy"
              decoding="async"
              className="photo-warm absolute inset-0 size-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/20 to-transparent" />
            <figcaption className="absolute right-6 bottom-6 left-6">
              <p className="label">At the desk</p>
              <p className="mt-2 max-w-xs font-display text-[24px] leading-tight">Keep the look you leave the chair with.</p>
            </figcaption>
          </figure>

          <ul className="grid grid-cols-2 gap-3">
            {PRODUCTS.map((product, i) => (
              <li data-reveal key={`${product.name}-${i}`}>
                <SpotlightCard spotlightColor="rgba(214, 165, 78, 0.18)" className="glass flex h-full flex-col justify-between gap-4 rounded-[1.5rem] p-4 sm:gap-6 sm:p-5">
                  <span className="num text-[12px] tracking-[0.2em] text-ink-3">{String(i + 1).padStart(2, '0')}</span>
                  <span>
                    <span className="block font-display text-[18px] leading-tight sm:text-[21px]">{product.name}</span>
                    {(product.hold || product.finish) && (
                      <span className="mt-1.5 block text-[14px] leading-relaxed text-ink-2">{[product.hold, product.finish].filter(Boolean).join(' · ')}</span>
                    )}
                    <span className="num mt-4 block text-[15px] font-medium text-accent-ink">
                      {product.price_centavos === null ? 'Ask at the desk' : peso(product.price_centavos)}
                    </span>
                  </span>
                </SpotlightCard>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
