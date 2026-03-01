import type { PIIType } from '../types.ts'

const FIRST = [
  'Alice', 'Bob', 'Carol', 'David', 'Emma', 'Frank', 'Grace', 'Henry',
  'Isabella', 'Jack', 'Katherine', 'Liam', 'Mia', 'Noah', 'Olivia', 'Peter',
  'Quinn', 'Rachel', 'Samuel', 'Tara', 'Uma', 'Victor', 'Wendy', 'Xavier',
  'Yara', 'Zoe',
]
const LAST = [
  'Anderson', 'Brown', 'Clark', 'Davis', 'Evans', 'Foster', 'Garcia', 'Harris',
  'Jackson', 'King', 'Lee', 'Martinez', 'Nelson', 'Owen', 'Parker', 'Quinn',
  'Roberts', 'Smith', 'Taylor', 'Underwood', 'Vasquez', 'Walker', 'Young', 'Zhou',
]
const STREETS = [
  'Main St', 'Oak Ave', 'Maple Dr', 'Cedar Ln', 'Elm Blvd',
  'Pine Rd', 'River Way', 'Lake Dr', 'Hillside Ave', 'Park Blvd',
]
const CITIES = [
  'Springfield', 'Shelbyville', 'Rivertown', 'Lakewood', 'Hillside',
  'Maplewood', 'Greenfield', 'Fairview', 'Clearwater', 'Ridgewood',
]
const STATES = ['CA', 'TX', 'NY', 'FL', 'OH', 'WA', 'IL', 'AZ', 'GA', 'NC']
const DOMAINS = ['example.com', 'sample.org', 'test.net', 'demo.io', 'placeholder.dev']

/** Deterministic hash so the same original always produces the same fake. */
function h(s: string): number {
  let v = 5381
  for (let i = 0; i < s.length; i++) v = (Math.imul(v, 33) ^ s.charCodeAt(i)) >>> 0
  return v
}

function pick<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length]
}

function pad(n: number, len: number): string {
  return String(n).padStart(len, '0')
}

export function generateFake(original: string, type: PIIType): string {
  const s1 = h(original)
  const s2 = h(original + '\x01')
  const s3 = h(original + '\x02')

  switch (type) {
    case 'NAME': {
      const first = pick(FIRST, s1)
      const last  = pick(LAST, s2)
      // Detect title prefixes (Mr., Dr., Professor, etc.) and preserve them
      const titleMatch = original.match(/^(Mr\.|Mrs\.|Ms\.|Mx\.|Dr\.|Prof\.|Sir|Madam|Dame|Lord|Lady|Mister|Miss|Misses|Doctor|Professor|Herr|Frau|Señor|Señora|Don|Doña|Monsieur|Madame|Mademoiselle|Signore|Signora|Signor|Senhor|Senhora)\s+/i)
      if (titleMatch) {
        const title = titleMatch[1]
        const nameOnly = original.slice(titleMatch[0].length).trim()
        const nameWords = nameOnly.split(/\s+/)
        const fakeName = nameWords.length === 1 ? last : `${first} ${last}`
        return `${title} ${fakeName}`
      }
      return original.trim().split(/\s+/).length === 1 ? first : `${first} ${last}`
    }

    case 'EMAIL': {
      const first  = pick(FIRST, s1).toLowerCase()
      const last   = pick(LAST, s2).toLowerCase()
      const domain = pick(DOMAINS, s3)
      return `${first}.${last}@${domain}`
    }

    case 'PHONE': {
      const mid  = pad(100 + (s1 % 900), 3)
      const last4 = pad(s2 % 10000, 4)
      if (original.includes('-')) return `555-${mid}-${last4}`
      if (original.includes('.')) return `555.${mid}.${last4}`
      if (original.includes(' ') || original.includes('(')) return `(555) ${mid}-${last4}`
      return `555${mid}${last4}`
    }

    case 'SSN': {
      // Area 000 is always invalid — unambiguously fake
      const grp  = pad(s1 % 100, 2)
      const ser  = pad(s2 % 10000, 4)
      return `000-${grp}-${ser}`
    }

    case 'FINANCIAL': {
      // 4111 prefix = Visa test card, universally recognised as fake
      const a = pad(s1 % 10000, 4)
      const b = pad(s2 % 10000, 4)
      const digits = `4111${a}${b}`
      const sep = original.includes('-') ? '-'
                : original.includes(' ') ? ' '
                : ''
      if (sep) {
        return [digits.slice(0, 4), digits.slice(4, 8),
                digits.slice(8, 12), digits.slice(12, 16)].join(sep)
      }
      return digits
    }

    case 'ADDRESS': {
      const num  = 1000 + (s1 % 9000)
      const zip  = pad(10000 + (s2 % 90000), 5)
      return `${num} ${pick(STREETS, s1)}, ${pick(CITIES, s2)}, ${pick(STATES, s3)} ${zip}`
    }

    case 'ID': {
      const hex1 = pad(s1, 8).toString() // numeric string
      const hex2 = pad(s2, 8).toString()
      // UUID format
      if (/^[0-9a-f]{8}-/i.test(original)) {
        const h1 = s1.toString(16).padStart(8, '0')
        const h2 = s2.toString(16).padStart(12, '0')
        return `00000000-${h1.slice(0, 4)}-4${h1.slice(4, 7)}-a${h2.slice(0, 3)}-${h2}`
      }
      // All digits
      if (/^\d+$/.test(original)) {
        return (hex1 + hex2).replace(/\D/g, '0').slice(0, original.length).padStart(original.length, '0')
      }
      // Hex
      const hexStr = (s1.toString(16) + s2.toString(16)).padStart(40, '0')
      return hexStr.slice(0, original.length)
    }

    case 'SECRET': {
      const CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'
      let out = ''
      let cur = s1
      for (let i = 0; i < original.length; i++) {
        out += CHARS[cur % CHARS.length]
        cur = (Math.imul(cur, 1664525) + 1013904223) >>> 0
      }
      // Preserve common key prefixes (sk-, pk-, etc.)
      const pfx = original.match(/^([a-z]{1,6}[-_])/i)
      return pfx ? pfx[1] + out.slice(pfx[1].length) : out
    }

    case 'URL': {
      // Strip query string — keep origin + path
      try {
        const u = new URL(original)
        return u.origin + u.pathname
      } catch {
        return original.replace(/\?.*$/, '')
      }
    }

    case 'DATE': {
      const yr  = 2000 + (s1 % 23)
      const mo  = (s2 % 12) + 1
      const dy  = (s3 % 28) + 1
      const moStr = pad(mo, 2)
      const dyStr = pad(dy, 2)
      if (/^\d{4}-\d{2}-\d{2}$/.test(original))  return `${yr}-${moStr}-${dyStr}`
      if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(original)) return `${mo}/${dy}/${yr}`
      const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
      return `${MONTHS[mo - 1]} ${dy}, ${yr}`
    }

    case 'PATH':   return '[REDACTED: PATH]'
    case 'CUSTOM': return '[REDACTED]'
    default:       return '[REDACTED]'
  }
}
