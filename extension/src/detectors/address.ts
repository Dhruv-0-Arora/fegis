import { ContextualDetector } from './base.ts'

export class AddressDetector extends ContextualDetector {
  constructor() {
    super()

    // GPS coordinates
    this.addRule({
      type: 'ADDRESS',
      score: 87,
      pattern: /-?\d{1,3}\.\d{4,},\s*-?\d{1,3}\.\d{4,}/g,
      validator: (match) => {
        const parts = match.split(',').map((p) => parseFloat(p.trim()))
        if (parts.length !== 2) return false
        const [lat, lon] = parts
        return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
      },
    })

    // US street addresses
    // Handles: house number, optional directional (N/S/E/W/NE/SE/…),
    //          optional ordinal street number (10th/21st/…), multi-word name,
    //          street type, and an optional trailing ", City, ST [zip]" suffix.
    this.addRule({
      type: 'ADDRESS',
      score: 85,
      pattern: /\b\d{1,6}\s+(?:(?:N\.?E\.?|N\.?W\.?|S\.?E\.?|S\.?W\.?|N\.?|S\.?|E\.?|W\.?|North|South|East|West|Northeast|Northwest|Southeast|Southwest)\.?\s+)?(?:\d{1,3}(?:st|nd|rd|th)\s+)?(?:[A-Za-z]+(?:\s+[A-Za-z]+)*\s+)?(?:Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Road|Rd|Lane|Ln|Way|Court|Ct|Place|Pl|Circle|Cir|Terrace|Ter|Parkway|Pkwy|Highway|Hwy|Trail|Trl|Alley|Aly|Freeway|Fwy|Expressway|Expy)\.?(?:,?\s+(?:[A-Za-z]+\s+){0,2}[A-Za-z]+,\s+[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?)?/gi,
      validator: (match) => {
        // Need at least 3 whitespace-separated tokens to avoid matching "1 St" noise
        return match.trim().split(/\s+/).length >= 3
      },
    })

    // UK postcodes
    this.addRule({
      type: 'ADDRESS',
      score: 65,
      pattern: /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/gi,
    })

    // Canadian postal codes
    this.addRule({
      type: 'ADDRESS',
      score: 65,
      pattern: /\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b/gi,
    })

    // US postal/zip codes (context-gated to reduce noise)
    this.addRule({
      type: 'ADDRESS',
      score: 60,
      pattern: /\b\d{5}(?:-\d{4})?\b/g,
      dist: 40,
      keywords: ['zip', 'postal', 'code', 'address', 'city', 'state'],
    })
  }
}
