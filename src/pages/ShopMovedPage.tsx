import { useEffect } from 'react'
import { Link } from 'react-router'
import { STAFF_URL } from '../lib/staffUrl'

// Old /shop links: send staff to the staff app.
export function ShopMovedPage() {
  useEffect(() => {
    if (STAFF_URL) window.location.replace(STAFF_URL)
  }, [])

  return (
    <div className="mx-auto max-w-md px-4 py-20 text-center">
      <h1 className="text-[30px]">The shop app moved</h1>
      <p className="mt-2 text-ink-2">Owner and staff screens have their own site now.</p>
      {STAFF_URL ? (
        <a href={STAFF_URL} className="mt-6 inline-block text-[15px] font-medium underline underline-offset-4">
          Open the staff app
        </a>
      ) : (
        <Link to="/" className="mt-6 inline-block text-[15px] font-medium underline underline-offset-4">
          Back to home
        </Link>
      )}
    </div>
  )
}
