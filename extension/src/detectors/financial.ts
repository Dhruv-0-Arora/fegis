import { ContextualDetector } from './base.ts'

export class FinancialDetector extends ContextualDetector {
  constructor() {
    super()

    // ── CREDIT CARD – strict Luhn check ───
    this.addRule({
      type: 'FINANCIAL',
      score: 110,
      pattern: /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6(?:011|5\d{2}))[\s.-]?\d{4}[\s.-]?\d{4}[\s.-]?\d{1,7}\b/g,
      validator: (match) => {
        const d = match.replace(/[- ]/g, '')
        let sum = 0
        let alternate = false
        for (let i = d.length - 1; i >= 0; i--) {
          let n = parseInt(d[i], 10)
          if (alternate) {
            n *= 2
            if (n > 9) n -= 9
          }
          sum += n
          alternate = !alternate
        }
        return d.length >= 13 && d.length <= 19 && sum % 10 === 0
      },
    })

    // Routing / Account number (exactly 9 digits, contextual) 
    this.addRule({
      type: 'FINANCIAL',
      score: 110,
      pattern: /\b\d{9}\b/g,
      keywords: ["routing", "account number", "aba", "transit"],
      dist: 40,
    })

    // IBAN
    this.addRule({
      type: 'FINANCIAL',
      score: 115,
      pattern: /\b[A-Z]{2}\d{2}[\s]?[\dA-Z]{4}[\s]?(?:[\dA-Z]{4}[\s]?){1,7}[\dA-Z]{1,4}\b/g,
      validator: (match) => {
        const clean = match.replace(/\s/g, '')
        return clean.length >= 15 && clean.length <= 34 && /^[A-Z]{2}\d{2}/.test(clean)
      },
    })

    // CVV
    this.addRule({
      type: 'FINANCIAL',
      score: 100,
      pattern: /\b\d{3,4}\b/g,
      dist: 20,
      keywords: ['cvv', 'cvc', 'cvv2', 'security code', 'card verification'],
    })

    // Crypto wallet addresses 
    this.addRule({
      type: 'FINANCIAL',
      score: 95,
      pattern: /\b(?:0x[a-fA-F0-9]{40}|(?:bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62})\b/g,
    })
  }
}
