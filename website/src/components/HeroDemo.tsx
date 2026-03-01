import { useState, useMemo, useRef, useCallback } from 'react'
import { analyzeText } from '@extension/detectors/engine'
import { tokenize, clearTokens } from '@extension/tokens/manager'
import { generateFake } from '@extension/tokens/fake-data'
import type { PIIMatch, PIIType } from '@extension/types'
import * as pdfjsLib from 'pdfjs-dist'
import mammoth from 'mammoth'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url,
).toString()

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

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

async function extractTextFromPDF(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise
  const pages: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
    pages.push(text)
  }
  return pages.join('\n\n')
}

async function extractTextFromDOCX(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const result = await mammoth.extractRawText({ arrayBuffer: buffer })
  return result.value
}

function extractTextFromFile(file: File): Promise<string> {
  if (file.type === DOCX_MIME || file.name.endsWith('.docx')) {
    return extractTextFromDOCX(file)
  }
  return extractTextFromPDF(file)
}

function isSupportedFile(file: File): boolean {
  return file.type === 'application/pdf' || file.type === DOCX_MIME || file.name.endsWith('.docx')
}

export default function HeroDemo() {
  const [mode, setMode] = useState<'text' | 'file'>('text')
  const [input, setInput] = useState('')
  const [redactMode, setRedactMode] = useState<'labels' | 'replaced'>('labels')
  const [fileLoading, setFileLoading] = useState(false)
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
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

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileLoading(true)
    setUploadedFileName(file.name)
    try {
      const text = await extractTextFromFile(file)
      setInput(text)
    } catch {
      setInput('')
      setUploadedFileName(null)
    } finally {
      setFileLoading(false)
    }
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (!file || !isSupportedFile(file)) return
    setFileLoading(true)
    setUploadedFileName(file.name)
    try {
      const text = await extractTextFromFile(file)
      setInput(text)
    } catch {
      setInput('')
      setUploadedFileName(null)
    } finally {
      setFileLoading(false)
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
    <div className="space-y-6 text-left select-text" style={{ pointerEvents: 'auto' }}>
      {/* Mode toggle — Text vs File Upload */}
      <div className="flex justify-center">
        <div className="flex bg-[#3B4252] rounded-lg p-0.5 gap-0.5">
          <button
            className={`px-4 py-2 rounded-md text-xs font-semibold uppercase tracking-wider transition-all flex items-center gap-2 ${
              mode === 'text'
                ? 'bg-[#88C0D0]/20 text-[#88C0D0]'
                : 'text-[#4C566A] hover:text-[#D8DEE9]'
            }`}
            onClick={() => { setMode('text'); setInput(''); setUploadedFileName(null) }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
            Text
          </button>
          <button
            className={`px-4 py-2 rounded-md text-xs font-semibold uppercase tracking-wider transition-all flex items-center gap-2 ${
              mode === 'file'
                ? 'bg-[#88C0D0]/20 text-[#88C0D0]'
                : 'text-[#4C566A] hover:text-[#D8DEE9]'
            }`}
            onClick={() => { setMode('file'); setInput(''); setUploadedFileName(null) }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            File Upload
          </button>
        </div>
      </div>

      {mode === 'text' ? (
        <>
          {/* Example buttons */}
          <div className="rounded-xl border border-[#434C5E]/60 bg-[#3B4252]/25 backdrop-blur-md p-4">
            <p className="text-xs font-mono text-[#81A1C1] uppercase tracking-wider mb-3">Examples</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map(({ label, icon, content }, i) => (
                <button
                  key={i}
                  className={`flex items-center gap-1.5 text-xs rounded-full px-3 py-1.5 border transition-all cursor-pointer ${
                    input === content
                      ? 'bg-[#88C0D0]/20 border-[#88C0D0] text-[#88C0D0]'
                      : 'text-[#D8DEE9] bg-[#2E3440]/50 border-[#434C5E]/80 hover:border-[#88C0D0] hover:text-[#ECEFF4]'
                  }`}
                  onClick={() => setInput(content)}
                  title={content}
                >
                  <span className="text-[11px]">{icon}</span>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Message input */}
          <div className="rounded-2xl bg-[#2E3440]/70 backdrop-blur-md border border-[#434C5E]/80 transition-colors relative overflow-hidden">
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
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-end gap-2 z-[2]">
              {hasPII && (
                <span className="text-[10px] font-semibold text-[#BF616A] bg-[#BF616A]/10 px-2 py-1 rounded-full flex items-center">
                  {matches.length} PII
                </span>
              )}
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                  input.trim() ? 'bg-[#88C0D0] text-[#2E3440]' : 'bg-[#3B4252] text-[#4C566A]'
                }`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 2L11 13" /><path d="M22 2L15 22L11 13L2 9L22 2Z" />
                </svg>
              </div>
            </div>
          </div>
        </>
      ) : (
        /* File Upload mode */
        <div
          className={`rounded-2xl border-2 border-dashed transition-colors bg-[#2E3440]/70 backdrop-blur-md p-8 text-center ${
            fileLoading ? 'border-[#EBCB8B]' : uploadedFileName ? 'border-[#A3BE8C]' : 'border-[#434C5E]/80 hover:border-[#88C0D0]'
          }`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={handleFileChange}
          />
          {fileLoading ? (
            <div className="space-y-3">
              <div className="w-10 h-10 mx-auto border-2 border-[#EBCB8B] border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-[#EBCB8B] font-mono">Extracting text from file...</p>
            </div>
          ) : uploadedFileName ? (
            <div className="space-y-3">
              <div className="w-12 h-12 mx-auto rounded-xl bg-[#A3BE8C]/15 flex items-center justify-center">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#A3BE8C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <polyline points="9 15 11 17 15 13" />
                </svg>
              </div>
              <p className="text-sm text-[#A3BE8C] font-mono font-semibold">{uploadedFileName}</p>
              <p className="text-xs text-[#4C566A]">{matches.length} PII item{matches.length !== 1 ? 's' : ''} detected</p>
              <button
                className="text-xs text-[#81A1C1] hover:text-[#88C0D0] font-mono underline underline-offset-2 cursor-pointer"
                onClick={() => { setInput(''); setUploadedFileName(null); if (fileInputRef.current) fileInputRef.current.value = '' }}
              >
                Upload another file
              </button>
            </div>
          ) : (
            <div
              className="space-y-3 cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="w-12 h-12 mx-auto rounded-xl bg-[#88C0D0]/10 flex items-center justify-center">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#88C0D0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <p className="text-sm text-[#D8DEE9] font-mono">Drop a file here or <span className="text-[#88C0D0] underline underline-offset-2">browse</span></p>
              <p className="text-xs text-[#4C566A]">PDF and DOCX files</p>
            </div>
          )}
        </div>
      )}

      {/* Extracted text preview for file mode */}
      {mode === 'file' && input && (
        <div className="rounded-xl border border-[#434C5E]/60 bg-[#3B4252]/25 backdrop-blur-md p-4 max-h-48 overflow-y-auto">
          <p className="text-xs font-mono text-[#81A1C1] uppercase tracking-wider mb-2">Extracted Text</p>
          <p className="text-xs font-mono text-[#D8DEE9]/70 whitespace-pre-wrap break-words leading-relaxed">
            <HighlightedText text={input} matches={matches} />
          </p>
        </div>
      )}

      {/* View mode toggle + output — separate from input */}
      {input.trim() && (
        <>
          {hasPII && (
            <div className="space-y-4 pt-2 border-t border-[#434C5E]">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-[#88C0D0] uppercase tracking-wider flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#88C0D0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                  Safe to send — view as:
                </span>
                <div className="flex bg-[#3B4252] rounded-lg p-0.5 gap-0.5">
                  <button
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wider transition-all ${
                      redactMode === 'labels'
                        ? 'bg-[#88C0D0]/20 text-[#88C0D0]'
                        : 'text-[#4C566A] hover:text-[#D8DEE9]'
                    }`}
                    onClick={() => setRedactMode('labels')}
                  >
                    Labels
                  </button>
                  <button
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wider transition-all ${
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
              <div className="rounded-xl border border-[#88C0D0]/30 bg-[#2E3440]/60 backdrop-blur-md p-4">
                <p className="font-mono text-sm text-[#D8DEE9] whitespace-pre-wrap break-words leading-relaxed">
                <HighlightedText
                  text={redactMode === 'labels' ? maskedText : replacedText}
                  matches={redactMode === 'labels' ? maskedMatches : replacedMatches}
                />
                </p>
              </div>
            </div>
          )}

          {mappings.length > 0 && (
            <div className="rounded-xl border border-[#434C5E]/80 bg-[#2E3440]/60 backdrop-blur-md p-4">
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
