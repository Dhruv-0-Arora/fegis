import { useState, useMemo, useRef, useCallback } from 'react'
import { analyzeText } from '@extension/detectors/engine'
import { tokenize, clearTokens } from '@extension/tokens/manager'
import { generateFake } from '@extension/tokens/fake-data'
import type { PIIMatch, PIIType } from '@extension/types'

const DEFAULT_ENABLED_TYPES: PIIType[] = [
  'NAME', 'EMAIL', 'PHONE', 'FINANCIAL', 'SSN', 'ID', 'ADDRESS', 'SECRET', 'URL', 'DATE', 'PATH',
]

const TYPE_BORDER: Record<PIIType, string> = {
  NAME: '#5E81AC',
  EMAIL: '#EBCB8B',
  PHONE: '#B48EAD',
  FINANCIAL: '#BF616A',
  SSN: '#BF616A',
  ID: '#D08770',
  ADDRESS: '#8FBCBB',
  SECRET: '#BF616A',
  URL: '#81A1C1',
  DATE: '#A3BE8C',
  CUSTOM: '#D08770',
  PATH: '#A3BE8C',
}

const TYPE_BG: Record<PIIType, string> = {
  NAME: 'rgba(94,129,172,0.22)',
  EMAIL: 'rgba(235,203,139,0.22)',
  PHONE: 'rgba(180,142,173,0.22)',
  FINANCIAL: 'rgba(191,97,106,0.22)',
  SSN: 'rgba(191,97,106,0.22)',
  ID: 'rgba(208,135,112,0.22)',
  ADDRESS: 'rgba(143,188,187,0.22)',
  SECRET: 'rgba(191,97,106,0.25)',
  URL: 'rgba(129,161,193,0.22)',
  DATE: 'rgba(163,190,140,0.22)',
  CUSTOM: 'rgba(208,135,112,0.22)',
  PATH: 'rgba(163,190,140,0.20)',
}

const PLACEHOLDER = 'Message AI assistant...'

const SUGGESTIONS: { label: string; icon: string; content: string }[] = [
  {
    label: 'Name',
    icon: '👤',
    content: 'Hi, my name is Sarah Johnson — nice to meet you. Please reach out anytime.',
  },
  {
    label: 'Email',
    icon: '✉️',
    content: 'Reach me at sarah.johnson@company.com for any inquiries.',
  },
  {
    label: 'Phone',
    icon: '📞',
    content: 'Call me at (206) 555-8742 or text me at +1-206-555-8742 anytime.',
  },
  {
    label: 'Credit Card',
    icon: '💳',
    content: 'Please charge my Visa: 4111 1111 1111 1111, exp 04/27, CVV 319.',
  },
  {
    label: 'SSN + DOB',
    icon: '🪪',
    content: 'My SSN is 372-14-8562 and my date of birth is 03/15/1984.',
  },
  {
    label: 'Address',
    icon: '🏠',
    content: 'Ship to 742 Evergreen Terrace, Springfield, IL 62701.',
  },
  {
    label: 'API Key',
    icon: '🔑',
    content: 'Here is my API token: sk_live_xK3mNpQ2rYsT4uVwZa8bC9dEfGhIjKl',
  },
  {
    label: 'URL',
    icon: '🔗',
    content: 'See the dashboard at https://app.example.com/settings?api_token=abc123xyz456&session_id=9182',
  },
  {
    label: 'UUID / ID',
    icon: '🔢',
    content: 'Request trace ID: 550e8400-e29b-41d4-a716-446655440000',
  },
  {
    label: 'File Path',
    icon: '📁',
    content: 'App crashed reading /etc/app/config.yml — see full trace at /var/log/app/error.log',
  },
  {
    label: 'Log File',
    icon: '📋',
    content: '[2024-03-15 09:14:02] ERROR auth failed for user jsmith@corp.net from 192.168.1.42 — token_x9f2k8m3abc4def5ghi6jklm',
  },
]

function HighlightedText({ text, matches }: { text: string; matches: PIIMatch[] }) {
  if (!text) return null
  if (matches.length === 0) return <>{text}</>

  const parts: (string | { type: PIIType; text: string })[] = []
  let last = 0
  for (const m of matches) {
    if (m.start > last) parts.push(text.slice(last, m.start))
    parts.push({ type: m.type, text: m.text })
    last = m.end
  }
  if (last < text.length) parts.push(text.slice(last))

  return (
    <>
      {parts.map((p, i) =>
        typeof p === 'string' ? (
          <span key={i}>{p}</span>
        ) : (
          <mark
            key={i}
            className="rounded border-b-2"
            style={{
              background: TYPE_BG[p.type] ?? 'rgba(129,161,193,0.22)',
              borderBottomColor: TYPE_BORDER[p.type] ?? '#81A1C1',
              color: 'inherit',
              padding: 0,
            }}
            title={p.type}
          >
            {p.text}
          </mark>
        ),
      )}
    </>
  )
}

interface MappingEntry {
  type: PIIType
  original: string
  fake: string
}

export default function HeroDemo() {
  const [input, setInput] = useState('')
  const [redactMode, setRedactMode] = useState<'labels' | 'replaced'>('labels')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  const syncScroll = useCallback(() => {
    const ta = textareaRef.current
    const ov = overlayRef.current
    if (ta && ov) {
      ov.scrollTop = ta.scrollTop
      ov.scrollLeft = ta.scrollLeft
    }
  }, [])

  const { matches, maskedText, maskedMatches, replacedText, replacedMatches, hasPII, error, mappings } = useMemo(() => {
    const empty = {
      matches: [] as PIIMatch[],
      maskedText: '',
      maskedMatches: [] as PIIMatch[],
      replacedText: '',
      replacedMatches: [] as PIIMatch[],
      hasPII: false,
      error: null as string | null,
      mappings: [] as MappingEntry[],
    }
    if (!input.trim()) return empty
    try {
      clearTokens()
      const m = analyzeText(input, DEFAULT_ENABLED_TYPES, [])
      const result = tokenize(m, input)

      const seen = new Set<string>()
      const mappings: MappingEntry[] = []
      const fakeMap = new Map<string, string>()
      for (const match of m) {
        const k = `${match.type}:${match.text}`
        if (seen.has(k)) continue
        seen.add(k)
        const fake = generateFake(match.text, match.type)
        fakeMap.set(k, fake)
        mappings.push({ type: match.type, original: match.text, fake })
      }

      const tokenMap = result.tokenMap
      const maskedMatches: PIIMatch[] = []
      let mIdx = 0
      let mPos = 0
      for (const match of m) {
        const before = input.substring(mIdx, match.start)
        mPos += before.length
        const tokenKey = Object.entries(tokenMap).find(([, v]) => v === match.text)?.[0] ?? match.text
        const newStart = mPos
        mPos += tokenKey.length
        maskedMatches.push({ text: tokenKey, type: match.type, start: newStart, end: mPos, score: match.score })
        mIdx = match.end
      }

      let replaced = ''
      const replacedMatches: PIIMatch[] = []
      let rIdx = 0
      for (const match of m) {
        replaced += input.substring(rIdx, match.start)
        const fake = fakeMap.get(`${match.type}:${match.text}`) ?? match.text
        const newStart = replaced.length
        replaced += fake
        replacedMatches.push({ text: fake, type: match.type, start: newStart, end: replaced.length, score: match.score })
        rIdx = match.end
      }
      replaced += input.substring(rIdx)

      return {
        matches: m,
        maskedText: result.maskedText,
        maskedMatches,
        replacedText: replaced,
        replacedMatches,
        hasPII: m.length > 0,
        error: null,
        mappings,
      }
    } catch (e) {
      return { ...empty, error: e instanceof Error ? e.message : 'Detection failed' }
    }
  }, [input])

  return (
    <div className="space-y-4 text-left select-text" style={{ pointerEvents: 'auto' }}>
      {/* Suggestion chips — always visible */}
      <div className="flex flex-wrap gap-2">
        {SUGGESTIONS.map(({ label, icon, content }, i) => (
          <button
            key={i}
            className={`flex items-center gap-1.5 text-xs rounded-full px-3 py-1.5 border transition-all cursor-pointer ${
              input === content
                ? 'bg-[#88C0D0]/15 border-[#88C0D0] text-[#88C0D0]'
                : 'text-[#D8DEE9] bg-[#3B4252] border-[#434C5E] hover:border-[#88C0D0] hover:text-[#ECEFF4]'
            }`}
            onClick={() => setInput(content)}
            title={content}
          >
            <span className="text-[11px]">{icon}</span>
            {label}
          </button>
        ))}
      </div>

      {/* Chat-style input with inline highlight overlay */}
      <div className="relative rounded-2xl bg-[#2E3440] border border-[#434C5E] transition-colors">
        {input && matches.length > 0 && (
          <div
            ref={overlayRef}
            className="absolute inset-0 p-4 pr-14 rounded-2xl overflow-hidden pointer-events-none z-0 text-sm font-mono whitespace-pre-wrap break-words leading-relaxed"
            aria-hidden
            style={{ color: 'transparent' }}
          >
            <HighlightedText text={input} matches={matches} />
          </div>
        )}
        <textarea
          ref={textareaRef}
          id="hero-demo-input"
          className="w-full p-4 pr-14 rounded-2xl bg-transparent text-[#ECEFF4] text-sm font-mono resize-none outline-none select-text placeholder-[#4C566A] relative z-[1] caret-[#ECEFF4] whitespace-pre-wrap break-words leading-relaxed"
          placeholder={PLACEHOLDER}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onScroll={syncScroll}
          onInput={(e) => {
            const el = e.target as HTMLTextAreaElement
            el.style.height = '0'
            el.style.height = `${Math.max(40, el.scrollHeight)}px`
          }}
          spellCheck={false}
          rows={1}
          aria-label="Type or paste text to see PII detection"
        />
        <div className="absolute right-3 bottom-3 flex items-center gap-2 z-[2]">
          {hasPII && (
            <span className="text-[10px] font-semibold text-[#BF616A] bg-[#BF616A]/10 px-2 py-1 rounded-full">
              {matches.length} PII
            </span>
          )}
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
              input.trim() ? 'bg-[#88C0D0] text-[#2E3440]' : 'bg-[#3B4252] text-[#4C566A]'
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2L11 13" /><path d="M22 2L15 22L11 13L2 9L22 2Z" />
            </svg>
          </div>
        </div>
      </div>

      {/* Results */}
      {input.trim() && (
        <>
          {hasPII && (
            <div className="rounded-xl border border-[#88C0D0]/30 bg-[#2E3440] p-4">
              <div className="text-xs font-mono text-[#88C0D0] uppercase tracking-wider mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#88C0D0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                  Safe to send
                </div>
                <div className="flex bg-[#3B4252] rounded-lg p-0.5 gap-0.5">
                  <button
                    className={`px-2.5 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wider transition-all ${
                      redactMode === 'labels'
                        ? 'bg-[#88C0D0]/20 text-[#88C0D0]'
                        : 'text-[#4C566A] hover:text-[#D8DEE9]'
                    }`}
                    onClick={() => setRedactMode('labels')}
                  >
                    Labels
                  </button>
                  <button
                    className={`px-2.5 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wider transition-all ${
                      redactMode === 'replaced'
                        ? 'bg-[#88C0D0]/20 text-[#88C0D0]'
                        : 'text-[#4C566A] hover:text-[#D8DEE9]'
                    }`}
                    onClick={() => setRedactMode('replaced')}
                  >
                    Replaced
                  </button>
                </div>
              </div>
              <p className="font-mono text-sm text-[#D8DEE9] whitespace-pre-wrap break-words leading-relaxed">
                <HighlightedText
                  text={redactMode === 'labels' ? maskedText : replacedText}
                  matches={redactMode === 'labels' ? maskedMatches : replacedMatches}
                />
              </p>
            </div>
          )}

          {mappings.length > 0 && (
            <div className="rounded-xl border border-[#434C5E] bg-[#2E3440] p-4">
              <div className="text-xs font-mono text-[#81A1C1] uppercase tracking-wider mb-1 flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#81A1C1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" />
                  <polyline points="21 16 21 21 16 21" /><line x1="15" y1="15" x2="21" y2="21" />
                </svg>
                Replacement Map
              </div>
              <p className="text-[11px] text-[#4C566A] mb-3">Same value always maps to the same replacement.</p>
              <div className="space-y-1.5">
                {mappings.map(({ type, original, fake }) => (
                  <div key={`${type}:${original}`} className="flex items-center gap-2 text-xs font-mono">
                    <span
                      className="text-[9px] font-bold uppercase border rounded px-1.5 py-0.5 flex-shrink-0"
                      style={{ color: TYPE_BORDER[type], borderColor: TYPE_BORDER[type], opacity: 0.85 }}
                    >
                      {type}
                    </span>
                    <span className="text-[#D8DEE9] truncate flex-1 opacity-75">{original}</span>
                    <span className="text-[#4C566A] flex-shrink-0">&rarr;</span>
                    <span className="text-[#ECEFF4] font-semibold truncate flex-1">{fake}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {error && (
        <p className="text-[#BF616A] text-sm font-mono" role="alert">{error}</p>
      )}
    </div>
  )
}
