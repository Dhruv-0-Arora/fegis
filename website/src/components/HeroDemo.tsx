import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
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
  NAME: '#5E81AC', EMAIL: '#EBCB8B', PHONE: '#B48EAD', FINANCIAL: '#BF616A',
  SSN: '#BF616A', ID: '#D08770', ADDRESS: '#8FBCBB', SECRET: '#BF616A',
  URL: '#81A1C1', DATE: '#A3BE8C', CUSTOM: '#D08770', PATH: '#A3BE8C',
}

const TYPE_BG: Record<PIIType, string> = {
  NAME: 'rgba(94,129,172,0.22)', EMAIL: 'rgba(235,203,139,0.22)', PHONE: 'rgba(180,142,173,0.22)',
  FINANCIAL: 'rgba(191,97,106,0.22)', SSN: 'rgba(191,97,106,0.22)', ID: 'rgba(208,135,112,0.22)',
  ADDRESS: 'rgba(143,188,187,0.22)', SECRET: 'rgba(191,97,106,0.25)', URL: 'rgba(129,161,193,0.22)',
  DATE: 'rgba(163,190,140,0.22)', CUSTOM: 'rgba(208,135,112,0.22)', PATH: 'rgba(163,190,140,0.20)',
}

const ChatGPTLogo = (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    <svg width="24" height="24" viewBox="0 0 320 320" fill="#ececec">
      <path d="m297.06 130.97c7.26-21.79 4.76-45.66-6.85-65.48-17.46-30.4-52.56-46.04-86.84-38.68-15.25-17.18-37.16-26.95-60.13-26.81-35.04-.08-66.13 22.48-76.91 55.82-22.51 4.61-41.94 18.7-53.31 38.67-17.59 30.32-13.58 68.54 9.92 94.54-7.26 21.79-4.76 45.66 6.85 65.48 17.46 30.4 52.56 46.04 86.84 38.68 15.24 17.18 37.16 26.95 60.13 26.8 35.06.09 66.16-22.49 76.94-55.86 22.51-4.61 41.94-18.7 53.31-38.67 17.57-30.32 13.55-68.51-9.94-94.51zm-120.28 168.11c-14.03.02-27.62-4.89-38.39-13.88.49-.26 1.34-.73 1.89-1.07l63.72-36.8c3.26-1.85 5.26-5.32 5.24-9.07v-89.83l26.93 15.55c.29.14.48.42.52.74v74.39c-.04 33.08-26.83 59.9-59.91 59.97zm-128.84-55.03c-7.03-12.14-9.56-26.37-7.15-40.18.47.28 1.3.79 1.89 1.13l63.72 36.8c3.23 1.89 7.23 1.89 10.47 0l77.79-44.92v31.1c.02.32-.13.63-.38.83l-64.41 37.19c-28.69 16.52-65.33 6.7-81.92-21.95zm-16.77-139.09c7-12.16 18.05-21.46 31.21-26.29 0 .55-.03 1.52-.03 2.2v73.61c-.02 3.74 1.98 7.21 5.23 9.06l77.79 44.91-26.93 15.55c-.27.18-.61.21-.91.08l-64.42-37.22c-28.63-16.58-38.45-53.21-21.95-81.89zm221.26 51.49-77.79-44.92 26.93-15.54c.27-.18.61-.21.91-.08l64.42 37.19c28.68 16.57 38.51 53.26 21.94 81.94-7.01 12.14-18.05 21.44-31.2 26.28v-75.81c.03-3.74-1.96-7.2-5.2-9.06zm26.8-40.34c-.47-.29-1.3-.79-1.89-1.13l-63.72-36.8c-3.23-1.89-7.23-1.89-10.47 0l-77.79 44.92v-31.1c-.02-.32.13-.63.38-.83l64.41-37.16c28.69-16.55 65.37-6.7 81.91 22 6.99 12.12 9.52 26.31 7.15 40.1zm-168.51 55.43-26.94-15.55c-.29-.14-.48-.42-.52-.74v-74.39c.02-33.12 26.89-59.96 60.01-59.94 14.01 0 27.57 4.92 38.34 13.88-.49.26-1.33.73-1.89 1.07l-63.72 36.8c-3.26 1.85-5.26 5.31-5.24 9.06l-.04 89.79zm14.63-31.54 34.65-20.01 34.65 20v40.01l-34.65 20-34.65-20z"/>
    </svg>
    <span style={{ color: '#ececec', fontSize: 16, fontWeight: 600, fontFamily: 'system-ui,sans-serif' }}>ChatGPT</span>
  </div>
)

const SUGGESTIONS: { label: string; icon: string; content: string }[] = [
  { label: 'Name', icon: '👤', content: 'Hi, my name is Sarah Johnson — nice to meet you. Please reach out anytime.' },
  { label: 'Email', icon: '✉️', content: 'Reach me at sarah.johnson@company.com for any inquiries.' },
  { label: 'Phone', icon: '📞', content: 'Call me at (206) 555-8742 or text me at +1-206-555-8742 anytime.' },
  { label: 'Credit Card', icon: '💳', content: 'Please charge my Visa: 4111 1111 1111 1111, exp 04/27, CVV 319.' },
  { label: 'SSN + DOB', icon: '🪪', content: 'My SSN is 372-14-8562 and my date of birth is 03/15/1984.' },
  { label: 'Address', icon: '🏠', content: 'Ship to 742 Evergreen Terrace, Springfield, IL 62701.' },
  { label: 'API Key', icon: '🔑', content: 'Here is my API token: sk_live_xK3mNpQ2rYsT4uVwZa8bC9dEfGhIjKl' },
  { label: 'URL', icon: '🔗', content: 'See the dashboard at https://app.example.com/settings?api_token=abc123xyz456&session_id=9182' },
  { label: 'UUID / ID', icon: '🔢', content: 'Request trace ID: 550e8400-e29b-41d4-a716-446655440000' },
  { label: 'File Path', icon: '📁', content: 'App crashed reading /etc/app/config.yml — see full trace at /var/log/app/error.log' },
  { label: 'Log File', icon: '📋', content: '[2024-03-15 09:14:02] ERROR auth failed for user jsmith@corp.net from 192.168.1.42 — token_x9f2k8m3abc4def5ghi6jklm' },
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
          <mark key={i} className="rounded border-b-2" style={{ background: TYPE_BG[p.type] ?? 'rgba(129,161,193,0.22)', borderBottomColor: TYPE_BORDER[p.type] ?? '#81A1C1', color: 'inherit', padding: 0 }} title={p.type}>
            {p.text}
          </mark>
        ),
      )}
    </>
  )
}

interface MappingEntry { type: PIIType; original: string; fake: string }

async function extractTextFromPDF(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise
  const pages: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '))
  }
  return pages.join('\n\n')
}

async function extractTextFromDOCX(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const result = await mammoth.extractRawText({ arrayBuffer: buffer })
  return result.value
}

function extractTextFromFile(file: File): Promise<string> {
  if (file.type === DOCX_MIME || file.name.endsWith('.docx')) return extractTextFromDOCX(file)
  return extractTextFromPDF(file)
}

function isSupportedFile(file: File): boolean {
  return file.type === 'application/pdf' || file.type === DOCX_MIME || file.name.endsWith('.docx')
}

export default function HeroDemo() {
  const [input, setInput] = useState('')
  const [redactMode, setRedactMode] = useState<'labels' | 'replaced'>('labels')
  const [fileLoading, setFileLoading] = useState(false)
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Auto-grow textarea whenever input changes
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(44, Math.min(el.scrollHeight, 240))}px`
  }, [input])

  const syncScroll = useCallback(() => {
    const ta = textareaRef.current
    const ov = overlayRef.current
    if (ta && ov) { ov.scrollTop = ta.scrollTop; ov.scrollLeft = ta.scrollLeft }
  }, [])

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileLoading(true)
    setUploadedFileName(file.name)
    try { setInput(await extractTextFromFile(file)) }
    catch { setInput(''); setUploadedFileName(null) }
    finally { setFileLoading(false) }
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (!file || !isSupportedFile(file)) return
    setFileLoading(true)
    setUploadedFileName(file.name)
    try { setInput(await extractTextFromFile(file)) }
    catch { setInput(''); setUploadedFileName(null) }
    finally { setFileLoading(false) }
  }, [])

  const { matches, maskedText, maskedMatches, replacedText, replacedMatches, hasPII, error, mappings } = useMemo(() => {
    const empty = { matches: [] as PIIMatch[], maskedText: '', maskedMatches: [] as PIIMatch[], replacedText: '', replacedMatches: [] as PIIMatch[], hasPII: false, error: null as string | null, mappings: [] as MappingEntry[] }
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
      let mIdx = 0, mPos = 0
      for (const match of m) {
        mPos += input.substring(mIdx, match.start).length
        const tokenKey = Object.entries(tokenMap).find(([, v]) => v === match.text)?.[0] ?? match.text
        maskedMatches.push({ text: tokenKey, type: match.type, start: mPos, end: mPos + tokenKey.length, score: match.score })
        mPos += tokenKey.length; mIdx = match.end
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
      return { matches: m, maskedText: result.maskedText, maskedMatches, replacedText: replaced, replacedMatches, hasPII: m.length > 0, error: null, mappings }
    } catch (e) {
      return { ...empty, error: e instanceof Error ? e.message : 'Detection failed' }
    }
  }, [input])

  return (
    <div className="space-y-6 text-left select-text" style={{ pointerEvents: 'auto' }}>
      {/* Example buttons */}
      <div className="flex flex-wrap gap-2 px-1">
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

      {/* Outer wrapper: browser frame + safe-to-send panel unified */}
      <div className="rounded-xl overflow-hidden" style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>

        {/* Browser title bar */}
        <div className="flex items-center gap-3 px-4 py-2.5" style={{ background: '#1e1e1e', borderBottom: '1px solid #2a2a2a' }}>
          <div className="flex gap-1.5 shrink-0">
            <div className="w-3 h-3 rounded-full" style={{ background: '#ff5f57' }} />
            <div className="w-3 h-3 rounded-full" style={{ background: '#febc2e' }} />
            <div className="w-3 h-3 rounded-full" style={{ background: '#28c840' }} />
          </div>
          <div className="flex-1 flex items-center gap-2 px-3 py-1 rounded-md text-xs" style={{ background: '#2a2a2a', color: '#777', fontFamily: 'system-ui,sans-serif' }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
            <span>chatgpt.com</span>
          </div>
          <div className="shrink-0 w-6 h-6 rounded flex items-center justify-center" style={{ background: 'rgba(136,192,208,0.15)' }} title="Fegis active">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L4 6v5c0 5.15 3.35 9.95 8 11.3C16.65 20.95 20 16.15 20 11V6l-8-4z" fill="#88C0D0"/>
              <path d="M10.5 11.5V10a1.5 1.5 0 0 1 3 0v1.5" stroke="#1e1e1e" strokeWidth="1.4" strokeLinecap="round"/>
              <rect x="9" y="11" width="6" height="4.5" rx="1" fill="#1e1e1e"/>
              <circle cx="12" cy="13.1" r="0.85" fill="#88C0D0"/>
            </svg>
          </div>
        </div>

        {/* ChatGPT page */}
        <div
          className="flex flex-col items-center justify-end"
          style={{ background: '#212121', padding: '40px 24px 24px' }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
        >
          <div style={{ marginBottom: 32, opacity: 0.7 }}>{ChatGPTLogo}</div>

          {/* Uploaded file badge */}
          {uploadedFileName && (
            <div className="w-full mb-2 flex items-center gap-2 px-1">
              <span className="text-xs text-[#A3BE8C] bg-[#A3BE8C]/10 border border-[#A3BE8C]/25 rounded-full px-3 py-1 flex items-center gap-1.5">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#A3BE8C" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><polyline points="9 15 11 17 15 13"/>
                </svg>
                {uploadedFileName}
              </span>
              <button
                className="text-[10px] text-[#4C566A] hover:text-[#BF616A] transition-colors cursor-pointer"
                onClick={() => { setInput(''); setUploadedFileName(null); if (fileInputRef.current) fileInputRef.current.value = '' }}
              >
                ✕
              </button>
            </div>
          )}

          {/* Input box */}
          <div className="w-full relative" style={{ background: '#2f2f2f', borderRadius: 16 }}>
            {/* PII highlight overlay */}
            {input && matches.length > 0 && (
              <div
                ref={overlayRef}
                className="absolute inset-0 overflow-hidden pointer-events-none z-0 whitespace-pre-wrap break-words"
                aria-hidden
                style={{
                  color: 'transparent',
                  padding: '12px 52px 12px 48px',
                  borderRadius: 16,
                  fontSize: 14,
                  fontFamily: 'system-ui, sans-serif',
                  lineHeight: '1.6',
                }}
              >
                <HighlightedText text={input} matches={matches} />
              </div>
            )}

            {/* Left: attach button */}
            <div className="absolute left-2 bottom-2 z-[2]">
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                onChange={handleFileChange}
              />
              <button
                className="w-8 h-8 rounded-full flex items-center justify-center transition-colors cursor-pointer"
                style={{ background: 'transparent', color: fileLoading ? '#EBCB8B' : '#676767' }}
                onClick={() => fileInputRef.current?.click()}
                title="Attach PDF or DOCX"
                disabled={fileLoading}
              >
                {fileLoading ? (
                  <div className="w-4 h-4 border-2 border-[#EBCB8B] border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                  </svg>
                )}
              </button>
            </div>

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              id="hero-demo-input"
              className="w-full bg-transparent resize-none relative z-[1] whitespace-pre-wrap break-words"
              placeholder="Message ChatGPT"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onScroll={syncScroll}
              spellCheck={false}
              rows={1}
              aria-label="Type or paste text to see PII detection"
              style={{
                color: '#ececec',
                padding: '12px 52px 12px 48px',
                fontSize: 14,
                fontFamily: 'system-ui, sans-serif',
                lineHeight: '1.6',
                caretColor: '#ececec',
                outline: 'none',
                boxShadow: 'none',
                border: 'none',
                minHeight: 44,
                maxHeight: 240,
                overflowY: 'auto',
              }}
            />

            {/* Right: PII badge + send */}
            <div className="absolute right-2 bottom-2 flex items-center gap-2 z-[2]">
              {hasPII && (
                <span className="text-[10px] font-semibold text-[#BF616A] bg-[#BF616A]/15 px-2 py-1 rounded-full">
                  {matches.length} PII
                </span>
              )}
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors"
                style={{ background: input.trim() ? '#ececec' : '#3a3a3a', color: '#212121' }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* Safe-to-send panel — connected to the bottom of the ChatGPT frame */}
        {input.trim() && hasPII && (
          <div style={{ background: '#1a1a1a', borderTop: '1px solid #2a2a2a', padding: '16px 24px 20px' }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-mono text-[#88C0D0] uppercase tracking-wider flex items-center gap-2">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#88C0D0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                </svg>
                Safe to send — view as:
              </span>
              <div className="flex rounded-lg p-0.5 gap-0.5" style={{ background: '#2a2a2a' }}>
                <button
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wider transition-all ${redactMode === 'labels' ? 'text-[#88C0D0]' : 'text-[#4C566A] hover:text-[#D8DEE9]'}`}
                  style={{ background: redactMode === 'labels' ? 'rgba(136,192,208,0.15)' : 'transparent' }}
                  onClick={() => setRedactMode('labels')}
                >Labels</button>
                <button
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wider transition-all ${redactMode === 'replaced' ? 'text-[#88C0D0]' : 'text-[#4C566A] hover:text-[#D8DEE9]'}`}
                  style={{ background: redactMode === 'replaced' ? 'rgba(136,192,208,0.15)' : 'transparent' }}
                  onClick={() => setRedactMode('replaced')}
                >Replaced</button>
              </div>
            </div>
            <div className="rounded-xl p-4" style={{ background: '#242424', border: '1px solid #2f2f2f' }}>
              <p className="font-mono text-sm text-[#D8DEE9] whitespace-pre-wrap break-words leading-relaxed">
                <HighlightedText
                  text={redactMode === 'labels' ? maskedText : replacedText}
                  matches={redactMode === 'labels' ? maskedMatches : replacedMatches}
                />
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Replacement map — separate below */}
      {mappings.length > 0 && (
        <div className="rounded-xl border border-[#434C5E]/80 bg-[#2E3440]/60 backdrop-blur-md p-4">
          <div className="text-xs font-mono text-[#81A1C1] uppercase tracking-wider mb-1 flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#81A1C1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/>
              <polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/>
            </svg>
            Replacement Map
          </div>
          <p className="text-[11px] text-[#4C566A] mb-3">Same value always maps to the same replacement.</p>
          <div className="space-y-1.5">
            {mappings.map(({ type, original, fake }) => (
              <div key={`${type}:${original}`} className="flex items-center gap-2 text-xs font-mono">
                <span className="text-[9px] font-bold uppercase border rounded px-1.5 py-0.5 flex-shrink-0" style={{ color: TYPE_BORDER[type], borderColor: TYPE_BORDER[type], opacity: 0.85 }}>
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

      {error && <p className="text-[#BF616A] text-sm font-mono" role="alert">{error}</p>}
    </div>
  )
}
