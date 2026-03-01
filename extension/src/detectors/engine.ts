import type { PIIMatch, PIIType } from '../types.ts'
import { NameDetector } from './name.ts'
import { EmailDetector } from './email.ts'
import { PhoneDetector } from './phone.ts'
import { FinancialDetector } from './financial.ts'
import { IdentityDetector } from './identity.ts'
import { NetworkDetector } from './network.ts'
import { AddressDetector } from './address.ts'
import { LogDetector } from './log.ts'
import { DateDetector } from './date.ts'
import { ContextualDetector } from './base.ts'

const detectorInstances = [
  new NameDetector(),
  new EmailDetector(),
  new PhoneDetector(),
  new FinancialDetector(),
  new IdentityDetector(),
  new NetworkDetector(),
  new AddressDetector(),
  new LogDetector(),
  new DateDetector(),
]

export function buildCustomDetector(blockList: string[]): ContextualDetector | null {
  if (blockList.length === 0) return null
  const detector = new ContextualDetector()
  for (const term of blockList) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    detector.addRule({
      type: 'CUSTOM',
      score: 130,
      pattern: new RegExp(escaped, 'gi'),
    })
  }
  return detector
}

export function analyzeText(
  text: string,
  enabledTypes: PIIType[] | null = null,
  customBlockList: string[] = []
): PIIMatch[] {
  if (!text || text.length === 0) return []

  let allMatches: PIIMatch[] = []

  for (const detector of detectorInstances) {
    const matches = detector.scan(text)
    allMatches.push(...matches)
  }

  const customDetector = buildCustomDetector(customBlockList)
  if (customDetector) {
    allMatches.push(...customDetector.scan(text))
  }

  if (enabledTypes) {
    allMatches = allMatches.filter((m) => m.type === 'CUSTOM' || enabledTypes.includes(m.type))
  }

  return resolveOverlaps(allMatches)
}

export function resolveOverlaps(matches: PIIMatch[]): PIIMatch[] {
  matches.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start
    if (a.score !== b.score) return b.score - a.score
    return b.end - a.end
  })

  const filtered: PIIMatch[] = []
  let lastEnd = 0

  for (const m of matches) {
    if (m.start >= lastEnd) {
      filtered.push(m)
      lastEnd = m.end
    } else {
      const prev = filtered[filtered.length - 1]
      if (prev && m.score > prev.score) {
        filtered.pop()
        filtered.push(m)
        lastEnd = m.end
      }
    }
  }

  return filtered
}

/**
 * Request ML-based PII analysis from the background service worker.
 * Returns additional matches found by the ML model (score 70).
 * Falls back to empty array if the background is unreachable.
 */
function requestMLAnalysis(text: string): Promise<PIIMatch[]> {
  return new Promise((resolve) => {
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime?.id) {
        resolve([])
        return
      }
      chrome.runtime.sendMessage({ action: 'ML_ANALYZE', text }, (response) => {
        if (chrome.runtime.lastError || !response?.matches) {
          resolve([])
        } else {
          resolve(response.matches as PIIMatch[])
        }
      })
    } catch {
      resolve([])
    }
  })
}

/**
 * Async version of analyzeText that also incorporates ML model results.
 * Regex runs synchronously first, then ML results are merged in.
 */
export async function analyzeTextWithML(
  text: string,
  enabledTypes: PIIType[] | null = null,
  customBlockList: string[] = [],
): Promise<PIIMatch[]> {
  const regexMatches = analyzeText(text, enabledTypes, customBlockList)

  let mlMatches: PIIMatch[]
  try {
    mlMatches = await requestMLAnalysis(text)
  } catch {
    return regexMatches
  }

  if (mlMatches.length === 0) return regexMatches

  if (enabledTypes) {
    mlMatches = mlMatches.filter((m) => enabledTypes.includes(m.type))
  }

  const combined = [...regexMatches, ...mlMatches]
  return resolveOverlaps(combined)
}
