import { ContextualDetector } from './base.ts'

export class IdentityDetector extends ContextualDetector {
  constructor() {
    super()

    // US Social Security Number (strict dash)
    this.addRule({
      type: 'SSN',
      score: 100,
      pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
      validator: (match) => {
        const clean = match.replace(/[-\s]/g, '')
        if (clean.length !== 9) return false
        const area = parseInt(clean.substring(0, 3), 10)
        if (area === 0 || area === 666 || area >= 900) return false
        const group = parseInt(clean.substring(3, 5), 10)
        if (group === 0) return false
        const serial = parseInt(clean.substring(5), 10)
        if (serial === 0) return false
        return true
      },
    })

    // US Social Security Number (contextual)
    this.addRule({
      type: 'SSN',
      score: 95,
      pattern: /\b(\d{3})[ .](\d{2})[ .](\d{4})\b/g,
      dist: 40,
      keywords: ["ssn", "social", "security", "secu"],
    })

    // Passport numbers (context-required)
    this.addRule({
      type: 'ID',
      score: 90,
      pattern: /\b[A-Z0-9]{6,9}\b/g,
      dist: 30,
      keywords: ['passport', 'passeport', 'reisepass', 'pasaporte'],
      validator: (match) => /[A-Z]/.test(match) && /\d/.test(match),
    })

    // Generic ID with context
    this.addRule({
      type: 'ID',
      score: 83,
      pattern: /\b[A-Z0-9]{5,20}\b/g,
      dist: 30,
      keywords: ['id', 'license', 'licence', 'permit', 'registration', 'badge', 'employee id', 'member'],
      validator: (match) => {
        if (/^[0-9]+$/.test(match) && match.length < 6) return false
        return true
      },
    })

    // License plates (common formats)
    this.addRule({
      type: 'ID',
      score: 88,
      pattern: /\b[A-Z]{1,3}[-\s]?\d{1,4}[-\s]?[A-Z]{1,3}\b/g,
      dist: 30,
      keywords: ['plate', 'license plate', 'registration', 'vehicle'],
    })

    // VIN (Vehicle Identification Number - 17 alphanumeric, no I/O/Q)
    this.addRule({
      type: 'ID',
      score: 98,
      pattern: /\b[A-HJ-NPR-Z0-9]{17}\b/g,
      validator: (match) => /[A-Z]/.test(match) && /\d/.test(match),
    })
  }
}
