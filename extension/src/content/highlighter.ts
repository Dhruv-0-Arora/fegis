import type { PIIMatch, PIIType, TokenMap } from '../types.ts'
import { getTokenForMatch, getFakeReplacement } from '../tokens/manager.ts'

type ReplaceMode = 'original' | 'labels' | 'replaced'
let replaceCallback: ((mode: ReplaceMode) => void) | null = null
let activeReplaceMode: ReplaceMode = 'original'

export function setReplaceCallback(fn: (mode: ReplaceMode) => void) {
  replaceCallback = fn
}

export function resetActiveMode() {
  activeReplaceMode = 'original'
  if (state) {
    const btns = state.badgeDiv.querySelectorAll('.pii-shield-mode-btn')
    btns.forEach(btn => {
      if ((btn as HTMLElement).dataset.mode === 'original') {
        btn.classList.add('active')
      } else {
        btn.classList.remove('active')
      }
    })
  }
}

export function clearHighlightsOnly() {
  if (!state) return
  state.highlightDiv.textContent = ''
}

const TYPE_COLORS: Record<PIIType, string> = {
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
  NAME: 'rgba(94,129,172,0.38)',
  EMAIL: 'rgba(235,203,139,0.35)',
  PHONE: 'rgba(180,142,173,0.35)',
  FINANCIAL: 'rgba(191,97,106,0.38)',
  SSN: 'rgba(191,97,106,0.38)',
  ID: 'rgba(208,135,112,0.35)',
  ADDRESS: 'rgba(143,188,187,0.35)',
  SECRET: 'rgba(191,97,106,0.40)',
  URL: 'rgba(129,161,193,0.35)',
  DATE: 'rgba(163,190,140,0.35)',
  CUSTOM: 'rgba(208,135,112,0.35)',
  PATH: 'rgba(163,190,140,0.32)',
}

interface HighlightState {
  inputEl: HTMLElement
  highlightDiv: HTMLDivElement
  badgeDiv: HTMLDivElement
  tooltipDiv: HTMLDivElement
  warningDiv: HTMLDivElement
  inspectPanelDiv: HTMLDivElement
  scrollSyncHandler: (() => void) | null
  resizeObserver: ResizeObserver | null
  warningTimer: ReturnType<typeof setTimeout> | null
}

let state: HighlightState | null = null
let tooltipHideTimer: ReturnType<typeof setTimeout> | null = null
let panelOpen = false
let lastPanelData: { text: string; matches: PIIMatch[]; tokenMap: TokenMap; replacementMap: Record<string, string> } | null = null

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
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

  const inspectPanelDiv = document.createElement('div')
  inspectPanelDiv.className = 'pii-shield-inspect-panel'
  inspectPanelDiv.style.display = 'none'

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
  document.body.appendChild(inspectPanelDiv)

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

  state = { inputEl, highlightDiv, badgeDiv, tooltipDiv, warningDiv, inspectPanelDiv, scrollSyncHandler, resizeObserver, warningTimer: null }
  panelOpen = false
  lastPanelData = null
  activeReplaceMode = 'original'
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
    mark.dataset.fakeValue = getFakeReplacement(match)
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

  const keepVisible = activeReplaceMode === 'labels' || activeReplaceMode === 'replaced'
  if (count === 0 && !keepVisible) {
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

  if (!badgeDiv.querySelector('.pii-shield-mode-toggle')) {
    const toggleGroup = document.createElement('div')
    toggleGroup.className = 'pii-shield-mode-toggle'

    const modes: { key: ReplaceMode; label: string }[] = [
      { key: 'original', label: 'Original' },
      { key: 'labels', label: 'Redacted' },
      { key: 'replaced', label: 'Replaced' },
    ]

    for (const { key, label } of modes) {
      const btn = document.createElement('button')
      btn.className = `pii-shield-mode-btn${activeReplaceMode === key ? ' active' : ''}`
      btn.dataset.mode = key
      btn.textContent = label
      btn.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        activeReplaceMode = key
        toggleGroup.querySelectorAll('.pii-shield-mode-btn').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        replaceCallback?.(key)
      })
      toggleGroup.appendChild(btn)
    }

    badgeDiv.insertBefore(toggleGroup, countSpan)
  }

  if (!badgeDiv.querySelector('.pii-shield-inspect-btn')) {
    const inspectBtn = document.createElement('button')
    inspectBtn.className = 'pii-shield-inspect-btn'
    inspectBtn.innerHTML = '&#128269; Inspect'
    inspectBtn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      toggleInspectPanel()
    })
    badgeDiv.appendChild(inspectBtn)
  }
}

// --- Inspect Panel ---

export function toggleInspectPanel() {
  if (!state) return
  panelOpen = !panelOpen
  if (panelOpen && lastPanelData) {
    renderInspectPanelContent()
    positionInspectPanel()
    state.inspectPanelDiv.style.display = 'block'
  } else {
    state.inspectPanelDiv.style.display = 'none'
  }
}

export function hideInspectPanel() {
  if (!state) return
  panelOpen = false
  state.inspectPanelDiv.style.display = 'none'
}

function positionInspectPanel() {
  if (!state) return
  const { inspectPanelDiv, inputEl } = state
  const rect = getInputRect(inputEl)
  const panelW = 400
  const panelMaxH = 480
  const margin = 12

  let left = rect.right + margin
  if (left + panelW > window.innerWidth) {
    left = rect.left - panelW - margin
  }
  if (left < margin) left = margin

  let top = rect.top
  if (top + panelMaxH > window.innerHeight) {
    top = Math.max(margin, window.innerHeight - panelMaxH - margin)
  }

  inspectPanelDiv.style.left = `${left}px`
  inspectPanelDiv.style.top = `${top}px`
}

export function updateInspectPanelData(text: string, matches: PIIMatch[], tokenMap: TokenMap, replacementMap: Record<string, string>) {
  lastPanelData = { text, matches, tokenMap, replacementMap }
  if (panelOpen && state) {
    renderInspectPanelContent()
  }
}

function renderInspectPanelContent() {
  if (!state || !lastPanelData) return
  const { inspectPanelDiv } = state
  const { matches, replacementMap } = lastPanelData

  inspectPanelDiv.innerHTML = ''

  const header = document.createElement('div')
  header.className = 'pii-panel-header'

  const title = document.createElement('div')
  title.className = 'pii-panel-title'
  title.innerHTML = `<span class="pii-panel-title-dot"></span> ${matches.length} PII item${matches.length !== 1 ? 's' : ''} detected`
  header.appendChild(title)

  const closeBtn = document.createElement('button')
  closeBtn.className = 'pii-panel-close'
  closeBtn.innerHTML = '&times;'
  closeBtn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    hideInspectPanel()
  })
  header.appendChild(closeBtn)
  inspectPanelDiv.appendChild(header)

  const replEntries = Object.entries(replacementMap)
  if (replEntries.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'pii-panel-empty'
    empty.textContent = 'No replacements mapped yet.'
    inspectPanelDiv.appendChild(empty)
    return
  }

  const mapSection = document.createElement('div')
  mapSection.className = 'pii-panel-section'
  const mapTitle = document.createElement('div')
  mapTitle.className = 'pii-panel-section-title'
  mapTitle.textContent = 'Replacement Map'
  mapSection.appendChild(mapTitle)
  const mapHint = document.createElement('div')
  mapHint.className = 'pii-panel-section-hint'
  mapHint.textContent = 'Same value always maps to the same replacement.'
  mapSection.appendChild(mapHint)

  for (const [key, fake] of replEntries) {
    const colon = key.indexOf(':')
    const type = key.slice(0, colon) as PIIType
    const original = key.slice(colon + 1)

    const row = document.createElement('div')
    row.className = 'pii-panel-mapping-row'

    const badge = document.createElement('span')
    badge.className = 'pii-panel-type-badge'
    badge.style.color = TYPE_COLORS[type] ?? '#81a1c1'
    badge.style.borderColor = TYPE_COLORS[type] ?? '#81a1c1'
    badge.textContent = type

    const orig = document.createElement('span')
    orig.className = 'pii-panel-original'
    orig.textContent = original

    const arrow = document.createElement('span')
    arrow.className = 'pii-panel-arrow'
    arrow.innerHTML = '&rarr;'

    const fakeSpan = document.createElement('span')
    fakeSpan.className = 'pii-panel-fake'
    fakeSpan.textContent = fake

    row.appendChild(badge)
    row.appendChild(orig)
    row.appendChild(arrow)
    row.appendChild(fakeSpan)
    mapSection.appendChild(row)
  }
  inspectPanelDiv.appendChild(mapSection)
}

// --- Tooltip ---

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
  `
  const TOP_OFFSET = 70
  const SIDE_MARGIN = 10
  const TOOLTIP_HEIGHT = 80
  let top = y - TOP_OFFSET < SIDE_MARGIN ? y + 16 : y - TOP_OFFSET
  const left = Math.min(x + 12, window.innerWidth - 280 - SIDE_MARGIN)
  if (top + TOOLTIP_HEIGHT > window.innerHeight) top = window.innerHeight - TOOLTIP_HEIGHT - SIDE_MARGIN

  tooltipDiv.style.display = 'block'
  tooltipDiv.style.position = 'fixed'
  tooltipDiv.style.left = `${left}px`
  tooltipDiv.style.top = `${top}px`
  tooltipDiv.style.zIndex = '2147483647'
  tooltipDiv.style.pointerEvents = 'auto'
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
  const { highlightDiv, badgeDiv, tooltipDiv, warningDiv, inspectPanelDiv, inputEl, scrollSyncHandler, resizeObserver, warningTimer } = state

  if (scrollSyncHandler) inputEl.removeEventListener('scroll', scrollSyncHandler)
  if (resizeObserver) resizeObserver.disconnect()
  if (warningTimer) clearTimeout(warningTimer)
  highlightDiv.remove()
  badgeDiv.remove()
  tooltipDiv.remove()
  warningDiv.remove()
  inspectPanelDiv.remove()

  state = null
  panelOpen = false
  lastPanelData = null
  activeReplaceMode = 'original'
}

export function getState(): HighlightState | null {
  return state
}
