import type { PIIMatch, PIIType, TokenMap } from '../types.ts'
import { getTokenForMatch, getFakeReplacement, getTokenMap } from '../tokens/manager.ts'

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
  scrollContainer: HTMLElement
  scrollListeners: Array<{ el: EventTarget; handler: () => void }>
  resizeObserver: ResizeObserver | null
  warningTimer: ReturnType<typeof setTimeout> | null
  rafId: number | null
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

function findScrollContainer(el: HTMLElement): HTMLElement {
  let node: HTMLElement | null = el
  while (node && node !== document.body) {
    const { overflowY } = window.getComputedStyle(node)
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 1) {
      return node
    }
    node = node.parentElement
  }
  return el
}

function syncScroll() {
  if (!state) return
  const { scrollContainer, highlightDiv } = state

  const maxSourceY = scrollContainer.scrollHeight - scrollContainer.clientHeight
  if (maxSourceY > 0) {
    const ratioY = scrollContainer.scrollTop / maxSourceY
    const maxTargetY = highlightDiv.scrollHeight - highlightDiv.clientHeight
    highlightDiv.scrollTop = ratioY * maxTargetY
  } else {
    highlightDiv.scrollTop = 0
  }

  const maxSourceX = scrollContainer.scrollWidth - scrollContainer.clientWidth
  if (maxSourceX > 0) {
    const ratioX = scrollContainer.scrollLeft / maxSourceX
    const maxTargetX = highlightDiv.scrollWidth - highlightDiv.clientWidth
    highlightDiv.scrollLeft = ratioX * maxTargetX
  } else {
    highlightDiv.scrollLeft = 0
  }
}

let lastInputRect: { top: number; left: number; width: number; height: number } | null = null
let lastClipPath = ''

function getClipBounds(el: HTMLElement): { top: number; right: number; bottom: number; left: number } {
  const rect = el.getBoundingClientRect()
  let top = rect.top
  let left = rect.left
  let bottom = rect.bottom
  let right = rect.right

  let parent = el.parentElement
  while (parent) {
    const { overflow, overflowX, overflowY } = window.getComputedStyle(parent)
    const clips = [overflow, overflowX, overflowY].some(
      v => v === 'hidden' || v === 'auto' || v === 'scroll' || v === 'clip'
    )
    if (clips) {
      const pr = parent.getBoundingClientRect()
      top = Math.max(top, pr.top)
      left = Math.max(left, pr.left)
      bottom = Math.min(bottom, pr.bottom)
      right = Math.min(right, pr.right)
    }
    parent = parent.parentElement
  }

  return { top, left, bottom, right }
}

function positionHighlightLayer(inputEl: HTMLElement, highlightDiv: HTMLDivElement) {
  const rect = getInputRect(inputEl)

  // Use fixed positioning to avoid extending the document's scrollable area
  const top = rect.top
  const left = rect.left
  if (
    !lastInputRect ||
    lastInputRect.top !== top ||
    lastInputRect.left !== left ||
    lastInputRect.width !== rect.width ||
    lastInputRect.height !== rect.height
  ) {
    lastInputRect = { top, left, width: rect.width, height: rect.height }
    highlightDiv.style.position = 'fixed'
    highlightDiv.style.top = `${top}px`
    highlightDiv.style.left = `${left}px`
    highlightDiv.style.width = `${rect.width}px`
    highlightDiv.style.height = `${rect.height}px`
    highlightDiv.style.zIndex = '2147483640'
    highlightDiv.style.pointerEvents = 'none'
    highlightDiv.style.background = 'transparent'
  }

  const clip = getClipBounds(inputEl)
  const clipTop = Math.max(0, clip.top - rect.top)
  const clipRight = Math.max(0, rect.right - clip.right)
  const clipBottom = Math.max(0, rect.bottom - clip.bottom)
  const clipLeft = Math.max(0, clip.left - rect.left)
  const newClip = `inset(${clipTop}px ${clipRight}px ${clipBottom}px ${clipLeft}px)`
  if (newClip !== lastClipPath) {
    lastClipPath = newClip
    highlightDiv.style.clipPath = newClip
  }
}

function positionBadge() {
  if (!state) return
  const { badgeDiv, inputEl } = state
  if (badgeDiv.style.display === 'none') return
  const rect = getInputRect(inputEl)
  // Anchor badge inside the input's top-right corner so it stays visible
  // even when the input is scrolled or resized
  badgeDiv.style.top = `${rect.top + 4}px`
  badgeDiv.style.left = `${rect.right - 8}px`
}

function startPositionLoop() {
  if (!state) return
  function loop() {
    if (!state) return
    positionHighlightLayer(state.inputEl, state.highlightDiv)
    positionBadge()
    syncScroll()
    state.rafId = requestAnimationFrame(loop)
  }
  state.rafId = requestAnimationFrame(loop)
}

function stopPositionLoop() {
  if (state?.rafId != null) {
    cancelAnimationFrame(state.rafId)
    state.rafId = null
  }
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

  lastInputRect = null
  positionHighlightLayer(inputEl, highlightDiv)
  copyStyles(inputEl, highlightDiv)

  const scrollContainer = findScrollContainer(inputEl)
  const scrollListeners: Array<{ el: EventTarget; handler: () => void }> = []

  const scrollHandler = () => {
    positionHighlightLayer(inputEl, highlightDiv)
    syncScroll()
  }

  scrollContainer.addEventListener('scroll', scrollHandler, { passive: true })
  scrollListeners.push({ el: scrollContainer, handler: scrollHandler })

  if (scrollContainer !== inputEl) {
    inputEl.addEventListener('scroll', scrollHandler, { passive: true })
    scrollListeners.push({ el: inputEl, handler: scrollHandler })
  }

  window.addEventListener('scroll', scrollHandler, { passive: true })
  scrollListeners.push({ el: window, handler: scrollHandler })

  const resizeObserver = new ResizeObserver(() => {
    lastInputRect = null
    positionHighlightLayer(inputEl, highlightDiv)
    copyStyles(inputEl, highlightDiv)
    syncScroll()
  })
  resizeObserver.observe(inputEl)

  state = { inputEl, highlightDiv, badgeDiv, tooltipDiv, warningDiv, inspectPanelDiv, scrollContainer, scrollListeners, resizeObserver, warningTimer: null, rafId: null }
  panelOpen = false
  lastPanelData = null
  activeReplaceMode = 'original'

  startPositionLoop()

  return state
}

export function renderHighlights(text: string, matches: PIIMatch[], autoReplace: boolean = false) {
  if (!state) return

  const { highlightDiv, inputEl } = state

  if (matches.length === 0) {
    state.highlightDiv.innerHTML = ''
    updateBadge(0, autoReplace)
    return
  }

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

  // Prevent re-rendering and re-showing badge if the highlight layer is exactly the same 
  const oldHtml = highlightDiv.innerHTML
  const tempDiv = document.createElement('div')
  tempDiv.appendChild(frag)
  const newHtml = tempDiv.innerHTML

  if (oldHtml !== newHtml) {
    highlightDiv.innerHTML = newHtml
    syncScroll()
    updateBadge(matches.length, autoReplace)
  }
}

function updateBadge(count: number, autoReplace: boolean = false) {
  if (!state) return
  const { badgeDiv, inputEl } = state

  if (autoReplace) { // Auto Replace ON → handles everything automatically, never show badge
    badgeDiv.style.display = 'none'
    hideInspectPanel()
    return
  }

  if (count === 0) {
    badgeDiv.style.display = 'none'
    return
  }

  const rect = getInputRect(inputEl)

  badgeDiv.style.display = 'flex'
  badgeDiv.style.position = 'fixed'
  badgeDiv.style.top = `${rect.top + 4}px`
  badgeDiv.style.left = `${rect.right - 8}px`
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

export function showTooltip(x: number, y: number, type: PIIType, token: string, original: string, direction: 'outgoing' | 'incoming' = 'outgoing') {
  if (!state) return
  const isAutoReplace = (window as any).__PII_SHIELD_AUTO_REPLACE__?.() || false;
  console.log(`[PII Shield] showTooltip: dir=${direction}, type=${type}, token=${token}, orig=${original}, autoReplace=${isAutoReplace}`);

  // Nuke ALL stale .pii-shield-tooltip elements that are NOT our current state.tooltipDiv
  const allTooltips = document.querySelectorAll('.pii-shield-tooltip')
  console.log(`[PII Shield] Found ${allTooltips.length} .pii-shield-tooltip elements in DOM`)
  allTooltips.forEach(el => {
    if (el !== state!.tooltipDiv) {
      console.log(`[PII Shield] Removing stale tooltip: "${el.textContent?.substring(0, 60)}"`)
      el.remove()
    }
  })

  const { tooltipDiv } = state


  if (tooltipHideTimer) {
    clearTimeout(tooltipHideTimer)
    tooltipHideTimer = null
  }

  if (direction === 'incoming') {
    // Incoming response: show what token was sent to the AI.
    // The token is pre-resolved and stored as data-pii-token on the span,
    // so we just display it directly.
    tooltipDiv.innerHTML = `
      <div class="pii-shield-tooltip-stats" style="padding: 8px 12px;">
        <div class="stat">
          <span class="value" style="color: ${TYPE_COLORS[type] || '#eceff4'}; font-family: monospace; font-size: 13px;">sent as ${escapeHtml(token)}</span>
        </div>
      </div>
    `

  } else {
    // Outgoing: resolve token defensively from token map
    let outToken = token
    if (!/^\[[a-z]+_\d+\]$/.test(token)) {
      const tmap = getTokenMap()
      console.log(`[PII Shield] Tooltip fallback resolution. passed_token=${token}, map_size=${Object.keys(tmap).length}`);
      for (const [tok, orig] of Object.entries(tmap)) {
        if (orig === original || orig === token) {
          outToken = tok
          console.log(`[PII Shield] Resolved token from map: ${tok}`);
          break
        }
      }
    }
    if (!/^\[[a-z]+_\d+\]$/.test(outToken)) {
      console.warn(`[PII Shield] FAILED to resolve valid token for tooltip! outToken=${outToken}`);
    }
    tooltipDiv.innerHTML = `
      <div class="pii-shield-tooltip-title">
        ${isAutoReplace ? 'Auto Updated (Beta)' : 'Private Information Detected'}
      </div>
      <div class="pii-shield-tooltip-stats">
        ${isAutoReplace ? `
        <div class="stat">
          <span class="value" style="color: ${TYPE_COLORS[type] || '#eceff4'}">Replaced to <span style="font-family: monospace; color: #eceff4;">${escapeHtml(outToken)}</span> to protect privacy</span>
        </div>
        ` : `
        <div class="stat">
          <span class="label">Type</span>
          <span class="value" style="color: ${TYPE_COLORS[type] || '#eceff4'}">${type}</span>
        </div>
        <div class="stat">
          <span class="label">Token</span>
          <span class="value" style="font-family: monospace;">${escapeHtml(outToken)}</span>
        </div>
        `}
      </div>
      ${isAutoReplace ?
        `<div class="pii-shield-tooltip-footer pii-ignore-btn" data-type="${type}" data-original="${escapeHtml(original)}" style="cursor: pointer; color: #ebcb8b; padding-top: 8px; font-weight: bold;">
           Click here to IGNORE
         </div>` :
        '<div class="pii-shield-tooltip-footer">Click highlight to block only this instance</div>'
      }
    `
  }
  const TOP_OFFSET = 90
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
  }, 100)
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

  warningDiv.style.display = 'block'
  warningDiv.style.position = 'fixed'
  warningDiv.style.top = `${rect.bottom + 6}px`
  warningDiv.style.left = `${rect.left}px`

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
  const { highlightDiv, badgeDiv, tooltipDiv, warningDiv, inspectPanelDiv, scrollListeners, resizeObserver, warningTimer } = state

  stopPositionLoop()
  for (const { el, handler } of scrollListeners) {
    el.removeEventListener('scroll', handler)
  }
  if (resizeObserver) resizeObserver.disconnect()
  if (warningTimer) clearTimeout(warningTimer)
  highlightDiv.remove()
  badgeDiv.remove()
  tooltipDiv.remove()
  warningDiv.remove()
  inspectPanelDiv.remove()

  state = null
  lastInputRect = null
  lastClipPath = ''
  panelOpen = false
  lastPanelData = null
  activeReplaceMode = 'original'
}

export function getState(): HighlightState | null {
  return state
}

export function hideBadge() {
  if (state?.badgeDiv) {
    state.badgeDiv.style.display = 'none'
  }
}

/**
 * Full UI cleanup: hides badge, tooltip, inspect panel, and clears highlight marks.
 * Call this on message send, form submit, or any global "reset" event.
 */
export function cleanupAllUI() {
  hideBadge()
  hideTooltip()
  hideInspectPanel()
  if (state) {
    state.highlightDiv.textContent = ''
  }
}

/**
 * Clear highlight layer content and hide badge (for post-send state).
 */
export function clearHighlightLayer() {
  if (state) {
    state.highlightDiv.textContent = ''
  }
  hideBadge()
}
