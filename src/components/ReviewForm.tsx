import { useId, useState, type FormEvent } from 'react'
import { errorMessage } from '../lib/format'
import { StarPicker } from './Barbers'
import { Trash } from './icons'
import { Button, Glass, Notice } from './ui'

export const MAX_COMMENT = 500

/**
 * Stars and an optional comment. Used for barbers and for branches:
 * the page passes in what saving and removing do.
 */
export function ReviewForm({
  prompt,
  initialRating,
  initialComment,
  editing,
  onSubmit,
  onRemove,
  onSaved,
  onEdit,
}: {
  /** the question at the top, e.g. "How was your cut?" */
  prompt: string
  initialRating: number
  initialComment: string
  editing: boolean
  onSubmit: (rating: number, comment: string) => Promise<unknown>
  onRemove: () => Promise<unknown>
  onSaved: (message: string) => void
  onEdit: () => void
}) {
  const id = useId()
  const [rating, setRatingState] = useState(initialRating)
  const [comment, setCommentState] = useState(initialComment)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // any change clears the old "saved" or error message
  const setRating = (value: number) => {
    setRatingState(value)
    setError(null)
    onEdit()
  }
  const setComment = (value: string) => {
    setCommentState(value)
    setError(null)
    onEdit()
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (rating === 0) {
      setError('Tap a star to rate first.')
      return
    }
    setBusy(true)
    try {
      await onSubmit(rating, comment)
      onSaved(editing ? 'Review updated.' : 'Thanks! Your review is up.')
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    try {
      await onRemove()
      onSaved('Your review was removed.')
    } catch (reason) {
      setError(errorMessage(reason))
      setBusy(false)
    }
  }

  return (
    <Glass className="p-5 sm:p-6">
      <form onSubmit={save} className="space-y-4" noValidate>
        <p className="text-[16px] font-medium">{editing ? 'Your review' : prompt}</p>
        {error && <Notice tone="bad">{error}</Notice>}
        <StarPicker value={rating} onChange={setRating} />
        <div>
          <label htmlFor={`${id}-comment`} className="mb-1.5 block text-[14px] font-medium">
            Comment <span className="font-normal text-ink-3">(optional)</span>
          </label>
          <textarea
            id={`${id}-comment`}
            rows={3}
            maxLength={MAX_COMMENT}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="w-full resize-y rounded-2xl border border-glass-line bg-[var(--glass)] px-4 py-3 text-[16px] text-ink outline-none placeholder:text-ink-3 focus:border-ink-2"
            placeholder="What did you like? Anything to improve?"
          />
          <p className="num mt-1 text-right text-[12px] text-ink-3">
            {comment.length}/{MAX_COMMENT}
          </p>
        </div>
        <p className="text-[13px] text-ink-3">Shown with your username, never your name or number.</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {editing && (
            <Button type="button" variant="ghost" onClick={remove} disabled={busy}>
              <Trash size={18} />
              Remove
            </Button>
          )}
          {/* secondary: the page's one main button is the booking one */}
          <Button type="submit" variant="secondary" loading={busy}>
            {editing ? 'Update review' : 'Post review'}
          </Button>
        </div>
      </form>
    </Glass>
  )
}
