/** 25000 -> "₱250", 25050 -> "₱250.50" */
export function peso(centavos: number): string {
  const whole = centavos % 100 === 0
  return `₱${(centavos / 100).toLocaleString('en-PH', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`
}

/** 30 -> "30 min", 60 -> "1 hr", 75 -> "1 hr 15 min" */
export function duration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`
}

/** "09171234567" -> "0917 123 4567" */
export function prettyMobile(mobile: string): string {
  return mobile.replace(/^(\d{4})(\d{3})(\d{4})$/, '$1 $2 $3')
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('')
}

export function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Something went wrong. Please try again.'
}
