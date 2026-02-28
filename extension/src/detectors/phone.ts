import { ContextualDetector } from './base.ts'

function phoneValidator(text: string): boolean {
  const digits = text.replace(/\D/g, '')
  if (digits.length < 7 || digits.length > 15) return false
  if (/^\d{3}-\d{2}-\d{4}$/.test(text)) return false     // SSN
  if (/^(?:19|20)\d{2}[\-./]\d{2}[\-./]\d{2}$/.test(text)) return false // ISO date
  if (/\r|\n/.test(text)) return false                    // no cross-line
  return true
}

export class PhoneDetector extends ContextualDetector {
  constructor() {
    super()

    // PHONE – NANP (North America)
    this.addRule({
      type: 'PHONE',
      score: 95,
      pattern: /(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}\b/g,
      validator: phoneValidator,
    })

    // PHONE – EU international (+3x, +4x)
    this.addRule({
      type: 'PHONE',
      score: 95,
      pattern: /\+(?:3[0-469]|4[0-9])\d{0,3}(?:[\s./_-]\d{1,12}){1,5}/g,
      validator: phoneValidator,
    })

    // PHONE – CIS/Russia
    this.addRule({
      type: 'PHONE',
      score: 95,
      pattern: /(?:\+7|8)[\s.\-]?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{2}[\s.\-]?\d{2}/g,
      validator: phoneValidator,
    })

    // PHONE – Asia international
    this.addRule({
      type: 'PHONE',
      score: 95,
      pattern: /\+(?:6[0-6]|8[1246]|9[0-8])\d{0,3}(?:[\s./_-]\d{1,12}){1,6}/g,
      validator: phoneValidator,
    })

    // PHONE – compact E.164 (+XXXXXXXXXXX)
    this.addRule({
      type: 'PHONE',
      score: 95,
      pattern: /\+\d{10,15}\b/g,
      validator: phoneValidator,
    })

    // PHONE – keyword-triggered (Tél:, Phone:, Cell:, Hotline:)
    this.addRule({
      type: 'PHONE',
      score: 95,
      pattern: /(?:T[ée]l|Fax|Phone|Cell|Hotline|Mobile)[\s]*:?\s*(\+?[\d\s.\-]{8,20})/gi,
      validator: phoneValidator,
    })
  }
}
