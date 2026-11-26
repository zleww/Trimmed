// The staff app is a separate site. The customer site only links to it.
export const STAFF_URL: string | null = import.meta.env.VITE_STAFF_URL || (import.meta.env.DEV ? 'http://localhost:5177' : null)
