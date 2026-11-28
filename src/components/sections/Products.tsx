import { useRef, useState } from 'react'
import { api } from '../../lib/api'
import { peso } from '../../lib/format'
import type { ShopProduct } from '../../lib/types'
import { useLoad } from '../../lib/useLoad'
import { useReveal } from '../../lib/useReveal'
import { Alert, Ban, CheckCircle, Scissors } from '../icons'
import { Skeleton } from '../ui'
import { SectionHead } from './SectionHead'

// stock as a status, never the count: icon + text + colour
const STOCK: Record<ShopProduct['stock_status'], { label: string; className: string; Icon: typeof Alert }> = {
  in_stock: { label: 'In stock', className: 'bg-good-bg text-good', Icon: CheckCircle },
  low: { label: 'Only a few left', className: 'bg-warn-bg text-warn', Icon: Alert },
  out: { label: 'Out of stock', className: 'bg-raised text-ink-3', Icon: Ban },
}

/** What the shop sells. Customers browse here and buy at the front desk. */
export function Products() {
  const root = useRef<HTMLElement>(null)
  useReveal(root)
  const products = useLoad(() => api.listShopProducts(), [])
  const [category, setCategory] = useState('All')

  const list = products.data ?? []
  const categories = ['All', ...new Set(list.map((p) => p.category))]
  const shown = category === 'All' ? list : list.filter((p) => p.category === category)

  return (
    <section ref={root} id="products" aria-labelledby="products-title" className="scroll-mt-20 py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHead
          id="products-title"
          label="Products"
          title="Keep the look you leave the chair with."
          text="Browse what we carry and check if it's in. Pay and pick it up at the front desk. Not sure which one? Ask your barber."
        />

        {categories.length > 2 && (
          <div role="radiogroup" aria-label="Category" className="mt-10 flex gap-2 overflow-x-auto pb-1">
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={c === category}
                onClick={() => setCategory(c)}
                className={`min-h-10 shrink-0 rounded-full px-4 text-[14px] font-medium transition ${
                  c === category ? 'bg-ink text-bg' : 'glass text-ink-2 hover:text-ink'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        )}

        {products.loading && !products.data && (
          <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-72" />
            ))}
          </div>
        )}
        {products.data && list.length === 0 && (
          <p className="glass mt-10 rounded-[1.5rem] p-6 text-center text-[15px] text-ink-2">Our product list is coming soon. Ask at the front desk what's in today.</p>
        )}

        <ul className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {shown.map((p) => {
            const stock = STOCK[p.stock_status]
            return (
              <li data-reveal key={p.id} className={`glass flex flex-col overflow-hidden rounded-[1.5rem] ${p.stock_status === 'out' ? 'opacity-75' : ''}`}>
                <div className="relative aspect-square bg-raised">
                  {p.photo_url ? (
                    <img src={p.photo_url} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
                  ) : (
                    <span aria-hidden="true" className="grid size-full place-items-center text-ink-3">
                      <Scissors size={32} />
                    </span>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-2 p-4">
                  <p className="text-[12px] font-medium tracking-wide text-ink-3 uppercase">{p.category}</p>
                  <p className="font-display text-[18px] leading-tight">{p.name}</p>
                  {(p.size || p.description) && <p className="text-[13px] leading-relaxed text-ink-2">{[p.size, p.description].filter(Boolean).join(' · ')}</p>}
                  <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-2">
                    <span className="num text-[16px] font-medium text-accent-ink">{peso(p.price_centavos)}</span>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium ${stock.className}`}>
                      <stock.Icon size={12} />
                      {stock.label}
                    </span>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
        {list.length > 0 && <p className="mt-4 text-[13px] text-ink-3">Stock changes during the day. Sold at the shop only.</p>}
      </div>
    </section>
  )
}
