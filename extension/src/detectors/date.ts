import { ContextualDetector } from './base.ts'

export class DateDetector extends ContextualDetector {
  constructor() {
    super()

    // DATE OF BIRTH – numeric slash/dash/dot (MM/DD/YYYY, YYYY-MM-DD)
    this.addRule({
      type: 'DATE',
      score: 86,
      pattern: /\b(?:0?[1-9]|1[0-2])[\/\-](?:0?[1-9]|[12]\d|3[01])[\/\-](?:19|20)\d{2}\b/g,
    })
    this.addRule({
      type: 'DATE',
      score: 86,
      pattern: /\b(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\b/g,
    })

    // DATE OF BIRTH – written-out month (EN/FR/DE/ES)
    this.addRule({
      type: 'DATE',
      score: 86,
      pattern: /\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+(?:19|20)\d{2}\b/gi,
      keywords: ["dob", "born", "birth", "date of birth", "birthday", "née", "naît"],
      dist: 80,
    })
    this.addRule({
      type: 'DATE',
      score: 86,
      pattern: /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\.?,?\s+(?:19|20)\d{2}\b/gi,
      keywords: ["dob", "born", "birth", "date of birth", "birthday"],
      dist: 80,
    })
  }
}
