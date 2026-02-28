import type { PIIMatch, PIIType } from '../types.ts'
import { getTokenForMatch } from '../tokens/manager.ts'

let replaceCallback: (() => void) | null = null

export function setReplaceCallback(fn: () => void) {
  replaceCallback = fn
}

const TYPE_COLORS: Record<PIIType, string> = {
  NAME: '#5e81ac',
  EMAIL: '#ebcb8b',
  PHONE: '#b48ead',
  FINANCIAL: '#bf616a',
  SSN: '#bf616a',
  ID: '#d08770',
  ADDRESS: '#8fbcbb',
  SECRET: '#bf616a',
  URL: '#81a1c1',
  DATE: '#a3be8c',
  CUSTOM: '#d08770',
  PATH: '#10b981',
}

const TYPE_BG: Record<PIIType, string> = {
  NAME: 'rgba(94,129,172,0.14)',
  EMAIL: 'rgba(235,203,139,0.14)',
  PHONE: 'rgba(180,142,173,0.14)',
  FINANCIAL: 'rgba(191,97,106,0.16)',
  SSN: 'rgba(191,97,106,0.16)',
  ID: 'rgba(208,135,112,0.14)',
  ADDRESS: 'rgba(143,188,187,0.14)',
  SECRET: 'rgba(191,97,106,0.18)',
  URL: 'rgba(129,161,193,0.14)',
  DATE: 'rgba(163,190,140,0.14)',
  CUSTOM: 'rgba(208,135,112,0.14)',
  PATH: 'rgba(16,185,129,0.12)',
}

interface HighlightState {
  inputEl: HTMLElement
  highlightDiv: HTMLDivElement
  badgeDiv: HTMLDivElement
  tooltipDiv: HTMLDivElement
  warningDiv: HTMLDivElement
  scrollSyncHandler: (() => void) | null
  resizeObserver: ResizeObserver | null
  warningTimer: ReturnType<typeof setTimeout> | null
}

let state: HighlightState | null = null
let tooltipHideTimer: ReturnType<typeof setTimeout> | null = null
let onReplaceCallback: ((token: string, original: string, type: PIIType) => void) | null = null

export function setOnReplace(cb: (token: string, original: string, type: PIIType) => void) {
  onReplaceCallback = cb
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function copyStyles(source: HTMLElement, target: HTMLDivElement) {
  const computed = window.getComputedStyle(source)
  const props = [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing',
    'lineHeight', 'textTransform', 'wordSpacing', 'textIndent',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'boxSizing', 'whiteSpace', 'wordWrap', 'overflowWrap', 'wordBreak',
    'textAlign', 'direction',
  ]
  for (const prop of props) {
    ;(target.style as unknown as Record<string, string>)[prop] = computed.getPropertyValue(
      prop.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())
    )
  }
  target.style.overflow = 'hidden'
  target.style.whiteSpace = 'pre-wrap'
  target.style.wordWrap = 'break-word'
}

function getInputRect(el: HTMLElement): DOMRect {
  return el.getBoundingClientRect()
}

export function createHighlightLayer(inputEl: HTMLElement): HighlightState {
  cleanup()

  const highlightDiv = document.createElement('div')
  highlightDiv.className = 'pii-shield-highlight-layer'
  highlightDiv.setAttribute('aria-hidden', 'true')

  const badgeDiv = document.createElement('div')
  badgeDiv.className = 'pii-shield-badge'
  badgeDiv.style.display = 'none'

  const tooltipDiv = document.createElement('div')
  tooltipDiv.className = 'pii-shield-tooltip'
  tooltipDiv.style.display = 'none'

  const warningDiv = document.createElement('div')
  warningDiv.className = 'pii-shield-warning'
  warningDiv.style.display = 'none'
  warningDiv.textContent = '⚠ Remove sensitive info before sending'

  tooltipDiv.addEventListener('mouseenter', () => {
    if (tooltipHideTimer) {
      clearTimeout(tooltipHideTimer)
      tooltipHideTimer = null
    }
  })
  tooltipDiv.addEventListener('mouseleave', () => {
    scheduleHideTooltip()
  })

  document.body.appendChild(highlightDiv)
  document.body.appendChild(badgeDiv)
  document.body.appendChild(tooltipDiv)
  document.body.appendChild(warningDiv)

  positionHighlightLayer(inputEl, highlightDiv)
  copyStyles(inputEl, highlightDiv)

  const scrollSyncHandler = () => {
    highlightDiv.scrollTop = (inputEl as HTMLTextAreaElement).scrollTop ?? 0
    highlightDiv.scrollLeft = (inputEl as HTMLTextAreaElement).scrollLeft ?? 0
  }
  inputEl.addEventListener('scroll', scrollSyncHandler)

  const resizeObserver = new ResizeObserver(() => {
    positionHighlightLayer(inputEl, highlightDiv)
    copyStyles(inputEl, highlightDiv)
  })
  resizeObserver.observe(inputEl)

  state = { inputEl, highlightDiv, badgeDiv, tooltipDiv, warningDiv, scrollSyncHandler, resizeObserver, warningTimer: null }
  return state
}

function positionHighlightLayer(inputEl: HTMLElement, highlightDiv: HTMLDivElement) {
  const rect = getInputRect(inputEl)
  const scrollX = window.scrollX
  const scrollY = window.scrollY

  highlightDiv.style.position = 'absolute'
  highlightDiv.style.top = `${rect.top + scrollY}px`
  highlightDiv.style.left = `${rect.left + scrollX}px`
  highlightDiv.style.width = `${rect.width}px`
  highlightDiv.style.height = `${rect.height}px`
  highlightDiv.style.zIndex = '2147483640'
  highlightDiv.style.pointerEvents = 'none'
  highlightDiv.style.background = 'transparent'
}

export function renderHighlights(text: string, matches: PIIMatch[]) {
  if (!state) return

  const { highlightDiv, inputEl } = state

  positionHighlightLayer(inputEl, highlightDiv)

  const frag = document.createDocumentFragment()
  let currentIndex = 0

  for (const match of matches) {
    if (match.start > currentIndex) {
      const textNode = document.createTextNode(text.substring(currentIndex, match.start))
      frag.appendChild(textNode)
    }

    const mark = document.createElement('mark')
    mark.className = `pii-shield-mark pii-shield-mark-${match.type.toLowerCase()}`
    mark.style.background = TYPE_BG[match.type] || 'rgba(129,161,193,0.14)'
    mark.style.borderBottom = `2px solid ${TYPE_COLORS[match.type] || '#81a1c1'}`
    mark.style.borderRadius = '2px'
    mark.style.color = 'transparent'
    mark.style.position = 'relative'

    const token = getTokenForMatch(match)
    mark.dataset.token = token
    mark.dataset.type = match.type
    mark.dataset.original = match.text

    mark.textContent = match.text
    frag.appendChild(mark)

    currentIndex = match.end
  }

  if (currentIndex < text.length) {
    frag.appendChild(document.createTextNode(text.substring(currentIndex)))
  }

  highlightDiv.textContent = ''
  highlightDiv.appendChild(frag)

  highlightDiv.scrollTop = (inputEl as HTMLTextAreaElement).scrollTop ?? 0
  highlightDiv.scrollLeft = (inputEl as HTMLTextAreaElement).scrollLeft ?? 0

  updateBadge(matches.length)
}

function updateBadge(count: number) {
  if (!state) return
  const { badgeDiv, inputEl } = state

  if (count === 0) {
    badgeDiv.style.display = 'none'
    return
  }

  const rect = getInputRect(inputEl)
  const scrollX = window.scrollX
  const scrollY = window.scrollY

  badgeDiv.style.display = 'flex'
  badgeDiv.style.position = 'absolute'
  badgeDiv.style.top = `${rect.top + scrollY - 30}px`
  badgeDiv.style.left = `${rect.right + scrollX}px`
  badgeDiv.style.zIndex = '2147483646'
  badgeDiv.title = `${count} PII item${count > 1 ? 's' : ''} detected`

  let countSpan = badgeDiv.querySelector<HTMLSpanElement>('.pii-shield-badge-count')
  if (!countSpan) {
    countSpan = document.createElement('span')
    countSpan.className = 'pii-shield-badge-count'
    badgeDiv.appendChild(countSpan)
  }
  countSpan.textContent = String(count)

  if (!badgeDiv.querySelector('.pii-shield-replace-btn')) {
    const btn = document.createElement('button')
    btn.className = 'pii-shield-replace-btn'
    btn.textContent = 'Replace All'
    btn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      replaceCallback?.()
    })
    badgeDiv.insertBefore(btn, countSpan)
  }
}

export function showTooltip(x: number, y: number, type: PIIType, token: string, original: string) {
  if (!state) return
  const { tooltipDiv } = state

  if (tooltipHideTimer) {
    clearTimeout(tooltipHideTimer)
    tooltipHideTimer = null
  }

  const color = TYPE_COLORS[type] || '#81a1c1'
  tooltipDiv.innerHTML = `
    <div class="pii-shield-tooltip-type">${type}</div>
    <div class="pii-shield-tooltip-original">"${escapeHtml(original)}"</div>
    <div class="pii-shield-tooltip-token" style="color:${color}">&rarr; ${escapeHtml(token)}</div>
    <button class="pii-shield-tooltip-replace" data-token="${escapeAttr(token)}" data-original="${escapeAttr(original)}" data-type="${escapeAttr(type)}">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 12.5V14h1.5l8.8-8.8-1.5-1.5L2 12.5zM14.7 4.1c.2-.2.2-.5 0-.7l-.8-.8c-.2-.2-.5-.2-.7 0l-.7.7 1.5 1.5.7-.7z" fill="currentColor"/></svg>
      Replace now
    </button>
  `
  const TOP_OFFSET = 90
  const SIDE_MARGIN = 10
  const TOOLTIP_HEIGHT = 120
  let top = y - TOP_OFFSET < SIDE_MARGIN ? y + 16 : y - TOP_OFFSET
  const left = Math.min(x + 12, window.innerWidth - 280 - SIDE_MARGIN)
  if (top + TOOLTIP_HEIGHT > window.innerHeight) top = window.innerHeight - TOOLTIP_HEIGHT - SIDE_MARGIN

  tooltipDiv.style.display = 'block'
  tooltipDiv.style.position = 'fixed'
  tooltipDiv.style.left = `${left}px`
  tooltipDiv.style.top = `${top}px`
  tooltipDiv.style.zIndex = '2147483647'
  tooltipDiv.style.pointerEvents = 'auto'

  const replaceBtn = tooltipDiv.querySelector('.pii-shield-tooltip-replace') as HTMLButtonElement | null
  if (replaceBtn) {
    replaceBtn.onclick = (e) => {
      e.stopPropagation()
      e.preventDefault()
      const t = replaceBtn.dataset.token || ''
      const o = replaceBtn.dataset.original || ''
      const tp = (replaceBtn.dataset.type || 'NAME') as PIIType
      if (onReplaceCallback) {
        onReplaceCallback(t, o, tp)
      }
      hideTooltip()
    }
  }
}

function scheduleHideTooltip() {
  if (tooltipHideTimer) clearTimeout(tooltipHideTimer)
  tooltipHideTimer = setTimeout(() => {
    hideTooltip()
  }, 300)
}

export function hideTooltip() {
  if (!state) return
  state.tooltipDiv.style.display = 'none'
  if (tooltipHideTimer) {
    clearTimeout(tooltipHideTimer)
    tooltipHideTimer = null
  }
}

export function scheduleHide() {
  scheduleHideTooltip()
}

export function showBlockWarning() {
  if (!state) return
  const { warningDiv, inputEl } = state

  if (state.warningTimer) clearTimeout(state.warningTimer)

  const rect = getInputRect(inputEl)
  const scrollX = window.scrollX
  const scrollY = window.scrollY

  warningDiv.style.display = 'block'
  warningDiv.style.top = `${rect.bottom + scrollY + 6}px`
  warningDiv.style.left = `${rect.left + scrollX}px`

  warningDiv.style.animation = 'none'
  void warningDiv.offsetWidth
  warningDiv.style.animation = ''

  state.warningTimer = setTimeout(() => {
    if (state) state.warningDiv.style.display = 'none'
  }, 3000)
}

export function hideBlockWarning() {
  if (!state) return
  if (state.warningTimer) {
    clearTimeout(state.warningTimer)
    state.warningTimer = null
  }
  state.warningDiv.style.display = 'none'
}

export function cleanup() {
  if (!state) return
  const { highlightDiv, badgeDiv, tooltipDiv, warningDiv, inputEl, scrollSyncHandler, resizeObserver, warningTimer } = state

  if (scrollSyncHandler) inputEl.removeEventListener('scroll', scrollSyncHandler)
  if (resizeObserver) resizeObserver.disconnect()
  if (warningTimer) clearTimeout(warningTimer)
  highlightDiv.remove()
  badgeDiv.remove()
  tooltipDiv.remove()
  warningDiv.remove()

  state = null
}

export function getState(): HighlightState | null {
  return state
}
