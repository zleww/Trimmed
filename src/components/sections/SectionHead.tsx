import type { ReactNode } from 'react'

/** Label, serif heading and a short line. Centred or left-aligned. */
export function SectionHead({
  label,
  title,
  text,
  center = false,
  id,
}: {
  label: string
  title: ReactNode
  text?: ReactNode
  center?: boolean
  id?: string
}) {
  return (
    <div className={center ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl'}>
      <p data-reveal className={`label flex items-center gap-3 ${center ? 'justify-center' : ''}`}>
        <span aria-hidden="true" className="h-px w-8 bg-accent" />
        {label}
      </p>
      <h2 id={id} data-reveal className="mt-5 text-[clamp(2.25rem,8vw,4rem)] leading-[1.02] font-medium tracking-[-0.03em] text-balance">
        {title}
      </h2>
      {text && (
        <p data-reveal className={`mt-5 text-[17px] leading-relaxed text-ink-2 ${center ? 'mx-auto max-w-lg' : 'max-w-lg'}`}>
          {text}
        </p>
      )}
    </div>
  )
}
