import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Camera, Trash } from '../../components/icons'
import { Avatar, Button, Field, Glass, Notice } from '../../components/ui'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { errorMessage, prettyMobile } from '../../lib/format'
import { squareWebp } from '../../lib/image'

export function ProfilePage() {
  const { session, profile, setProfile } = useAuth()
  const fileInput = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(profile?.full_name ?? '')
  const [mobile, setMobile] = useState(profile ? prettyMobile(profile.mobile) : '')
  const [saving, setSaving] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)

  if (!profile) return null

  const changed = name.trim() !== profile.full_name || mobile.replace(/\D/g, '') !== profile.mobile

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setMessage(null)
    try {
      setProfile(await api.saveProfile(name, mobile, true))
      setMessage({ tone: 'good', text: 'Profile saved.' })
    } catch (reason) {
      setMessage({ tone: 'bad', text: errorMessage(reason) })
    } finally {
      setSaving(false)
    }
  }

  async function pickPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = '' // so picking the same file again still fires
    if (!file) return
    setPhotoBusy(true)
    setMessage(null)
    try {
      setProfile(await api.uploadAvatar(await squareWebp(file)))
    } catch (reason) {
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

  const since = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'long', year: 'numeric' }).format(
    new Date(profile.member_since),
  )

  return (
    <div className="space-y-6">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <Glass className="flex flex-col items-center gap-5 p-6 text-center sm:flex-row sm:text-left">
        <div className="relative">
          <Avatar name={profile.full_name} url={profile.avatar_url} size={96} />
          {photoBusy && <span className="absolute inset-0 animate-pulse rounded-full bg-black/40" aria-hidden="true" />}
        </div>
        <div className="flex-1">
          <p className="text-[16px] font-medium">Profile photo</p>
          <p className="mt-1 text-[14px] text-ink-2">Only you can see it. JPG, PNG or WebP.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
            <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={pickPhoto} tabIndex={-1} aria-hidden="true" />
            <Button variant="secondary" loading={photoBusy} onClick={() => fileInput.current?.click()}>
              <Camera size={18} />
              {profile.avatar_url ? 'Change photo' : 'Add photo'}
            </Button>
            {profile.avatar_url && (
              <Button variant="ghost" disabled={photoBusy} onClick={removePhoto}>
                <Trash size={18} />
                Remove
              </Button>
            )}
          </div>
        </div>
      </Glass>

      <Glass className="p-6">
        <form onSubmit={save} className="space-y-5" noValidate>
          <Field label="Full name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          <Field
            label="Mobile number"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            hint="The shop calls or texts this number only about your bookings."
          />
          <Field label="Email" type="email" value={session?.email ?? ''} readOnly disabled hint="You sign in with this email." />
          <div className="flex flex-col-reverse items-stretch gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-center text-[13px] text-ink-3 sm:text-left">Member since {since}</p>
            <Button type="submit" loading={saving} disabled={!changed}>
              Save changes
            </Button>
          </div>
        </form>
      </Glass>
    </div>
  )
}
