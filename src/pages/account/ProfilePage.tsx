import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { Camera, Trash } from '../../components/icons'
import { PhotoCropper } from '../../components/PhotoCropper'
import { Avatar, Button, Dialog, Field, Glass, Notice } from '../../components/ui'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import type { Crop } from '../../lib/crop'
import { errorMessage, prettyMobile } from '../../lib/format'
import { cropPhoto, loadPhoto, type LoadedPhoto } from '../../lib/image'
import { SettingsPage } from './SettingsPage'

/**
 * One place for everything about the customer: photo and details at the top,
 * then preferences, account and the delete button (from SettingsPage).
 */
export function ProfilePage() {
  const { session, profile, setProfile } = useAuth()
  const fileInput = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [picked, setPicked] = useState<LoadedPhoto | null>(null) // open in the cropper
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)

  // free the preview's memory once the cropper closes
  useEffect(() => {
    if (!picked) return
    return () => URL.revokeObjectURL(picked.url)
  }, [picked])

  if (!profile) return null

  // step 1: read the picked photo and open the cropper
  async function pickPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = '' // so picking the same file again still fires
    if (!file) return
    setMessage(null)
    try {
      setPicked(await loadPhoto(file))
    } catch (reason) {
      setMessage({ tone: 'bad', text: errorMessage(reason) })
    }
  }

  // step 2: cut out what's in the circle and upload it
  async function savePhoto(crop: Crop) {
    if (!picked) return
    setPhotoBusy(true)
    try {
      setProfile(await api.uploadAvatar(await cropPhoto(picked, crop)))
      setPicked(null)
      setMessage({ tone: 'good', text: 'Photo updated.' })
    } catch (reason) {
      setPicked(null)
      setMessage({ tone: 'bad', text: errorMessage(reason) })
    } finally {
      setPhotoBusy(false)
    }
  }

  async function removePhoto() {
    setPhotoBusy(true)
    setMessage(null)
    try {
      setProfile(await api.removeAvatar())
    } catch (reason) {
      setMessage({ tone: 'bad', text: errorMessage(reason) })
    } finally {
      setPhotoBusy(false)
    }
  }

  const since = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'long', year: 'numeric' }).format(new Date(profile.member_since))

  return (
    <div className="space-y-8">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      {/* who you are: photo, name, username */}
      <Glass className="flex flex-col items-center gap-4 p-6 text-center sm:flex-row sm:gap-6 sm:text-left">
        <div className="relative shrink-0">
          <Avatar name={profile.full_name} url={profile.avatar_url} size={96} />
          {photoBusy && <span className="absolute inset-0 animate-pulse rounded-full bg-black/40" aria-hidden="true" />}
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={pickPhoto} tabIndex={-1} aria-hidden="true" />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={photoBusy}
            aria-label={profile.avatar_url ? 'Change photo' : 'Add photo'}
            className="absolute -right-1 -bottom-1 grid size-10 place-items-center rounded-full border-4 border-card bg-ink text-bg transition hover:scale-105 disabled:opacity-60"
          >
            <Camera size={16} />
          </button>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[26px] leading-tight">{profile.full_name}</p>
          {profile.username && <p className="truncate text-[15px] text-ink-2">@{profile.username}</p>}
          <p className="mt-1 text-[13px] text-ink-3">Member since {since}</p>
          {profile.avatar_url && (
            <button type="button" onClick={removePhoto} disabled={photoBusy} className="mt-2 inline-flex min-h-10 items-center gap-1.5 text-[13px] text-ink-3 hover:text-bad">
              <Trash size={14} />
              Remove photo
            </button>
          )}
        </div>
      </Glass>

      <Dialog open={picked !== null} title="Adjust your photo" onClose={() => setPicked(null)}>
        {/* keyed by the photo, so a new pick starts centered again */}
        {picked && <PhotoCropper key={picked.url} photo={picked} busy={photoBusy} onCancel={() => setPicked(null)} onDone={savePhoto} />}
      </Dialog>

      {/* details: read first, edit on purpose */}
      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 className="text-[14px] font-medium tracking-wide text-ink-2">Personal details</h2>
          {!editing && (
            <Button variant="ghost" className="min-h-10 px-4 text-[14px]" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
        </div>
        {editing ? (
          <DetailsForm
            onCancel={() => setEditing(false)}
            onSaved={() => {
              setEditing(false)
              setMessage({ tone: 'good', text: 'Details saved.' })
            }}
          />
        ) : (
          <Glass className="divide-y divide-[var(--glass-line)]">
            <Detail label="Name" hint="What the shop calls you" value={profile.full_name} />
            <Detail label="Username" hint="Shown on your reviews" value={profile.username ? `@${profile.username}` : 'Not set'} />
            <Detail label="Mobile" hint="Only for your bookings" value={prettyMobile(profile.mobile)} />
            <Detail label="Email" hint="You sign in with this" value={session?.email ?? ''} />
          </Glass>
        )}
      </section>

      {/* preferences, password, sign out, delete */}
      <SettingsPage />
    </div>
  )
}

function Detail({ label, hint, value }: { label: string; hint: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div>
        <p className="text-[15px] font-medium">{label}</p>
        <p className="text-[13px] text-ink-3">{hint}</p>
      </div>
      <p className="min-w-0 truncate text-[15px] text-ink-2 sm:text-right">{value}</p>
    </div>
  )
}

function DetailsForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: () => void }) {
  const { session, profile, setProfile } = useAuth()
  const [username, setUsername] = useState(profile?.username ?? '')
  const [name, setName] = useState(profile?.full_name ?? '')
  const [mobile, setMobile] = useState(profile ? prettyMobile(profile.mobile) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!profile) return null

  const changed =
    username.trim().toLowerCase() !== (profile.username ?? '') || name.trim() !== profile.full_name || mobile.replace(/\D/g, '') !== profile.mobile

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      setProfile(await api.saveProfile(username, name, mobile, true))
      onSaved()
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Glass className="p-6">
      <form onSubmit={save} className="space-y-5" noValidate>
        {error && <Notice tone="bad">{error}</Notice>}
        <Field label="Name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} hint="The name the shop will call you." />
        <Field
          label="Username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          hint="Shown on your reviews instead of your name."
        />
        <Field
          label="Mobile number"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          value={mobile}
          onChange={(e) => setMobile(e.target.value)}
          hint="The shop calls or texts this number only about your bookings."
        />
        <Field label="Email" type="email" value={session?.email ?? ''} readOnly disabled hint="You sign in with this email. It can't be changed here." />
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" loading={saving} disabled={!changed}>
            Save details
          </Button>
        </div>
      </form>
    </Glass>
  )
}
