import { ContextualDetector } from './base.ts'
import { FIRST_NAMES } from './data/first-names.ts'
import { LAST_NAMES } from './data/last-names.ts'
import { COMMON_WORDS } from './data/common-words.ts'

const PREFIXES_RAW = [
  'Mister','Miss','Misses','Mrs','Mrs\\.','Ms','Ms\\.','Mr','Mr\\.','Mx','Mx\\.',
  'Doctor','Dr','Dr\\.','Professor','Prof','Prof\\.','Sir','Madam','Dame','Lord','Lady',
  'Monsieur','Madame','Mademoiselle','Mme','Mme\\.','Mlle','Mlle\\.','M','M\\.',
  'Herr','Frau','Doktor',
  'Señor','Señora','Señorita','Don','Doña','Sr','Sr\\.','Sra','Sra\\.',
  'Signore','Signora','Signorina','Signor',
  'Senhor','Senhora',
]
const PREFIXES = PREFIXES_RAW.sort((a, b) => b.length - a.length).join('|')

const GREETINGS = [
  'Hi','Hello','Hey','Dear','Greetings','Good morning','Good afternoon','Good evening',
  'Hola','Bonjour','Salut','Ciao','Olá',
  'Hallo','Hej','Namaste','Sup','Yo','What\'s up',
].sort((a, b) => b.length - a.length).join('|')

const INTRODUCTIONS = [
  'my name is','i am','i\'m','this is','call me',
  'je m\'appelle','mon nom est','je suis',
  'ich heiße','mein name ist','ich bin',
  'me llamo','mi nombre es','soy',
  'mi chiamo','il mio nome è',
  'his name is','her name is','their name is','its name is',
  'named','called','known as','goes by','referred to as',
  'first name','last name','nickname','surname',
  'contact','sent by','from','signed','written by','authored by',
  'regards','sincerely','best','cheers','thanks',
  'attention','attn','to','cc','bcc',
].sort((a, b) => b.length - a.length).join('|')

function toTitleCase(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()
}

function isCommon(word: string): boolean {
  return COMMON_WORDS.has(word.toLowerCase()) || COMMON_WORDS.has(toTitleCase(word))
}

function isKnownFirstName(word: string): boolean {
  return FIRST_NAMES.has(toTitleCase(word)) || FIRST_NAMES.has(word)
}

function isKnownLastName(word: string): boolean {
  return LAST_NAMES.has(toTitleCase(word))
}

function isKnownName(word: string): boolean {
  return isKnownFirstName(word) || isKnownLastName(word)
}

function looksLikeName(word: string): boolean {
  if (word.length < 2 || word.length > 30) return false
  if (/\d/.test(word)) return false
  return /^[A-Z][a-zA-Z'-]+$/.test(word)
}

export class NameDetector extends ContextualDetector {
  constructor() {
    super()

    // Title/prefix + capitalized word(s): "Mr. Smith", "Dr. John Doe", "Professor Henke"
    // The prefix is included in the matched text so the whole thing is one token
    this.addRule({
      type: 'NAME',
      score: 90,
      pattern: new RegExp(
        `(?:${PREFIXES})\\s+[A-Z][a-zA-Z'-]+(?:\\s+[A-Z][a-zA-Z'-]+)*\\b`,
        'g'
      ),
    })

    // Introduction + any word(s): "my name is John", "I'm Sarah", "call me Dave"
    // Strong context — accept any capitalized word, no need for name-list lookup
    this.addRule({
      type: 'NAME',
      score: 88,
      pattern: /\b[A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)?\b/g,
      contextBefore: new RegExp(`(?:${INTRODUCTIONS})[,:]?\\s+$`, 'i'),
      validator: (match) => {
        const words = match.split(/\s+/)
        return words.every((w) => looksLikeName(w))
      },
    })

    // Introduction + lowercase name: "my name is john" (people often don't capitalize)
    this.addRule({
      type: 'NAME',
      score: 86,
      pattern: /\b[a-zA-Z][a-zA-Z'-]+(?:\s+[a-zA-Z][a-zA-Z'-]+)?\b/g,
      contextBefore: new RegExp(`(?:${INTRODUCTIONS})[,:]?\\s+$`, 'i'),
      validator: (match) => {
        const words = match.split(/\s+/)
        if (words.some((w) => isCommon(w) && !isKnownName(w))) return false
        return words.some((w) => isKnownName(w))
      },
    })

    // Greeting + capitalized word: "Hi John", "Hello Sarah", "Hey Mike"
    // Accept any capitalized word that isn't a common English word
    this.addRule({
      type: 'NAME',
      score: 85,
      pattern: /\b[A-Z][a-zA-Z'-]+\b/g,
      contextBefore: new RegExp(`(?:${GREETINGS})[,!]?\\s+$`, 'i'),
      validator: (match) => !isCommon(match) && looksLikeName(match),
    })

    // Two+ capitalised words where first is known first name and last is known last name: "John Smith"
    this.addRule({
      type: 'NAME',
      score: 82,
      pattern: /\b[A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)+\b/g,
      validator: (match) => {
        const words = match.split(/\s+/)
        if (words.length < 2 || words.length > 4) return false
        if (words.some((w) => isCommon(w) && !isKnownName(w))) return false
        const firstKnown = isKnownFirstName(words[0])
        const lastKnown = isKnownLastName(words[words.length - 1])
        return firstKnown && lastKnown
      },
    })

    // Two capitalised words where at least one is a known name: "Priya Patel", "Chen Wei"
    this.addRule({
      type: 'NAME',
      score: 79,
      pattern: /\b[A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)+\b/g,
      validator: (match) => {
        const words = match.split(/\s+/)
        if (words.length < 2 || words.length > 4) return false
        if (words.some((w) => isCommon(w) && !isKnownName(w))) return false
        return words.some((w) => isKnownName(w))
      },
    })

    // Standalone known first name (not a common word): "John", "Sarah"
    this.addRule({
      type: 'NAME',
      score: 78,
      pattern: /\b[A-Z][a-zA-Z'-]{1,30}\b/g,
      validator: (word) => !isCommon(word) && isKnownFirstName(word),
    })

    // Username context: "username: john_doe"
    this.addRule({
      type: 'NAME',
      score: 80,
      pattern: /\b[a-zA-Z0-9._-]{3,30}\b/g,
      contextBefore: /(?:username|login|user|handle|alias)\s*[:=]\s*$/i,
      validator: (val) => val.length > 2,
    })
  }
}
