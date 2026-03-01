import type { PIIMatch, PIIType, TokenMap, TokenizeResult } from '../types.ts'
import { generateFake } from './fake-data.ts'

/** Access chrome APIs in a way that type-checks in both extension and web (no global chrome type required). */
function getChrome(): { storage?: { session?: { get: (keys: string[], cb: (r: Record<string, unknown>) => void) => void; set: (obj: object, cb?: () => void) => void } }; runtime?: { lastError?: unknown } } | undefined {
  return typeof globalThis !== 'undefined'
    ? (globalThis as unknown as { chrome?: { storage?: { session?: { get: (k: string[], cb: (r: Record<string, unknown>) => void) => void; set: (o: object, cb?: () => void) => void }; runtime?: { lastError?: unknown } } } }).chrome
    : undefined
}

// Replacement map: "${type}:${original}" → fake value
// Persisted in session storage so the same PII always gets the same fake across queries.
let replacementMap: Record<string, string> = {}

export function getFakeReplacement(match: PIIMatch): string {
  const key = `${match.type}:${match.text}`
  if (replacementMap[key]) return replacementMap[key]
  const fake = generateFake(match.text, match.type)
  replacementMap[key] = fake
  return fake
}

export function getReplacementMap(): Record<string, string> {
  return { ...replacementMap }
}

export function getKnownFakeValues(): Set<string> {
  return new Set(Object.values(replacementMap))
}

export function setReplacementMap(map: Record<string, string>) {
  replacementMap = { ...map }
}

export async function loadReplacementMap(): Promise<Record<string, string>> {
  const chrome = getChrome()
  const session = chrome?.storage?.session
  if (!isContextValid() || !session) return getReplacementMap()
  return new Promise((resolve) => {
    try {
      session.get(['replacementMap'], (result: Record<string, unknown>) => {
        if (chrome?.runtime?.lastError) {
          resolve(getReplacementMap())
          return
        }
        if (result.replacementMap) replacementMap = result.replacementMap as Record<string, string>
        resolve(getReplacementMap())
      })
    } catch {
      resolve(getReplacementMap())
    }
  })
}

export async function saveReplacementMap(): Promise<void> {
  const chrome = getChrome()
  const session = chrome?.storage?.session
  if (!isContextValid() || !session) return
  return new Promise((resolve) => {
    try {
      session.set({ replacementMap }, () => {
        if (chrome?.runtime?.lastError) { /* ignore */ }
        resolve()
      })
    } catch {
      resolve()
    }
  })
}

const TYPE_TOKEN_PREFIX: Record<PIIType, string> = {
  NAME: 'name',
  EMAIL: 'email',
  PHONE: 'phone',
  FINANCIAL: 'financial',
  SSN: 'ssn',
  ID: 'id',
  ADDRESS: 'address',
  SECRET: 'secret',
  URL: 'url',
  DATE: 'date',
  CUSTOM: 'custom',
  PATH: 'path',
}

const PATH_TOKEN = '[REDACTED: PATH]'

const counters: Record<string, number> = {}
let tokenMap: TokenMap = {}

function isContextValid(): boolean {
  try {
    const chrome = getChrome()
    return !!(chrome?.runtime && 'id' in chrome.runtime)
  } catch {
    return false
  }
}

export function getTokenMap(): TokenMap {
  return { ...tokenMap }
}

export function setTokenMap(map: TokenMap) {
  tokenMap = { ...map }
}

export function clearTokens() {
  Object.keys(counters).forEach((k) => delete counters[k])
  tokenMap = {}
}

function findExistingToken(text: string): string | null {
  for (const [token, original] of Object.entries(tokenMap)) {
    if (original === text) return token
  }
  return null
}

function createToken(type: PIIType): string {
  const prefix = TYPE_TOKEN_PREFIX[type] || type.toLowerCase()
  if (!counters[prefix]) counters[prefix] = 0
  counters[prefix]++
  return `[${prefix}_${counters[prefix]}]`
}

export function tokenize(matches: PIIMatch[], text: string): TokenizeResult {
  let maskedText = ''
  let currentIndex = 0

  for (const match of matches) {
    maskedText += text.substring(currentIndex, match.start)

    let token: string
    if (match.type === 'PATH') {
      token = PATH_TOKEN
    } else {
      token = findExistingToken(match.text) ?? ''
      if (!token) {
        token = createToken(match.type)
        tokenMap[token] = match.text
      }
    }

    maskedText += token
    currentIndex = match.end
  }

  maskedText += text.substring(currentIndex)

  return { maskedText, tokenMap: getTokenMap() }
}

export function detokenize(maskedText: string): string {
  return maskedText.replace(
    /\[[a-z]+_\d+\]/g,
    (token) => tokenMap[token] || token
  )
}

export function getTokenForMatch(match: PIIMatch): string {
  if (match.type === 'PATH') return PATH_TOKEN
  const existing = findExistingToken(match.text)
  if (existing) return existing
  const token = createToken(match.type)
  tokenMap[token] = match.text
  return token
}

export async function loadTokenMap(): Promise<TokenMap> {
  const chrome = getChrome()
  const session = chrome?.storage?.session
  if (!isContextValid() || !session) return getTokenMap()
  return new Promise((resolve) => {
    try {
      session.get(['tokenMap'], (result: Record<string, unknown>) => {
        if (chrome?.runtime?.lastError) {
          resolve(getTokenMap())
          return
        }
        if (result.tokenMap) {
          const loadedMap = result.tokenMap as TokenMap
          // Defensively filter out corrupt keys from past bugs (e.g. fake values stored instead of tokens)
          const validMap: TokenMap = {}
          for (const [key, value] of Object.entries(loadedMap)) {
            if (/^\[[a-z]+_\d+\]$/.test(key) || key === PATH_TOKEN) {
              validMap[key] = value
            }
          }
          tokenMap = validMap
        }
        resolve(getTokenMap())
      })
    } catch {
      resolve(getTokenMap())
    }
  })
}

export async function saveTokenMap(): Promise<void> {
  const chrome = getChrome()
  const session = chrome?.storage?.session
  if (!isContextValid() || !session) return
  return new Promise((resolve) => {
    try {
      session.set({ tokenMap }, () => {
        if (chrome?.runtime?.lastError) { /* ignore */ }
        resolve()
      })
    } catch {
      resolve()
    }
  })
}
