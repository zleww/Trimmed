import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { LogOut, Monitor, Moon, Sun, Trash } from '../../components/icons'
import { Button, ButtonLink, Dialog, Field, Glass, Notice, Segmented, Toggle } from '../../components/ui'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { errorMessage } from '../../lib/format'
import type { Settings } from '../../lib/types'
import { useLoad } from '../../lib/useLoad'

// Preferences and account, shown under the profile. Every change saves right away, so there is no Save button to forget.
export function SettingsPage() {
  const { session, profile, setProfile, signOut } = useAuth()
  const navigate = useNavigate()
  const barbers = useLoad(() => api.listBarbers(), [])
  const branches = useLoad(() => api.listBranches(), [])
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)

  if (!profile) return null

  const settings: Settings = {
    theme: profile.theme,
    time_format: profile.time_format,
    preferred_barber: profile.preferred_barber,
    promo_opt_in: profile.promo_opt_in,
  }

  async function change(patch: Partial<Settings>) {
    if (!profile) return
    setMessage(null)
    // show the change at once, then save; put it back if saving fails
    const before = profile
    setProfile({ ...profile, ...patch })
    try {
      setProfile(await api.saveSettings({ ...settings, ...patch }))
    } catch (reason) {
      setProfile(before)
      setMessage({ tone: 'bad', text: errorMessage(reason) })
    }
  }

  async function deleteData() {
    setBusy(true)
    try {
      await api.deleteMyData()
      await signOut()
      navigate('/', { replace: true })
    } catch (reason) {
      setMessage({ tone: 'bad', text: errorMessage(reason) })
      setBusy(false)
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-8">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <Section title="Preferences">
        <Row label="Theme" description="System follows your phone's light or dark mode.">
          <Segmented
            label="Theme"
            value={settings.theme}
            onChange={(theme) => change({ theme })}
            options={[
              { value: 'dark', label: 'Dark', icon: <Moon size={16} /> },
              { value: 'light', label: 'Light', icon: <Sun size={16} /> },
              { value: 'system', label: 'System', icon: <Monitor size={16} /> },
            ]}
          />
        </Row>
        <Row label="Time format" description="How times are shown in the app.">
          <Segmented
            label="Time format"
            value={settings.time_format}
            onChange={(time_format) => change({ time_format })}
            options={[
              { value: '12h', label: '2:30 PM' },
              { value: '24h', label: '14:30' },
            ]}
          />
        </Row>
        <Row label="Favourite barber" description="Picked for you when you start a booking. You can still change it.">
          <select
            value={settings.preferred_barber ?? ''}
            onChange={(e) => change({ preferred_barber: e.target.value || null })}
            aria-label="Favourite barber"
            className="h-12 w-full rounded-2xl border border-glass-line bg-[var(--glass)] px-4 text-[16px] text-ink outline-none focus:border-ink-2 sm:w-64"
          >
            <option value="">No favourite</option>
            {/* grouped by location when there is more than one */}
            {(branches.data?.length ?? 0) > 1
              ? branches.data!.map((branch) => (
                  <optgroup key={branch.id} label={branch.name}>
                    {barbers.data
                      ?.filter((b) => b.branch_id === branch.id)
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.display_name}
                        </option>
                      ))}
                  </optgroup>
                ))
              : barbers.data?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.display_name}
                  </option>
                ))}
          </select>
        </Row>
        <div className="p-6">
          <Toggle
            label="News and promos"
            description="Occasional offers from the shop. Booking messages come either way."
            checked={settings.promo_opt_in}
            onChange={(promo_opt_in) => change({ promo_opt_in })}
          />
        </div>
      </Section>

      <Section title="Account">
        <Row label="Password" description={`For ${session?.email ?? 'your account'}.`}>
          <ButtonLink variant="secondary" to="/new-password">
            Change password
          </ButtonLink>
        </Row>
        <Row label="Sign out" description="On this device only.">
          <Button variant="secondary" onClick={() => signOut().then(() => navigate('/', { replace: true }))}>
            <LogOut size={18} />
            Sign out
          </Button>
        </Row>
      </Section>

      <Glass className="border-bad/30 p-6">
        <h2 className="text-[16px] font-medium text-bad">Delete my data</h2>
        <p className="mt-1 text-[14px] leading-relaxed text-ink-2">
          Cancels your upcoming bookings and removes your name, username, number, photo, reviews and inspo files. Past payment records stay with the shop, without your name. This can't be undone.
        </p>
        <Button variant="danger" className="mt-4" onClick={() => setDeleting(true)}>
          <Trash size={18} />
          Delete my data
        </Button>
      </Glass>

      <Dialog open={deleting} title="Delete your data?" onClose={() => setDeleting(false)}>
        <p className="text-[15px] text-ink-2">Type DELETE to confirm. Your upcoming bookings will be cancelled.</p>
        <Field label="Confirm" className="mt-4" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={() => setDeleting(false)}>
            Keep my account
          </Button>
          <Button variant="danger" disabled={confirmText.trim().toUpperCase() !== 'DELETE'} loading={busy} onClick={deleteData}>
            Delete everything
          </Button>
        </div>
      </Dialog>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-[14px] font-medium tracking-wide text-ink-2">{title}</h2>
      <Glass className="divide-y divide-[var(--glass-line)]">{children}</Glass>
    </section>
  )
}

function Row({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-[15px] font-medium">{label}</p>
        {description && <p className="mt-0.5 text-[14px] text-ink-2">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
