import { ButtonLink } from '../components/ui'

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <p className="num text-[64px] font-semibold tracking-tight text-ink-3">404</p>
      <h1 className="mt-2 text-[26px] font-semibold tracking-tight">This page doesn't exist</h1>
      <p className="mt-2 text-[16px] text-ink-2">The link may be old, or there's a typo in the address.</p>
      <ButtonLink to="/" className="mt-8">
        Back to home
      </ButtonLink>
    </div>
  )
}
