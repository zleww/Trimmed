import { useState } from 'react'
import { ReviewForm } from '../../components/ReviewForm'
import { Button, Dialog, Notice, Skeleton } from '../../components/ui'
import { api } from '../../lib/api'
import type { Booking } from '../../lib/types'
import { useLoad } from '../../lib/useLoad'

/**
 * After a finished cut: rate the barber and the branch in one place.
 * Same forms and same database rules as the barber page and the Branches section
 * (you can only rate after a 'done' appointment).
 */
export function RateDialog({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const barberId = booking.barber_id
  const branchId = booking.branch_id ?? null
  const barber = useLoad(() => (barberId ? api.barberReviews(barberId) : Promise.resolve(null)), [barberId])
  const branch = useLoad(() => (branchId ? api.branchReviews(branchId) : Promise.resolve(null)), [branchId])
  const [saved, setSaved] = useState<{ barber?: string; branch?: string }>({})

  const myBarber = barber.data?.reviews.find((r) => r.mine)
  const myBranch = branch.data?.reviews.find((r) => r.mine)
  const barberName = booking.barber ?? 'your barber'

  return (
    <Dialog open title="Rate your cut" onClose={onClose}>
      <div className="space-y-5">
        {(barber.loading || branch.loading) && !barber.data && <Skeleton className="h-48" />}
        {barber.error && <Notice tone="bad">{barber.error}</Notice>}

        {barberId && barber.data && (
          <div className="space-y-2">
            {saved.barber && <Notice tone="good">{saved.barber}</Notice>}
            {barber.data.can_review ? (
              <ReviewForm
                key={myBarber?.id ?? 'new'}
                prompt={`How was your cut with ${barberName}?`}
                initialRating={myBarber?.rating ?? 0}
                initialComment={myBarber?.comment ?? ''}
                editing={Boolean(myBarber)}
                onSubmit={(rating, comment) => api.reviewBarber(barberId, rating, comment)}
                onRemove={() => api.removeMyReview(barberId)}
                onSaved={(text) => {
                  setSaved((s) => ({ ...s, barber: text }))
                  barber.reload()
                }}
                onEdit={() => setSaved((s) => ({ ...s, barber: undefined }))}
              />
            ) : (
              <p className="text-[14px] text-ink-2">You can rate {barberName} once the shop marks your cut as done.</p>
            )}
          </div>
        )}

        {branchId && branch.data?.can_review && (
          <div className="space-y-2">
            {saved.branch && <Notice tone="good">{saved.branch}</Notice>}
            <ReviewForm
              key={myBranch?.id ?? 'new'}
              prompt={`How was ${booking.branch ?? 'the branch'}?`}
              initialRating={myBranch?.rating ?? 0}
              initialComment={myBranch?.comment ?? ''}
              editing={Boolean(myBranch)}
              onSubmit={(rating, comment) => api.reviewBranch(branchId, rating, comment)}
              onRemove={() => api.removeMyBranchReview(branchId)}
              onSaved={(text) => {
                setSaved((s) => ({ ...s, branch: text }))
                branch.reload()
              }}
              onEdit={() => setSaved((s) => ({ ...s, branch: undefined }))}
            />
          </div>
        )}

        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
