import { Glass } from '../components/ui'

// Plain-language privacy notice for the Data Privacy Act (RA 10173).
// TODO: the shop's legal name, address and contact person for privacy requests,
// once the owner approves. Have this reviewed before real customers use it.
export function PrivacyPage() {
  const sections = [
    {
      title: 'What we collect',
      body: 'Your email and password (to sign in), your name and mobile number, the bookings you make, and a profile photo if you choose to add one. If you use the contact form, the email or number and the note you send. We do not ask for anything else.',
    },
    {
      title: 'Why',
      body: 'To hold your seat, let the barbers know who is coming, and contact you if your booking has to change. We do not sell your data or share it with advertisers.',
    },
    {
      title: 'Who can see it',
      body: "The shop's front desk sees your name and number for bookings. Barbers see your name, not your number. Your photo is visible only to you.",
    },
    {
      title: 'Contact form',
      body: 'If you send a note, we keep your email and/or number and the note so the owner or front desk can reply. They are used only for that reply, never for promos. Ask us any time to delete a note you sent.',
    },
    {
      title: 'Reviews',
      body: 'Reviews of a barber or a branch show your username, the stars and your comment. Never your name or number. You can edit or remove your review, and deleting your data removes them all.',
    },
    {
      title: 'Promotions',
      body: 'We only send news or promos if you turn that on in Settings. It is off unless you choose it, and you can turn it off any time.',
    },
    {
      title: 'Deleting your data',
      body: 'In Settings you can delete your data. Your upcoming bookings are cancelled and your name, number and photo are removed. Records of past payments are kept without your name, as the shop needs them for its books.',
    },
    {
      title: 'Your rights',
      body: 'Under the Data Privacy Act of 2012 you can ask what we hold about you, correct it, or have it removed. Most of this you can do yourself in your account.',
    },
  ]
  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:py-20">
      <h1 className="text-[32px] font-semibold tracking-tight">Privacy notice</h1>
      <p className="mt-2 text-[16px] text-ink-2">How the shop handles your information, in plain words.</p>
      <Glass className="mt-8 divide-y divide-[var(--glass-line)]">
        {sections.map((s) => (
          <section key={s.title} className="p-6">
            <h2 className="text-[17px] font-medium">{s.title}</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{s.body}</p>
          </section>
        ))}
      </Glass>
    </div>
  )
}
